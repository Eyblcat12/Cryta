# Requires a fresh retained stack created by test-isolated-stack.ps1.
param([Parameter(Mandatory=$true)][string]$ReportPath)

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'testing/database-context.ps1')
$taskContext = Get-CryptaDatabaseContext -ProjectDirectory $taskRoot -IsolatedReport $ReportPath
$taskReportPath = (Resolve-Path -LiteralPath $ReportPath).Path
$taskReport = Get-Content -LiteralPath $taskReportPath -Raw | ConvertFrom-Json
$taskOutput = Join-Path (Split-Path -Parent $taskReportPath) 'operations-metrics.json'
if ($taskReport.status -ne 'PASSED' -or $taskReport.fixtureOnly -ne $false -or (Test-Path -LiteralPath $taskOutput)) {
  throw 'Expected a fresh isolated stack with passing smoke tests.'
}
$taskArgs = $taskContext.ComposeArguments
$taskContainers = @(& docker @taskArgs ps -q backend)
if ($LASTEXITCODE -ne 0 -or $taskContainers.Count -ne 1) { throw 'Expected one isolated backend.' }
$taskBackend = $taskContainers[0]
$taskLabels = & docker inspect --format '{{json .Config.Labels}}' $taskBackend | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $taskLabels.'com.docker.compose.project' -cne $taskContext.Project -or
    $taskLabels.'com.docker.compose.service' -cne 'backend') {
  throw 'Backend ownership mismatch.'
}
$taskFixture = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'testing/operations-metrics-runner.cjs') -Raw
$taskRaw = $taskFixture | & docker exec -i $taskBackend node -
if ($LASTEXITCODE -ne 0) { throw 'Operations metrics fixture failed.' }
$taskResults = $taskRaw | ConvertFrom-Json
if (-not $taskResults.success) { throw 'Operations metrics fixture did not pass.' }
$taskResults | Add-Member -NotePropertyName project -NotePropertyValue $taskContext.Project
$taskResults | Add-Member -NotePropertyName backendImage -NotePropertyValue (& docker inspect --format '{{.Image}}' $taskBackend)
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify the tested backend image.' }
$taskResults | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath $taskOutput -Encoding utf8
Write-Host "PASS isolated operations metrics: $taskOutput"
