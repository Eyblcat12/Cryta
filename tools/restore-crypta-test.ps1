param(
  [Parameter(Mandatory=$true)][string]$BackupFile,
  [Parameter(Mandatory=$true)][string]$TargetDatabase,
  [string]$IsolatedReport
)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDir

$resolvedBackup = (Resolve-Path -LiteralPath $BackupFile -ErrorAction Stop).Path
if ($TargetDatabase -cnotmatch '^[a-z][a-z0-9_]{2,62}$') { throw 'TargetDatabase must use 3-63 lowercase letters, digits or underscores.' }
. (Join-Path $PSScriptRoot 'testing/database-context.ps1')
$taskDatabaseContext=Get-CryptaDatabaseContext -ProjectDirectory $projectDir -IsolatedReport $IsolatedReport
$sourceName=$taskDatabaseContext.Database
$dbUser=$taskDatabaseContext.User
$taskComposeArguments=$taskDatabaseContext.ComposeArguments
if ($TargetDatabase -eq $sourceName) { throw 'Refusing to restore into the live source database.' }
if ($dbUser -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw 'Invalid database user in .env.' }

$manifestFile = "$resolvedBackup.json"
if (-not (Test-Path -LiteralPath $manifestFile)) { throw 'Backup checksum manifest is missing.' }
$manifest = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
if ([string]$manifest.sha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'Backup checksum manifest is invalid.' }
$actualHash = (Get-FileHash -LiteralPath $resolvedBackup -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $manifest.sha256) { throw 'Backup checksum does not match its manifest.' }

$containerId=$taskDatabaseContext.ContainerId
$id = [guid]::NewGuid().ToString('N').Substring(0, 8)
$containerFile = "/tmp/crypta-restore-$id.dump"
try {
  docker cp $resolvedBackup "${containerId}:$containerFile"
  if ($LASTEXITCODE -ne 0) { throw 'Could not copy backup into PostgreSQL container.' }
  # createdb refuses an existing database, so this script cannot replace live data.
  docker @taskComposeArguments exec -T postgres createdb -U $dbUser $TargetDatabase
  if ($LASTEXITCODE -ne 0) { throw 'Target database already exists or could not be created.' }
  docker @taskComposeArguments exec -T postgres pg_restore -U $dbUser --dbname=$TargetDatabase --exit-on-error --no-owner --no-acl $containerFile
  if ($LASTEXITCODE -ne 0) { throw "Restore failed. The separate database '$TargetDatabase' was left in place for inspection." }
  docker @taskComposeArguments exec -T postgres psql -U $dbUser -d $TargetDatabase -Atqc 'SELECT COUNT(*) FROM users'
  if ($LASTEXITCODE -ne 0) { throw 'Restore finished but the users table verification failed.' }
  Write-Host "Restore verified in separate database: $TargetDatabase" -ForegroundColor Green
  Write-Host 'The original Crypta database was not modified.' -ForegroundColor Green
} finally {
  docker @taskComposeArguments exec -T postgres rm -f -- $containerFile | Out-Null
}
