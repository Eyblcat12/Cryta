param([switch]$ProveFailureGate)

$ErrorActionPreference = 'Stop'
$taskCiRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskCiTooling = Join-Path $PSScriptRoot 'node_modules'
if ($env:CRYPTA_REAL_TEST_FILTER) { throw 'Clear CRYPTA_REAL_TEST_FILTER before running full CI verification.' }
if (-not (Test-Path -LiteralPath (Join-Path $taskCiTooling 'playwright/package.json'))) {
  throw 'Install the pinned tools/ci dependencies before integration verification.'
}
. (Join-Path $taskCiRoot 'tools/testing/database-context.ps1')
$taskCiBefore = @(Get-CryptaContainerInventory)
$taskCiState = @{
  reportPath = $null
  verificationPassed = $false
  proveFailureGate = [bool]$ProveFailureGate
  powershellVersion = $PSVersionTable.PSVersion.ToString()
  platform = $PSVersionTable.OS
}

$taskCiVerification = {
  param([string]$ReportPath)
  $taskCiState.reportPath = $ReportPath
  $taskCiReport = Get-Content -Raw -LiteralPath $ReportPath | ConvertFrom-Json
  $taskCiState.project = $taskCiReport.project
  if ($taskCiState.proveFailureGate) {
    & node -e 'process.exit(23)'
    if ($LASTEXITCODE -ne 0) { throw 'Intentional native test failure for CI propagation and cleanup verification.' }
  }
  # Use the freshly seeded database before other suites alter its queue signals.
  & node (Join-Path $taskCiRoot 'tools/test-real-operations-monitor.cjs') $ReportPath $taskCiMonitorTokenFile
  if ($LASTEXITCODE -ne 0) { throw 'Operations monitor integration failed.' }
  foreach ($script in @('test-real-body-parser.cjs', 'test-real-runtime-ledger.cjs',
      'test-real-runtime-privileges.cjs', 'test-real-worker-recovery.cjs',
      'test-real-expiry-scan.cjs', 'test-real-email-delivery.cjs')) {
    & node (Join-Path $taskCiRoot "tools/$script") $ReportPath
    if ($LASTEXITCODE -ne 0) { throw "Integration failed in $script." }
  }
  & node (Join-Path $taskCiRoot 'tools/test-real-integration.cjs') $ReportPath $taskCiTooling chromium
  if ($LASTEXITCODE -ne 0) { throw 'Real Chromium integration failed.' }
  & node (Join-Path $taskCiRoot 'tools/test-real-reports.cjs') $ReportPath $taskCiTooling
  if ($LASTEXITCODE -ne 0) { throw 'Real report export integration failed.' }
  & node (Join-Path $taskCiRoot 'tools/test-real-audit-anchor.cjs') $ReportPath
  if ($LASTEXITCODE -ne 0) { throw 'Independent audit checkpoint integration failed.' }
  & node (Join-Path $taskCiRoot 'tools/test-real-openbao.cjs') $ReportPath
  if ($LASTEXITCODE -ne 0) { throw 'OpenBao provider contract integration failed.' }
  & node (Join-Path $taskCiRoot 'tools/test-release-upgrade.cjs') $ReportPath
  if ($LASTEXITCODE -ne 0) { throw 'Release upgrade and restore integration failed.' }
  # The signal rehearsal stops the isolated backend, so run it after browser tests.
  & (Join-Path $taskCiRoot 'tools/test-real-shutdown.ps1') -ReportPath $ReportPath
}

$taskCiArtifactRoot = Join-Path $taskCiRoot 'tools/test-artifacts'
$taskCiMonitorTokenFile = Join-Path $taskCiArtifactRoot ('ci-monitor-' + [Guid]::NewGuid().ToString('N') + '.token')
$taskCiPreviousMonitorHash = $env:T30_TEST_MONITOR_TOKEN_SHA256
try {
  try {
    if (-not $ProveFailureGate) {
      [void][IO.Directory]::CreateDirectory($taskCiArtifactRoot)
      $taskCiMonitorToken = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
      $env:T30_TEST_MONITOR_TOKEN_SHA256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($taskCiMonitorToken))).ToLowerInvariant()
      $taskCiTokenOptions = [IO.FileStreamOptions]::new()
      $taskCiTokenOptions.Mode = [IO.FileMode]::CreateNew
      $taskCiTokenOptions.Access = [IO.FileAccess]::Write
      if (-not $IsWindows) { $taskCiTokenOptions.UnixCreateMode = 'UserRead, UserWrite' }
      $taskCiTokenWriter = [IO.StreamWriter]::new($taskCiMonitorTokenFile, $taskCiTokenOptions)
      try { $taskCiTokenWriter.WriteLine($taskCiMonitorToken) } finally { $taskCiTokenWriter.Dispose() }
    }
    & (Join-Path $taskCiRoot 'tools/test-isolated-stack.ps1') -VerifyStack $taskCiVerification
  } finally {
    $env:T30_TEST_MONITOR_TOKEN_SHA256 = $taskCiPreviousMonitorHash
    [IO.File]::Delete($taskCiMonitorTokenFile)
  }
  & (Join-Path $taskCiRoot 'tools/test-isolated-stack.ps1') -Port 18083 -SessionTlsPort 18443 -AccessTtlSeconds 20 -VerifyStack {
    param([string]$ReportPath)
    & node (Join-Path $taskCiRoot 'tools/test-real-session-expiry.cjs') $ReportPath $taskCiTooling chromium
    if ($LASTEXITCODE -ne 0) { throw 'Real session expiry integration failed.' }
  }
  & (Join-Path $taskCiRoot 'tools/test-isolated-stack.ps1') -RequireMfa -VerifyStack {
    param([string]$ReportPath)
    & node (Join-Path $taskCiRoot 'tools/test-real-mfa.cjs') $ReportPath $taskCiTooling
    if ($LASTEXITCODE -ne 0) { throw 'Real MFA integration failed.' }
  }
  & (Join-Path $taskCiRoot 'tools/test-isolated-stack.ps1') -Port 18081 -OidcPort 18082 -RequireMfa -VerifyStack {
    param([string]$ReportPath)
    & node (Join-Path $taskCiRoot 'tools/test-real-oidc.cjs') $ReportPath $taskCiTooling
    if ($LASTEXITCODE -ne 0) { throw 'Real Keycloak OIDC integration failed.' }
  }
  $taskCiState.verificationPassed = $true
} finally {
  $taskCiAfter = @(Get-CryptaContainerInventory)
  $taskCiState.containerIdentitiesPreserved = Test-CryptaContainerIdentitiesMatch -Before $taskCiBefore -After $taskCiAfter
  $taskCiState.otherContainers = $taskCiAfter.Count
  $taskCiState.completedUtc = [DateTimeOffset]::UtcNow.ToString('o')
  if ($taskCiState.reportPath) {
    $taskCiFinalReport = Get-Content -Raw -LiteralPath $taskCiState.reportPath | ConvertFrom-Json
    $taskCiState.cleanupCompleted = $taskCiFinalReport.cleanupCompleted
    $taskCiState.proveFailureGate = [bool]$ProveFailureGate
    $taskCiStatePath = Join-Path (Split-Path -Parent $taskCiState.reportPath) 'ci-verification.json'
    [IO.File]::WriteAllText($taskCiStatePath, ($taskCiState | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
    if (-not $taskCiState.cleanupCompleted) { throw 'CI stack cleanup failed.' }
  }
  if (-not $taskCiState.containerIdentitiesPreserved) { throw 'Container identities outside the CI stack changed.' }
}
