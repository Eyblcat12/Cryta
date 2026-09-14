-- DỮ LIỆU DEMO - chạy database_schema.sql trước file này.
-- Mật khẩu chung local/demo: Password@123

BEGIN;

TRUNCATE TABLE notifications, auth_sessions, audit_logs, request_decisions, requests,
  certificates, cryptographic_keys, crypto_assets, policy_versions,
  approver_scopes, user_roles, users, policies, roles, departments
RESTART IDENTITY CASCADE;

-- 1. Cơ cấu, role, policy ----------------------------------------------------
INSERT INTO departments (id, code, name) VALUES
  ('d1111111-1111-1111-1111-111111111111', 'IT',  'Công nghệ thông tin'),
  ('d2222222-2222-2222-2222-222222222222', 'FIN', 'Tài chính - Kế toán'),
  ('d3333333-3333-3333-3333-333333333333', 'HR',  'Hành chính Nhân sự'),
  ('d4444444-4444-4444-4444-444444444444', 'SEC', 'Bảo mật thông tin');

INSERT INTO roles (id, code, name) VALUES
  ('02222222-1111-1111-1111-111111111111', 'ADMIN',    'Quản trị bảo mật'),
  ('02222222-2222-2222-2222-222222222222', 'APPROVER', 'Người phê duyệt'),
  ('02222222-3333-3333-3333-333333333333', 'USER',     'Người dùng thông thường');

INSERT INTO policies (id, code, name) VALUES
  ('03333333-1111-1111-1111-111111111111', 'RSA_STANDARD', 'Tiêu chuẩn khóa RSA'),
  ('03333333-2222-2222-2222-222222222222', 'TLS_WEB',      'Chứng thư TLS cho Web'),
  ('03333333-3333-3333-3333-333333333333', 'ECDSA_STRICT', 'Tiêu chuẩn ECDSA bảo mật cao');

-- 2. User và phân quyền ------------------------------------------------------
INSERT INTO users (id, department_id, email, password_hash, display_name, status) VALUES
  ('04444444-1111-1111-1111-111111111111', 'd4444444-4444-4444-4444-444444444444', 'admin@congty.com',
   '$2b$10$fAkKnLzQme9j8f1gZyyPaOcWpLPJBV1TFz.iD.LKLcLfx/TQHv3p.', 'Quản trị hệ thống', 'ACTIVE'),
  ('04444444-2222-2222-2222-222222222222', 'd1111111-1111-1111-1111-111111111111', 'it.manager@congty.com',
   '$2b$10$fAkKnLzQme9j8f1gZyyPaOcWpLPJBV1TFz.iD.LKLcLfx/TQHv3p.', 'Trưởng phòng IT', 'ACTIVE'),
  ('04444444-3333-3333-3333-333333333333', 'd1111111-1111-1111-1111-111111111111', 'dev.nguyen@congty.com',
   '$2b$10$fAkKnLzQme9j8f1gZyyPaOcWpLPJBV1TFz.iD.LKLcLfx/TQHv3p.', 'Nguyễn Văn Dev', 'ACTIVE'),
  ('04444444-4444-4444-4444-444444444444', 'd2222222-2222-2222-2222-222222222222', 'fin.manager@congty.com',
   '$2b$10$fAkKnLzQme9j8f1gZyyPaOcWpLPJBV1TFz.iD.LKLcLfx/TQHv3p.', 'Kế toán trưởng', 'ACTIVE'),
  ('04444444-5555-5555-5555-555555555555', 'd2222222-2222-2222-2222-222222222222', 'kt.tran@congty.com',
   '$2b$10$fAkKnLzQme9j8f1gZyyPaOcWpLPJBV1TFz.iD.LKLcLfx/TQHv3p.', 'Trần Thị Kế Toán', 'ACTIVE'),
  ('04444444-6666-6666-6666-666666666666', 'd4444444-4444-4444-4444-444444444444', 'ciso@congty.com',
   '$2b$10$fAkKnLzQme9j8f1gZyyPaOcWpLPJBV1TFz.iD.LKLcLfx/TQHv3p.', 'Giám đốc Bảo mật', 'ACTIVE'),
  ('04444444-9999-9999-9999-999999999999', 'd1111111-1111-1111-1111-111111111111', 'nghi.viec@congty.com',
   '$2b$10$fAkKnLzQme9j8f1gZyyPaOcWpLPJBV1TFz.iD.LKLcLfx/TQHv3p.', 'Nhân viên đã nghỉ việc', 'INACTIVE');

INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES
  ('04444444-1111-1111-1111-111111111111', '02222222-1111-1111-1111-111111111111', '04444444-1111-1111-1111-111111111111'),
  ('04444444-2222-2222-2222-222222222222', '02222222-2222-2222-2222-222222222222', '04444444-1111-1111-1111-111111111111'),
  ('04444444-3333-3333-3333-333333333333', '02222222-3333-3333-3333-333333333333', '04444444-1111-1111-1111-111111111111'),
  ('04444444-4444-4444-4444-444444444444', '02222222-2222-2222-2222-222222222222', '04444444-1111-1111-1111-111111111111'),
  ('04444444-5555-5555-5555-555555555555', '02222222-3333-3333-3333-333333333333', '04444444-1111-1111-1111-111111111111'),
  ('04444444-6666-6666-6666-666666666666', '02222222-1111-1111-1111-111111111111', '04444444-1111-1111-1111-111111111111'),
  ('04444444-9999-9999-9999-999999999999', '02222222-3333-3333-3333-333333333333', '04444444-1111-1111-1111-111111111111');

-- Chỉ APPROVER có scope; ADMIN không được duyệt.
INSERT INTO approver_scopes (user_id, department_id, assigned_by) VALUES
  ('04444444-2222-2222-2222-222222222222', 'd1111111-1111-1111-1111-111111111111', '04444444-1111-1111-1111-111111111111'),
  ('04444444-4444-4444-4444-444444444444', 'd2222222-2222-2222-2222-222222222222', '04444444-1111-1111-1111-111111111111');

-- 3. Policy version ----------------------------------------------------------
INSERT INTO policy_versions (id, policy_id, version, configuration, changed_by, effective_from) VALUES
  ('05555555-1111-1111-1111-111111111111', '03333333-1111-1111-1111-111111111111', 1,
   '{"algorithm":"RSA","minimum_key_size":1024,"maximum_validity_days":365,"warning_days":[30,7,1]}',
   '04444444-1111-1111-1111-111111111111', NOW() - INTERVAL '2 years'),
  ('05555555-1111-1111-1111-111111111112', '03333333-1111-1111-1111-111111111111', 2,
   '{"algorithm":"RSA","minimum_key_size":2048,"maximum_validity_days":365,"warning_days":[30,7,1]}',
   '04444444-6666-6666-6666-666666666666', NOW() - INTERVAL '1 year'),
  ('05555555-2222-2222-2222-222222222222', '03333333-2222-2222-2222-222222222222', 1,
   '{"certificate_profile":"TLS_SERVER","maximum_validity_days":365,"warning_days":[30,7,1]}',
   '04444444-6666-6666-6666-666666666666', NOW() - INTERVAL '1 year'),
  ('05555555-3333-3333-3333-333333333333', '03333333-3333-3333-3333-333333333333', 1,
   '{"algorithm":"ECDSA","curve":"P-256","maximum_validity_days":365,"warning_days":[30,7,1]}',
   '04444444-6666-6666-6666-666666666666', NOW() - INTERVAL '6 months');

-- 4. Asset: đủ trạng thái để demo -------------------------------------------
INSERT INTO crypto_assets (
  id, asset_code, asset_type, owner_id, department_id, policy_version_id,
  purpose, status, valid_from, expires_at, replaces_asset_id, provider_reference
) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'KEY-DEV-001', 'KEY', '04444444-3333-3333-3333-333333333333',
   'd1111111-1111-1111-1111-111111111111', '05555555-1111-1111-1111-111111111112',
   'Đăng nhập máy chủ phát triển', 'ACTIVE', NOW() - INTERVAL '1 month', NOW() + INTERVAL '11 months', NULL, 'mock-key-dev-001'),
  ('a1111112-1111-1111-1111-111111111112', 'KEY-DEV-OLD', 'KEY', '04444444-3333-3333-3333-333333333333',
   'd1111111-1111-1111-1111-111111111111', '05555555-1111-1111-1111-111111111111',
   'Khóa SSH phiên bản cũ', 'SUPERSEDED', NOW() - INTERVAL '13 months', NOW() - INTERVAL '1 month', NULL, 'mock-key-dev-old'),
  ('a1111113-1111-1111-1111-111111111113', 'KEY-DEV-NEW', 'KEY', '04444444-3333-3333-3333-333333333333',
   'd1111111-1111-1111-1111-111111111111', '05555555-1111-1111-1111-111111111112',
   'Khóa SSH được gia hạn', 'ACTIVE', NOW() - INTERVAL '1 month', NOW() + INTERVAL '11 months',
   'a1111112-1111-1111-1111-111111111112', 'mock-key-dev-new'),
  ('a1111114-1111-1111-1111-111111111114', 'KEY-DEV-REVOKED', 'KEY', '04444444-3333-3333-3333-333333333333',
   'd1111111-1111-1111-1111-111111111111', '05555555-1111-1111-1111-111111111112',
   'Khóa trên thiết bị đã mất', 'REVOKED', NOW() - INTERVAL '5 months', NOW() + INTERVAL '7 months', NULL, 'mock-key-dev-revoked'),
  ('a2222221-2222-2222-2222-222222222221', 'CRT-FIN-EXPIRED', 'CERTIFICATE', '04444444-5555-5555-5555-555555555555',
   'd2222222-2222-2222-2222-222222222222', '05555555-2222-2222-2222-222222222222',
   'Chứng thư hóa đơn năm trước', 'EXPIRED', NOW() - INTERVAL '2 years', NOW() - INTERVAL '1 year', NULL, 'mock-cert-fin-expired'),
  ('a2222222-2222-2222-2222-222222222222', 'CRT-FIN-SOON', 'CERTIFICATE', '04444444-5555-5555-5555-555555555555',
   'd2222222-2222-2222-2222-222222222222', '05555555-2222-2222-2222-222222222222',
   'Ký hóa đơn điện tử', 'EXPIRING_SOON', NOW() - INTERVAL '350 days', NOW() + INTERVAL '15 days', NULL, 'mock-cert-fin-soon'),
  ('a2222223-2222-2222-2222-222222222223', 'CRT-FIN-ACTIVE', 'CERTIFICATE', '04444444-5555-5555-5555-555555555555',
   'd2222222-2222-2222-2222-222222222222', '05555555-2222-2222-2222-222222222222',
   'Cổng thanh toán nội bộ', 'ACTIVE', NOW() - INTERVAL '2 months', NOW() + INTERVAL '10 months', NULL, 'mock-cert-fin-active');

INSERT INTO cryptographic_keys (asset_id, algorithm, key_size, usage, public_key_fingerprint) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'RSA', 2048, 'SSH_LOGIN',  'SHA256:key-dev-001-demo'),
  ('a1111112-1111-1111-1111-111111111112', 'RSA', 1024, 'SSH_LOGIN',  'SHA256:key-dev-old-demo'),
  ('a1111113-1111-1111-1111-111111111113', 'RSA', 2048, 'SSH_LOGIN',  'SHA256:key-dev-new-demo'),
  ('a1111114-1111-1111-1111-111111111114', 'RSA', 2048, 'DEVICE_AUTH','SHA256:key-dev-revoked-demo');

INSERT INTO certificates (asset_id, serial_number, subject_dn, issuer_dn, fingerprint) VALUES
  ('a2222221-2222-2222-2222-222222222221', '01:F8:7A:B4:9C:22:11:D3', 'CN=old.ketoan.demo',     'CN=Demo-CA', 'SHA256:cert-fin-expired-demo'),
  ('a2222222-2222-2222-2222-222222222222', '02:E5:6B:A1:8D:33:44:E5', 'CN=invoice.ketoan.demo', 'CN=Demo-CA', 'SHA256:cert-fin-soon-demo'),
  ('a2222223-2222-2222-2222-222222222223', '03:C4:9D:11:7F:55:66:A7', 'CN=payment.ketoan.demo', 'CN=Demo-CA', 'SHA256:cert-fin-active-demo');

-- 5. Request/decision --------------------------------------------------------
-- Request cần quyết định được insert ở PENDING để trigger SoD kiểm tra.
INSERT INTO requests (
  id, request_type, creator_id, department_id, policy_version_id, target_asset_id,
  result_asset_id, status, reason, emergency, requested_parameters, submitted_at
) VALUES
  ('0eeeeeee-1111-1111-1111-111111111111', 'CREATE', '04444444-3333-3333-3333-333333333333',
   'd1111111-1111-1111-1111-111111111111', '05555555-1111-1111-1111-111111111112', NULL, NULL, 'PENDING',
   'Cần khóa RSA cho máy chủ mới', FALSE,
   '{"asset_type":"KEY","algorithm":"RSA","key_size":2048,"usage":"SSH_LOGIN"}', NOW() - INTERVAL '2 hours'),
  ('0eeeeeee-2222-2222-2222-222222222222', 'CREATE', '04444444-5555-5555-5555-555555555555',
   'd2222222-2222-2222-2222-222222222222', '05555555-1111-1111-1111-111111111112', NULL, NULL, 'PENDING',
   'Xin cấp khóa RSA 1024 cho ứng dụng cũ', FALSE,
   '{"asset_type":"KEY","algorithm":"RSA","key_size":1024,"usage":"SIGNING"}', NOW() - INTERVAL '2 days'),
  ('0eeeeeee-3333-3333-3333-333333333333', 'REVOKE', '04444444-3333-3333-3333-333333333333',
   'd1111111-1111-1111-1111-111111111111', '05555555-1111-1111-1111-111111111112',
   'a1111111-1111-1111-1111-111111111111', NULL, 'CANCELLED', 'Chọn nhầm tài sản cần thu hồi', FALSE, '{}', NOW() - INTERVAL '10 days'),
  ('0eeeeeee-4444-4444-4444-444444444444', 'RENEW', '04444444-3333-3333-3333-333333333333',
   'd1111111-1111-1111-1111-111111111111', '05555555-1111-1111-1111-111111111112',
   'a1111112-1111-1111-1111-111111111112', NULL, 'PENDING', 'Gia hạn khóa SSH theo policy RSA mới', FALSE,
   '{"algorithm":"RSA","key_size":2048,"validity_days":365}', NOW() - INTERVAL '40 days'),
  ('0eeeeeee-5555-5555-5555-555555555555', 'REVOKE', '04444444-3333-3333-3333-333333333333',
   'd1111111-1111-1111-1111-111111111111', '05555555-1111-1111-1111-111111111112',
   'a1111114-1111-1111-1111-111111111114', NULL, 'PENDING', 'Thiết bị chứa khóa bị thất lạc', TRUE,
   '{"incident_reference":"INC-DEMO-001"}', NOW() - INTERVAL '3 days');

INSERT INTO request_decisions (request_id, approver_id, decision, comment, decided_at) VALUES
  ('0eeeeeee-2222-2222-2222-222222222222', '04444444-4444-4444-4444-444444444444', 'REJECTED',
   'RSA 1024 không đáp ứng policy tối thiểu 2048 bit.', NOW() - INTERVAL '1 day'),
  ('0eeeeeee-4444-4444-4444-444444444444', '04444444-2222-2222-2222-222222222222', 'APPROVED',
   'Thông số đáp ứng policy và đúng nhu cầu công việc.', NOW() - INTERVAL '39 days'),
  ('0eeeeeee-5555-5555-5555-555555555555', '04444444-2222-2222-2222-222222222222', 'APPROVED',
   'Thu hồi khẩn cấp do mất thiết bị.', NOW() - INTERVAL '3 days');

UPDATE requests SET status = 'REJECTED', version = version + 1
WHERE id = '0eeeeeee-2222-2222-2222-222222222222';

UPDATE requests SET status = 'COMPLETED', result_asset_id = 'a1111113-1111-1111-1111-111111111113',
  completed_at = NOW() - INTERVAL '38 days', version = version + 1
WHERE id = '0eeeeeee-4444-4444-4444-444444444444';

UPDATE requests SET status = 'COMPLETED', result_asset_id = 'a1111114-1111-1111-1111-111111111114',
  completed_at = NOW() - INTERVAL '3 days', version = version + 1
WHERE id = '0eeeeeee-5555-5555-5555-555555555555';

-- 6. Audit: success, denied và system ---------------------------------------
INSERT INTO audit_logs
  (actor_id, actor_type, action, entity_type, entity_id, outcome, request_id, ip_address, metadata, occurred_at)
VALUES
  ('04444444-3333-3333-3333-333333333333', 'USER', 'REQUEST_SUBMITTED', 'REQUEST',
   '0eeeeeee-1111-1111-1111-111111111111', 'SUCCESS', '0eeeeeee-1111-1111-1111-111111111111', '10.0.0.31',
   '{"request_type":"CREATE"}', NOW() - INTERVAL '2 hours'),
  ('04444444-4444-4444-4444-444444444444', 'USER', 'REQUEST_APPROVAL_DENIED', 'REQUEST',
   '0eeeeeee-1111-1111-1111-111111111111', 'DENIED', '0eeeeeee-1111-1111-1111-111111111111', '10.0.0.44',
   '{"reason":"OUT_OF_SCOPE"}', NOW() - INTERVAL '90 minutes'),
  ('04444444-4444-4444-4444-444444444444', 'USER', 'REQUEST_REJECTED', 'REQUEST',
   '0eeeeeee-2222-2222-2222-222222222222', 'SUCCESS', '0eeeeeee-2222-2222-2222-222222222222', '10.0.0.44',
   '{"policy_violation":"RSA_KEY_SIZE_TOO_SMALL"}', NOW() - INTERVAL '1 day'),
  ('04444444-2222-2222-2222-222222222222', 'USER', 'REQUEST_APPROVED', 'REQUEST',
   '0eeeeeee-4444-4444-4444-444444444444', 'SUCCESS', '0eeeeeee-4444-4444-4444-444444444444', '10.0.0.22',
   '{}', NOW() - INTERVAL '39 days'),
  (NULL, 'SYSTEM', 'ASSET_RENEWED', 'CRYPTO_ASSET', 'a1111113-1111-1111-1111-111111111113',
   'SUCCESS', '0eeeeeee-4444-4444-4444-444444444444', NULL,
   '{"provider":"MOCK","replaces_asset_id":"a1111112-1111-1111-1111-111111111112"}', NOW() - INTERVAL '38 days'),
  (NULL, 'SYSTEM', 'ASSET_REVOKED', 'CRYPTO_ASSET', 'a1111114-1111-1111-1111-111111111114',
   'SUCCESS', '0eeeeeee-5555-5555-5555-555555555555', NULL,
   '{"provider":"MOCK","emergency":true}', NOW() - INTERVAL '3 days'),
  (NULL, 'SYSTEM', 'ASSET_MARKED_EXPIRING_SOON', 'CRYPTO_ASSET', 'a2222222-2222-2222-2222-222222222222',
   'SUCCESS', NULL, NULL, '{"threshold_days":30}', NOW() - INTERVAL '1 day');

-- 7. Notification: sent/read/failed -----------------------------------------
INSERT INTO notifications
  (id, recipient_id, asset_id, request_id, type, channel, delivery_status,
   deduplication_key, attempt_count, scheduled_for, sent_at, failed_at, read_at, error_message)
VALUES
  ('09999999-1111-1111-1111-111111111111', '04444444-3333-3333-3333-333333333333',
   'a1111113-1111-1111-1111-111111111113', '0eeeeeee-4444-4444-4444-444444444444',
   'REQUEST_APPROVED', 'IN_APP', 'SENT', 'request:0eeeeeee-4444-4444-4444-444444444444:approved', 1,
   NOW() - INTERVAL '39 days', NOW() - INTERVAL '39 days', NULL, NOW() - INTERVAL '38 days', NULL),
  ('09999999-2222-2222-2222-222222222222', '04444444-5555-5555-5555-555555555555',
   NULL, '0eeeeeee-2222-2222-2222-222222222222', 'REQUEST_REJECTED', 'IN_APP', 'SENT',
   'request:0eeeeeee-2222-2222-2222-222222222222:rejected', 1,
   NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', NULL, NULL, NULL),
  ('09999999-3333-3333-3333-333333333333', '04444444-5555-5555-5555-555555555555',
   'a2222222-2222-2222-2222-222222222222', NULL, 'ASSET_EXPIRING', 'EMAIL', 'SENT',
   'asset:a2222222-2222-2222-2222-222222222222:expiry:30:email', 1,
   NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', NULL, NULL, NULL),
  ('09999999-4444-4444-4444-444444444444', '04444444-5555-5555-5555-555555555555',
   'a2222222-2222-2222-2222-222222222222', NULL, 'ASSET_EXPIRING', 'IN_APP', 'SENT',
   'asset:a2222222-2222-2222-2222-222222222222:expiry:30:in-app', 1,
   NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', NULL, NOW() - INTERVAL '12 hours', NULL),
  ('09999999-5555-5555-5555-555555555555', '04444444-3333-3333-3333-333333333333',
   'a1111114-1111-1111-1111-111111111114', '0eeeeeee-5555-5555-5555-555555555555',
   'ASSET_REVOKED', 'EMAIL', 'FAILED', 'request:0eeeeeee-5555-5555-5555-555555555555:revoked:email', 3,
   NOW() - INTERVAL '3 days', NULL, NOW() - INTERVAL '2 days', NULL, 'MailHog unavailable during demo seed');

COMMIT;

-- Smoke tests: kết quả mong đợi lần lượt là 0, 0, 0, 1.
SELECT COUNT(*) AS admin_approver_conflicts
FROM users u
JOIN user_roles ua ON ua.user_id = u.id
JOIN roles ra ON ra.id = ua.role_id AND ra.code = 'ADMIN'
JOIN user_roles up ON up.user_id = u.id
JOIN roles rp ON rp.id = up.role_id AND rp.code = 'APPROVER';

SELECT COUNT(*) AS self_approval_conflicts
FROM request_decisions d JOIN requests r ON r.id = d.request_id
WHERE d.approver_id = r.creator_id;

SELECT COUNT(*) AS duplicate_notification_keys FROM (
  SELECT deduplication_key FROM notifications GROUP BY deduplication_key HAVING COUNT(*) > 1
) duplicates;

SELECT COUNT(*) AS expiring_soon_assets
FROM crypto_assets WHERE status = 'EXPIRING_SOON';
