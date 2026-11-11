param([Parameter(Mandatory=$true)][string]$ReportPath)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'testing/database-context.ps1')
$taskContext=Get-CryptaDatabaseContext -ProjectDirectory $taskRoot -IsolatedReport $ReportPath
if (-not $taskContext.Project) { throw 'Backup rehearsal requires an isolated test project.' }
$taskComposeArguments=$taskContext.ComposeArguments
$taskRunningBackend=@(& docker ps --filter "label=com.docker.compose.project=$($taskContext.Project)" --filter 'label=com.docker.compose.service=backend' --format '{{.ID}}')
if ($LASTEXITCODE -ne 0 -or $taskRunningBackend.Count) { throw 'Stop only the isolated backend before taking a stable rehearsal snapshot.' }
$taskDirectory=Join-Path (Split-Path -Parent (Resolve-Path -LiteralPath $ReportPath).Path) ('backup-restore-'+[guid]::NewGuid().ToString('N').Substring(0,12))
[void](New-Item -ItemType Directory -Path $taskDirectory)
$taskTarget='crypta_restore_'+[guid]::NewGuid().ToString('N').Substring(0,12)
$taskResults=New-Object System.Collections.Generic.List[object]
function Test-Condition([string]$Name,[bool]$Condition) { if (-not $Condition) { throw "Rehearsal failed: $Name" };$taskResults.Add([ordered]@{name=$Name;passed=$true});Write-Host "PASS $Name" }
function Invoke-RehearsalSql([string]$Database,[string]$Query) {
  $taskValue=& docker @taskComposeArguments exec -T postgres psql -U crypta_t30_test -d $Database -At -v ON_ERROR_STOP=1 -c $Query
  if ($LASTEXITCODE -ne 0) { throw 'Rehearsal SQL failed.' };return ($taskValue -join [Environment]::NewLine)
}
function Get-RehearsalSnapshot([string]$Database) {
  $taskNames=(Invoke-RehearsalSql $Database "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;").Split([char]10,[StringSplitOptions]::RemoveEmptyEntries)
  foreach ($taskName in $taskNames) {
    $taskQuotedName=$taskName.Trim().Replace('"','""')
    $taskCounts=Invoke-RehearsalSql $Database ('SELECT count(*),md5(coalesce(string_agg(to_jsonb(t)::text,chr(10) ORDER BY to_jsonb(t)::text),'''')) FROM public."'+$taskQuotedName+'" t;')
    $taskFields=$taskCounts.Trim().Split('|');[ordered]@{table=$taskName.Trim();rows=[long]$taskFields[0];dataMd5=$taskFields[1]}
  }
}
function Test-RestoreRejected([string]$Name,[string]$File,[string]$Target,[string]$Expected) {
  $taskRejected=$false
  try { & (Join-Path $PSScriptRoot 'restore-crypta-test.ps1') -BackupFile $File -TargetDatabase $Target -IsolatedReport $ReportPath }
  catch { $taskRejected=$_.Exception.Message -match $Expected }
  Test-Condition $Name $taskRejected
}
function Test-DamagedBackupCopy {
  $taskDestination=Join-Path $taskDirectory 'damaged-copy'
  $taskDockerBinary=(Get-Command docker -CommandType Application | Select-Object -First 1).Source
  function docker {
    & $taskDockerBinary @args
    if ($args[0] -eq 'cp' -and $LASTEXITCODE -eq 0) {
      $taskFile=[IO.File]::Open($args[2],[IO.FileMode]::Open,[IO.FileAccess]::Write)
      try { $taskFile.SetLength($taskFile.Length - 1) } finally { $taskFile.Dispose() }
    }
  }
  $taskRejected=$false
  try { & (Join-Path $PSScriptRoot 'backup-crypta.ps1') -OutputDirectory $taskDestination -IsolatedReport $ReportPath }
  catch { $taskRejected=$_.Exception.Message -eq 'Backup copy checksum does not match the source archive.' }
  Test-Condition 'A damaged transfer is rejected without publishing a dump or manifest' ($taskRejected -and @(Get-ChildItem -LiteralPath $taskDestination -Force).Count -eq 0)
}
$taskWatch=[Diagnostics.Stopwatch]::StartNew()
$taskOutput=[ordered]@{project=$taskContext.Project;sourceDatabase=$taskContext.Database;targetDatabase=$taskTarget;fixtureOnly=$false;provider='MOCK';smtpEnabled=$false;success=$false;results=$taskResults;createdUtc=[DateTimeOffset]::UtcNow.ToString('o')}
try {
  $taskBeforeInventory=@(Get-CryptaContainerInventory)
  $taskBeforeOthers=@($taskBeforeInventory | Where-Object { $_.project -cne $taskContext.Project })
  $taskOutput.containerInventoryBefore=$taskBeforeInventory
  $taskOutput.containerCountBefore=$taskBeforeInventory.Count
  $taskOutput.otherContainersBefore=$taskBeforeOthers
  $taskOutput.otherContainerCountBefore=$taskBeforeOthers.Count
  $taskOutput.otherContainerIdentityCheckScope='all-running-and-stopped-including-unlabeled'
  $taskOutput.otherContainerIdentityComparisonHasSubjects=($taskBeforeOthers.Count -gt 0)
  $taskSource=@(Get-RehearsalSnapshot $taskContext.Database)
  $taskSourceSequences=Invoke-RehearsalSql $taskContext.Database "SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename;"
  Test-DamagedBackupCopy
  & (Join-Path $PSScriptRoot 'backup-crypta.ps1') -OutputDirectory $taskDirectory -IsolatedReport $ReportPath
  $taskDump=(Get-ChildItem -LiteralPath $taskDirectory -Filter '*.dump' | Select-Object -First 1).FullName
  $taskManifest=Get-Content -LiteralPath "$taskDump.json" -Raw | ConvertFrom-Json
  Test-Condition 'Backup nonempty and SHA256 matches manifest' ((Get-Item -LiteralPath $taskDump).Length -gt 0 -and (Get-FileHash -LiteralPath $taskDump -Algorithm SHA256).Hash.ToLowerInvariant() -eq $taskManifest.sha256)
  $taskMissing=Join-Path $taskDirectory 'missing-manifest.dump';Copy-Item -LiteralPath $taskDump -Destination $taskMissing
  Test-RestoreRejected 'Missing checksum manifest is rejected before database creation' $taskMissing ($taskTarget+'_missing') 'manifest is missing'
  $taskCorrupt=Join-Path $taskDirectory 'wrong-checksum.dump';Copy-Item -LiteralPath $taskDump -Destination $taskCorrupt
  [IO.File]::WriteAllText("$taskCorrupt.json",('{"sha256":"'+('0'*64)+'"}'),(New-Object Text.UTF8Encoding $false))
  Test-RestoreRejected 'Wrong checksum is rejected before database creation' $taskCorrupt ($taskTarget+'_corrupt') 'checksum does not match'
  $taskTruncated=Join-Path $taskDirectory 'truncated.dump'
  $taskHeader=New-Object byte[] 12
  $taskStream=[IO.File]::OpenRead($taskDump)
  try { if ($taskStream.Read($taskHeader,0,$taskHeader.Length) -ne $taskHeader.Length) { throw 'Fixture dump is too short.' } }
  finally { $taskStream.Dispose() }
  [IO.File]::WriteAllBytes($taskTruncated,$taskHeader)
  $taskTruncatedHash=(Get-FileHash -LiteralPath $taskTruncated -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText("$taskTruncated.json",(@{sha256=$taskTruncatedHash;bytes=$taskHeader.Length} | ConvertTo-Json))
  Test-RestoreRejected 'Truncated archive with a matching checksum is rejected before database creation' $taskTruncated ($taskTarget+'_truncated') 'not a readable PostgreSQL archive'
  Test-RestoreRejected 'Source database cannot be overwritten' $taskDump $taskContext.Database 'Refusing to restore into'
  $taskAbsent=Invoke-RehearsalSql 'postgres' ("SELECT count(*) FROM pg_database WHERE datname IN ('$($taskTarget)_missing','$($taskTarget)_corrupt','$($taskTarget)_truncated');")
  Test-Condition 'Rejected backup attempts created no database' ($taskAbsent.Trim() -eq '0')
  $taskRestoreWatch=[Diagnostics.Stopwatch]::StartNew()
  & (Join-Path $PSScriptRoot 'restore-crypta-test.ps1') -BackupFile $taskDump -TargetDatabase $taskTarget -IsolatedReport $ReportPath
  $taskRestored=@(Get-RehearsalSnapshot $taskTarget)
  $taskRestoredSequences=Invoke-RehearsalSql $taskTarget "SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename;"
  Test-Condition 'All public tables have matching row counts and row hashes' (($taskSource | ConvertTo-Json -Depth 4 -Compress) -ceq ($taskRestored | ConvertTo-Json -Depth 4 -Compress))
  Test-Condition 'Public sequence values match the backup source' ($taskSourceSequences -ceq $taskRestoredSequences)
  $taskPublicAccess = Invoke-RehearsalSql $taskTarget @'
SELECT NOT EXISTS (SELECT 1 FROM pg_database d,
  LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) acl
  WHERE d.datname=current_database() AND acl.grantee=0 AND acl.privilege_type='CONNECT')
AND EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid='public.capture_audit_anchor_rows(bigint,integer)'::regprocedure
  AND p.prosecdef AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
  WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'));
'@
  Test-Condition 'Restore database and checkpoint function are closed to PUBLIC' ($taskPublicAccess -ceq 't')
  $taskRestoreWatch.Stop();$taskOutput.restoreAndVerifySeconds=$taskRestoreWatch.Elapsed.TotalSeconds
  Test-RestoreRejected 'An existing target database cannot be replaced' $taskDump $taskTarget 'already exists or could not be created'
  $taskAfter=@(Get-RehearsalSnapshot $taskTarget)
  Test-Condition 'Existing-target rejection leaves restored data intact' (($taskRestored | ConvertTo-Json -Depth 4 -Compress) -ceq ($taskAfter | ConvertTo-Json -Depth 4 -Compress))
  $taskSourceAfter=@(Get-RehearsalSnapshot $taskContext.Database)
  Test-Condition 'Source database rows remain unchanged by rehearsal' (($taskSource | ConvertTo-Json -Depth 4 -Compress) -ceq ($taskSourceAfter | ConvertTo-Json -Depth 4 -Compress))
  $taskAfterInventory=@(Get-CryptaContainerInventory)
  $taskAfterOthers=@($taskAfterInventory | Where-Object { $_.project -cne $taskContext.Project })
  $taskOutput.containerInventoryAfter=$taskAfterInventory
  $taskOutput.containerCountAfter=$taskAfterInventory.Count
  $taskOutput.otherContainersAfter=$taskAfterOthers
  $taskOutput.otherContainerCountAfter=$taskAfterOthers.Count
  $taskOutput.otherContainerIdsPreserved=Test-CryptaContainerIdentitiesMatch -Before $taskBeforeOthers -After $taskAfterOthers
  Test-Condition 'Other container identities are preserved' $taskOutput.otherContainerIdsPreserved
  $taskOutput.success=$true;$taskOutput.tables=$taskRestored;$taskOutput.backupFile=Split-Path -Leaf $taskDump;$taskOutput.backupSha256=$taskManifest.sha256;$taskOutput.backupBytes=$taskManifest.bytes
} catch { $taskOutput.error=$_.Exception.Message;throw }
finally {
  $taskWatch.Stop();$taskOutput.elapsedSeconds=$taskWatch.Elapsed.TotalSeconds;$taskOutput.finishedUtc=[DateTimeOffset]::UtcNow.ToString('o')
  [IO.File]::WriteAllText((Join-Path $taskDirectory 'results.json'),($taskOutput | ConvertTo-Json -Depth 7),(New-Object Text.UTF8Encoding $false))
  Write-Host "Rehearsal report: $(Join-Path $taskDirectory 'results.json')"
}
