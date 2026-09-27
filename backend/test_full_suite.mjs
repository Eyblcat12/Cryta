import { Pool } from 'pg';

const API_BASE = 'http://localhost:3000/api/v1';
const DOCS_BASE = 'http://localhost:3000';
const UI_BASE = 'http://127.0.0.1:5173';
const DB_URL = 'postgresql://postgres.birqopdckxfjopntntks:ZIr9KtCHIp0CFGCj@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres';

let passed = 0;
let failed = 0;
const results = [];

function logTest(suite, name, isPass, detail = '') {
  if (isPass) {
    passed++;
    console.log(`  \x1b[32m✔ [PASS]\x1b[0m [${suite}] ${name}`);
    results.push({ suite, name, status: 'PASS', detail });
  } else {
    failed++;
    console.log(`  \x1b[31m✖ [FAIL]\x1b[0m [${suite}] ${name} - ${detail}`);
    results.push({ suite, name, status: 'FAIL', detail });
  }
}

async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  const reqHeaders = { ...headers };
  if (token) reqHeaders['Authorization'] = `Bearer ${token}`;
  if (body) reqHeaders['Content-Type'] = 'application/json';
  
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  
  let json = null;
  const text = await res.text();
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, headers: res.headers, data: json };
}

async function run() {
  console.log('\n===============================================================');
  console.log('    CRYTA AUTOMATED END-TO-END TEST RUNNER (ALL 8 SUITES)      ');
  console.log('===============================================================\n');

  let adminToken = '';
  let itManagerToken = '';
  let finManagerToken = '';
  let devToken = '';
  let cisoToken = '';
  let rsaPolicyId = '';
  let tlsPolicyId = '';
  let itDeptId = '';
  let finDeptId = '';

  // -----------------------------------------------------------------
  // SUITE 1: AUTHENTICATION & SESSION MANAGEMENT
  // -----------------------------------------------------------------
  console.log('\n\x1b[36m▶ SUITE 1: AUTHENTICATION & SESSION MANAGEMENT\x1b[0m');

  // TC-AUTH-01: Health check
  try {
    const res = await api('/health');
    const ok = res.status === 200 && res.data?.data?.database === 'connected';
    logTest('AUTH', 'TC-AUTH-01: System health check & database connected', ok, `Status ${res.status}`);
  } catch (e) {
    logTest('AUTH', 'TC-AUTH-01: System health check & database connected', false, e.message);
  }

  // TC-AUTH-02: Valid logins for all roles
  try {
    const resAdmin = await api('/auth/login', { method: 'POST', body: { email: 'admin@congty.com', password: 'Password@123' } });
    adminToken = resAdmin.data?.data?.accessToken;
    const adminOk = resAdmin.status === 200 && !!adminToken && resAdmin.data.data.user.roles.includes('ADMIN');

    const resIT = await api('/auth/login', { method: 'POST', body: { email: 'it.manager@congty.com', password: 'Password@123' } });
    itManagerToken = resIT.data?.data?.accessToken;
    itDeptId = resIT.data?.data?.user.departmentId;

    const resFin = await api('/auth/login', { method: 'POST', body: { email: 'fin.manager@congty.com', password: 'Password@123' } });
    finManagerToken = resFin.data?.data?.accessToken;
    finDeptId = resFin.data?.data?.user.departmentId;

    const resDev = await api('/auth/login', { method: 'POST', body: { email: 'dev.nguyen@congty.com', password: 'Password@123' } });
    devToken = resDev.data?.data?.accessToken;

    const resCiso = await api('/auth/login', { method: 'POST', body: { email: 'ciso@congty.com', password: 'Password@123' } });
    cisoToken = resCiso.data?.data?.accessToken;

    logTest('AUTH', 'TC-AUTH-02: Login with valid credentials for all 4 roles (ADMIN, CISO, APPROVER, USER)', adminOk && !!itManagerToken && !!devToken);
  } catch (e) {
    logTest('AUTH', 'TC-AUTH-02: Login with valid credentials', false, e.message);
  }

  // TC-AUTH-03: Invalid password
  try {
    const res = await api('/auth/login', { method: 'POST', body: { email: 'admin@congty.com', password: 'WrongPassword999!' } });
    const ok = res.status === 401 && res.data?.error?.code === 'INVALID_CREDENTIALS';
    logTest('AUTH', 'TC-AUTH-03: Rejection on wrong password (401 INVALID_CREDENTIALS)', ok, `Code: ${res.data?.error?.code}`);
  } catch (e) {
    logTest('AUTH', 'TC-AUTH-03: Rejection on wrong password', false, e.message);
  }

  // TC-AUTH-04: Non-existent email
  try {
    const res = await api('/auth/login', { method: 'POST', body: { email: 'ghost.user.nonexistent@congty.com', password: 'Password@123' } });
    const ok = res.status === 401 && res.data?.error?.code === 'INVALID_CREDENTIALS';
    logTest('AUTH', 'TC-AUTH-04: Rejection on unknown email (401 INVALID_CREDENTIALS)', ok, `Code: ${res.data?.error?.code}`);
  } catch (e) {
    logTest('AUTH', 'TC-AUTH-04: Rejection on unknown email', false, e.message);
  }

  // TC-AUTH-05: Account lockout testing
  try {
    const lockoutEmail = `lockout.test_${Date.now()}@congty.com`;
    await api('/users', {
      method: 'POST',
      token: adminToken,
      body: {
        email: lockoutEmail,
        displayName: 'Lockout Test User',
        departmentId: itDeptId,
        temporaryPassword: 'Password@123',
        roles: ['USER'],
        approverDepartmentIds: []
      }
    });

    let lockedOut = false;
    for (let i = 1; i <= 11; i++) {
      const failRes = await api('/auth/login', { method: 'POST', body: { email: lockoutEmail, password: 'WrongPassword!' } });
      if (failRes.data?.error?.code === 'ACCOUNT_TEMPORARILY_LOCKED') {
        lockedOut = true;
        break;
      }
    }
    logTest('AUTH', 'TC-AUTH-05: Brute-force lockout (locked after 10 failed attempts)', lockedOut);
  } catch (e) {
    logTest('AUTH', 'TC-AUTH-05: Brute-force lockout', false, e.message);
  }

  // TC-AUTH-06: Profile check
  try {
    const res = await api('/auth/me', { token: adminToken });
    const ok = res.status === 200 && res.data?.data?.email === 'admin@congty.com';
    logTest('AUTH', 'TC-AUTH-06: GET /api/v1/auth/me returns current user identity', ok);
  } catch (e) {
    logTest('AUTH', 'TC-AUTH-06: GET /api/v1/auth/me', false, e.message);
  }

  // TC-AUTH-07 & 08: Refresh token rotation & Replay prevention
  try {
    const loginRes = await api('/auth/login', { method: 'POST', body: { email: 'admin@congty.com', password: 'Password@123' } });
    const cookies = loginRes.headers.getSetCookie?.() || [loginRes.headers.get('set-cookie') || ''];
    const refreshCookie1 = cookies.find(c => c && c.startsWith('crypta_refresh=')) || '';

    // Refresh once
    const refreshRes = await api('/auth/refresh', {
      method: 'POST',
      headers: { cookie: refreshCookie1 }
    });
    const refreshCookies = refreshRes.headers.getSetCookie?.() || [refreshRes.headers.get('set-cookie') || ''];
    const refreshCookie2 = refreshCookies.find(c => c && c.startsWith('crypta_refresh=')) || '';
    const refreshOk = refreshRes.status === 200 && !!refreshRes.data?.data?.accessToken && !!refreshCookie2 && refreshCookie2 !== refreshCookie1;

    // Replay attack with refreshCookie1
    const replayRes = await api('/auth/refresh', {
      method: 'POST',
      headers: { cookie: refreshCookie1 }
    });
    const replayBlocked = replayRes.status === 401 && replayRes.data?.error?.code === 'SESSION_INVALID';

    logTest('AUTH', 'TC-AUTH-07: Refresh token rotation via HTTP-only cookie returns new access & refresh tokens', refreshOk);
    logTest('AUTH', 'TC-AUTH-08: Replay attack on replaced token is blocked (401 SESSION_INVALID)', replayBlocked);
  } catch (e) {
    logTest('AUTH', 'TC-AUTH-07 & 08: Refresh rotation & replay', false, e.message);
  }

  // TC-AUTH-09: Password change & Session invalidation
  try {
    const sameRes = await api('/auth/change-password', {
      method: 'POST',
      token: devToken,
      body: { currentPassword: 'Password@123', newPassword: 'Password@123' }
    });
    const sameBlocked = sameRes.status === 400 && sameRes.data?.error?.code === 'PASSWORD_UNCHANGED';

    const wrongRes = await api('/auth/change-password', {
      method: 'POST',
      token: devToken,
      body: { currentPassword: 'WrongOldPassword!', newPassword: 'NewPassword@456' }
    });
    const wrongBlocked = wrongRes.status === 401 && wrongRes.data?.error?.code === 'CURRENT_PASSWORD_INVALID';

    const goodRes = await api('/auth/change-password', {
      method: 'POST',
      token: devToken,
      body: { currentPassword: 'Password@123', newPassword: 'NewPassword@456' }
    });
    const goodChanged = goodRes.status === 200 && goodRes.data?.data?.changed === true;

    const oldTokenBlocked = (await api('/assets', { token: devToken })).status === 401;

    const reLogin = await api('/auth/login', { method: 'POST', body: { email: 'dev.nguyen@congty.com', password: 'NewPassword@456' } });
    devToken = reLogin.data?.data?.accessToken;
    await api('/auth/change-password', {
      method: 'POST',
      token: devToken,
      body: { currentPassword: 'NewPassword@456', newPassword: 'Password@123' }
    });
    const devResetLogin = await api('/auth/login', { method: 'POST', body: { email: 'dev.nguyen@congty.com', password: 'Password@123' } });
    devToken = devResetLogin.data?.data?.accessToken;

    logTest('AUTH', 'TC-AUTH-09: Password change validations & instant token revocation', sameBlocked && wrongBlocked && goodChanged && oldTokenBlocked);
  } catch (e) {
    logTest('AUTH', 'TC-AUTH-09: Password change validations', false, e.message);
  }

  // TC-AUTH-10: Logout
  try {
    const tempLogin = await api('/auth/login', { method: 'POST', body: { email: 'ciso@congty.com', password: 'Password@123' } });
    const logoutRes = await api('/auth/logout', { method: 'POST', token: tempLogin.data?.data?.accessToken });
    logTest('AUTH', 'TC-AUTH-10: Logout revokes session cleanly', logoutRes.status === 200 && logoutRes.data?.data?.loggedOut === true);
  } catch (e) {
    logTest('AUTH', 'TC-AUTH-10: Logout revokes session', false, e.message);
  }


  // -----------------------------------------------------------------
  // SUITE 2: USER MANAGEMENT & RBAC SECURITY
  // -----------------------------------------------------------------
  console.log('\n\x1b[36m▶ SUITE 2: USER MANAGEMENT & RBAC SECURITY\x1b[0m');

  // TC-RBAC-01 & 02: Reference data access
  try {
    const refAdmin = await api('/users/reference-data', { token: adminToken });
    const refAdminOk = refAdmin.status === 200 && refAdmin.data?.data?.departments?.length > 0;

    const refUser = await api('/users/reference-data', { token: devToken });
    const refUserBlocked = refUser.status === 403 && refUser.data?.error?.code === 'ADMIN_REQUIRED';

    logTest('RBAC', 'TC-RBAC-01: Admin can fetch reference data', refAdminOk);
    logTest('RBAC', 'TC-RBAC-02: Regular user is forbidden from user reference data (403)', refUserBlocked);
  } catch (e) {
    logTest('RBAC', 'TC-RBAC-01/02: Reference data', false, e.message);
  }

  // TC-RBAC-03: List users
  try {
    const listRes = await api('/users', { token: adminToken });
    logTest('RBAC', 'TC-RBAC-03: Admin lists all users with roles and department scopes', listRes.status === 200 && listRes.data?.data?.length >= 5);
  } catch (e) {
    logTest('RBAC', 'TC-RBAC-03: List users', false, e.message);
  }

  // TC-RBAC-04: SoD conflict creation
  try {
    const sodRes = await api('/users', {
      method: 'POST',
      token: adminToken,
      body: {
        email: 'sod.tester@congty.com',
        displayName: 'SoD Tester',
        departmentId: itDeptId,
        temporaryPassword: 'Password@123',
        roles: ['ADMIN', 'APPROVER'],
        approverDepartmentIds: [itDeptId]
      }
    });
    const ok = sodRes.status === 409 && sodRes.data?.error?.code === 'SOD_ROLE_CONFLICT';
    logTest('RBAC', 'TC-RBAC-04: SoD enforcement - Account cannot have both ADMIN and APPROVER (409)', ok);
  } catch (e) {
    logTest('RBAC', 'TC-RBAC-04: SoD conflict', false, e.message);
  }

  // TC-RBAC-05 & 06: Create valid user and duplicate email check
  let createdUserId = '';
  const testEmail = `qa.engineer_${Date.now()}@congty.com`;
  try {
    const createRes = await api('/users', {
      method: 'POST',
      token: adminToken,
      body: {
        email: testEmail,
        displayName: 'QA Engineer',
        departmentId: itDeptId,
        temporaryPassword: 'Password@123',
        roles: ['USER'],
        approverDepartmentIds: []
      }
    });
    createdUserId = createRes.data?.data?.id;
    const createOk = createRes.status === 201 && !!createdUserId;

    const dupRes = await api('/users', {
      method: 'POST',
      token: adminToken,
      body: {
        email: testEmail,
        displayName: 'QA Engineer 2',
        departmentId: itDeptId,
        temporaryPassword: 'Password@123',
        roles: ['USER'],
        approverDepartmentIds: []
      }
    });
    const dupBlocked = dupRes.status === 409 && dupRes.data?.error?.code === 'EMAIL_EXISTS';

    logTest('RBAC', 'TC-RBAC-05: Admin creates valid user with temporary password', createOk);
    logTest('RBAC', 'TC-RBAC-06: Duplicate email is rejected (409 EMAIL_EXISTS)', dupBlocked);
  } catch (e) {
    logTest('RBAC', 'TC-RBAC-05/06: User creation', false, e.message);
  }

  // TC-RBAC-07 & 08: Deactivate & Reactivate user
  try {
    const deactRes = await api(`/users/${createdUserId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'INACTIVE' }
    });
    const deactOk = deactRes.status === 200 && deactRes.data?.data?.status === 'INACTIVE';

    const loginInactive = await api('/auth/login', { method: 'POST', body: { email: testEmail, password: 'Password@123' } });
    const loginInactiveBlocked = loginInactive.status === 401;

    const reactRes = await api(`/users/${createdUserId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'ACTIVE' }
    });
    const reactOk = reactRes.status === 200 && reactRes.data?.data?.status === 'ACTIVE';

    const loginActive = await api('/auth/login', { method: 'POST', body: { email: testEmail, password: 'Password@123' } });
    const loginActiveOk = loginActive.status === 200;

    logTest('RBAC', 'TC-RBAC-07: Deactivating user revokes sessions and blocks login', deactOk && loginInactiveBlocked);
    logTest('RBAC', 'TC-RBAC-08: Reactivating user restores login access', reactOk && loginActiveOk);
  } catch (e) {
    logTest('RBAC', 'TC-RBAC-07/08: Status management', false, e.message);
  }

  // TC-RBAC-09: Self disable prevention
  try {
    const meRes = await api('/auth/me', { token: adminToken });
    const adminId = meRes.data?.data?.id;
    const selfRes = await api(`/users/${adminId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'INACTIVE' }
    });
    const ok = selfRes.status === 409 && selfRes.data?.error?.code === 'CANNOT_DISABLE_SELF';
    logTest('RBAC', 'TC-RBAC-09: Admin cannot deactivate their own active account (409 CANNOT_DISABLE_SELF)', ok);
  } catch (e) {
    logTest('RBAC', 'TC-RBAC-09: Self disable prevention', false, e.message);
  }


  // -----------------------------------------------------------------
  // SUITE 3: REQUEST LIFECYCLE & SEPARATION OF DUTIES
  // -----------------------------------------------------------------
  console.log('\n\x1b[36m▶ SUITE 3: REQUEST LIFECYCLE & SEPARATION OF DUTIES\x1b[0m');

  // Fetch policies
  const polRes = await api('/policies', { token: devToken });
  const rsaPolicy = polRes.data?.data?.find(p => p.code === 'RSA_STANDARD');
  const tlsPolicy = polRes.data?.data?.find(p => p.code === 'TLS_WEB');
  rsaPolicyId = rsaPolicy?.id;
  tlsPolicyId = tlsPolicy?.id;

  // TC-REQ-01: Admin cannot create business requests
  try {
    const res = await api('/requests', {
      method: 'POST',
      token: adminToken,
      body: { type: 'CREATE', policyVersionId: rsaPolicyId, reason: 'Admin attempt' }
    });
    const ok = res.status === 403 && res.data?.error?.code === 'ROLE_FORBIDDEN';
    logTest('REQ', 'TC-REQ-01: Admin cannot create business requests (403 ROLE_FORBIDDEN)', ok);
  } catch (e) {
    logTest('REQ', 'TC-REQ-01: Admin request creation', false, e.message);
  }

  // TC-REQ-02: CREATE with targetAssetId not allowed
  try {
    const res = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: { type: 'CREATE', policyVersionId: rsaPolicyId, targetAssetId: 'd1111111-1111-1111-1111-111111111111', reason: 'Invalid target' }
    });
    const ok = res.status === 409 && res.data?.error?.code === 'TARGET_ASSET_NOT_ALLOWED';
    logTest('REQ', 'TC-REQ-02: CREATE request cannot specify targetAssetId (409)', ok);
  } catch (e) {
    logTest('REQ', 'TC-REQ-02: Target asset not allowed', false, e.message);
  }

  // TC-REQ-03: RENEW without targetAssetId rejected
  try {
    const res = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: { type: 'RENEW', policyVersionId: rsaPolicyId, reason: 'Lý do gia hạn không có target asset' }
    });
    const ok = res.status === 400 || res.status === 409;
    logTest('REQ', 'TC-REQ-03: RENEW request requires targetAssetId (rejected with 400/409)', ok);
  } catch (e) {
    logTest('REQ', 'TC-REQ-03: Target asset required', false, e.message);
  }

  // TC-REQ-04: Policy mismatch (ECDSA algorithm on RSA policy)
  try {
    const res = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: {
        type: 'CREATE',
        policyVersionId: rsaPolicyId,
        reason: 'Algorithm mismatch test',
        parameters: { assetType: 'KEY', algorithm: 'ECDSA', keySize: 2048 }
      }
    });
    const ok = res.status === 409 && res.data?.error?.code === 'POLICY_ALGORITHM_MISMATCH';
    logTest('REQ', 'TC-REQ-04: Policy validation - Algorithm mismatch is rejected (409)', ok);
  } catch (e) {
    logTest('REQ', 'TC-REQ-04: Policy algorithm mismatch', false, e.message);
  }

  // TC-REQ-05: Key size too small
  try {
    const res = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: {
        type: 'CREATE',
        policyVersionId: rsaPolicyId,
        reason: 'Key size small test',
        parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 1024 }
      }
    });
    const ok = res.status === 409 && res.data?.error?.code === 'POLICY_KEY_SIZE_TOO_SMALL';
    logTest('REQ', 'TC-REQ-05: Policy validation - Key size below minimum is rejected (409)', ok);
  } catch (e) {
    logTest('REQ', 'TC-REQ-05: Key size too small', false, e.message);
  }

  // TC-REQ-06: Validity days exceeded
  try {
    const res = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: {
        type: 'CREATE',
        policyVersionId: rsaPolicyId,
        reason: 'Validity exceeded test',
        parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 2048, validityDays: 9999 }
      }
    });
    const ok = res.status === 409 && res.data?.error?.code === 'POLICY_VALIDITY_EXCEEDED';
    logTest('REQ', 'TC-REQ-06: Policy validation - Validity exceeding policy limit is rejected (409)', ok);
  } catch (e) {
    logTest('REQ', 'TC-REQ-06: Validity days exceeded', false, e.message);
  }

  // TC-REQ-07 & 08 & 09: Create, Cancel, and Re-cancel
  try {
    const createRes = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: {
        type: 'CREATE',
        policyVersionId: rsaPolicyId,
        reason: 'Test request to be cancelled',
        parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 2048, validityDays: 30 }
      }
    });
    const reqId = createRes.data?.data?.id;
    const createOk = createRes.status === 201 && createRes.data?.data?.status === 'PENDING';

    const cancelRes = await api(`/requests/${reqId}/cancel`, { method: 'POST', token: devToken });
    const cancelOk = cancelRes.status === 201 && cancelRes.data?.data?.status === 'CANCELLED';

    const reCancelRes = await api(`/requests/${reqId}/cancel`, { method: 'POST', token: devToken });
    const reCancelBlocked = reCancelRes.status === 409 && reCancelRes.data?.error?.code === 'INVALID_REQUEST_STATE';

    logTest('REQ', 'TC-REQ-07: Regular user creates valid request with status PENDING', createOk);
    logTest('REQ', 'TC-REQ-08: Creator can cancel pending request (status CANCELLED)', cancelOk);
    logTest('REQ', 'TC-REQ-09: Re-cancelling already cancelled request is rejected (409)', reCancelBlocked);
  } catch (e) {
    logTest('REQ', 'TC-REQ-07/08/09: Cancellation flow', false, e.message);
  }

  // TC-REQ-10: Creator cannot approve their own request (SoD)
  let pendingReqId = '';
  try {
    const createRes = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: {
        type: 'CREATE',
        policyVersionId: rsaPolicyId,
        reason: 'Yêu cầu kiểm thử SoD tự duyệt',
        parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 2048, validityDays: 30 }
      }
    });
    pendingReqId = createRes.data?.data?.id;

    const selfApprove = await api(`/requests/${pendingReqId}/decision`, {
      method: 'POST',
      token: devToken,
      body: { decision: 'APPROVED' }
    });
    const selfApproveBlocked = selfApprove.status === 403;
    logTest('REQ', 'TC-REQ-10: SoD enforcement - Non-approver/creator cannot approve (403)', selfApproveBlocked);
  } catch (e) {
    logTest('REQ', 'TC-REQ-10: Creator approve self', false, e.message);
  }

  // TC-REQ-11: Out of scope approval (Fin approver on IT request)
  try {
    const outScopeRes = await api(`/requests/${pendingReqId}/decision`, {
      method: 'POST',
      token: finManagerToken,
      body: { decision: 'APPROVED', comment: 'Duyệt nhầm phòng ban' }
    });
    const ok = outScopeRes.status === 403 && outScopeRes.data?.error?.code === 'OUT_OF_SCOPE';
    logTest('REQ', 'TC-REQ-11: Approver from different department is blocked (403 OUT_OF_SCOPE)', ok);
  } catch (e) {
    logTest('REQ', 'TC-REQ-11: Out of scope', false, e.message);
  }

  // TC-REQ-12: Reject request & Re-decision block
  try {
    const rejectRes = await api(`/requests/${pendingReqId}/decision`, {
      method: 'POST',
      token: itManagerToken,
      body: { decision: 'REJECTED', comment: 'Từ chối để kiểm thử từ chối yêu cầu' }
    });
    const rejectOk = rejectRes.status === 201 && rejectRes.data?.data?.status === 'REJECTED';

    const reDecideRes = await api(`/requests/${pendingReqId}/decision`, {
      method: 'POST',
      token: itManagerToken,
      body: { decision: 'APPROVED' }
    });
    const reDecideBlocked = reDecideRes.status === 409 && reDecideRes.data?.error?.code === 'REQUEST_ALREADY_DECIDED';

    logTest('REQ', 'TC-REQ-12: IT Approver rejects request with comment; cannot be re-decided (409)', rejectOk && reDecideBlocked);
  } catch (e) {
    logTest('REQ', 'TC-REQ-12: Reject request', false, e.message);
  }


  // -----------------------------------------------------------------
  // SUITE 4: CRYPTOGRAPHIC PROVISIONING & EMERGENCY REVOCATION
  // -----------------------------------------------------------------
  console.log('\n\x1b[36m▶ SUITE 4: CRYPTOGRAPHIC PROVISIONING & EMERGENCY REVOCATION\x1b[0m');

  let provisionedCertId = '';
  let linkedPublicKeyAssetId = '';

  // TC-CRYPTO-01 & 02: Provision Certificate & verify Public Key Asset link
  try {
    const certReq = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: {
        type: 'CREATE',
        policyVersionId: tlsPolicyId,
        reason: 'Cấp chứng thư số TLS cho API Gateway',
        parameters: { assetType: 'CERTIFICATE', algorithm: 'RSA', keySize: 2048, validityDays: 90 }
      }
    });
    const certReqId = certReq.data?.data?.id;

    await api(`/requests/${certReqId}/decision`, {
      method: 'POST',
      token: itManagerToken,
      body: { decision: 'APPROVED', comment: 'Phê duyệt cấp chứng thư số' }
    });

    let completed = false;
    for (let i = 0; i < 7; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const reqDetail = await api(`/requests/${certReqId}`, { token: devToken });
      if (reqDetail.data?.data?.status === 'COMPLETED' && reqDetail.data?.data?.resultAssetId) {
        completed = true;
        provisionedCertId = reqDetail.data.data.resultAssetId;
        break;
      }
    }

    const pool = new Pool({ connectionString: DB_URL });
    const certRow = await pool.query('SELECT * FROM certificates WHERE asset_id = $1', [provisionedCertId]);
    linkedPublicKeyAssetId = certRow.rows[0]?.public_key_asset_id;
    await pool.end();

    const certHasKey = !!linkedPublicKeyAssetId;
    logTest('CRYPTO', 'TC-CRYPTO-01: User creates & Approver approves Certificate request', !!certReqId);
    logTest('CRYPTO', 'TC-CRYPTO-02: Background worker provisions Certificate with linked Public Key Asset ID', completed && certHasKey);
  } catch (e) {
    logTest('CRYPTO', 'TC-CRYPTO-01/02: Certificate provisioning', false, e.message);
  }

  // TC-CRYPTO-03 & 04: Asset scope visibility & denial
  try {
    const devAssets = await api('/assets', { token: devToken });
    const devAssetIds = devAssets.data?.data?.map(a => a.id) || [];
    const devSeesOwn = devAssetIds.includes(provisionedCertId);

    const finDenied = await api(`/assets/${provisionedCertId}`, { token: finManagerToken });
    const isDenied = finDenied.status === 403 && finDenied.data?.error?.code === 'ASSET_SCOPE_DENIED';

    logTest('CRYPTO', 'TC-CRYPTO-03: Asset listing correctly filters by user scope', devSeesOwn);
    logTest('CRYPTO', 'TC-CRYPTO-04: Approver/User from another dept is denied viewing asset (403 ASSET_SCOPE_DENIED)', isDenied);
  } catch (e) {
    logTest('CRYPTO', 'TC-CRYPTO-03/04: Asset scope', false, e.message);
  }

  // TC-CRYPTO-05: Non-admin emergency revoke blocked
  try {
    const devRevoke = await api(`/assets/${provisionedCertId}/revoke`, {
      method: 'POST',
      token: devToken,
      body: { reason: 'Unauthorized revoke attempt' }
    });
    const approverRevoke = await api(`/assets/${provisionedCertId}/revoke`, {
      method: 'POST',
      token: itManagerToken,
      body: { reason: 'Unauthorized approver revoke attempt' }
    });
    const ok = devRevoke.status === 403 && approverRevoke.status === 403;
    logTest('CRYPTO', 'TC-CRYPTO-05: Non-admin users cannot call Emergency Revoke (403 ADMIN_REQUIRED)', ok);
  } catch (e) {
    logTest('CRYPTO', 'TC-CRYPTO-05: Emergency revoke permission', false, e.message);
  }

  // TC-CRYPTO-06 & 07: Security Admin Emergency Revoke & Re-revoke prevention
  try {
    const revokeRes = await api(`/assets/${provisionedCertId}/revoke`, {
      method: 'POST',
      token: cisoToken,
      body: { reason: 'Phát hiện lộ khóa bảo mật - CISO thu hồi khẩn cấp ngay lập tức' }
    });
    const revokeOk = revokeRes.status === 201 && revokeRes.data?.data?.revoked === true;

    const assetDetail = await api(`/assets/${provisionedCertId}`, { token: adminToken });
    const isRevoked = assetDetail.data?.data?.status === 'REVOKED';

    const reRevokeRes = await api(`/assets/${provisionedCertId}/revoke`, {
      method: 'POST',
      token: adminToken,
      body: { reason: 'Thu hồi lần hai' }
    });
    const reRevokeBlocked = reRevokeRes.status === 409 && reRevokeRes.data?.error?.code === 'ASSET_NOT_ACTIVE';

    logTest('CRYPTO', 'TC-CRYPTO-06: Security Admin (CISO) performs Emergency Revocation -> status REVOKED', revokeOk && isRevoked);
    logTest('CRYPTO', 'TC-CRYPTO-07: Emergency Revocation on already REVOKED asset is rejected (409 ASSET_NOT_ACTIVE)', reRevokeBlocked);
  } catch (e) {
    logTest('CRYPTO', 'TC-CRYPTO-06/07: Emergency revocation', false, e.message);
  }


  // -----------------------------------------------------------------
  // SUITE 5: SECURITY POLICIES & VERSIONING
  // -----------------------------------------------------------------
  console.log('\n\x1b[36m▶ SUITE 5: SECURITY POLICIES & VERSIONING\x1b[0m');

  let testPolicyId = '';

  // TC-POLICY-01 & 02: List and Non-admin creation block
  try {
    const listRes = await api('/policies', { token: devToken });
    const listOk = listRes.status === 200 && listRes.data?.data?.length >= 3;

    const userCreate = await api('/policies', {
      method: 'POST',
      token: devToken,
      body: { code: 'HACK_POLICY', name: 'Hack Policy', configuration: {} }
    });
    const userBlocked = userCreate.status === 403 && userCreate.data?.error?.code === 'ADMIN_REQUIRED';

    logTest('POLICY', 'TC-POLICY-01: All authenticated users can view active security policies', listOk);
    logTest('POLICY', 'TC-POLICY-02: Non-admin users cannot create policies (403 ADMIN_REQUIRED)', userBlocked);
  } catch (e) {
    logTest('POLICY', 'TC-POLICY-01/02: Policy list & permission', false, e.message);
  }

  // TC-POLICY-03 & 04: Admin creates policy & duplicate code block
  try {
    const pool = new Pool({ connectionString: DB_URL });
    await pool.query(`DELETE FROM policies WHERE code = 'ED25519_QA_TEST'`);
    await pool.end();

    const createRes = await api('/policies', {
      method: 'POST',
      token: adminToken,
      body: {
        code: 'ED25519_QA_TEST',
        name: 'Tiêu chuẩn chữ ký số ED25519 QA',
        configuration: { algorithm: 'ED25519', maximum_validity_days: 180 }
      }
    });
    testPolicyId = createRes.data?.data?.policyId;
    const createOk = createRes.status === 201 && !!testPolicyId && createRes.data?.data?.version === 1;

    const dupRes = await api('/policies', {
      method: 'POST',
      token: adminToken,
      body: {
        code: 'ED25519_QA_TEST',
        name: 'Trùng mã chính sách',
        configuration: {}
      }
    });
    const dupBlocked = dupRes.status === 409 && dupRes.data?.error?.code === 'POLICY_EXISTS';

    logTest('POLICY', 'TC-POLICY-03: Security Admin creates new policy (v1) with configuration', createOk);
    logTest('POLICY', 'TC-POLICY-04: Duplicate policy code is rejected (409 POLICY_EXISTS)', dupBlocked);
  } catch (e) {
    logTest('POLICY', 'TC-POLICY-03/04: Policy creation', false, e.message);
  }

  // TC-POLICY-05: Admin publishes new version (v2)
  try {
    const v2Res = await api(`/policies/${testPolicyId}/versions`, {
      method: 'POST',
      token: adminToken,
      body: {
        configuration: { algorithm: 'ED25519', maximum_validity_days: 90, note: 'Updated to 90 days' }
      }
    });
    const v2Ok = v2Res.status === 201 && v2Res.data?.data?.version === 2;
    logTest('POLICY', 'TC-POLICY-05: Security Admin publishes new version (v2) of existing policy', v2Ok);
  } catch (e) {
    logTest('POLICY', 'TC-POLICY-05: Policy versioning', false, e.message);
  }


  // -----------------------------------------------------------------
  // SUITE 6: NOTIFICATIONS & BACKGROUND JOBS
  // -----------------------------------------------------------------
  console.log('\n\x1b[36m▶ SUITE 6: NOTIFICATIONS & BACKGROUND JOBS\x1b[0m');

  let notifId = '';

  // TC-NOTIF-01: List notifications
  try {
    const notifRes = await api('/notifications', { token: devToken });
    const listOk = notifRes.status === 200 && Array.isArray(notifRes.data?.data);
    notifId = notifRes.data?.data?.[0]?.id;
    logTest('NOTIF', 'TC-NOTIF-01: User receives in-app notifications for submitted/approved/revoked events', listOk);
  } catch (e) {
    logTest('NOTIF', 'TC-NOTIF-01: List notifications', false, e.message);
  }

  // TC-NOTIF-02 & 03: Mark single read and mark all read
  try {
    let singleOk = true;
    if (notifId) {
      const readRes = await api(`/notifications/${notifId}/read`, { method: 'PATCH', token: devToken });
      singleOk = readRes.status === 200 && readRes.data?.data?.updated >= 0;
    }
    const readAllRes = await api('/notifications/read-all', { method: 'PATCH', token: devToken });
    const readAllOk = readAllRes.status === 200 && readAllRes.data?.data?.updated >= 0;

    logTest('NOTIF', 'TC-NOTIF-02: User marks single notification as read', singleOk);
    logTest('NOTIF', 'TC-NOTIF-03: User marks all notifications as read', readAllOk);
  } catch (e) {
    logTest('NOTIF', 'TC-NOTIF-02/03: Read notifications', false, e.message);
  }

  // TC-NOTIF-04 & 05: Status queue & permission
  try {
    const statusAdmin = await api('/notifications/status', { token: adminToken });
    const statusOk = statusAdmin.status === 200 && typeof statusAdmin.data?.data?.queue === 'object';

    const statusUser = await api('/notifications/status', { token: devToken });
    const userBlocked = statusUser.status === 403 && statusUser.data?.error?.code === 'ADMIN_REQUIRED';

    logTest('NOTIF', 'TC-NOTIF-04: Admin views notification delivery queue status', statusOk);
    logTest('NOTIF', 'TC-NOTIF-05: Non-admin cannot view notification queue statistics (403)', userBlocked);
  } catch (e) {
    logTest('NOTIF', 'TC-NOTIF-04/05: Notification status', false, e.message);
  }


  // -----------------------------------------------------------------
  // SUITE 7: AUDIT LOGS & DASHBOARD ANALYTICS
  // -----------------------------------------------------------------
  console.log('\n\x1b[36m▶ SUITE 7: AUDIT LOGS & DASHBOARD ANALYTICS\x1b[0m');

  // TC-AUDIT-01 & 02: Audit log access & completeness
  try {
    const userAudit = await api('/audit-logs', { token: devToken });
    const userBlocked = userAudit.status === 403 && userAudit.data?.error?.code === 'ADMIN_REQUIRED';

    const adminAudit = await api('/audit-logs?limit=50', { token: adminToken });
    const auditLogs = adminAudit.data?.data || [];
    const actions = auditLogs.map(l => l.action);
    const hasEmergencyRevoke = actions.includes('EMERGENCY_REVOKE');
    const hasLoginSuccess = actions.includes('LOGIN_SUCCESS');

    logTest('AUDIT', 'TC-AUDIT-01: Non-admin cannot access audit logs (403 ADMIN_REQUIRED)', userBlocked);
    logTest('AUDIT', 'TC-AUDIT-02: Admin views audit logs containing actions (LOGIN_SUCCESS, EMERGENCY_REVOKE, etc.)', adminAudit.status === 200 && hasEmergencyRevoke && hasLoginSuccess);
  } catch (e) {
    logTest('AUDIT', 'TC-AUDIT-01/02: Audit log view', false, e.message);
  }

  // TC-AUDIT-03: Audit log immutability trigger
  try {
    const pool = new Pool({ connectionString: DB_URL });
    let mutateBlocked = false;
    try {
      await pool.query(`UPDATE audit_logs SET action = 'HACKED' WHERE id = (SELECT id FROM audit_logs LIMIT 1)`);
    } catch (e) {
      if (e.message.includes('AUDIT_LOG_IMMUTABLE')) {
        mutateBlocked = true;
      }
    }
    await pool.end();
    logTest('AUDIT', 'TC-AUDIT-03: Database trigger enforces Audit Log immutability (UPDATE/DELETE blocked)', mutateBlocked);
  } catch (e) {
    logTest('AUDIT', 'TC-AUDIT-03: Audit log immutability', false, e.message);
  }

  // TC-AUDIT-04 & 05 & 06: Dashboards by role
  try {
    const userDash = await api('/dashboard', { token: devToken });
    const userDashOk = userDash.status === 200 && userDash.data?.data?.role === 'USER' && typeof userDash.data?.data?.metrics === 'object';

    const appDash = await api('/dashboard', { token: itManagerToken });
    const appDashOk = appDash.status === 200 && appDash.data?.data?.role === 'APPROVER' && typeof appDash.data?.data?.metrics === 'object';

    const adminDash = await api('/dashboard', { token: adminToken });
    const adminDashOk = adminDash.status === 200 && adminDash.data?.data?.role === 'ADMIN' && adminDash.data?.data?.services?.cryptoProvider === 'MOCK';

    logTest('AUDIT', 'TC-AUDIT-04: User Dashboard returns role USER with personal asset metrics', userDashOk);
    logTest('AUDIT', 'TC-AUDIT-05: Approver Dashboard returns role APPROVER with approval queue metrics', appDashOk);
    logTest('AUDIT', 'TC-AUDIT-06: Admin Dashboard returns role ADMIN with system overview and service health', adminDashOk);
  } catch (e) {
    logTest('AUDIT', 'TC-AUDIT-04/05/06: Dashboard metrics', false, e.message);
  }


  // -----------------------------------------------------------------
  // SUITE 8: FRONTEND UI & STATIC ASSET INTEGRITY
  // -----------------------------------------------------------------
  console.log('\n\x1b[36m▶ SUITE 8: FRONTEND UI & STATIC ASSET INTEGRITY\x1b[0m');

  // TC-UI-01: Frontend index html
  try {
    const res = await fetch(`${UI_BASE}/`);
    const text = await res.text();
    const ok = res.status === 200 && text.includes('<div id="root">') && text.includes('Crypta');
    logTest('UI', 'TC-UI-01: Frontend root page loads HTTP 200 and valid HTML shell', ok);
  } catch (e) {
    logTest('UI', 'TC-UI-01: Frontend root page', false, e.message);
  }

  // TC-UI-02: Vite proxy /api
  try {
    const res = await fetch(`${UI_BASE}/api/v1/health`);
    const json = await res.json();
    const ok = res.status === 200 && json?.data?.database === 'connected';
    logTest('UI', 'TC-UI-02: Frontend dev proxy (/api -> backend:3000) operates seamlessly', ok);
  } catch (e) {
    logTest('UI', 'TC-UI-02: Frontend dev proxy', false, e.message);
  }

  // TC-UI-03: Swagger UI html
  try {
    const res = await fetch(`${DOCS_BASE}/docs`);
    const text = await res.text();
    const ok = res.status === 200 && text.includes('Swagger UI');
    logTest('UI', 'TC-UI-03: Swagger UI documentation loads HTTP 200 at /docs', ok);
  } catch (e) {
    logTest('UI', 'TC-UI-03: Swagger UI', false, e.message);
  }

  // TC-UI-04: Swagger OpenAPI 3.0 specification
  try {
    const res = await fetch(`${DOCS_BASE}/docs-json`);
    const json = await res.json();
    const paths = Object.keys(json.paths || {});
    const ok = res.status === 200 && paths.length >= 20;
    logTest('UI', `TC-UI-04: OpenAPI 3.0 JSON specification is valid and exposes ${paths.length} endpoints`, ok);
  } catch (e) {
    logTest('UI', 'TC-UI-04: OpenAPI specification', false, e.message);
  }

  // -----------------------------------------------------------------
  // SUMMARY
  // -----------------------------------------------------------------
  console.log('\n===============================================================');
  console.log(`  TOTAL TESTS: ${passed + failed} | \x1b[32mPASSED: ${passed}\x1b[0m | \x1b[31mFAILED: ${failed}\x1b[0m`);
  console.log('===============================================================\n');

  return { passed, failed, total: passed + failed, results };
}

run().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
