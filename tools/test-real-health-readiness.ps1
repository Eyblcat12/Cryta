# Requires PowerShell 7 and a fresh retained stack created by test-isolated-stack.ps1.
param([Parameter(Mandatory=$true)][string]$ReportPath)

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'testing/database-context.ps1')
$taskContext = Get-CryptaDatabaseContext -ProjectDirectory $taskRoot -IsolatedReport $ReportPath
$taskReportPath = (Resolve-Path -LiteralPath $ReportPath).Path
$taskReport = Get-Content -LiteralPath $taskReportPath -Raw | ConvertFrom-Json
$taskOutputPath = Join-Path (Split-Path -Parent $taskReportPath) 'health-readiness.json'
if ($taskReport.status -ne 'PASSED' -or $taskReport.fixtureOnly -ne $false -or
    $taskReport.origin -cnotmatch '^http://127\.0\.0\.1:[0-9]{4,5}$' -or
    (Test-Path -LiteralPath $taskOutputPath)) {
  throw 'Expected a fresh isolated stack with passing smoke tests and a loopback origin.'
}

function Invoke-TestDocker([string[]]$Arguments) {
  $taskOutput = & docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker command failed: $($Arguments[0])" }
  return $taskOutput
}

$taskBackend, $taskFrontend = foreach ($taskService in @('backend', 'frontend')) {
  $taskIds = @(Invoke-TestDocker ($taskContext.ComposeArguments + @('ps', '-q', $taskService)))
  if ($taskIds.Count -ne 1) { throw "Expected one running isolated $taskService container." }
  $taskIds[0]
}
$taskBinding = Invoke-TestDocker @('port', $taskFrontend, '80/tcp')
if ("http://$taskBinding" -cne $taskReport.origin) { throw 'Frontend port does not match the isolated report.' }

function Get-BackendProcess {
  Invoke-TestDocker @('inspect', '--format', '{{.Id}} {{.Image}} {{.State.Pid}} {{.State.StartedAt}} {{.RestartCount}}', $taskBackend)
}

$taskResults = [ordered]@{
  project = $taskContext.Project
  backendBefore = Get-BackendProcess
  postgresId = $taskContext.ContainerId
  probes = [Collections.Generic.List[object]]::new()
  success = $false
}
$taskHeaderMarker = 'synthetic-client-request-id'
$taskQueryMarker = 'synthetic-url-secret'
function Test-Probe([string]$Phase, [string]$Path, [int]$Expected) {
  $taskTimer = [Diagnostics.Stopwatch]::StartNew()
  $taskUrl = "$($taskReport.origin)/api/v1/health$Path"
  $taskHeaders = @{}
  if ($Expected -eq 503) {
    $taskUrl += "?fixture=$taskQueryMarker"
    $taskHeaders['x-request-id'] = $taskHeaderMarker
  }
  $taskResponse = Invoke-WebRequest -Uri $taskUrl -Headers $taskHeaders -SkipHttpErrorCheck -TimeoutSec 3 -NoProxy
  $taskElapsed = $taskTimer.ElapsedMilliseconds
  $taskBody = $taskResponse.Content | ConvertFrom-Json
  $taskResults.probes.Add([ordered]@{
    phase = $Phase
    path = "/api/v1/health$Path"
    status = [int]$taskResponse.StatusCode
    elapsedMs = $taskElapsed
    code = $taskBody.error.code
    requestId = $taskBody.requestId
    database = $taskBody.data.database
  })
  if ($taskResponse.StatusCode -ne $Expected -or $taskElapsed -ge 3000) {
    throw "Unexpected HTTP status or deadline for $Phase health$Path."
  }
  if ($Expected -eq 503) {
    if ($taskBody.error.code -cne 'DATABASE_UNAVAILABLE' -or
        $taskBody.requestId -cnotmatch '^req_[0-9a-f-]{36}$' -or
        $taskResponse.Headers['x-request-id'][0] -cne $taskBody.requestId -or
        $taskResponse.Content -match '(?i)postgres(?:ql)?://|ECONNREFUSED|ENOTFOUND|at ReadinessService') {
      throw 'Database outage response did not preserve the public error contract.'
    }
  } elseif ($taskBody.data.status -cne 'ok' -or -not $taskBody.data.timestamp -or
      ($Path -eq '/live' -and $null -ne $taskBody.data.database) -or
      ($Path -ne '/live' -and $taskBody.data.database -cne 'connected')) {
    throw 'Unexpected health response shape.'
  }
}

try {
  $taskDocs = (Invoke-TestDocker @('exec', $taskBackend, 'wget', '-qO-', 'http://127.0.0.1:3000/docs-json')) |
    ConvertFrom-Json
  $taskResults.operationIds = @(
    $taskDocs.paths.'/api/v1/health'.get.operationId
    $taskDocs.paths.'/api/v1/health/live'.get.operationId
    $taskDocs.paths.'/api/v1/health/ready'.get.operationId
  )
  if (($taskResults.operationIds -join ',') -cne 'HealthController_check,HealthController_live,HealthController_ready') {
    throw 'Unexpected Swagger operation IDs for the health routes.'
  }
  foreach ($taskPath in @('/live', '/ready', '')) { Test-Probe 'before' $taskPath 200 }
  try {
    Invoke-TestDocker @('stop', '--time', '10', $taskContext.ContainerId) | Out-Null
    if ((Invoke-TestDocker @('inspect', '--format', '{{.State.Running}}', $taskContext.ContainerId)) -cne 'false') {
      throw 'Isolated PostgreSQL did not stop.'
    }
    Test-Probe 'outage' '/live' 200
    Test-Probe 'outage' '/ready' 503
    Test-Probe 'outage' '' 503
  } finally {
    Invoke-TestDocker @('start', $taskContext.ContainerId) | Out-Null
  }
  $taskDeadline = [DateTimeOffset]::UtcNow.AddSeconds(30)
  do {
    $taskHealth = Invoke-WebRequest -Uri "$($taskReport.origin)/api/v1/health/ready" -SkipHttpErrorCheck -TimeoutSec 3 -NoProxy
    if ($taskHealth.StatusCode -eq 200) { break }
    Start-Sleep -Milliseconds 500
  } while ([DateTimeOffset]::UtcNow -lt $taskDeadline)
  foreach ($taskPath in @('/live', '/ready', '')) { Test-Probe 'recovered' $taskPath 200 }
  $taskLogin = Invoke-RestMethod -Method Post -Uri "$($taskReport.origin)/api/v1/auth/login" -TimeoutSec 5 -NoProxy `
    -StatusCodeVariable taskLoginStatus -ContentType 'application/json' `
    -Body (@{ email = 'admin@congty.com'; password = 'Password@123' } | ConvertTo-Json -Compress)
  $taskResults.recoveryLoginStatus = $taskLoginStatus
  if ($taskLoginStatus -ne 200 -and $taskLoginStatus -ne 201) { throw 'Unexpected login status after recovery.' }
  if (-not $taskLogin.data.accessToken) { throw 'Main application pool did not recover for login.' }
  $taskResults.backendAfter = Get-BackendProcess
  if ($taskResults.backendBefore -cne $taskResults.backendAfter) { throw 'Backend process changed during the outage.' }
  $taskLogLines = @(& docker logs $taskBackend 2>&1 | ForEach-Object { $_.ToString() })
  if ($LASTEXITCODE -ne 0 -or ($taskLogLines -join "`n") -match "$taskHeaderMarker|$taskQueryMarker") {
    throw 'Backend logs could not be inspected or contain a synthetic marker.'
  }
  $taskEvents = @($taskLogLines | ForEach-Object { $_ | ConvertFrom-Json -ErrorAction Stop })
  $taskResults.outageLogEvents = @(
    foreach ($taskProbe in ($taskResults.probes | Where-Object status -eq 503)) {
      $taskMatches = @($taskEvents | Where-Object { $_.message.requestId -ceq $taskProbe.requestId })
      if ($taskMatches.Count -ne 1 -or $taskMatches[0].message.event -cne 'http.server_error' -or
          $taskMatches[0].message.route -cne $taskProbe.path -or $taskMatches[0].message.status -ne 503 -or
          $null -eq $taskMatches[0].message.durationMs -or $taskMatches[0].message.durationMs -ge 3000) {
        throw 'Missing or invalid structured outage event.'
      }
      $taskMatches[0].message
    }
  )
  $taskResults.success = $true
} finally {
  $taskResults | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $taskOutputPath -Encoding utf8
  Write-Host "Health readiness report: $taskOutputPath"
}
