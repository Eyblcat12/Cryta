param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectDir

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop is not installed. Install and open Docker Desktop first.' }
docker info | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not running or this account cannot access Docker. Open Docker Desktop and try again.' }

$envFile = Join-Path $projectDir '.env'
if (-not (Test-Path -LiteralPath $envFile)) {
  Copy-Item -LiteralPath (Join-Path $projectDir '.env.example') -Destination $envFile
  $dbSecret = -join ((1..40) | ForEach-Object { 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[(Get-Random -Maximum 62)] })
  $jwtSecret = -join ((1..64) | ForEach-Object { 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[(Get-Random -Maximum 62)] })
  $content = Get-Content -Raw -LiteralPath $envFile
  $content = $content.Replace('CHANGE_ME_GENERATED_BY_START_SCRIPT', $dbSecret)
  $first = $content.IndexOf($dbSecret)
  $second = $content.IndexOf($dbSecret, $first + 1)
  if ($second -ge 0) { $content = $content.Remove($second, $dbSecret.Length).Insert($second, $jwtSecret) }
  Set-Content -LiteralPath $envFile -Value $content -Encoding utf8
  Write-Host 'Created .env with random database and JWT secrets.' -ForegroundColor Green
}

Write-Host 'Building and starting Crypta...' -ForegroundColor Cyan
docker compose up --build -d
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose could not start Crypta.' }
docker compose ps
Write-Host 'Crypta: http://localhost:8080' -ForegroundColor Green
Write-Host 'For real email, configure SMTP_* and set SMTP_ENABLED=true in .env, then run this file again.' -ForegroundColor Yellow
if (-not $NoBrowser) { Start-Process 'http://localhost:8080' }
