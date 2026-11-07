param([string]$OutputDirectory,[string]$IsolatedReport)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDir

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker is required for backup.' }
. (Join-Path $PSScriptRoot 'testing/database-context.ps1')
$taskDatabaseContext=Get-CryptaDatabaseContext -ProjectDirectory $projectDir -IsolatedReport $IsolatedReport
$dbName=$taskDatabaseContext.Database
$dbUser=$taskDatabaseContext.User
$taskComposeArguments=$taskDatabaseContext.ComposeArguments

if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectDir 'backups' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$containerId=$taskDatabaseContext.ContainerId

$id = [guid]::NewGuid().ToString('N').Substring(0, 8)
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$backupFile = Join-Path $OutputDirectory "crypta-$stamp-$id.dump"
$containerFile = "/tmp/crypta-backup-$id.dump"
try {
  docker @taskComposeArguments exec -T postgres pg_dump -U $dbUser -d $dbName --format=custom --file=$containerFile
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed.' }
  docker cp "${containerId}:$containerFile" $backupFile
  if ($LASTEXITCODE -ne 0) { throw 'Could not copy backup from PostgreSQL container.' }
  $file = Get-Item -LiteralPath $backupFile
  if ($file.Length -eq 0) { throw 'Backup file is empty.' }
  $manifest = [ordered]@{
    sourceDatabase = $dbName
    sourceProject = $taskDatabaseContext.Project
    createdAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    bytes = $file.Length
    sha256 = (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  [System.IO.File]::WriteAllText("$backupFile.json", ($manifest | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "Backup created: $backupFile" -ForegroundColor Green
  Write-Host 'Verify it by restoring to a separate database before relying on it.' -ForegroundColor Yellow
} finally {
  docker @taskComposeArguments exec -T postgres rm -f -- $containerFile | Out-Null
}
