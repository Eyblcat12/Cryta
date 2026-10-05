-- ============================================================================
-- HỌC VIỆN CÔNG NGHỆ BƯU CHÍNH VIỄN THÔNG (PTIT)
-- KHOA AN TOÀN THÔNG TIN & CÔNG NGHỆ THÔNG TIN
-- BÁO CÁO ĐỒ ÁN MÔN HỌC: THIẾT KẾ HỆ THỐNG THÔNG TIN
-- ĐỀ TÀI: HỆ THỐNG QUẢN LÝ VÒNG ĐỜI KHÓA MÃ HÓA VÀ CHỨNG CHỈ SỐ DOANH NGHIỆP
-- SINH VIÊN THỰC HIỆN:
--   1. Hồ Ngọc Đức   - MSSV: N23DCAT012 (Trưởng nhóm - D23CQAT01-N)
--   2. Lê Hoàng Ngọc  - MSSV: N23DCAT048 (Thành viên  - D23CQAT01-N)
-- HỆ QUẢN TRỊ CSDL: PostgreSQL 15+
-- ============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS auth_sessions CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS request_decisions CASCADE;
DROP TABLE IF EXISTS requests CASCADE;
DROP TABLE IF EXISTS certificates CASCADE;
DROP TABLE IF EXISTS cryptographic_keys CASCADE;
DROP TABLE IF EXISTS crypto_assets CASCADE;
DROP TABLE IF EXISTS policy_versions CASCADE;
DROP TABLE IF EXISTS approver_scopes CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS policies CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS departments CASCADE;
DROP FUNCTION IF EXISTS reject_audit_log_mutation() CASCADE;
DROP FUNCTION IF EXISTS reject_request_decision_mutation() CASCADE;
DROP FUNCTION IF EXISTS enforce_request_decision_rules() CASCADE;
DROP FUNCTION IF EXISTS enforce_role_separation() CASCADE;
DROP FUNCTION IF EXISTS set_updated_at() CASCADE;

-- 1. Tổ chức và RBAC ---------------------------------------------------------
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_departments_code CHECK (BTRIM(code) <> ''),
  CONSTRAINT ck_departments_name CHECK (BTRIM(name) <> '')
);

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_roles_code CHECK (code IN ('USER', 'APPROVER', 'ADMIN')),
  CONSTRAINT ck_roles_name CHECK (BTRIM(name) <> '')
);

CREATE TABLE policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_policies_code CHECK (BTRIM(code) <> ''),
  CONSTRAINT ck_policies_name CHECK (BTRIM(name) <> '')
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  token_version INTEGER NOT NULL DEFAULT 1,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_users_email CHECK (BTRIM(email) <> ''),
  CONSTRAINT ck_users_name CHECK (BTRIM(display_name) <> ''),
  CONSTRAINT ck_users_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'LOCKED')),
  CONSTRAINT ck_users_token_version CHECK (token_version > 0)
  ,CONSTRAINT ck_users_failed_login CHECK (failed_login_attempts >= 0)
);
CREATE UNIQUE INDEX uq_users_email_ci ON users (LOWER(email));

-- Refresh token chỉ được lưu dưới dạng hash. Mỗi lần refresh sẽ xoay vòng session.
CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  user_agent VARCHAR(500),
  ip_address INET,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  replaced_by UUID REFERENCES auth_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_auth_session_expiry CHECK (expires_at > created_at)
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id, created_at DESC);
CREATE INDEX idx_auth_sessions_active ON auth_sessions(token_hash, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE approver_scopes (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, department_id)
);

-- ADMIN và APPROVER là hai nhiệm vụ loại trừ nhau trong phạm vi MVP.
CREATE FUNCTION enforce_role_separation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_new_role VARCHAR(50);
BEGIN
  SELECT code INTO v_new_role FROM roles WHERE id = NEW.role_id;
  IF v_new_role = 'ADMIN' AND EXISTS (
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = NEW.user_id AND r.code = 'APPROVER'
  ) THEN
    RAISE EXCEPTION 'SOD_ROLE_CONFLICT: ADMIN cannot also be APPROVER';
  END IF;
  IF v_new_role = 'APPROVER' AND EXISTS (
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = NEW.user_id AND r.code = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'SOD_ROLE_CONFLICT: APPROVER cannot also be ADMIN';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_user_roles_sod
BEFORE INSERT OR UPDATE ON user_roles
FOR EACH ROW EXECUTE FUNCTION enforce_role_separation();

-- 2. Phiên bản chính sách ----------------------------------------------------
CREATE TABLE policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  configuration JSONB NOT NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_policy_versions UNIQUE (policy_id, version),
  CONSTRAINT ck_policy_version_positive CHECK (version > 0),
  CONSTRAINT ck_policy_configuration CHECK (JSONB_TYPEOF(configuration) = 'object')
);

-- 3. Tài sản mật mã ----------------------------------------------------------
-- Chỉ lưu metadata/provider reference; không lưu private key dạng rõ.
CREATE TABLE crypto_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code VARCHAR(100) NOT NULL UNIQUE,
  asset_type VARCHAR(30) NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  policy_version_id UUID NOT NULL REFERENCES policy_versions(id) ON DELETE RESTRICT,
  purpose VARCHAR(255) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'REGISTERED',
  valid_from TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  replaces_asset_id UUID REFERENCES crypto_assets(id) ON DELETE RESTRICT,
  provider_reference VARCHAR(255),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_assets_type CHECK (asset_type IN ('KEY', 'CERTIFICATE')),
  CONSTRAINT ck_assets_status CHECK (
    status IN ('REGISTERED', 'ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'REVOKED', 'SUPERSEDED')
  ),
  CONSTRAINT ck_assets_dates CHECK (expires_at > valid_from),
  CONSTRAINT ck_assets_not_self_replacing CHECK (replaces_asset_id IS NULL OR replaces_asset_id <> id),
  CONSTRAINT ck_assets_version CHECK (version > 0),
  CONSTRAINT ck_assets_code CHECK (BTRIM(asset_code) <> ''),
  CONSTRAINT ck_assets_purpose CHECK (BTRIM(purpose) <> '')
);
CREATE UNIQUE INDEX uq_assets_provider_reference
  ON crypto_assets(provider_reference) WHERE provider_reference IS NOT NULL;

CREATE TABLE cryptographic_keys (
  asset_id UUID PRIMARY KEY REFERENCES crypto_assets(id) ON DELETE CASCADE,
  algorithm VARCHAR(50) NOT NULL,
  key_size INTEGER NOT NULL,
  usage VARCHAR(100) NOT NULL,
  public_key_fingerprint VARCHAR(255) NOT NULL UNIQUE,
  CONSTRAINT ck_keys_algorithm CHECK (algorithm IN ('RSA', 'ECDSA', 'ED25519', 'AES')),
  CONSTRAINT ck_keys_size CHECK (key_size > 0),
  CONSTRAINT ck_keys_usage CHECK (BTRIM(usage) <> '')
);

CREATE TABLE certificates (
  asset_id UUID PRIMARY KEY REFERENCES crypto_assets(id) ON DELETE CASCADE,
  serial_number VARCHAR(100) NOT NULL UNIQUE,
  subject_dn VARCHAR(500) NOT NULL,
  issuer_dn VARCHAR(500) NOT NULL,
  fingerprint VARCHAR(255) NOT NULL UNIQUE,
  public_key_asset_id UUID REFERENCES crypto_assets(id) ON DELETE RESTRICT,
  CONSTRAINT ck_cert_serial CHECK (BTRIM(serial_number) <> ''),
  CONSTRAINT ck_cert_subject CHECK (BTRIM(subject_dn) <> ''),
  CONSTRAINT ck_cert_issuer CHECK (BTRIM(issuer_dn) <> '')
);

-- 4. Workflow yêu cầu --------------------------------------------------------
CREATE TABLE requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type VARCHAR(30) NOT NULL,
  creator_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  policy_version_id UUID NOT NULL REFERENCES policy_versions(id) ON DELETE RESTRICT,
  target_asset_id UUID REFERENCES crypto_assets(id) ON DELETE RESTRICT,
  result_asset_id UUID REFERENCES crypto_assets(id) ON DELETE RESTRICT,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  reason TEXT NOT NULL,
  emergency BOOLEAN NOT NULL DEFAULT FALSE,
  requested_parameters JSONB NOT NULL DEFAULT '{}'::JSONB,
  version INTEGER NOT NULL DEFAULT 1,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_requests_type CHECK (request_type IN ('CREATE', 'RENEW', 'REVOKE')),
  CONSTRAINT ck_requests_status CHECK (
    status IN ('PENDING', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')
  ),
  CONSTRAINT ck_requests_reason CHECK (BTRIM(reason) <> ''),
  CONSTRAINT ck_requests_parameters CHECK (JSONB_TYPEOF(requested_parameters) = 'object'),
  CONSTRAINT ck_requests_version CHECK (version > 0),
  CONSTRAINT ck_requests_target CHECK (
    (request_type = 'CREATE' AND target_asset_id IS NULL)
    OR (request_type IN ('RENEW', 'REVOKE') AND target_asset_id IS NOT NULL)
  ),
  CONSTRAINT ck_requests_result CHECK (status <> 'COMPLETED' OR result_asset_id IS NOT NULL),
  CONSTRAINT ck_requests_completed_at CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
);

CREATE TABLE request_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  approver_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision VARCHAR(30) NOT NULL,
  comment TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_request_final_decision UNIQUE (request_id),
  CONSTRAINT ck_decision_value CHECK (decision IN ('APPROVED', 'REJECTED')),
  CONSTRAINT ck_reject_comment CHECK (
    decision <> 'REJECTED' OR NULLIF(BTRIM(comment), '') IS NOT NULL
  )
);

-- Database guard cho SoD/scope. Backend vẫn kiểm tra để trả lỗi thân thiện.
CREATE FUNCTION enforce_request_decision_rules()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_creator UUID;
  v_department UUID;
  v_status VARCHAR(30);
  v_approver_status VARCHAR(30);
BEGIN
  SELECT creator_id, department_id, status
    INTO v_creator, v_department, v_status
  FROM requests WHERE id = NEW.request_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REQUEST_NOT_FOUND';
  END IF;
  IF NEW.approver_id = v_creator THEN
    RAISE EXCEPTION 'SOD_VIOLATION';
  END IF;
  IF v_status <> 'PENDING' THEN
    RAISE EXCEPTION 'INVALID_REQUEST_STATE';
  END IF;

  SELECT status INTO v_approver_status FROM users WHERE id = NEW.approver_id;
  IF v_approver_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'APPROVER_INACTIVE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = NEW.approver_id AND r.code = 'APPROVER'
  ) THEN
    RAISE EXCEPTION 'APPROVER_ROLE_REQUIRED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM approver_scopes s
    WHERE s.user_id = NEW.approver_id AND s.department_id = v_department
  ) THEN
    RAISE EXCEPTION 'APPROVER_OUT_OF_SCOPE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_request_decision_sod
BEFORE INSERT ON request_decisions
FOR EACH ROW EXECUTE FUNCTION enforce_request_decision_rules();

CREATE FUNCTION reject_request_decision_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'REQUEST_DECISION_IMMUTABLE';
END;
$$;
CREATE TRIGGER trg_request_decision_immutable
BEFORE UPDATE OR DELETE ON request_decisions
FOR EACH ROW EXECUTE FUNCTION reject_request_decision_mutation();

-- 5. Audit và notification ---------------------------------------------------
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_type VARCHAR(30) NOT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(100),
  outcome VARCHAR(30) NOT NULL,
  request_id UUID REFERENCES requests(id) ON DELETE SET NULL,
  ip_address INET,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_audit_actor_type CHECK (actor_type IN ('USER', 'SYSTEM')),
  CONSTRAINT ck_audit_outcome CHECK (outcome IN ('SUCCESS', 'FAILED', 'DENIED')),
  CONSTRAINT ck_audit_actor CHECK (
    (actor_type = 'SYSTEM' AND actor_id IS NULL)
    OR (actor_type = 'USER' AND actor_id IS NOT NULL)
  ),
  CONSTRAINT ck_audit_metadata CHECK (JSONB_TYPEOF(metadata) = 'object')
);

CREATE FUNCTION reject_audit_log_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_LOG_IMMUTABLE';
END;
$$;
CREATE TRIGGER trg_audit_log_immutable
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION reject_audit_log_mutation();

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES crypto_assets(id) ON DELETE CASCADE,
  request_id UUID REFERENCES requests(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  channel VARCHAR(30) NOT NULL,
  delivery_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  deduplication_key VARCHAR(255) NOT NULL UNIQUE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  error_message TEXT,
  CONSTRAINT ck_notification_type CHECK (
    type IN ('REQUEST_SUBMITTED', 'REQUEST_APPROVED', 'REQUEST_REJECTED', 'ASSET_EXPIRING', 'ASSET_EXPIRED', 'ASSET_REVOKED')
  ),
  CONSTRAINT ck_notification_channel CHECK (channel IN ('IN_APP', 'EMAIL')),
  CONSTRAINT ck_notification_delivery CHECK (delivery_status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  CONSTRAINT ck_notification_attempts CHECK (attempt_count >= 0),
  CONSTRAINT ck_notification_subject CHECK (asset_id IS NOT NULL OR request_id IS NOT NULL),
  CONSTRAINT ck_notification_sent CHECK (delivery_status <> 'SENT' OR sent_at IS NOT NULL),
  CONSTRAINT ck_notification_failed CHECK (delivery_status <> 'FAILED' OR failed_at IS NOT NULL)
);

-- 6. Timestamp trigger và index ---------------------------------------------
CREATE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_departments_updated BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_policies_updated BEFORE UPDATE ON policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_assets_updated BEFORE UPDATE ON crypto_assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_requests_updated BEFORE UPDATE ON requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_user_roles_role ON user_roles(role_id, user_id);
CREATE INDEX idx_scopes_department ON approver_scopes(department_id, user_id);
CREATE INDEX idx_policy_effective ON policy_versions(policy_id, effective_from DESC);
CREATE INDEX idx_assets_owner ON crypto_assets(owner_id, status);
CREATE INDEX idx_assets_department ON crypto_assets(department_id, status);
CREATE INDEX idx_assets_expiry ON crypto_assets(status, expires_at);
CREATE INDEX idx_assets_replaces ON crypto_assets(replaces_asset_id) WHERE replaces_asset_id IS NOT NULL;
CREATE INDEX idx_requests_creator ON requests(creator_id, submitted_at DESC);
CREATE INDEX idx_requests_queue ON requests(department_id, status, emergency DESC, submitted_at);
CREATE INDEX idx_requests_target ON requests(target_asset_id) WHERE target_asset_id IS NOT NULL;
CREATE INDEX idx_decisions_approver ON request_decisions(approver_id, decided_at DESC);
CREATE INDEX idx_audit_time ON audit_logs(occurred_at DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id, occurred_at DESC) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_audit_request ON audit_logs(request_id, occurred_at) WHERE request_id IS NOT NULL;
CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, created_at DESC);
CREATE INDEX idx_notifications_delivery ON notifications(delivery_status, scheduled_for);
CREATE INDEX idx_notifications_asset ON notifications(asset_id, created_at DESC) WHERE asset_id IS NOT NULL;

COMMIT;
