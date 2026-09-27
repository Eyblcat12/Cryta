// backend/test_notification_bell.mjs
// Automated Test Suite for Notification Bell & Lifecycle Notifications

const API_BASE = 'http://localhost:3000/api/v1';

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

async function login(email, password = 'Password@123') {
  const res = await api('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.data)}`);
  }
  return res.data?.data?.accessToken;
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runNotificationBellTests() {
  console.log('===============================================================');
  console.log('🧪 RUNNING NOTIFICATION BELL & POPUP VERIFICATION SUITE');
  console.log('===============================================================\n');

  try {
    // 1. Authenticate actors
    console.log('--- Step 1: Đăng nhập các tác nhân kiểm thử ---');
    const devToken = await login('dev.nguyen@congty.com');
    const managerToken = await login('it.manager@congty.com');
    const adminToken = await login('admin@congty.com');
    assert(!!devToken && !!managerToken && !!adminToken, 'Đăng nhập thành công cho User, Approver, Admin');

    // Get policy id
    const polRes = await api('/policies', { token: devToken });
    const rsaPolicyId = polRes.data?.data?.find((p) => p.code === 'RSA_STANDARD')?.id;
    assert(!!rsaPolicyId, 'Lấy Policy Version RSA_STANDARD thành công');

    // 2. Mark existing read to establish clean baseline
    console.log('\n--- Step 2: Dọn sạch trạng thái unread để thiết lập baseline ---');
    await api('/notifications/read-all', { method: 'PATCH', token: managerToken });
    await api('/notifications/read-all', { method: 'PATCH', token: devToken });

    // Check Approver initial unread count
    let res = await api('/notifications', { token: managerToken });
    let managerNotifications = res.data?.data ?? [];
    let managerUnreadCount = managerNotifications.filter((n) => !n.readAt).length;
    assert(managerUnreadCount === 0, 'Approver ban đầu có 0 thông báo chưa đọc');

    // Check User initial unread count
    res = await api('/notifications', { token: devToken });
    let devNotifications = res.data?.data ?? [];
    let devUnreadCount = devNotifications.filter((n) => !n.readAt).length;
    assert(devUnreadCount === 0, 'User ban đầu có 0 thông báo chưa đọc');

    // 3. User submits a request -> Approver should receive REQUEST_SUBMITTED notification
    console.log('\n--- Step 3: User tạo yêu cầu cấp khóa -> Kiểm tra chuông của Approver ---');
    const requestPayload = {
      type: 'CREATE',
      policyVersionId: rsaPolicyId,
      reason: 'Kiểm thử quả chuông thông báo ' + Date.now(),
      emergency: false,
      parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 2048, validityDays: 90 },
    };
    res = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: requestPayload,
    });
    const createdReq = res.data?.data;
    const newRequestId = createdReq?.id;
    assert(res.status === 201 && !!newRequestId, `User tạo yêu cầu thành công (RequestId: ${newRequestId})`);

    // Fetch Approver notifications -> verify REQUEST_SUBMITTED received
    res = await api('/notifications', { token: managerToken });
    managerNotifications = res.data?.data ?? [];
    const submittedNotify = managerNotifications.find((n) => n.requestId === newRequestId && n.type === 'REQUEST_SUBMITTED');
    assert(submittedNotify !== undefined, 'Approver nhận được thông báo REQUEST_SUBMITTED');
    assert(!submittedNotify?.readAt, 'Thông báo của Approver ở trạng thái CHƯA ĐỌC (Kích hoạt chấm đỏ chuông Header)');

    managerUnreadCount = managerNotifications.filter((n) => !n.readAt).length;
    assert(managerUnreadCount >= 1, `Approver có ${managerUnreadCount} thông báo chưa đọc (Chấm đỏ chuông đang bật)`);

    // 4. Approver approves request -> User should receive REQUEST_APPROVED notification
    console.log('\n--- Step 4: Approver phê duyệt yêu cầu -> Kiểm tra chuông của User ---');
    res = await api(`/requests/${newRequestId}/decision`, {
      method: 'POST',
      token: managerToken,
      body: { decision: 'APPROVED', comment: 'Phê duyệt để kiểm tra chuông thông báo' },
    });
    assert(res.status === 201 && res.data?.data?.status === 'APPROVED', 'Approver duyệt yêu cầu thành công (Status: APPROVED)');

    // Fetch User notifications -> verify REQUEST_APPROVED received
    res = await api('/notifications', { token: devToken });
    devNotifications = res.data?.data ?? [];
    const approvedNotify = devNotifications.find((n) => n.requestId === newRequestId && n.type === 'REQUEST_APPROVED');
    assert(approvedNotify !== undefined, 'User nhận được thông báo REQUEST_APPROVED sau khi được duyệt');
    assert(!approvedNotify?.readAt, 'Thông báo REQUEST_APPROVED chưa đọc (Kích hoạt chấm đỏ chuông User)');

    // 5. Test "Mark all read" from Notification Popover for User
    console.log('\n--- Step 5: Thao tác "Đánh dấu tất cả là đã đọc" của User trên Popover ---');
    res = await api('/notifications/read-all', { method: 'PATCH', token: devToken });
    const updatedCount = res.data?.data?.updated ?? 0;
    assert(res.status === 200 && updatedCount >= 1, `Đã đánh dấu đã đọc thành công ${updatedCount} thông báo`);

    // Re-check User unread count
    res = await api('/notifications', { token: devToken });
    devUnreadCount = (res.data?.data ?? []).filter((n) => !n.readAt).length;
    assert(devUnreadCount === 0, 'Số lượng thông báo chưa đọc của User về 0 (Chấm đỏ tắt, nút "Đánh dấu đã đọc" disable)');

    // 6. Test "Mark all read" for Approver
    console.log('\n--- Step 6: Thao tác "Đánh dấu tất cả là đã đọc" của Approver trên Popover ---');
    res = await api('/notifications/read-all', { method: 'PATCH', token: managerToken });
    assert(res.status === 200, 'Approver đánh dấu tất cả đã đọc thành công');

    res = await api('/notifications', { token: managerToken });
    managerUnreadCount = (res.data?.data ?? []).filter((n) => !n.readAt).length;
    assert(managerUnreadCount === 0, 'Số lượng thông báo chưa đọc của Approver về 0 (Chấm đỏ Approver tắt)');

    // 7. Test Rejection flow -> User receives REQUEST_REJECTED
    console.log('\n--- Step 7: Test luồng Từ chối (Reject) -> User nhận REQUEST_REJECTED ---');
    res = await api('/requests', {
      method: 'POST',
      token: devToken,
      body: {
        type: 'CREATE',
        policyVersionId: rsaPolicyId,
        reason: 'Yêu cầu kiểm tra từ chối thông báo ' + Date.now(),
        parameters: { assetType: 'KEY', algorithm: 'RSA', keySize: 2048, validityDays: 30 },
      },
    });
    const rejectReqId = res.data?.data?.id;
    assert(res.status === 201 && !!rejectReqId, `Tạo yêu cầu thứ hai thành công (Id: ${rejectReqId})`);

    // Approver rejects
    res = await api(`/requests/${rejectReqId}/decision`, {
      method: 'POST',
      token: managerToken,
      body: { decision: 'REJECTED', comment: 'Từ chối để kiểm tra thông báo cảnh báo màu đỏ' },
    });
    assert(res.status === 201 && res.data?.data?.status === 'REJECTED', 'Approver từ chối yêu cầu thành công (Status: REJECTED)');

    // Verify User received REQUEST_REJECTED
    res = await api('/notifications', { token: devToken });
    const rejectNotify = (res.data?.data ?? []).find((n) => n.requestId === rejectReqId && n.type === 'REQUEST_REJECTED');
    assert(rejectNotify !== undefined, 'User nhận được thông báo REQUEST_REJECTED (Loại thông báo màu đỏ)');
    assert(!rejectNotify?.readAt, 'Thông báo từ chối ở trạng thái chưa đọc (Kích hoạt chấm đỏ)');

    // 8. Test Admin role accessing notifications
    console.log('\n--- Step 8: Kiểm tra vai trò Admin (CISO/Admin) truy cập thông báo ---');
    res = await api('/notifications', { token: adminToken });
    assert(res.status === 200 && Array.isArray(res.data?.data), 'Admin truy cập API danh sách thông báo thành công (200 OK)');

    console.log('\n===============================================================');
    console.log(`🎉 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('===============================================================\n');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Lỗi ngoại lệ trong quá trình chạy test:', err);
    process.exit(1);
  }
}

runNotificationBellTests();
