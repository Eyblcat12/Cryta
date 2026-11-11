function Get-CryptaContainerInventory {
  # Go raw strings keep the label key intact under Windows PowerShell 5.1's native argument quoting.
  $taskInventoryLines=@(& docker ps -a --no-trunc --format '{{.ID}}|{{.Names}}|{{.Label `com.docker.compose.project`}}')
  $taskInventoryExitCode=$LASTEXITCODE
  if ($taskInventoryExitCode -ne 0) { throw 'Cannot capture the complete Docker container inventory.' }
  $taskSeenIds=@{}
  $taskInventory=foreach ($taskInventoryLine in $taskInventoryLines) {
    $taskInventoryFields=([string]$taskInventoryLine).Split([char]'|')
    if ($taskInventoryFields.Count -ne 3 -or
        $taskInventoryFields[0] -cnotmatch '^[a-f0-9]{64}$' -or
        $taskInventoryFields[1] -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*(,[A-Za-z0-9][A-Za-z0-9_.-]*)*$' -or
        ($taskInventoryFields[2] -ne '' -and $taskInventoryFields[2] -cnotmatch '^[a-z0-9][a-z0-9_-]*$')) {
      throw 'Docker container inventory is malformed.'
    }
    if ($taskSeenIds.ContainsKey($taskInventoryFields[0])) { throw 'Docker container inventory contains duplicate IDs.' }
    $taskSeenIds[$taskInventoryFields[0]]=$true
    [pscustomobject]@{id=$taskInventoryFields[0];name=$taskInventoryFields[1];project=$taskInventoryFields[2]}
  }
  $taskInventory | Sort-Object -Property id
}

function Test-CryptaContainerIdentitiesMatch([object[]]$Before,[object[]]$After) {
  $taskBeforeIdentities=@($Before | ForEach-Object { "$($_.id)|$($_.name)|$($_.project)" } | Sort-Object)
  $taskAfterIdentities=@($After | ForEach-Object { "$($_.id)|$($_.name)|$($_.project)" } | Sort-Object)
  if ($taskBeforeIdentities.Count -ne $taskAfterIdentities.Count) { return $false }
  for ($taskIndex=0;$taskIndex -lt $taskBeforeIdentities.Count;$taskIndex++) {
    if ($taskBeforeIdentities[$taskIndex] -cne $taskAfterIdentities[$taskIndex]) { return $false }
  }
  return $true
}

function Get-CryptaDatabaseContext([string]$ProjectDirectory,[string]$IsolatedReport) {
  if ($IsolatedReport) {
    $taskReportPath=(Resolve-Path -LiteralPath $IsolatedReport).Path
    $taskArtifactRoot=[IO.Path]::GetFullPath((Join-Path $ProjectDirectory 'tools/test-artifacts/integration'))
    if (-not $taskReportPath.StartsWith($taskArtifactRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Isolated report is outside the test artifact root.' }
    $taskReport=Get-Content -LiteralPath $taskReportPath -Raw | ConvertFrom-Json
    $taskProject=[string]$taskReport.project
    if ($taskProject -notmatch '^crypta-t30-test-[a-f0-9]{12}$' -or (Split-Path -Leaf (Split-Path -Parent $taskReportPath)) -ne $taskProject) { throw 'Invalid isolated project identity.' }
    if ($taskReport.database -ne 'crypta_t30_test' -or -not $taskReport.started -or -not $taskReport.keptStack -or $taskReport.cleanupCompleted -or $taskReport.provider -ne 'MOCK' -or $taskReport.smtpEnabled -ne $false) { throw 'Expected a retained isolated MOCK/SMTP-disabled test stack.' }
    $taskArguments=@('compose','--project-name',$taskProject,'--env-file',(Join-Path (Split-Path -Parent $taskReportPath) 'test.env'),'--file',(Join-Path $ProjectDirectory 'tools/testing/compose.t30.yml'))
    $taskIds=@(& docker @taskArguments ps -q postgres)
    $taskExitCode=$LASTEXITCODE
    if ($taskExitCode -ne 0 -or $taskIds.Count -ne 1) { throw 'Expected one running isolated PostgreSQL container.' }
    $taskId=[string]$taskIds[0]
    if ([string]::IsNullOrWhiteSpace($taskId)) { throw 'Isolated PostgreSQL is not running.' }
    $taskInspection=(& docker inspect $taskId.Trim()) -join [Environment]::NewLine
    if ($LASTEXITCODE -ne 0) { throw 'Cannot verify PostgreSQL ownership.' }
    $taskContainer=$taskInspection | ConvertFrom-Json
    if ($taskContainer.Config.Labels.'com.docker.compose.project' -ne $taskProject -or $taskContainer.Config.Labels.'com.docker.compose.service' -ne 'postgres') { throw 'PostgreSQL ownership mismatch.' }
    return @{Database='crypta_t30_test';User='crypta_t30_test';ComposeArguments=$taskArguments;ContainerId=$taskId.Trim();Project=$taskProject}
  }
  $taskEnvironmentPath=Join-Path $ProjectDirectory '.env'
  if (-not (Test-Path -LiteralPath $taskEnvironmentPath)) { throw '.env is missing.' }
  $taskSettings=@{}
  Get-Content -LiteralPath $taskEnvironmentPath | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { $taskSettings[$matches[1]]=$matches[2] } }
  $taskDatabase=if ($taskSettings['POSTGRES_DB']) { $taskSettings['POSTGRES_DB'] } else { 'crypta' }
  $taskUser=if ($taskSettings['POSTGRES_USER']) { $taskSettings['POSTGRES_USER'] } else { 'crypta' }
  if ($taskDatabase -notmatch '^[A-Za-z_][A-Za-z0-9_]*$' -or $taskUser -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw 'Invalid database/user in .env.' }
  $taskIds=@(& docker compose ps -q postgres)
  $taskExitCode=$LASTEXITCODE
  if ($taskExitCode -ne 0 -or $taskIds.Count -ne 1) { throw 'Expected one running PostgreSQL container.' }
  $taskId=[string]$taskIds[0]
  if ([string]::IsNullOrWhiteSpace($taskId)) { throw 'PostgreSQL is not running.' }
  return @{Database=$taskDatabase;User=$taskUser;ComposeArguments=@('compose');ContainerId=$taskId.Trim();Project=$null}
}
