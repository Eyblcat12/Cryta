param([string]$BaseUrl = 'http://127.0.0.1:8080')

$ErrorActionPreference = 'Stop'
$origin = $BaseUrl.TrimEnd('/')
$routes = @(
  '/dashboard', '/assets', '/assets/', '/assets?status=EXPIRED',
  '/assets/example-id', '/users?q=Nguy%E1%BB%85n', '/audit?q=login',
  '/policies', '/operations/email?status=FAILED', '/operations/provider', '/requests/example-id',
  '/requests?status=COMPLETED&page=2', '/approvals?q=TLS&emergency=1',
  '/notifications', '/forbidden', '/unknown-route'
)

foreach ($route in $routes) {
  $response = Invoke-WebRequest -Uri "$origin$route" -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 10
  if ($response.StatusCode -ne 200 -or $response.Headers.Location) {
    throw "SPA route $route returned $($response.StatusCode), Location=$($response.Headers.Location)"
  }
  if ($response.Content -notmatch '<div id="root"></div>') {
    throw "SPA route $route did not return the application shell."
  }
  Write-Host "PASS $route"
}

$index = Invoke-WebRequest -Uri "$origin/" -UseBasicParsing -TimeoutSec 10
$assetPath = [regex]::Match($index.Content, 'src="(/assets/[^\"]+\.js)"').Groups[1].Value
if (-not $assetPath) { throw 'Could not find the built JavaScript asset.' }
$asset = Invoke-WebRequest -Uri "$origin$assetPath" -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 10
if ($asset.StatusCode -ne 200 -or $asset.Headers['Content-Type'] -notmatch 'javascript') {
  throw "Static JavaScript asset returned $($asset.StatusCode) or unexpected Content-Type."
}
Write-Host "PASS $assetPath"

$health = Invoke-WebRequest -Uri "$origin/api/v1/health" -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 10
if ($health.StatusCode -ne 200 -or $health.Content -notmatch '"status":"ok"') {
  throw "API health returned $($health.StatusCode) or unhealthy payload."
}
Write-Host 'PASS /api/v1/health'
