param([Parameter(Mandatory=$true)][string]$ReportPath)

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'testing/database-context.ps1')
$taskArtifactRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'test-artifacts/integration'))
$taskReportPath = (Resolve-Path -LiteralPath $ReportPath).Path
if (-not $taskReportPath.StartsWith($taskArtifactRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Report must belong to the isolated integration artifact root.' }
$taskReport = Get-Content -LiteralPath $taskReportPath -Raw | ConvertFrom-Json
$taskProject = [string]$taskReport.project
if ($taskProject -notmatch '^crypta-t30-test-[a-f0-9]{12}$' -or (Split-Path -Leaf (Split-Path -Parent $taskReportPath)) -ne $taskProject) { throw 'Invalid test project identity.' }
if ($taskReport.database -ne 'crypta_t30_test' -or $taskReport.provider -ne 'MOCK' -or $taskReport.smtpEnabled -ne $false -or $taskReport.fixtureOnly -ne $false) { throw 'Report does not describe the supported isolated test configuration.' }
if (-not $taskReport.started -or -not $taskReport.keptStack -or $taskReport.cleanupCompleted) { throw 'Expected a started, retained test stack awaiting cleanup.' }
$taskEnvironmentPath = Join-Path (Split-Path -Parent $taskReportPath) 'test.env'
$taskComposePath = Join-Path $PSScriptRoot 'testing/compose.t30.yml'
$taskComposeArgs = @('compose','--project-name',$taskProject,'--env-file',$taskEnvironmentPath,'--file',$taskComposePath)

function Invoke-TestDocker([string[]]$Arguments) {
  $taskOutput = & docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker command failed: $($Arguments[0])" }
  return $taskOutput
}
$taskConfig = ((Invoke-TestDocker ($taskComposeArgs + @('config','--format','json'))) -join [Environment]::NewLine) | ConvertFrom-Json
if ($taskConfig.name -ne $taskProject -or $taskConfig.volumes.test_postgres.name -ne "${taskProject}_test_postgres" -or $taskConfig.volumes.test_postgres.external -eq $true) { throw 'Compose volume identity does not match the test namespace.' }
$taskContainerIds = @(Invoke-TestDocker -Arguments @('ps','-a','--filter',"label=com.docker.compose.project=$taskProject",'--format','{{.ID}}'))
if ($taskContainerIds.Count -ne 3) { throw 'Expected exactly three test containers before cleanup.' }
$taskContainers = ((Invoke-TestDocker (@('inspect') + $taskContainerIds)) -join [Environment]::NewLine) | ConvertFrom-Json
foreach ($taskContainer in $taskContainers) { if ($taskContainer.Config.Labels.'com.docker.compose.project' -ne $taskProject) { throw 'Container ownership mismatch.' } }
$taskVolumeName = "${taskProject}_test_postgres"
$taskVolume = ((Invoke-TestDocker -Arguments @('volume','inspect',$taskVolumeName)) -join [Environment]::NewLine) | ConvertFrom-Json
if ($taskVolume.Labels.'com.docker.compose.project' -ne $taskProject) { throw 'Volume ownership mismatch.' }
$taskBeforeInventory = @(Get-CryptaContainerInventory)
$taskBeforeOthers = @($taskBeforeInventory | Where-Object { $_.project -cne $taskProject })
$taskResidues = Invoke-TestDocker ($taskComposeArgs + @('exec','-T','postgres','psql','-U','crypta_t30_test','-d','crypta_t30_test','-At','-c',"SELECT (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND starts_with(tgname,'t30_')) || ',' || (SELECT count(*) FROM pg_proc WHERE starts_with(proname,'t30_'));"))
if (($taskResidues -join '').Trim() -ne '0,0') { throw 'Test triggers/functions remain; remove them in their owning test cleanup before removing the stack.' }

Invoke-TestDocker ($taskComposeArgs + @('down','--volumes','--remove-orphans')) | Out-Null
$taskRemainingContainers = @(Invoke-TestDocker -Arguments @('ps','-a','--filter',"label=com.docker.compose.project=$taskProject",'--format','{{.ID}}'))
$taskRemainingVolumes = @(Invoke-TestDocker -Arguments @('volume','ls','--filter',"label=com.docker.compose.project=$taskProject",'--format','{{.Name}}'))
$taskRemainingNetworks = @(Invoke-TestDocker -Arguments @('network','ls','--filter',"label=com.docker.compose.project=$taskProject",'--format','{{.Name}}'))
$taskAfterInventory = @(Get-CryptaContainerInventory)
$taskAfterOthers = @($taskAfterInventory | Where-Object { $_.project -cne $taskProject })
if ($taskRemainingContainers.Count -or $taskRemainingVolumes.Count -or $taskRemainingNetworks.Count) { throw 'Some test resources remain after cleanup.' }
if (-not (Test-CryptaContainerIdentitiesMatch -Before $taskBeforeOthers -After $taskAfterOthers)) { throw 'Container identity outside the test project changed; inspect before recording cleanup success.' }
$taskCleanup = [ordered]@{project=$taskProject;cleanupCompleted=$true;testContainerCountBefore=$taskContainerIds.Count;remainingContainers=0;remainingVolumes=0;remainingNetworks=0;testTriggers=0;testFunctions=0;containerInventoryBefore=$taskBeforeInventory;containerInventoryAfter=$taskAfterInventory;containerCountBefore=$taskBeforeInventory.Count;containerCountAfter=$taskAfterInventory.Count;otherContainerIdsPreserved=$true;otherContainerIdentityCheckScope='all-running-and-stopped-including-unlabeled';otherContainerIdentityComparisonHasSubjects=($taskBeforeOthers.Count -gt 0);otherContainersBefore=$taskBeforeOthers;otherContainersAfter=$taskAfterOthers;otherContainerCountBefore=$taskBeforeOthers.Count;otherContainerCountAfter=$taskAfterOthers.Count;otherContainers=$taskAfterOthers;completedUtc=[DateTimeOffset]::UtcNow.ToString('o')}
$taskCleanupPath = Join-Path (Split-Path -Parent $taskReportPath) 'cleanup-report.json'
[IO.File]::WriteAllText($taskCleanupPath,($taskCleanup | ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding $false))
$taskReport.cleanupCompleted=$true
$taskReport.keptStack=$false
[IO.File]::WriteAllText($taskReportPath,($taskReport | ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding $false))
Write-Host "PASS isolated cleanup: $taskProject; report: $taskCleanupPath"
