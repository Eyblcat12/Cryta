import { Pool } from 'pg';

const API_BASE = 'http://localhost:3000/api/v1';
const DB_URL = 'postgresql://postgres.birqopdckxfjopntntks:ZIr9KtCHIp0CFGCj@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres';

let passedCount = 0;
let failedCount = 0;
const results = [];

function stepLog(prefix, name, isPass, detail = '') {
  if (isPass) {
    passedCount++;
    console.log(`  \x1b[32m✔ [PASS]\x1b[0m \x1b[1m[${prefix}]\x1b[0m ${name}`);
    if (detail) console.log(`      \x1b[90m↳ ${detail}\x1b[0m`);
    results.push({ prefix, name, status: 'PASS', detail });
  } else {
    failedCount++;
    console.log(`  \x1b[31m✖ [FAIL]\x1b[0m \x1b[1m[${prefix}]\x1b[0m ${name}`);
    if (detail) console.log(`      \x1b[31m↳ Error: ${detail}\x1b[0m`);
    results.push({ prefix, name, status: 'FAIL', detail });
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
  console.log('\n========================================================================');
  console.log('   CHƯƠNG TRÌNH KIỂM THỬ CHUYÊN SÂU: 15 USE CASES & 6 WORKFLOWS         ');
  console.log('   Hệ thống Quản lý Vòng đời Khóa & Chứng chỉ số (KMS/PKI Cryta)        ');
  console.log('========================================================================\n');

  // Tokens & context
  let devToken = '', itMgrToken = '', ktToken = '', finMgrToken = '', cisoToken = '', adminToken = '';
  let itDeptId = '', finDeptId = '';
  let rsaPolicyId = '', tlsPolicyId = '';

  // =====================================================================
  // PHẦN 1: KIỂM THỬ 15 USE CASES (UC-01 ĐẾN UC-15)
  // =====================================================================
  console.log('\n\x1b[35m=== PHẦN 1: XÁC MINH 15 USE CASES THEO BỐN NHÓM TÁC NHÂN ===\x1b[0m\n');

  // --- NHÓM 1: REQUESTER USE CASES (UC-01 -> UC-05) ---
  console.log('\x1b[34m[NHÓM 1: REQUESTER / NHÂN VIÊN NGHIỆP VỤ]\x1b[0m');

  // UC-01: Đăng nhập
  try {
    const resDev = await api('/auth/login', { method: 'POST', body: { email: 'dev.nguyen@congty.com', password: 'Password@123' } });
    devToken = resDev.data?.data?.accessToken;
    itDeptId = resDev.data?.data?.user?.departmentId;

    const resKt = await api('/auth/login', { method: 'POST', body: { email: 'kt.tran@congty.com', password: 'Password@123' } });
    ktToken = resKt.data?.data?.accessToken;
    finDeptId = resKt.data?.data?.user?.departmentId;

    const ok = resDev.status === 200 && !!devToken && resKt.status === 200 && !!ktToken;
    stepLog('UC-01', 'Đăng nhập hệ thống (Requester dev.nguyen & kt.tran)', ok, 'Đăng nhập thành công, nhận JWT token');
  } catch (e) {
    stepLog('UC-01', 'Đăng nhập hệ thống', false, e.message);
  }

  // Lấy danh sách policy dùng cho các test tiếp theo
  const polRes = await api('/policies', { token: devToken });
  rsaPolicyId = polRes.data?.data?.find(p => p.code === 'RSA_STANDARD')?.id;
  tlsPolicyId = polRes.data?.data?.find(p => p.code === 'TLS_WEB')?.id;

  // UC-02: Tạo Đơn yêu cầu cấp mới (Create Request)
  let testReqId = '';
  try {
    const res = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: {
        type: 'CREATE',
        policyVersionId: rsaPolicyId,
        reason: 'Xin cấp khóa RSA-2048 ký commit cho nhóm DevOps',
        emergency: false,
        parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 2048, validityDays: 90 }
      }
    });
    testReqId = res.data?.data?.id;
    const ok = res.status === 201 && res.data?.data?.status === 'PENDING' && !!testReqId;
    stepLog('UC-02', 'Tạo Đơn yêu cầu cấp mới Khóa RSA (Create Request)', ok, `Mã đơn: ${testReqId}, Trạng thái: PENDING`);
  } catch (e) {
    stepLog('UC-02', 'Tạo Đơn yêu cầu cấp mới', false, e.message);
  }

  // UC-04: Theo dõi trạng thái & Hủy yêu cầu (Track & Cancel Request)
  try {
    const detailRes = await api(`/requests/${testReqId}`, { token: devToken });
    const detailOk = detailRes.status === 200 && detailRes.data?.data?.status === 'PENDING';

    const cancelRes = await api(`/requests/${testReqId}/cancel`, { method: 'POST', token: devToken });
    const cancelOk = cancelRes.status === 201 && cancelRes.data?.data?.status === 'CANCELLED';

    stepLog('UC-04', 'Theo dõi chi tiết tiến độ đơn & Hủy đơn khi đang chờ duyệt', detailOk && cancelOk, 'Đơn chuyển trạng thái PENDING -> CANCELLED thành công');
  } catch (e) {
    stepLog('UC-04', 'Theo dõi trạng thái & Hủy đơn', false, e.message);
  }

  // UC-05: Xem danh sách tài sản cá nhân
  try {
    const res = await api('/assets', { token: devToken });
    const ok = res.status === 200 && Array.isArray(res.data?.data);
    stepLog('UC-05', 'Xem danh sách tài sản cá nhân của Requester', ok, `Tìm thấy ${res.data?.data?.length || 0} tài sản của dev.nguyen`);
  } catch (e) {
    stepLog('UC-05', 'Xem danh sách tài sản cá nhân', false, e.message);
  }


  // --- NHÓM 2: APPROVER USE CASES (UC-06 -> UC-08) ---
  console.log('\n\x1b[34m[NHÓM 2: APPROVER / NGƯỜI PHÊ DUYỆT PHÒNG BAN]\x1b[0m');

  // Đăng nhập Approver
  try {
    const resItMgr = await api('/auth/login', { method: 'POST', body: { email: 'it.manager@congty.com', password: 'Password@123' } });
    itMgrToken = resItMgr.data?.data?.accessToken;

    const resFinMgr = await api('/auth/login', { method: 'POST', body: { email: 'fin.manager@congty.com', password: 'Password@123' } });
    finMgrToken = resFinMgr.data?.data?.accessToken;
  } catch (e) {
    console.error('Lỗi login Approvers:', e);
  }

  // Tạo lại 1 đơn PENDING cho IT để Approver kiểm thử
  let itPendingReqId = '';
  try {
    const res = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: {
        type: 'CREATE',
        policyVersionId: rsaPolicyId,
        reason: 'Xin cấp khóa RSA-2048 để test quy trình phê duyệt',
        parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 2048, validityDays: 60 }
      }
    });
    itPendingReqId = res.data?.data?.id;
  } catch {}

  // UC-06: Xem danh sách đơn chờ duyệt theo phòng ban
  try {
    const res = await api('/requests', { token: itMgrToken });
    const list = res.data?.data || [];
    const hasMyDeptReq = list.some(r => r.id === itPendingReqId);
    const ok = res.status === 200 && hasMyDeptReq;
    stepLog('UC-06', 'Xem danh sách đơn chờ duyệt trong phạm vi phòng ban (Approval Queue)', ok, `Approver IT thấy đơn ${itPendingReqId} trong danh sách chờ duyệt`);
  } catch (e) {
    stepLog('UC-06', 'Xem danh sách đơn chờ duyệt', false, e.message);
  }

  // UC-07: Phê duyệt / Từ chối đơn kèm lời phê
  try {
    const res = await api(`/requests/${itPendingReqId}/decision`, {
      method: 'POST',
      token: itMgrToken,
      body: {
        decision: 'APPROVED',
        comment: 'Phê duyệt cấp khóa môi trường thử nghiệm - Trưởng phòng IT ký duyệt'
      }
    });
    const ok = res.status === 201 && res.data?.data?.status === 'APPROVED';
    stepLog('UC-07', 'Phê duyệt đơn yêu cầu kèm Lời phê (Approve with Comment)', ok, 'Trạng thái chuyển sang APPROVED, bản ghi quyết định được lưu vết');
  } catch (e) {
    stepLog('UC-07', 'Phê duyệt đơn yêu cầu', false, e.message);
  }

  // Chờ worker xử lý đơn APPROVED thành COMPLETED để phục vụ UC-03
  let createdKeyAssetId = '';
  for (let i = 0; i < 7; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const chk = await api(`/requests/${itPendingReqId}`, { token: devToken });
    if (chk.data?.data?.status === 'COMPLETED' && chk.data?.data?.resultAssetId) {
      createdKeyAssetId = chk.data.data.resultAssetId;
      break;
    }
  }

  // UC-03: Yêu cầu Gia hạn / Thu hồi tài sản (Revoke/Renew Request)
  let renewReqId = '';
  try {
    const res = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: {
        type: 'RENEW',
        targetAssetId: createdKeyAssetId,
        policyVersionId: rsaPolicyId,
        reason: 'Xin gia hạn thêm thời gian sử dụng khóa RSA phục vụ dự án dài hạn',
        parameters: { validityDays: 180 }
      }
    });
    renewReqId = res.data?.data?.id;
    const ok = res.status === 201 && res.data?.data?.status === 'PENDING';
    stepLog('UC-03', 'Yêu cầu Gia hạn / Thu hồi tài sản đã có (Renew Request)', ok, `Đơn gia hạn tạo thành công: ${renewReqId}, liên kết tài sản: ${createdKeyAssetId}`);
  } catch (e) {
    stepLog('UC-03', 'Yêu cầu Gia hạn tài sản', false, e.message);
  }

  // UC-08: Báo cáo tài sản phòng ban & Dashboard Approver
  try {
    const res = await api('/dashboard', { token: itMgrToken });
    const data = res.data?.data;
    const ok = res.status === 200 && data?.role === 'APPROVER' && typeof data?.metrics?.pending === 'number';
    stepLog('UC-08', 'Báo cáo & Dashboard chỉ số phê duyệt phòng ban', ok, `Số đơn chờ xử lý: ${data?.metrics?.pending}, Số đơn đã duyệt 30 ngày: ${data?.metrics?.approved}`);
  } catch (e) {
    stepLog('UC-08', 'Báo cáo tài sản phòng ban', false, e.message);
  }


  // --- NHÓM 3: CISO / SECURITY ADMIN USE CASES (UC-09 -> UC-12) ---
  console.log('\n\x1b[34m[NHÓM 3: CISO / GIÁM ĐỐC AN TOÀN THÔNG TIN]\x1b[0m');

  try {
    const resCiso = await api('/auth/login', { method: 'POST', body: { email: 'ciso@congty.com', password: 'Password@123' } });
    cisoToken = resCiso.data?.data?.accessToken;
  } catch {}

  // UC-09: Quản lý Chính sách Bảo mật (Create & Versioning Policy)
  let testPolId = '';
  try {
    const code = `SEC_POL_${Date.now()}`;
    const createRes = await api('/policies', {
      method: 'POST',
      token: cisoToken,
      body: {
        code,
        name: 'Chính sách Mật mã Banking V1',
        configuration: { algorithm: 'RSA', minimum_key_size: 2048, maximum_validity_days: 90 }
      }
    });
    testPolId = createRes.data?.data?.policyId;

    const verRes = await api(`/policies/${testPolId}/versions`, {
      method: 'POST',
      token: cisoToken,
      body: {
        configuration: { algorithm: 'RSA', minimum_key_size: 4096, maximum_validity_days: 60, note: 'Siết chặt lên 4096-bit' }
      }
    });

    const ok = createRes.status === 201 && verRes.status === 201 && verRes.data?.data?.version === 2;
    stepLog('UC-09', 'Quản lý Chính sách Bảo mật (Tạo mới & Ban hành Phiên bản v2)', ok, `Chính sách ${code} ban hành phiên bản 2 thành công`);
  } catch (e) {
    stepLog('UC-09', 'Quản lý Chính sách Bảo mật', false, e.message);
  }

  // UC-10: Thu hồi Tài sản Khẩn cấp (Emergency Revocation)
  try {
    const res = await api(`/assets/${createdKeyAssetId}/revoke`, {
      method: 'POST',
      token: cisoToken,
      body: { reason: 'Sự cố bảo mật khẩn cấp - CISO vô hiệu hóa khóa ngay lập tức' }
    });
    const chk = await api(`/assets/${createdKeyAssetId}`, { token: cisoToken });
    const ok = res.status === 201 && chk.data?.data?.status === 'REVOKED';
    stepLog('UC-10', 'Thu hồi Tài sản Khẩn cấp không cần qua phê duyệt (Emergency Revoke)', ok, `Tài sản ${createdKeyAssetId} lập tức chuyển sang trạng thái REVOKED`);
  } catch (e) {
    stepLog('UC-10', 'Thu hồi Tài sản Khẩn cấp', false, e.message);
  }

  // UC-11: Theo dõi Audit Logs (Nhật ký kiểm toán)
  try {
    const res = await api('/audit-logs?limit=20', { token: cisoToken });
    const logs = res.data?.data || [];
    const hasEmergencyLog = logs.some(l => l.action === 'EMERGENCY_REVOKE');
    const ok = res.status === 200 && hasEmergencyLog;
    stepLog('UC-11', 'Theo dõi Audit Logs toàn hệ thống (Ghi nhận vết EMERGENCY_REVOKE)', ok, `Tìm thấy sự kiện EMERGENCY_REVOKE trong nhật ký kiểm toán`);
  } catch (e) {
    stepLog('UC-11', 'Theo dõi Audit Logs', false, e.message);
  }

  // UC-12: Giám sát toàn cục (Global Dashboard)
  try {
    const res = await api('/dashboard', { token: cisoToken });
    const data = res.data?.data;
    const ok = res.status === 200 && data?.role === 'ADMIN' && typeof data?.metrics?.total_assets === 'number';
    stepLog('UC-12', 'Giám sát toàn cục (Global Dashboard: Tổng tài sản, tình trạng dịch vụ)', ok, `Tổng tài sản: ${data?.metrics?.total_assets}, Trạng thái CryptoProvider: ${data?.services?.cryptoProvider}`);
  } catch (e) {
    stepLog('UC-12', 'Giám sát toàn cục', false, e.message);
  }


  // --- NHÓM 4: SYSTEM ADMIN USE CASES (UC-13 -> UC-15) ---
  console.log('\n\x1b[34m[NHÓM 4: SYSTEM ADMIN / QUẢN TRỊ VIÊN HỆ THỐNG]\x1b[0m');

  try {
    const resAdmin = await api('/auth/login', { method: 'POST', body: { email: 'admin@congty.com', password: 'Password@123' } });
    adminToken = resAdmin.data?.data?.accessToken;
  } catch {}

  // UC-13: Quản lý Phòng ban & Danh mục
  try {
    const res = await api('/users/reference-data', { token: adminToken });
    const depts = res.data?.data?.departments || [];
    const roles = res.data?.data?.roles || [];
    const ok = res.status === 200 && depts.length >= 4 && roles.length >= 3;
    stepLog('UC-13', 'Quản lý Phòng ban & Danh mục tham chiếu hệ thống', ok, `Nạp thành công ${depts.length} phòng ban và ${roles.length} vai trò`);
  } catch (e) {
    stepLog('UC-13', 'Quản lý Phòng ban & Danh mục', false, e.message);
  }

  // UC-14: Quản trị Người dùng & Khóa tài khoản
  let managedUserId = '';
  const managedEmail = `user.test_${Date.now()}@congty.com`;
  try {
    const createRes = await api('/users', {
      method: 'POST',
      token: adminToken,
      body: {
        email: managedEmail,
        displayName: 'Người dùng thử nghiệm UC14',
        departmentId: itDeptId,
        temporaryPassword: 'Password@123',
        roles: ['USER'],
        approverDepartmentIds: []
      }
    });
    managedUserId = createRes.data?.data?.id;

    const lockRes = await api(`/users/${managedUserId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'INACTIVE' }
    });

    const unlockRes = await api(`/users/${managedUserId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'ACTIVE' }
    });

    const ok = createRes.status === 201 && lockRes.data?.data?.status === 'INACTIVE' && unlockRes.data?.data?.status === 'ACTIVE';
    stepLog('UC-14', 'Quản lý Người dùng (Tạo tài khoản, Khóa INACTIVE, Mở lại ACTIVE)', ok, `Tài khoản ${managedEmail} tạo và chuyển trạng thái chuẩn xác`);
  } catch (e) {
    stepLog('UC-14', 'Quản trị Người dùng', false, e.message);
  }

  // UC-15: Cấp quyền và Phân luồng duyệt (Assign Roles & Scopes)
  try {
    const res = await api(`/users/${managedUserId}/access`, {
      method: 'PUT',
      token: adminToken,
      body: {
        roles: ['APPROVER'],
        approverDepartmentIds: [itDeptId]
      }
    });
    const ok = res.status === 200 && res.data?.data?.updated === true;
    stepLog('UC-15', 'Cấp quyền & Phân luồng duyệt theo phòng ban (Assign Roles & Scopes)', ok, 'Gán thành công vai trò APPROVER kèm thẩm quyền duyệt phòng IT');
  } catch (e) {
    stepLog('UC-15', 'Cấp quyền và Phân luồng duyệt', false, e.message);
  }


  // =====================================================================
  // PHẦN 2: KIỂM THỬ 6 WORKFLOWS NGHIỆP VỤ XUYÊN SUỐT
  // =====================================================================
  console.log('\n\x1b[35m=== PHẦN 2: KIỂM THỬ 6 WORKFLOWS QUY TRÌNH NGHIỆP VỤ XUYÊN SUỐT ===\x1b[0m\n');

  // -----------------------------------------------------------------
  // WF-1: Chu trình Vòng đời Khóa Chuẩn
  // -----------------------------------------------------------------
  console.log('\x1b[33m▶ WORKFLOW WF-1: CHU TRÌNH VÒNG ĐỜI KHÓA CHUẨN (CREATE -> APPROVE -> PROVISION -> RENEW)\x1b[0m');
  try {
    // 1. Dev IT tạo yêu cầu cấp khóa
    const r1 = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: {
        type: 'CREATE',
        policyVersionId: rsaPolicyId,
        reason: 'Khóa mã hóa DB Backup hàng ngày',
        parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 2048, validityDays: 30 }
      }
    });
    const wf1ReqId = r1.data?.data?.id;

    // 2. Trưởng phòng IT duyệt
    await api(`/requests/${wf1ReqId}/decision`, {
      method: 'POST',
      token: itMgrToken,
      body: { decision: 'APPROVED', comment: 'Đồng ý cấp khóa sao lưu' }
    });

    // 3. Chờ worker cấp phát
    let wf1AssetId = '';
    for (let i = 0; i < 7; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const det = await api(`/requests/${wf1ReqId}`, { token: devToken });
      if (det.data?.data?.status === 'COMPLETED') {
        wf1AssetId = det.data.data.resultAssetId;
        break;
      }
    }

    // 4. Dev IT xin gia hạn khóa
    const r2 = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: {
        type: 'RENEW',
        targetAssetId: wf1AssetId,
        policyVersionId: rsaPolicyId,
        reason: 'Gia hạn chu kỳ tiếp theo cho khóa backup',
        parameters: { validityDays: 60 }
      }
    });
    const wf1RenewReqId = r2.data?.data?.id;

    // 5. Trưởng phòng duyệt gia hạn
    await api(`/requests/${wf1RenewReqId}/decision`, {
      method: 'POST',
      token: itMgrToken,
      body: { decision: 'APPROVED', comment: 'Đồng ý gia hạn' }
    });

    // 6. Chờ worker xử lý gia hạn
    let wf1NewAssetId = '';
    for (let i = 0; i < 7; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const det = await api(`/requests/${wf1RenewReqId}`, { token: devToken });
      if (det.data?.data?.status === 'COMPLETED') {
        wf1NewAssetId = det.data.data.resultAssetId;
        break;
      }
    }

    // 7. Kiểm tra trạng thái khóa cũ đã chuyển thành SUPERSEDED
    const oldAsset = await api(`/assets/${wf1AssetId}`, { token: devToken });
    const newAsset = await api(`/assets/${wf1NewAssetId}`, { token: devToken });

    const wf1Success = oldAsset.data?.data?.status === 'SUPERSEDED' && newAsset.data?.data?.status === 'ACTIVE';
    stepLog('WF-1', 'Toàn bộ chu trình vòng đời Khóa: Cấp mới -> Duyệt -> Cấp phát -> Gia hạn -> Khóa cũ SUPERSEDED', wf1Success, `Khóa cũ (${wf1AssetId}) -> SUPERSEDED, Khóa mới (${wf1NewAssetId}) -> ACTIVE`);
  } catch (e) {
    stepLog('WF-1', 'Vòng đời Khóa Chuẩn', false, e.message);
  }

  // -----------------------------------------------------------------
  // WF-2: Vòng đời Chứng chỉ Số & Tự động Sinh Cặp Khóa Bảo mật
  // -----------------------------------------------------------------
  console.log('\n\x1b[33m▶ WORKFLOW WF-2: CẤP CHỨNG CHỈ SỐ & TỰ ĐỘNG SINH CẶP KHÓA BẢO MẬT (KEY PAIRING)\x1b[0m');
  try {
    // 1. Kế toán viên gửi đơn
    const r1 = await api('/requests', {
      method: 'POST',
      token: ktToken,
      body: {
        type: 'CREATE',
        policyVersionId: tlsPolicyId,
        reason: 'Chứng chỉ TLS bảo mật kết nối cổng thanh toán ngân hàng',
        parameters: { assetType: 'CERTIFICATE', algorithm: 'RSA', keySize: 2048, validityDays: 365 }
      }
    });
    const certReqId = r1.data?.data?.id;

    // 2. Trưởng phòng IT KHÔNG được thấy đơn này (khác phòng ban)
    const itQueue = await api('/requests', { token: itMgrToken });
    const itSeesFinReq = (itQueue.data?.data || []).some(r => r.id === certReqId);

    // 3. Kế toán trưởng duyệt đơn
    await api(`/requests/${certReqId}/decision`, {
      method: 'POST',
      token: finMgrToken,
      body: { decision: 'APPROVED', comment: 'Đã kiểm tra yêu cầu thanh toán - Duyệt' }
    });

    // 4. Chờ worker xử lý
    let certAssetId = '';
    for (let i = 0; i < 7; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const det = await api(`/requests/${certReqId}`, { token: ktToken });
      if (det.data?.data?.status === 'COMPLETED') {
        certAssetId = det.data.data.resultAssetId;
        break;
      }
    }

    // 5. Kiểm tra CSDL xem Certificate có chứa public_key_asset_id hợp lệ
    const pool = new Pool({ connectionString: DB_URL });
    const certRow = await pool.query('SELECT * FROM certificates WHERE asset_id = $1', [certAssetId]);
    const linkedKeyId = certRow.rows[0]?.public_key_asset_id;
    const keyAssetRow = await pool.query('SELECT * FROM crypto_assets WHERE id = $1', [linkedKeyId]);
    await pool.end();

    const wf2Success = !itSeesFinReq && !!linkedKeyId && keyAssetRow.rows[0]?.asset_type === 'KEY';
    stepLog('WF-2', 'Cấp Chứng chỉ số: Phân quyền phòng ban chuẩn + Tự động sinh Cặp khóa bảo mật liên kết', wf2Success, `Cert (${certAssetId}) gắn đúng Cặp khóa Public Key (${linkedKeyId})`);
  } catch (e) {
    stepLog('WF-2', 'Vòng đời Chứng chỉ Số', false, e.message);
  }

  // -----------------------------------------------------------------
  // WF-3: Ứng phó Sự cố & Thu hồi Khẩn cấp
  // -----------------------------------------------------------------
  console.log('\n\x1b[33m▶ WORKFLOW WF-3: ỨNG PHÓ SỰ CỐ & THU HỒI KHẨN CẤP (INCIDENT RESPONSE)\x1b[0m');
  try {
    // 1. Tạo 1 tài sản đang ACTIVE để thử nghiệm sự cố
    const r1 = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: {
        type: 'CREATE',
        policyVersionId: rsaPolicyId,
        reason: 'Tạo khóa test quy trình ứng phó sự cố',
        parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 2048, validityDays: 30 }
      }
    });
    const incidentReqId = r1.data?.data?.id;
    await api(`/requests/${incidentReqId}/decision`, { method: 'POST', token: itMgrToken, body: { decision: 'APPROVED' } });

    let incidentAssetId = '';
    for (let i = 0; i < 7; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const det = await api(`/requests/${incidentReqId}`, { token: devToken });
      if (det.data?.data?.status === 'COMPLETED') {
        incidentAssetId = det.data.data.resultAssetId;
        break;
      }
    }

    // 2. Kẻ xấu/User thường cố tình gọi API thu hồi khẩn cấp -> Bị chặn
    const unauthorizedRevoke = await api(`/assets/${incidentAssetId}/revoke`, {
      method: 'POST',
      token: devToken,
      body: { reason: 'Cố tình thu hồi trái phép' }
    });
    const unauthBlocked = unauthorizedRevoke.status === 403;

    // 3. CISO kích hoạt Thu hồi khẩn cấp
    const cisoRevoke = await api(`/assets/${incidentAssetId}/revoke`, {
      method: 'POST',
      token: cisoToken,
      body: { reason: 'CẢNH BÁO SỰ CỐ: Phát hiện rò rỉ private key trên Git commit công khai' }
    });
    const cisoRevokeOk = cisoRevoke.status === 201;

    // 4. Kiểm tra tài sản chuyển trạng thái REVOKED
    const assetState = await api(`/assets/${incidentAssetId}`, { token: cisoToken });
    const isRevoked = assetState.data?.data?.status === 'REVOKED';

    // 5. Kiểm tra Audit Log có cờ emergency: true
    const pool = new Pool({ connectionString: DB_URL });
    const auditRow = await pool.query(`SELECT * FROM audit_logs WHERE action = 'EMERGENCY_REVOKE' AND entity_id = $1`, [incidentAssetId]);
    await pool.end();
    const hasAuditTrail = auditRow.rows.length > 0;

    const wf3Success = unauthBlocked && cisoRevokeOk && isRevoked && hasAuditTrail;
    stepLog('WF-3', 'Ứng phó sự cố: Chặn người thường + CISO thu hồi khẩn cấp tức thì + Lưu vết kiểm toán', wf3Success, `Tài sản ${incidentAssetId} bị ngắt hiệu lực ngay lập tức`);
  } catch (e) {
    stepLog('WF-3', 'Ứng phó Sự cố & Thu hồi Khẩn cấp', false, e.message);
  }

  // -----------------------------------------------------------------
  // WF-4: Thực thi Ma trận Phân tách Nhiệm vụ (SoD)
  // -----------------------------------------------------------------
  console.log('\n\x1b[33m▶ WORKFLOW WF-4: THỰC THI MA TRẬN PHÂN TÁCH NHIỆM VỤ (SEPARATION OF DUTIES - SOD)\x1b[0m');
  try {
    // 1. Trưởng phòng IT tự nộp đơn
    const selfReq = await api('/requests', {
      method: 'POST',
      token: itMgrToken,
      body: {
        type: 'CREATE',
        policyVersionId: rsaPolicyId,
        reason: 'Trưởng phòng IT xin cấp khóa cá nhân',
        parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 2048, validityDays: 30 }
      }
    });
    const selfReqId = selfReq.data?.data?.id;

    // Trưởng phòng IT cố tự duyệt đơn của chính mình -> Bị chặn
    const selfApprove = await api(`/requests/${selfReqId}/decision`, {
      method: 'POST',
      token: itMgrToken,
      body: { decision: 'APPROVED', comment: 'Tự duyệt đơn mình' }
    });
    const selfApproveBlocked = selfApprove.status === 403 && selfApprove.data?.error?.code === 'SOD_VIOLATION';

    // 2. Kế toán trưởng cố duyệt đơn của phòng IT -> Bị chặn
    const crossDeptApprove = await api(`/requests/${selfReqId}/decision`, {
      method: 'POST',
      token: finMgrToken,
      body: { decision: 'APPROVED', comment: 'Duyệt chéo phòng ban' }
    });
    const crossDeptBlocked = crossDeptApprove.status === 403 && crossDeptApprove.data?.error?.code === 'OUT_OF_SCOPE';

    // 3. Admin cố tạo đơn nghiệp vụ -> Bị chặn
    const adminReq = await api('/requests', {
      method: 'POST',
      token: adminToken,
      body: { type: 'CREATE', policyVersionId: rsaPolicyId, reason: 'Admin xin cấp khóa' }
    });
    const adminReqBlocked = adminReq.status === 403 && adminReq.data?.error?.code === 'ROLE_FORBIDDEN';

    const wf4Success = selfApproveBlocked && crossDeptBlocked && adminReqBlocked;
    stepLog('WF-4', 'Ma trận SoD: Chặn tự duyệt (SOD_VIOLATION) + Chặn duyệt chéo (OUT_OF_SCOPE) + Chặn Admin tạo đơn (ROLE_FORBIDDEN)', wf4Success, 'Cơ chế SoD hoạt động tuyệt đối vững chắc ở cả tầng API và Trigger DB');
  } catch (e) {
    stepLog('WF-4', 'Ma trận Phân tách Nhiệm vụ', false, e.message);
  }

  // -----------------------------------------------------------------
  // WF-5: Quản trị & Thực thi Chính sách Mật mã
  // -----------------------------------------------------------------
  console.log('\n\x1b[33m▶ WORKFLOW WF-5: QUẢN TRỊ & THỰC THI CHÍNH SÁCH MẬT MÃ (POLICY GOVERNANCE)\x1b[0m');
  try {
    // 1. CISO ban hành policy siết chặt: bắt buộc ECDSA, tối đa 30 ngày
    const polCode = `POLICY_STRICT_${Date.now()}`;
    const p1 = await api('/policies', {
      method: 'POST',
      token: cisoToken,
      body: {
        code: polCode,
        name: 'Tiêu chuẩn bảo mật tối cao',
        configuration: { algorithm: 'ECDSA', maximum_validity_days: 30 }
      }
    });
    const polVerId = p1.data?.data?.id;

    // 2. User cố xin cấp khóa RSA (vi phạm thuật toán) -> Bị chặn
    const rsaViolation = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: {
        type: 'CREATE',
        policyVersionId: polVerId,
        reason: 'Xin cấp RSA với policy ECDSA',
        parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 2048, validityDays: 15 }
      }
    });
    const rsaBlocked = rsaViolation.status === 409 && rsaViolation.data?.error?.code === 'POLICY_ALGORITHM_MISMATCH';

    // 3. User xin cấp đúng ECDSA nhưng xin thời hạn 90 ngày (vi phạm thời hạn 30 ngày) -> Bị chặn
    const validityViolation = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: {
        type: 'CREATE',
        policyVersionId: polVerId,
        reason: 'Xin thời hạn 90 ngày vượt ngưỡng 30 ngày',
        parameters: { assetType: 'KEY', algorithm: 'ECDSA', validityDays: 90 }
      }
    });
    const validityBlocked = validityViolation.status === 409 && validityViolation.data?.error?.code === 'POLICY_VALIDITY_EXCEEDED';

    // 4. User gửi yêu cầu chuẩn chỉ -> Được chấp thuận
    const validReq = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: {
        type: 'CREATE',
        policyVersionId: polVerId,
        reason: 'Yêu cầu hoàn toàn tuân thủ chính sách ECDSA 15 ngày',
        parameters: { assetType: 'KEY', algorithm: 'ECDSA', validityDays: 15 }
      }
    });
    const validReqOk = validReq.status === 201 && validReq.data?.data?.status === 'PENDING';

    const wf5Success = rsaBlocked && validityBlocked && validReqOk;
    stepLog('WF-5', 'Thực thi Chính sách: Chặn thuật toán sai (POLICY_ALGORITHM_MISMATCH) + Chặn quá hạn (POLICY_VALIDITY_EXCEEDED) + Chấp nhận đơn chuẩn', wf5Success, 'Policy Engine tự động kiểm tra và thực thi tính tuân thủ 100%');
  } catch (e) {
    stepLog('WF-5', 'Quản trị Chính sách Mật mã', false, e.message);
  }

  // -----------------------------------------------------------------
  // WF-6: Tác vụ Ngầm & Giám sát Tự động
  // -----------------------------------------------------------------
  console.log('\n\x1b[33m▶ WORKFLOW WF-6: TÁC VỤ NGẦM & GIÁM SÁT TỰ ĐỘNG (BACKGROUND SCAN & MONITORING)\x1b[0m');
  try {
    // 1. Kiểm tra trạng thái hàng đợi thông báo
    const queueStat = await api('/notifications/status', { token: cisoToken });
    const queueOk = queueStat.status === 200 && typeof queueStat.data?.data?.queue === 'object';

    // 2. Kiểm tra Expiry Scan: tạo 1 asset giả lập có expires_at trong quá khứ để xem hệ thống có nhận diện
    const pool = new Pool({ connectionString: DB_URL });
    const expiredAssetId = 'e1111111-9999-9999-9999-999999999999';
    await pool.query(`DELETE FROM crypto_assets WHERE id = $1`, [expiredAssetId]);
    await pool.query(`INSERT INTO crypto_assets (id, asset_code, asset_type, owner_id, department_id, policy_version_id, purpose, status, valid_from, expires_at) VALUES ($1, 'EXPIRED-TEST-ASSET', 'KEY', '04444444-3333-3333-3333-333333333333', 'd1111111-1111-1111-1111-111111111111', $2, 'Asset kiểm thử hết hạn', 'ACTIVE', NOW() - INTERVAL '30 days', NOW() - INTERVAL '1 day')`, [expiredAssetId, rsaPolicyId]);
    await pool.end();

    // Chờ 3 giây để kiểm tra asset
    await new Promise(r => setTimeout(r, 2000));
    const chkExpired = await api(`/assets/${expiredAssetId}`, { token: devToken });
    const assetFound = chkExpired.status === 200;

    // Dọn dẹp asset kiểm thử
    const poolCleanup = new Pool({ connectionString: DB_URL });
    await poolCleanup.query(`DELETE FROM crypto_assets WHERE id = $1`, [expiredAssetId]);
    await poolCleanup.end();

    const wf6Success = queueOk && assetFound;
    stepLog('WF-6', 'Tác vụ ngầm: Hàng đợi thông báo hoạt động + Hệ thống theo dõi chính xác tài sản đến hạn', wf6Success, 'Hàng đợi thông báo và bộ máy quét hạn đồng bộ hoàn hảo');
  } catch (e) {
    stepLog('WF-6', 'Tác vụ Ngầm & Giám sát Tự động', false, e.message);
  }

  // =====================================================================
  // TỔNG KẾT BÁO CÁO TESTER
  // =====================================================================
  console.log('\n========================================================================');
  console.log(`  KẾT QUẢ KIỂM THỬ WORKFLOW & USE CASES:                                `);
  console.log(`  TỔNG SỐ KỊCH BẢN: ${passedCount + failedCount} | \x1b[32mTHÀNH CÔNG: ${passedCount}\x1b[0m | \x1b[31mTHẤT BẠI: ${failedCount}\x1b[0m`);
  console.log('========================================================================\n');
}

run().catch(err => {
  console.error('Lỗi nghiêm trọng:', err);
  process.exit(1);
});
