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

$id = [guid]::NewGuid().ToString('N')
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$backupFile = Join-Path (Resolve-Path -LiteralPath $OutputDirectory).Path "crypta-$stamp-$id.dump"
$pendingDump = "$backupFile.partial"
$pendingManifest = "$backupFile.json.partial"
$containerFile = "/tmp/crypta-backup-$id.dump"
$dumpPublished = $false
$manifestPublished = $false
try {
  docker @taskComposeArguments exec -T postgres pg_dump -U $dbUser -d $dbName --format=custom --file=$containerFile
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed.' }
  $containerChecksum = docker @taskComposeArguments exec -T postgres sha256sum $containerFile
  if ($LASTEXITCODE -ne 0 -or $containerChecksum -cnotmatch '^([a-f0-9]{64})\s') { throw 'Could not read backup checksum from PostgreSQL container.' }
  $sourceHash = $Matches[1]
  docker cp "${containerId}:$containerFile" $pendingDump
  if ($LASTEXITCODE -ne 0) { throw 'Could not copy backup from PostgreSQL container.' }
  $file = Get-Item -LiteralPath $pendingDump
  if ($file.Length -eq 0) { throw 'Backup file is empty.' }
  $copiedHash = (Get-FileHash -LiteralPath $pendingDump -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($copiedHash -cne $sourceHash) { throw 'Backup copy checksum does not match the source archive.' }
  $manifest = [ordered]@{
    sourceDatabase = $dbName
    sourceProject = $taskDatabaseContext.Project
    createdAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    bytes = $file.Length
    sha256 = $copiedHash
  }
  [IO.File]::WriteAllText($pendingManifest, ($manifest | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
  [IO.File]::Move($pendingDump, $backupFile)
  $dumpPublished = $true
  [IO.File]::Move($pendingManifest, "$backupFile.json")
  $manifestPublished = $true
  Write-Host "Backup created: $backupFile" -ForegroundColor Green
  Write-Host 'Verify it by restoring to a separate database before relying on it.' -ForegroundColor Yellow
} finally {
  try {
    [IO.File]::Delete($pendingDump)
    [IO.File]::Delete($pendingManifest)
    if ($dumpPublished -and -not $manifestPublished) { [IO.File]::Delete($backupFile) }
  } finally {
    docker @taskComposeArguments exec -T postgres rm -f -- $containerFile | Out-Null
  }
}
