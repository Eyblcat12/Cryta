# Run last in a disposable integration stack. This test leaves its backend stopped.
param([Parameter(Mandatory)][string]$ReportPath)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'testing/database-context.ps1')
$taskPath = (Resolve-Path -LiteralPath $ReportPath).Path
$taskStack = Get-Content -Raw -LiteralPath $taskPath | ConvertFrom-Json
$taskContext = Get-CryptaDatabaseContext -ProjectDirectory (Split-Path -Parent $PSScriptRoot) -IsolatedReport $taskPath
if ($taskStack.status -cne 'PASSED' -or $taskStack.fixtureOnly -ne $false -or
    $taskStack.origin -cnotmatch '^http://127\.0\.0\.1:[0-9]{4,5}$') {
  throw 'Expected a passing, loopback-only isolated stack.'
}

function Invoke-TestDocker([string[]]$Arguments) {
  $output = & docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker command failed: $($Arguments[0])" }
  return $output
}

function Invoke-TestSql([string]$Query) {
  Invoke-TestDocker @('exec', $taskContext.ContainerId, 'psql', '-X', '-U', $taskContext.User,
    '-d', $taskContext.Database, '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', $Query)
}

function Wait-TestCondition([scriptblock]$Predicate, [string]$Failure, [int]$TimeoutSeconds = 15) {
  $timer = [Diagnostics.Stopwatch]::StartNew()
  do {
    if (& $Predicate) { return }
    Start-Sleep -Milliseconds 150
  } while ($timer.Elapsed.TotalSeconds -lt $TimeoutSeconds)
  throw $Failure
}

function Add-ApprovedFixture([guid]$Id, [string]$Reason) {
  if ($Reason -cnotin @('Shutdown drain fixture A', 'Shutdown drain fixture B')) { throw 'Invalid fixture name.' }
  $parameters = '{"assetType":"KEY","algorithm":"RSA","keySize":2048,"usage":"SIGNING","validityDays":90}'
  Invoke-TestSql @"
INSERT INTO requests(id,request_type,creator_id,department_id,policy_version_id,status,reason,requested_parameters)
SELECT '$Id','CREATE',u.id,u.department_id,pv.id,'APPROVED','$Reason','$parameters'::jsonb
FROM users u JOIN policies p ON p.code='RSA_STANDARD' AND p.is_active
JOIN policy_versions pv ON pv.policy_id=p.id AND pv.version=2
WHERE u.email='dev.nguyen@congty.com';
"@ | Out-Null
}

$taskBackend, $taskFrontend = foreach ($service in @('backend', 'frontend')) {
  $ids = @(Invoke-TestDocker ($taskContext.ComposeArguments + @('ps', '-q', $service)))
  if ($ids.Count -ne 1) { throw "Expected one isolated $service container." }
  $identity = Invoke-TestDocker @('inspect', '--format',
    '{{.State.Running}}|{{index .Config.Labels `com.docker.compose.project`}}|{{index .Config.Labels `com.docker.compose.service`}}', $ids[0])
  if ($identity -cne "true|$($taskContext.Project)|$service") { throw 'Unexpected test container identity.' }
  $ids[0]
}
$binding = Invoke-TestDocker @('port', $taskFrontend, '80/tcp')
if ("http://$binding" -cne $taskStack.origin) { throw 'Frontend port does not match the test report.' }
$mode = Invoke-TestDocker @('exec', $taskBackend, 'node', '-e',
  'process.stdout.write([process.env.CRYPTO_PROVIDER_MODE,process.env.SMTP_ENABLED].join(String.fromCharCode(124)))')
if ($mode -cne 'MOCK|false' -or (Invoke-TestSql 'SELECT current_database();') -cne 'crypta_t30_test') {
  throw 'Expected MOCK, disabled SMTP and an isolated database.'
}

$taskBefore = @(Get-CryptaContainerInventory)
$taskFirst = [guid]::NewGuid()
$taskSecond = [guid]::NewGuid()
$taskOutput = Join-Path (Split-Path -Parent $taskPath) ('shutdown-' + $taskFirst.ToString('N').Substring(0,12))
[void](New-Item -ItemType Directory -Path $taskOutput)
$taskReport = [ordered]@{
  project = $taskContext.Project
  signal = 'SIGTERM'
  provider = 'MOCK'
  smtpEnabled = $false
  passed = 0
  total = 2
  success = $false
}
$taskBlocker = $false

function Release-TestBlocker {
  Invoke-TestSql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND application_name='crypta-shutdown-blocker';" | Out-Null
}

try {
  Invoke-TestSql @'
CREATE FUNCTION shutdown_fixture_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose = 'Shutdown drain fixture A' THEN
    PERFORM pg_advisory_xact_lock(20261107, 917);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER shutdown_fixture_gate BEFORE INSERT ON crypto_assets
  FOR EACH ROW EXECUTE FUNCTION shutdown_fixture_gate();
'@ | Out-Null
  [void](Invoke-TestDocker @('exec', '-d', '--env', 'PGAPPNAME=crypta-shutdown-blocker', $taskContext.ContainerId,
    'psql', '-X', '-U', $taskContext.User, '-d', $taskContext.Database, '-v', 'ON_ERROR_STOP=1',
    '-c', 'SELECT pg_advisory_lock(20261107, 917); SELECT pg_sleep(45);'))
  $taskBlocker = $true
  $advisory = "a.datname=current_database() AND l.locktype='advisory' AND l.classid=20261107 AND l.objid=917"
  Wait-TestCondition {
    (Invoke-TestSql "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE $advisory AND a.application_name='crypta-shutdown-blocker' AND l.granted;") -ceq '1'
  } 'The isolated advisory lock was not acquired.'
  Add-ApprovedFixture $taskFirst 'Shutdown drain fixture A'
  Wait-TestCondition {
    (Invoke-TestSql "SELECT count(*) FROM provider_operations WHERE request_id='$taskFirst' AND status='PROVIDER_SUCCEEDED';") -ceq '1' -and
    (Invoke-TestSql "SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING(pid) WHERE $advisory AND a.application_name='crypta-api' AND NOT l.granted;") -ceq '1'
  } 'The real worker did not reach its final transaction.'
  $taskReport.signalSentWhileTransactionBlocked = $true
  [void](Invoke-TestDocker @('kill', '--signal=TERM', $taskBackend))
  Wait-TestCondition {
    $ready = Invoke-WebRequest -Uri "$($taskStack.origin)/api/v1/health/ready" -SkipHttpErrorCheck -TimeoutSec 2 -NoProxy
    $ready.StatusCode -eq 503 -and ($ready.Content | ConvertFrom-Json).error.code -ceq 'APP_SHUTTING_DOWN'
  } 'Readiness did not report shutdown.' 5
  $taskReport.readinessDuringDrain = 503
  $live = Invoke-WebRequest -Uri "$($taskStack.origin)/api/v1/health/live" -SkipHttpErrorCheck -TimeoutSec 2 -NoProxy
  $blocked = Invoke-WebRequest -Uri "$($taskStack.origin)/api/v1/policies" -SkipHttpErrorCheck -TimeoutSec 2 -NoProxy
  if ($live.StatusCode -ne 200 -or $blocked.StatusCode -ne 503 -or
      ($blocked.Content | ConvertFrom-Json).error.code -cne 'APP_SHUTTING_DOWN') {
    throw 'Drain should keep liveness visible and reject new business requests.'
  }
  $taskReport.livenessDuringDrain = [int]$live.StatusCode
  $taskReport.businessRequestDuringDrain = [int]$blocked.StatusCode
  Add-ApprovedFixture $taskSecond 'Shutdown drain fixture B'
  Release-TestBlocker
  $taskBlocker = $false
  Wait-TestCondition {
    (Invoke-TestDocker @('inspect', '--format', '{{.State.Running}}', $taskBackend)) -ceq 'false'
  } 'The backend did not exit after the transaction was released.'
  $taskReport.exitCode = [int](Invoke-TestDocker @('inspect', '--format', '{{.State.ExitCode}}', $taskBackend))
  if ($taskReport.exitCode -ne 0) { throw 'Backend did not exit cleanly after SIGTERM.' }
  $taskReport.firstRequest = (Invoke-TestSql @"
SELECT jsonb_build_object(
  'status',r.status,'operationStatus',op.status,'attemptCount',op.attempt_count,
  'assets',(SELECT count(*) FROM crypto_assets WHERE id=r.result_asset_id AND purpose=r.reason),
  'successAudits',(SELECT count(*) FROM audit_logs WHERE request_id=r.id AND action='ASSET_CREATED' AND outcome='SUCCESS'),
  'completionNotifications',(SELECT count(*) FROM notifications WHERE request_id=r.id AND type='REQUEST_COMPLETED')
)
FROM requests r JOIN provider_operations op ON op.request_id=r.id WHERE r.id='$taskFirst';
"@) | ConvertFrom-Json
  $first = $taskReport.firstRequest
  if ($first.status -cne 'COMPLETED' -or $first.operationStatus -cne 'COMPLETED' -or $first.attemptCount -ne 1 -or
      $first.assets -ne 1 -or $first.successAudits -ne 1 -or $first.completionNotifications -ne 2) {
    throw 'Claimed work did not commit exactly once before shutdown.'
  }
  $taskReport.nextRequest = Invoke-TestSql "SELECT r.status || '|' || (SELECT count(*) FROM provider_operations WHERE request_id=r.id) FROM requests r WHERE r.id='$taskSecond';"
  if ($taskReport.nextRequest -cne 'APPROVED|0') { throw 'The worker claimed another job during shutdown.' }
  $taskReport.apiConnectionsRemaining = [int](Invoke-TestSql "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name IN ('crypta-api','crypta-readiness','crypta-failure-audit');")
  if ($taskReport.apiConnectionsRemaining -ne 0) { throw 'API connections survived shutdown.' }
  $taskReport.passed = 1
  Write-Host 'PASS real SIGTERM drains one transaction, rejects new work and closes API connections.'

  $taskMarker = 'shutdown-probe-' + [guid]::NewGuid().ToString('N')
  # A removed endpoint can refuse the connection or time out at Nginx's default 60-second limit.
  $proxyFailure = Invoke-WebRequest -Uri "$($taskStack.origin)/api/v1/health/live?probe=$taskMarker" `
    -Headers @{ Referer = "https://example.test/$taskMarker" } -SkipHttpErrorCheck -TimeoutSec 75 -NoProxy
  $proxyStatus = [string]$proxyFailure.StatusCode
  if ($proxyStatus -cnotin @('502', '504')) { throw 'The stopped backend should produce HTTP 502 or 504 at the proxy.' }
  $proxyLogs = & docker logs --tail 300 $taskFrontend 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw 'Unable to read isolated Nginx logs.' }
  if ($proxyLogs.Contains($taskMarker)) { throw 'Synthetic sensitive value was found in the Nginx outage logs.' }
  $proxyRecord = $proxyLogs -split '\r?\n' | Where-Object { $_.StartsWith('{') } |
    ForEach-Object { $_ | ConvertFrom-Json } | Where-Object {
      $_.event -ceq 'nginx.access' -and $_.surface -ceq 'api' -and $_.method -ceq 'GET' -and
        $_.status -ceq $proxyStatus -and $_.upstreamStatus -ceq $proxyStatus -and
        $_.correlationId -ceq '-' -and $_.proxyRequestId -cmatch '^[0-9a-f]{32}$'
    } | Select-Object -Last 1
  if (-not $proxyRecord) { throw 'No safe Nginx access record described the upstream outage.' }
  $taskReport.proxyOutage = @{ status = [int]$proxyStatus; accessRecordPresent = $true; syntheticValueExcluded = $true }
  $taskReport.passed = 2
  $taskReport.success = $true
  Write-Host 'PASS Nginx records the upstream outage without logging raw request data.'
} finally {
  try {
    if ($taskBlocker) { Release-TestBlocker }
    $taskReport.containerIdentitiesPreserved = Test-CryptaContainerIdentitiesMatch -Before $taskBefore -After @(Get-CryptaContainerInventory)
    if (-not $taskReport.containerIdentitiesPreserved) { throw 'Unexpected container identity change.' }
  } finally {
    $taskReport | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $taskOutput 'results.json') -Encoding utf8
  }
}
