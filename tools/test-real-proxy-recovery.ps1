# Run last on a disposable stack. The parent runner removes the replacement.
param([Parameter(Mandatory)][string]$ReportPath)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'testing/database-context.ps1')
$taskPath = (Resolve-Path -LiteralPath $ReportPath).Path
$taskStack = Get-Content -Raw -LiteralPath $taskPath | ConvertFrom-Json
$taskContext = Get-CryptaDatabaseContext -ProjectDirectory (Split-Path -Parent $PSScriptRoot) -IsolatedReport $taskPath
if ($taskStack.status -cne 'PASSED' -or $taskStack.fixtureOnly -ne $false -or
    $taskStack.origin -cnotmatch '^http://127\.0\.0\.1:(?!8080$)[0-9]{4,5}$') {
  throw 'Expected a passing, loopback-only isolated stack.'
}

function Invoke-ProxyTestDocker([string[]]$Arguments) {
  $output = & docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Isolated Docker command failed: $($Arguments[0])." }
  return $output
}

function Get-ProxyTestContainer([string]$Id, [string]$Service) {
  if ($Id -cnotmatch '^[0-9a-f]{64}$') { throw 'Invalid container ID.' }
  $item = Invoke-ProxyTestDocker @('inspect', $Id) | Out-String | ConvertFrom-Json
  if ($item.Id -cne $Id -or $item.Config.Labels.'com.docker.compose.project' -cne $taskContext.Project -or
      $item.Config.Labels.'com.docker.compose.service' -cne $Service) { throw 'Unexpected test container identity.' }
  return $item
}

function Test-ProxyReadiness {
  try {
    $response = Invoke-WebRequest -Uri "$($taskStack.origin)/api/v1/health/ready" -SkipHttpErrorCheck -TimeoutSec 3 -NoProxy
  } catch { return $false }
  if ($response.StatusCode -ne 200) { return $false }
  $data = ($response.Content | ConvertFrom-Json).data
  return $data.status -ceq 'ok' -and $data.database -ceq 'connected'
}

function Wait-ProxyReadiness([string]$Failure) {
  $timer = [Diagnostics.Stopwatch]::StartNew()
  do {
    if (Test-ProxyReadiness) { return [int]$timer.Elapsed.TotalMilliseconds }
    Start-Sleep -Milliseconds 250
  } while ($timer.Elapsed.TotalSeconds -lt 15)
  throw $Failure
}

$compose = $taskContext.ComposeArguments
$frontend = Get-ProxyTestContainer (Invoke-ProxyTestDocker ($compose + @('ps', '-q', 'frontend'))) 'frontend'
$original = Get-ProxyTestContainer (Invoke-ProxyTestDocker ($compose + @('ps', '-a', '-q', 'backend'))) 'backend'
$binding = Invoke-ProxyTestDocker @('port', $frontend.Id, '80/tcp')
if ("http://$binding" -cne $taskStack.origin -or 'CRYPTO_PROVIDER_MODE=MOCK' -cnotin $original.Config.Env -or
    'SMTP_ENABLED=false' -cnotin $original.Config.Env) { throw 'Unexpected proxy binding or backend mode.' }
$outside = @(Get-CryptaContainerInventory | Where-Object project -CNE $taskContext.Project)
$network = "$($taskContext.Project)_default"
$up = @('up', '-d', '--no-deps', '--no-recreate', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '60')
$result = [ordered]@{ project = $taskContext.Project; originalBackend = $original.Id; frontend = $frontend.Id; passed = 0; total = 1 }
$directory = Join-Path (Split-Path -Parent $taskPath) ('proxy-recovery-' + [guid]::NewGuid().ToString('N').Substring(0,12))
[void](New-Item -ItemType Directory -Path $directory)
try {
  if (-not $original.State.Running) {
    Invoke-ProxyTestDocker ($compose + $up + @('backend')) | Out-Null
    $original = Get-ProxyTestContainer $original.Id 'backend'
  }
  [void](Wait-ProxyReadiness 'The original backend must serve readiness through the proxy.')

  # Allocate the replacement while the original address is still occupied.
  Invoke-ProxyTestDocker ($compose + $up + @('--scale', 'backend=2', 'backend')) | Out-Null
  $ids = @(Invoke-ProxyTestDocker ($compose + @('ps', '-q', 'backend')))
  if ($ids.Count -ne 2 -or $original.Id -cnotin $ids) { throw 'Expected the original and replacement backend.' }
  $replacement = Get-ProxyTestContainer ($ids | Where-Object { $_ -cne $original.Id }) 'backend'
  $result.replacementBackend = $replacement.Id
  $result.originalAddress = $original.NetworkSettings.Networks.$network.IPAddress
  $result.replacementAddress = $replacement.NetworkSettings.Networks.$network.IPAddress
  if ($replacement.Image -cne $original.Image -or $replacement.State.Health.Status -cne 'healthy' -or
      !$result.originalAddress -or !$result.replacementAddress -or $result.replacementAddress -ceq $result.originalAddress) {
    throw 'Expected a healthy replacement at a different address on the same test network.'
  }
  Invoke-ProxyTestDocker @('stop', $original.Id) | Out-Null
  Invoke-ProxyTestDocker @('rm', $original.Id) | Out-Null

  $result.proxyRecoveredMilliseconds = Wait-ProxyReadiness 'The unchanged proxy did not recover after the backend address changed.'
  $currentFrontend = Get-ProxyTestContainer $frontend.Id 'frontend'
  $result.frontendUnchanged = $currentFrontend.State.StartedAt -ceq $frontend.State.StartedAt
  $result.outsideContainersPreserved = Test-CryptaContainerIdentitiesMatch -Before $outside `
    -After @(Get-CryptaContainerInventory | Where-Object project -CNE $taskContext.Project)
  if (!$result.frontendUnchanged -or !$result.outsideContainersPreserved) { throw 'Unexpected container identity change.' }
  $result.passed = 1
  Write-Host 'PASS unchanged Nginx reaches the healthy backend at its new address.'
} finally {
  $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $directory 'results.json') -Encoding utf8
}
