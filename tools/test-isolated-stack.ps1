param(
  [ValidateRange(1024,65535)][int]$Port = 18080,
  [ValidateSet(0,10,12,15,20,30)][int]$AccessTtlSeconds = 0,
  [switch]$PrepareOnly,
  [switch]$KeepStack,
  [switch]$RequireMfa,
  [ValidateRange(1024,65535)][int]$OidcPort,
  [scriptblock]$VerifyStack
)

$ErrorActionPreference = 'Stop'
$taskComposePath = Join-Path $PSScriptRoot 'testing/compose.t30.yml'
$taskProject = 'crypta-t30-test-' + [Guid]::NewGuid().ToString('N').Substring(0,12)
$taskArtifactRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'test-artifacts/integration'))
$taskArtifactPath = [IO.Path]::GetFullPath((Join-Path $taskArtifactRoot $taskProject))
if (-not $taskArtifactPath.StartsWith($taskArtifactRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Test artifact path escaped its root.' }
if ($taskProject -notmatch '^crypta-t30-test-[a-f0-9]{12}$') { throw 'Invalid isolated project name.' }
if (Test-Path -LiteralPath $taskArtifactPath) { throw 'Fresh test artifact directory already exists.' }
if ($OidcPort -and (-not $RequireMfa -or $OidcPort -eq $Port -or $Port -eq 8080 -or $OidcPort -eq 8080)) {
  throw 'The isolated OIDC stack needs MFA and two dedicated ports.'
}

function New-TestSecret {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

[void](New-Item -ItemType Directory -Path $taskArtifactPath)
$taskEnvironmentPath = Join-Path $taskArtifactPath 'test.env'
$taskEnvironment = @(
  "POSTGRES_PASSWORD=$(New-TestSecret)"
  "JWT_ACCESS_SECRET=$(New-TestSecret)"
  "T30_TEST_PORT=$Port"
  "T30_TEST_ACCESS_TTL=$(if ($AccessTtlSeconds) { "$($AccessTtlSeconds)s" } else { '15m' })"
  "T30_TEST_MFA_REQUIRED=$($RequireMfa.ToString().ToLowerInvariant())"
  "T30_TEST_MFA_KEY=$(if ($RequireMfa) { New-TestSecret } else { '' })"
)
$taskComposeArgs = @('compose','--project-name',$taskProject,'--env-file',$taskEnvironmentPath,'--file',$taskComposePath)
$taskRealmDirectory = $null
if ($OidcPort) {
  $taskRealmDirectory = Join-Path (Split-Path -Parent $taskArtifactRoot) ('keycloak-test-' + $taskProject.Substring($taskProject.Length - 12))
  & node (Join-Path $PSScriptRoot 'testing/keycloak-realm.cjs') $taskRealmDirectory "http://app.crypta.test:$Port/api/v1/auth/oidc/callback" 'http://backend:3000/api/v1/auth/oidc/backchannel'
  if ($LASTEXITCODE -ne 0) { throw 'Could not generate the isolated Keycloak realm.' }
  $taskKeycloak = Get-Content -Raw -LiteralPath (Join-Path $taskRealmDirectory 'test-credentials.json') | ConvertFrom-Json
  $taskEnvironment += @(
    "CRYPTA_TEST_OIDC_PORT=$OidcPort"
    "CRYPTA_TEST_OIDC_REALM=$(Join-Path $taskRealmDirectory 'crypta-oidc-test-realm.json')"
    "CRYPTA_TEST_OIDC_SECRET=$($taskKeycloak.clientSecret)"
    "CRYPTA_TEST_OIDC_ADMIN_SECRET=$($taskKeycloak.adminSecret)"
    "CRYPTA_TEST_OIDC_KEY=$(New-TestSecret)"
  )
  $taskComposeArgs += @('--file',(Join-Path $PSScriptRoot 'testing/compose.oidc-test.yml'))
}
[IO.File]::WriteAllText($taskEnvironmentPath,($taskEnvironment -join [Environment]::NewLine),(New-Object Text.UTF8Encoding $false))
$taskReportPath = Join-Path $taskArtifactPath 'report.json'
$taskReport = [ordered]@{
  project = $taskProject
  origin = "http://127.0.0.1:$Port"
  database = 'crypta_t30_test'
  provider = 'MOCK'
  smtpEnabled = $false
  mfaRequired = [bool]$RequireMfa
  accessTtlSeconds = $(if ($AccessTtlSeconds) { $AccessTtlSeconds } else { 900 })
  fixtureOnly = $false
  preparedOnly = [bool]$PrepareOnly
  status = 'PREPARED'
  started = $false
  cleanupCompleted = $false
  createdUtc = [DateTimeOffset]::UtcNow.ToString('o')
}
if ($OidcPort) {
  $taskReport.browserOrigin = "http://app.crypta.test:$Port"
  $taskReport.oidcIssuer = "http://oidc.crypta.test:$OidcPort/realms/crypta-oidc-test"
}
function Save-TestReport {
  [IO.File]::WriteAllText($taskReportPath,($taskReport | ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding $false))
}
Save-TestReport
if ($PrepareOnly) { Write-Host "PREPARED isolated test stack: $taskProject; report: $taskReportPath"; return }

$taskStarted = $false
$taskCleanupFailed = $false
try {
  & docker version --format '{{.Server.Version}}'
  if ($LASTEXITCODE -ne 0) { throw 'Docker daemon unavailable. No test stack was started.' }
  $taskExisting = & docker ps -a --filter "label=com.docker.compose.project=$taskProject" --format '{{.ID}}'
  if ($LASTEXITCODE -ne 0 -or $taskExisting) { throw 'Could not prove this is a fresh isolated Compose project.' }
  $taskExistingVolumes = & docker volume ls --filter "name=^$($taskProject)_" --format '{{.Name}}'
  if ($LASTEXITCODE -ne 0 -or $taskExistingVolumes) { throw 'Could not prove this test volume namespace is fresh.' }
  $taskConfigText = & docker @taskComposeArgs config --format json
  if ($LASTEXITCODE -ne 0) { throw 'Could not validate isolated Compose configuration.' }
  $taskConfig = ($taskConfigText -join [Environment]::NewLine) | ConvertFrom-Json
  foreach ($volume in $taskConfig.volumes.PSObject.Properties) {
    if ($volume.Value.external -eq $true -or $volume.Value.name -notlike "$($taskProject)_*") { throw 'Test volume is not owned by the fresh test project.' }
  }
  if ($taskConfig.services.backend.environment.CRYPTO_PROVIDER_MODE -ne 'MOCK' -or [string]$taskConfig.services.backend.environment.SMTP_ENABLED -ne 'false') { throw 'Test configuration must disable real provider/email effects.' }
  foreach ($binding in $taskConfig.services.frontend.ports) { if ($binding.host_ip -ne '127.0.0.1') { throw 'Test port must bind only to loopback.' } }
  if ($OidcPort) {
    foreach ($binding in $taskConfig.services.keycloak.ports) { if ($binding.host_ip -ne '127.0.0.1') { throw 'Keycloak must bind only to loopback.' } }
  }
  $taskStarted = $true
  $taskReport.started = $true
  $taskReport.status = 'STARTING'
  Save-TestReport
  & docker @taskComposeArgs up --detach --build
  if ($LASTEXITCODE -ne 0) { throw 'Isolated stack build/start failed.' }
  $taskDeadline = [DateTimeOffset]::UtcNow.AddMinutes(4)
  $taskReady = $false
  while ([DateTimeOffset]::UtcNow -lt $taskDeadline) {
    try {
      $taskHealth = Invoke-RestMethod -Uri "$($taskReport.origin)/api/v1/health" -TimeoutSec 5
      if ($taskHealth.data.status -eq 'ok' -or $taskHealth.status -eq 'ok') { $taskReady = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
  }
  if (-not $taskReady) { throw 'Isolated test API did not become ready.' }
  & (Join-Path $PSScriptRoot 'smoke-spa-routes.ps1') -BaseUrl $taskReport.origin
  $taskReport.spaSmokePassed = $true
  if (-not $RequireMfa) {
    & (Join-Path $PSScriptRoot 'smoke-test.ps1') -BaseUrl "$($taskReport.origin)/api/v1"
    $taskReport.apiSmokePassed = $true
  }
  $taskIndex = Invoke-WebRequest -Uri $taskReport.origin -UseBasicParsing -TimeoutSec 10
  $taskReport.buildAssets = @([regex]::Matches($taskIndex.Content,'/assets/[^"\s>]+') | ForEach-Object { $_.Value })
  $taskReport.status = 'PASSED'
  if ($VerifyStack) {
    $taskReport.keptStack = $true
    $taskReport.verificationPassed = $false
    Save-TestReport
    & $VerifyStack $taskReportPath
    $taskReport.verificationPassed = $true
  }
  Write-Host "PASS isolated SPA/API smoke: $taskProject"
} catch {
  $taskReport.status = 'FAILED'
  $taskReport.error = $_.Exception.Message
  throw
} finally {
  if ($taskStarted -and -not $KeepStack) {
    try {
      & docker @taskComposeArgs down --volumes --remove-orphans
      $taskReport.cleanupCompleted = $LASTEXITCODE -eq 0
    } catch {
      $taskReport.cleanupCompleted = $false
      $taskReport.cleanupError = $_.Exception.Message
    }
    if (-not $taskReport.cleanupCompleted) {
      if (-not $taskReport.cleanupError) { $taskReport.cleanupError = 'Could not remove the generated test stack. Use this report project/env file to clean it up.' }
      if ($taskReport.status -eq 'PASSED') { $taskReport.status = 'PASSED_CLEANUP_FAILED'; $taskCleanupFailed = $true }
      Write-Warning $taskReport.cleanupError
    }
  }
  if ($taskRealmDirectory -and -not $KeepStack -and (-not $taskStarted -or $taskReport.cleanupCompleted)) {
    foreach ($taskFixtureFile in @('test-credentials.json','crypta-oidc-test-realm.json')) {
      Remove-Item -LiteralPath (Join-Path $taskRealmDirectory $taskFixtureFile) -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $taskRealmDirectory -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $taskEnvironmentPath -ErrorAction SilentlyContinue
  }
  $taskReport.keptStack = $taskStarted -and [bool]$KeepStack
  $taskReport.finishedUtc = [DateTimeOffset]::UtcNow.ToString('o')
  Save-TestReport
  Write-Host "Test report: $taskReportPath"
  if ($taskCleanupFailed) { throw 'Smoke passed but test-stack cleanup failed. See the saved report.' }
}
