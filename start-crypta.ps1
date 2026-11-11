[CmdletBinding(DefaultParameterSetName = 'Start')]
param(
  [Parameter(ParameterSetName = 'Start')][switch]$NoBrowser,
  [Parameter(Mandatory, ParameterSetName = 'Diagnose')][switch]$Diagnose,
  [Parameter(Mandatory, ParameterSetName = 'Stop')][switch]$Stop
)

$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$envFile = Join-Path $projectDir '.env'

function New-CryptaSecret {
  $bytes = New-Object byte[] 48
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Initialize-CryptaEnvironment {
  if (Test-Path -LiteralPath $envFile -PathType Leaf) { return }
  if (Test-Path -LiteralPath $envFile) { throw '.env must be a file.' }
  $lines = Get-Content -LiteralPath (Join-Path $projectDir '.env.example') -Encoding UTF8
  $values = @{
    POSTGRES_PASSWORD = New-CryptaSecret
    JWT_ACCESS_SECRET = New-CryptaSecret
  }
  $found = @{}
  $content = foreach ($line in $lines) {
    if ($line -match '^(POSTGRES_PASSWORD|JWT_ACCESS_SECRET)=') {
      $key = $Matches[1]
      if ($found.ContainsKey($key)) { throw "Duplicate $key in .env.example." }
      $found[$key] = $true
      "$key=$($values[$key])"
    } else { $line }
  }
  if ($found.Count -ne $values.Count) { throw '.env.example is missing required secret settings.' }
  $temporary = Join-Path $projectDir ('.env.init-' + [Guid]::NewGuid().ToString('N'))
  try {
    [IO.File]::WriteAllText($temporary, (($content -join [Environment]::NewLine) + [Environment]::NewLine), (New-Object Text.UTF8Encoding $false))
    try {
      [IO.File]::Move($temporary, $envFile)
      Write-Host 'Created .env with random database and JWT secrets.' -ForegroundColor Green
    } catch [IO.IOException] {
      if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) { throw }
    }
  } finally {
    if (Test-Path -LiteralPath $temporary -PathType Leaf) { Remove-Item -LiteralPath $temporary }
  }
}

function Get-CryptaConfiguration {
  # Keep resolved Compose variables out of terminal output.
  $ErrorActionPreference = 'Continue'
  $configuration = & docker compose config --format json 2>$null
  if ($LASTEXITCODE -ne 0) { throw 'Docker Compose configuration is invalid. Check .env and docker-compose.yml.' }
  try { return ($configuration -join [Environment]::NewLine) | ConvertFrom-Json -ErrorAction Stop }
  catch { throw 'Docker Compose did not return valid configuration JSON.' }
}

function Test-CryptaPortAvailable([Net.IPAddress]$Address, [int]$Port) {
  $listener = New-Object Net.Sockets.TcpListener $Address, $Port
  try {
    $listener.ExclusiveAddressUse = $true
    $listener.Start()
    return $true
  } catch [Net.Sockets.SocketException] {
    return $false
  } finally { $listener.Stop() }
}

function Get-CryptaPublishedPort {
  $ErrorActionPreference = 'Continue'
  $bindings = @(& docker compose port frontend 80 2>$null)
  if ($LASTEXITCODE -eq 0 -and $bindings.Count -eq 1 -and [string]$bindings[0] -match ':(\d{1,5})$') {
    return [int]$Matches[1]
  }
  return $null
}

function Test-CryptaReady([string]$Url) {
  $ProgressPreference = 'SilentlyContinue'
  try {
    $health = Invoke-RestMethod -Uri "$Url/api/v1/health/ready" -TimeoutSec 2
    if ($health.data.status -ne 'ok' -or $health.data.database -ne 'connected') { return $false }
    $page = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $page.StatusCode -eq 200
  } catch { return $false }
}

Push-Location -LiteralPath $projectDir
try {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker is not installed. Install and open Docker Desktop first.'
  }
  & docker info --format '{{.ServerVersion}}' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Docker is not running or this account cannot access it. Open Docker Desktop and try again.' }
  & docker compose version --short | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 is required. Update Docker Desktop and try again.' }

  if ($Stop) {
    & docker compose down
    if ($LASTEXITCODE -ne 0) { throw 'Docker Compose could not stop Crypta.' }
    Write-Host 'Crypta stopped. Database volumes were preserved.' -ForegroundColor Green
    return
  }

  if ($Diagnose -and -not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    throw '.env is missing. Run start-crypta.cmd once to generate the local configuration.'
  }
  if (-not $Diagnose) { Initialize-CryptaEnvironment }
  $config = Get-CryptaConfiguration
  $password = [string]$config.services.postgres.environment.POSTGRES_PASSWORD
  $jwtSecret = [string]$config.services.backend.environment.JWT_ACCESS_SECRET
  if (-not $password -or $password -eq 'CHANGE_ME_GENERATED_BY_START_SCRIPT') {
    throw 'Set a real POSTGRES_PASSWORD in .env before starting.'
  }
  if (-not $jwtSecret -or $jwtSecret -eq 'CHANGE_ME_GENERATED_BY_START_SCRIPT') {
    throw 'Set a real JWT_ACCESS_SECRET in .env before starting.'
  }
  $ports = @($config.services.frontend.ports | Where-Object { $_.target -eq 80 -and $_.protocol -eq 'tcp' })
  $appPort = 0
  if ($ports.Count -ne 1 -or -not [int]::TryParse([string]$ports[0].published, [ref]$appPort) -or $appPort -lt 1 -or $appPort -gt 65535) {
    throw 'APP_PORT must publish frontend TCP port 80 to one valid local port.'
  }
  $appUrl = 'http://localhost:' + $appPort
  $ipv6 = $ports[0].host_ip -in @('::', '::1')
  $probeAddress = if ($ipv6) { [Net.IPAddress]::IPv6Loopback } else { [Net.IPAddress]::Loopback }
  $probeUrl = if ($ipv6) { "http://[::1]:$appPort" } else { "http://127.0.0.1:$appPort" }
  if ($config.services.backend.environment.CORS_ORIGIN -ne $appUrl) {
    Write-Warning "APP_ORIGIN differs from $appUrl. Confirm the browser URL and CORS configuration."
  }

  $currentPort = Get-CryptaPublishedPort
  if ($Diagnose) {
    & docker compose ps --all
    if ($LASTEXITCODE -ne 0) { throw 'Could not read Compose service status.' }
    if ($currentPort -eq $appPort -and (Test-CryptaReady $probeUrl)) {
      Write-Host "Crypta is ready: $appUrl" -ForegroundColor Green
      return
    }
    throw "Crypta is not ready at $appUrl. Run start-crypta.cmd, or check 'docker compose logs backend frontend'."
  }

  if ($currentPort -ne $appPort -and -not (Test-CryptaPortAvailable $probeAddress $appPort)) {
    throw "APP_PORT $appPort is already in use. Choose another port in .env before starting."
  }
  Write-Host 'Building and starting Crypta...' -ForegroundColor Cyan
  & docker compose up --build -d
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose could not start Crypta. Check 'docker compose logs backend frontend'." }
  $currentPort = Get-CryptaPublishedPort
  if ($currentPort -ne $appPort) { throw "Docker did not publish the expected frontend port $appPort." }

  $ready = $false
  $startupWait = [Diagnostics.Stopwatch]::StartNew()
  while ($startupWait.Elapsed.TotalSeconds -lt 120) {
    if (Test-CryptaReady $probeUrl) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw "Crypta did not become ready at $appUrl. Check 'docker compose ps' and 'docker compose logs backend frontend'." }
  & docker compose ps
  if ($LASTEXITCODE -ne 0) { throw 'Could not read Compose service status.' }
  Write-Host "Crypta: $appUrl" -ForegroundColor Green
  if (-not $NoBrowser) { Start-Process $appUrl }
} finally { Pop-Location }
