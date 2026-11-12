# Observe the actual hourly NestJS expiry timer on a fresh, disposable stack.
param([ValidateRange(1024,65535)][int]$Port = 18210)

$ErrorActionPreference = 'Stop'
if ($Port -eq 8080) { throw 'Use a dedicated test port.' }
$taskRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'testing/database-context.ps1')

& (Join-Path $PSScriptRoot 'test-isolated-stack.ps1') -Port $Port -VerifyStack {
  param([string]$ReportPath)
  $taskContext = Get-CryptaDatabaseContext -ProjectDirectory $taskRoot -IsolatedReport $ReportPath
  $taskCompose = $taskContext.ComposeArguments
  $taskBackend = & docker @taskCompose ps -q backend
  if ($LASTEXITCODE -ne 0 -or @($taskBackend).Count -ne 1 -or -not $taskBackend) {
    throw 'Expected one isolated backend.'
  }
  function Get-ExpiryProcess {
    $taskIdentity = & docker inspect --format '{{.State.Running}}|{{.State.Pid}}|{{.State.StartedAt}}|{{.RestartCount}}|{{.Image}}' $taskBackend
    if ($LASTEXITCODE -ne 0 -or $taskIdentity -notmatch '^true\|[1-9][0-9]*\|[^|]+\|[0-9]+\|sha256:[a-f0-9]{64}$') {
      throw 'Isolated backend is not running.'
    }
    return $taskIdentity
  }
  function Invoke-ExpirySql([string]$Query) {
    $taskRows = $Query | & docker exec -i $taskContext.ContainerId psql -XqAt -v ON_ERROR_STOP=1 -U $taskContext.User -d $taskContext.Database
    if ($LASTEXITCODE -ne 0) { throw 'Isolated expiry SQL failed.' }
    return $taskRows
  }

  $taskWarning = [Guid]::NewGuid().ToString()
  $taskExpiry = [Guid]::NewGuid().ToString()
  $taskSnapshot = @"
SELECT json_build_object(
  'attempt',extract(epoch from last_attempt_at),'success',extract(epoch from last_success_at),'failed',last_failed,
  'due',(SELECT count(*) FROM crypto_assets WHERE id='$taskExpiry' AND expires_at<=clock_timestamp()),
  'warningDue',(SELECT count(*) FROM crypto_assets WHERE id='$taskWarning' AND expires_at<=clock_timestamp()+interval '24 hours'),
  'assets',(SELECT json_object_agg(id,json_build_array(status,version)) FROM crypto_assets WHERE id IN ('$taskWarning','$taskExpiry')),
  'audit',(SELECT coalesce(json_object_agg(entity_id,actions),'{}') FROM (
    SELECT entity_id,json_agg(action ORDER BY id) AS actions FROM audit_logs
    WHERE entity_type='CRYPTO_ASSET' AND entity_id IN ('$taskWarning','$taskExpiry') GROUP BY entity_id) a),
  'notices',(SELECT coalesce(json_agg(json_build_array(asset_id,recipient_id,channel,type,delivery_status) ORDER BY asset_id,recipient_id,channel),'[]')
    FROM notifications WHERE asset_id IN ('$taskWarning','$taskExpiry'))
) FROM expiry_scan_status WHERE singleton;
"@
  $taskResultPath = Join-Path (Split-Path -Parent $ReportPath) 'expiry-schedule.json'
  $taskResult = [ordered]@{
    project = $taskContext.Project
    startedUtc = [DateTimeOffset]::UtcNow.ToString('o')
    expectedIntervalSeconds = 3600
    success = $false
  }
  try {
    $taskResult.processBefore = Get-ExpiryProcess
    $taskBaseline = Invoke-ExpirySql $taskSnapshot | ConvertFrom-Json -AsHashtable
    if (-not $taskBaseline.success -or $taskBaseline.failed) { throw 'The startup scan has not completed successfully.' }
    $taskResult.startup = $taskBaseline

    Invoke-ExpirySql @"
INSERT INTO crypto_assets (id,asset_code,asset_type,owner_id,department_id,policy_version_id,purpose,status,valid_from,expires_at)
SELECT fixture.id,'EXPIRY-TIMER-'||fixture.id,'KEY',a.owner_id,a.department_id,a.policy_version_id,
  'Expiry timer rehearsal','ACTIVE',now()-interval '24 hours',now()+fixture.remaining
FROM crypto_assets a CROSS JOIN (VALUES ('$taskWarning'::uuid,interval '24 hours 1 minute'),
  ('$taskExpiry'::uuid,interval '1 minute')) AS fixture(id,remaining)
WHERE a.id='a1111111-1111-1111-1111-111111111111';
"@
    $taskClock = [Diagnostics.Stopwatch]::StartNew()
    Write-Host "Waiting for the hourly expiry timer in $($taskContext.Project)."
    do {
      $taskCurrent = Invoke-ExpirySql $taskSnapshot | ConvertFrom-Json -AsHashtable
      if ($taskCurrent.attempt -gt $taskBaseline.attempt) { break }
      if ($taskCurrent.assets.Count -ne 2 -or $taskCurrent.audit.Count -ne 0 -or $taskCurrent.notices.Count -ne 0 -or
          @($taskCurrent.assets.Values | Where-Object { $_[0] -ne 'ACTIVE' -or $_[1] -ne 1 }).Count -ne 0) {
        throw 'A fixture changed before the periodic scan.'
      }
      if ($taskCurrent.due -eq 1 -and $taskCurrent.warningDue -eq 1 -and -not $taskResult.beforeTick) {
        $taskResult.beforeTick = $taskCurrent
        [IO.File]::WriteAllText($taskResultPath, ($taskResult | ConvertTo-Json -Depth 10))
        Write-Host 'Both thresholds crossed and fixtures remain unchanged before the timer.'
      }
      Start-Sleep -Seconds 20
    } while ($taskClock.Elapsed.TotalMinutes -lt 65)

    $taskResult.afterTick = $taskCurrent
    $taskResult.elapsedBetweenAttemptsSeconds = $taskCurrent.attempt - $taskBaseline.attempt
    $taskResult.processAfter = Get-ExpiryProcess
    if (-not $taskResult.beforeTick -or $taskResult.elapsedBetweenAttemptsSeconds -lt 3590 -or
        $taskResult.elapsedBetweenAttemptsSeconds -gt 3660 -or $taskCurrent.failed -or
        $taskCurrent.success -le $taskBaseline.success -or $taskResult.processBefore -cne $taskResult.processAfter) {
      throw 'Expected the next hourly scan to succeed in the original backend process.'
    }
    $taskCases = @(
      @{id=$taskWarning; status='EXPIRING_SOON'; audit='ASSET_MARKED_EXPIRING_SOON'; type='ASSET_EXPIRING'},
      @{id=$taskExpiry; status='EXPIRED'; audit='ASSET_MARKED_EXPIRED'; type='ASSET_EXPIRED'}
    )
    $taskRecipients = @('04444444-1111-1111-1111-111111111111','04444444-2222-2222-2222-222222222222',
      '04444444-3333-3333-3333-333333333333','04444444-6666-6666-6666-666666666666')
    $taskExpected = foreach ($taskCase in $taskCases) {
      $taskAsset = $taskCurrent.assets[$taskCase.id]
      if ($taskAsset[0] -ne $taskCase.status -or $taskAsset[1] -ne 2 -or
          ($taskCurrent.audit[$taskCase.id] -join ',') -ne $taskCase.audit) {
        throw 'Expected one version change and one matching audit event for each asset.'
      }
      foreach ($taskRecipient in $taskRecipients) {
        "$($taskCase.id)|$taskRecipient|EMAIL|$($taskCase.type)|PENDING"
        "$($taskCase.id)|$taskRecipient|IN_APP|$($taskCase.type)|SENT"
      }
    }
    $taskActual = foreach ($taskNotice in $taskCurrent.notices) { $taskNotice -join '|' }
    if (Compare-Object -ReferenceObject $taskExpected -DifferenceObject $taskActual) {
      throw 'Notification recipients, channels, statuses or multiplicity differ from the expected set.'
    }
    $taskResult.success = $true
    Write-Host "PASS hourly expiry schedule: $taskResultPath"
  } catch {
    $taskResult.error = $_.Exception.Message
    throw
  } finally {
    $taskResult.finishedUtc = [DateTimeOffset]::UtcNow.ToString('o')
    [IO.File]::WriteAllText($taskResultPath, ($taskResult | ConvertTo-Json -Depth 10))
  }
}
