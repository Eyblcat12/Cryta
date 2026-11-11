param(
  [string]$BaseUrl = 'http://localhost:8080/api/v1',
  [string]$AdminEmail = 'admin@congty.com',
  [string]$AdminPassword = 'Password@123',
  [string]$ApproverEmail = 'it.manager@congty.com',
  [string]$ApproverPassword = 'Password@123',
  [string]$UserEmail = 'dev.nguyen@congty.com',
  [string]$UserPassword = 'Password@123'
)

$ErrorActionPreference = 'Stop'

function Invoke-CryptaApi {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [object]$Body,
    [string]$Token
  )

  $headers = @{}
  if ($Token) { $headers.Authorization = "Bearer $Token" }
  $parameters = @{
    Method = $Method
    Uri = "$BaseUrl$Path"
    Headers = $headers
    ContentType = 'application/json'
    UseBasicParsing = $true
  }
  if ($null -ne $Body) { $parameters.Body = $Body | ConvertTo-Json -Depth 8 }
  return Invoke-RestMethod @parameters
}

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw "FAILED: $Message" }
  Write-Host "PASS: $Message" -ForegroundColor Green
}

$createdUserId = $null
$adminToken = $null
$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$testEmail = "smoke.$stamp@congty.com"
$initialPassword = 'Initial@Test12345'
$newPassword = 'Changed@Test12345'

try {
  $health = Invoke-CryptaApi -Method GET -Path '/health'
  Assert-True ($health.data.status -eq 'ok') 'Health endpoint reports ok'

  $adminLogin = Invoke-CryptaApi -Method POST -Path '/auth/login' -Body @{ email = $AdminEmail; password = $AdminPassword }
  $adminToken = $adminLogin.data.accessToken
  Assert-True ([bool]$adminToken) 'Admin login returns an access token'

  $reference = Invoke-CryptaApi -Method GET -Path '/users/reference-data' -Token $adminToken
  $department = $reference.data.departments | Select-Object -First 1
  Assert-True ([bool]$department.id) 'Admin can load user reference data'

  $created = Invoke-CryptaApi -Method POST -Path '/users' -Token $adminToken -Body @{
    email = $testEmail
    displayName = 'Smoke Test User'
    departmentId = $department.id
    temporaryPassword = $initialPassword
    roles = @('USER')
    approverDepartmentIds = @()
  }
  $createdUserId = $created.data.id
  Assert-True ($created.data.mustChangePassword -eq $true) 'New account is marked for mandatory password change'

  $initialLogin = Invoke-CryptaApi -Method POST -Path '/auth/login' -Body @{ email = $testEmail; password = $initialPassword }
  Assert-True ($initialLogin.data.user.mustChangePassword -eq $true) 'First login exposes the mandatory password-change state'

  $businessBlocked = $false
  try {
    Invoke-CryptaApi -Method GET -Path '/assets' -Token $initialLogin.data.accessToken | Out-Null
  } catch {
    $businessBlocked = $_.Exception.Response.StatusCode.value__ -eq 403
  }
  Assert-True $businessBlocked 'Temporary-password session cannot access business endpoints'

  $changed = Invoke-CryptaApi -Method POST -Path '/auth/change-password' -Token $initialLogin.data.accessToken -Body @{
    currentPassword = $initialPassword
    newPassword = $newPassword
  }
  Assert-True ($changed.data.changed -eq $true -and $changed.data.loginRequired -eq $true) 'Password change revokes sessions and requires login again'

  $oldTokenRejected = $false
  try {
    Invoke-CryptaApi -Method GET -Path '/auth/me' -Token $initialLogin.data.accessToken | Out-Null
  } catch {
    $oldTokenRejected = $_.Exception.Response.StatusCode.value__ -eq 401
  }
  Assert-True $oldTokenRejected 'Access token issued before password change is revoked'

  $oldPasswordRejected = $false
  try {
    Invoke-CryptaApi -Method POST -Path '/auth/login' -Body @{ email = $testEmail; password = $initialPassword } | Out-Null
  } catch {
    $oldPasswordRejected = $_.Exception.Response.StatusCode.value__ -eq 401
  }
  Assert-True $oldPasswordRejected 'Old temporary password is rejected'

  $newLogin = Invoke-CryptaApi -Method POST -Path '/auth/login' -Body @{ email = $testEmail; password = $newPassword }
  Assert-True ($newLogin.data.user.mustChangePassword -eq $false) 'New password works and clears the mandatory-change flag'

  $approverLogin = Invoke-CryptaApi -Method POST -Path '/auth/login' -Body @{ email = $ApproverEmail; password = $ApproverPassword }
  $queue = Invoke-CryptaApi -Method GET -Path '/requests' -Token $approverLogin.data.accessToken
  $queueItems = @($queue.data)
  if ($queueItems.Count -gt 0) {
    $sample = $queueItems | Select-Object -First 1
    Assert-True ([bool]$sample.creatorName -and [bool]$sample.departmentName -and [bool]$sample.version) 'Approver queue includes creator, department, and concurrency version'
  } else {
    Write-Host 'PASS: Approver queue is accessible (currently empty)' -ForegroundColor Green
  }

  $userLogin = Invoke-CryptaApi -Method POST -Path '/auth/login' -Body @{ email = $UserEmail; password = $UserPassword }
  $policies = Invoke-CryptaApi -Method GET -Path '/policies' -Token $userLogin.data.accessToken
  $certificatePolicy = @($policies.data) | Where-Object { $_.configuration.certificate_profile } | Select-Object -First 1
  Assert-True ([bool]$certificatePolicy.id) 'Certificate-only policy is available for boundary testing'

  $policyRejected = $false
  try {
    Invoke-CryptaApi -Method POST -Path '/requests' -Token $userLogin.data.accessToken -Body @{
      type = 'CREATE'
      policyVersionId = $certificatePolicy.id
      reason = 'Smoke test must reject an incompatible asset type'
      emergency = $false
      parameters = @{ assetType = 'KEY'; algorithm = 'RSA'; keySize = 2048; validityDays = 90 }
    } | Out-Null
  } catch {
    $policyRejected = $_.Exception.Response.StatusCode.value__ -eq 409
  }
  Assert-True $policyRejected 'Server rejects a KEY request that uses a certificate-only policy'

  Write-Host 'Crypta smoke test completed successfully.' -ForegroundColor Cyan
} finally {
  if ($createdUserId -and $adminToken) {
    try {
      Invoke-CryptaApi -Method PATCH -Path "/users/$createdUserId/status" -Token $adminToken -Body @{ status = 'INACTIVE' } | Out-Null
      Write-Host "Cleanup: deactivated $testEmail" -ForegroundColor DarkGray
    } catch {
      Write-Warning "Could not deactivate test account $testEmail. Deactivate it in Admin > Users."
    }
  }
}
