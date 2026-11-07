import { Inject,Injectable,Logger,OnModuleInit } from '@nestjs/common'; import { createHash } from 'node:crypto'; import type { Pool, PoolClient } from 'pg'; import { DATABASE_POOL } from './database.constants';
import { assertProductionRuntime } from './production-runtime';
type Migration={version:string;sql:string};
const migrations:Migration[]=[
{version:'001_auth_sessions_email',sql:`CREATE TABLE IF NOT EXISTS auth_sessions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash CHAR(64) NOT NULL UNIQUE,user_agent VARCHAR(500),ip_address INET,expires_at TIMESTAMPTZ NOT NULL,last_used_at TIMESTAMPTZ,revoked_at TIMESTAMPTZ,replaced_by UUID REFERENCES auth_sessions(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),CONSTRAINT ck_auth_session_expiry CHECK (expires_at > created_at));CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id,created_at DESC);CREATE INDEX IF NOT EXISTS idx_auth_sessions_active ON auth_sessions(token_hash,expires_at) WHERE revoked_at IS NULL;ALTER TABLE notifications DROP CONSTRAINT IF EXISTS ck_notification_type;ALTER TABLE notifications ADD CONSTRAINT ck_notification_type CHECK(type IN ('REQUEST_SUBMITTED','REQUEST_APPROVED','REQUEST_REJECTED','ASSET_EXPIRING','ASSET_EXPIRED','ASSET_REVOKED'))`},
{version:'002_login_protection',sql:`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_failed_login;ALTER TABLE users ADD CONSTRAINT ck_users_failed_login CHECK(failed_login_attempts>=0)`},
{version:'003_forced_password_change',sql:`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`},
{version:'004_reconciliation_status',sql:`ALTER TABLE requests DROP CONSTRAINT IF EXISTS ck_requests_status;ALTER TABLE requests ADD CONSTRAINT ck_requests_status CHECK (status IN ('PENDING','APPROVED','REJECTED','PROCESSING','COMPLETED','FAILED','CANCELLED','RECONCILIATION_REQUIRED'))`},
{version:'005_provider_operations',sql:`CREATE TABLE IF NOT EXISTS provider_operations(request_id uuid PRIMARY KEY REFERENCES requests(id) ON DELETE RESTRICT,operation_type varchar(30) NOT NULL CHECK(operation_type IN ('CREATE','RENEW','REVOKE')),status varchar(30) NOT NULL CHECK(status IN ('CLAIMED','SENT','PROVIDER_SUCCEEDED','COMPLETED','RECONCILIATION_REQUIRED')),attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),provider_reference varchar(255),last_error_code varchar(100),created_at timestamptz NOT NULL DEFAULT NOW(),updated_at timestamptz NOT NULL DEFAULT NOW());CREATE INDEX IF NOT EXISTS idx_provider_operations_status ON provider_operations(status,updated_at)`},
{version:'006_email_reconciliation',sql:`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS claimed_at timestamptz;ALTER TABLE notifications DROP CONSTRAINT IF EXISTS ck_notification_delivery;ALTER TABLE notifications ADD CONSTRAINT ck_notification_delivery CHECK(delivery_status IN ('PENDING','SENDING','SENT','FAILED','RECONCILIATION_REQUIRED'));CREATE INDEX IF NOT EXISTS idx_notifications_claimed ON notifications(claimed_at) WHERE channel='EMAIL' AND delivery_status='SENDING'`},
{version:'007_asset_history_indexes',sql:`CREATE INDEX IF NOT EXISTS idx_requests_result_asset ON requests(result_asset_id) WHERE result_asset_id IS NOT NULL;CREATE INDEX IF NOT EXISTS idx_audit_asset_entity ON audit_logs(entity_id,occurred_at DESC,id DESC) WHERE entity_type='CRYPTO_ASSET'`},
{version:'008_policy_versions_immutable',sql:`CREATE OR REPLACE FUNCTION reject_policy_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $function$ BEGIN RAISE EXCEPTION 'POLICY_VERSION_IMMUTABLE' USING ERRCODE='23514'; END; $function$;
DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='policy_versions'::regclass AND tgname='trg_policy_versions_immutable' AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_policy_versions_immutable BEFORE UPDATE OR DELETE ON policy_versions FOR EACH ROW EXECUTE FUNCTION reject_policy_version_mutation();
  END IF;
END; $migration$;`},
{version:'009_request_drafts',sql:`
ALTER TABLE requests
  ALTER COLUMN policy_version_id DROP NOT NULL,
  ALTER COLUMN submitted_at DROP NOT NULL,
  ADD COLUMN cancellation_reason text,
  DROP CONSTRAINT ck_requests_status,
  DROP CONSTRAINT ck_requests_reason,
  DROP CONSTRAINT ck_requests_target,
  ADD CONSTRAINT ck_requests_status CHECK (
    status IN ('DRAFT','PENDING','APPROVED','REJECTED','PROCESSING','COMPLETED','FAILED','CANCELLED','RECONCILIATION_REQUIRED')
  ),
  ADD CONSTRAINT ck_requests_submission CHECK (
    (submitted_at IS NULL AND status IN ('DRAFT','CANCELLED') AND result_asset_id IS NULL AND completed_at IS NULL)
    OR (submitted_at IS NOT NULL AND status <> 'DRAFT' AND policy_version_id IS NOT NULL AND BTRIM(reason) <> '')
  ),
  ADD CONSTRAINT ck_requests_target CHECK (
    (request_type = 'CREATE' AND target_asset_id IS NULL)
    OR (request_type IN ('RENEW','REVOKE') AND (target_asset_id IS NOT NULL OR submitted_at IS NULL))
  ),
  ADD CONSTRAINT ck_requests_cancellation_reason CHECK (
    cancellation_reason IS NULL OR (status = 'CANCELLED' AND char_length(BTRIM(cancellation_reason)) BETWEEN 1 AND 500)
  );
`},
{version:'010_execution_notifications',sql:`ALTER TABLE notifications DROP CONSTRAINT ck_notification_type;
ALTER TABLE notifications ADD CONSTRAINT ck_notification_type CHECK(type IN (
  'REQUEST_SUBMITTED','REQUEST_APPROVED','REQUEST_REJECTED','REQUEST_COMPLETED','REQUEST_RECONCILIATION_REQUIRED',
  'ASSET_EXPIRING','ASSET_EXPIRED','ASSET_REVOKED'
))`},
{version:'011_department_administration',sql:`ALTER TABLE departments ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE departments ADD CONSTRAINT ck_departments_version CHECK(version>0)`},
{version:'012_account_actions',sql:`
ALTER TABLE users ADD COLUMN invitation_pending boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT ck_users_pending_invitation CHECK (NOT invitation_pending OR (must_change_password AND status IN ('INACTIVE','LOCKED')));
CREATE TABLE account_actions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  purpose varchar(30) NOT NULL CHECK (purpose IN ('INVITATION','PASSWORD_RESET')),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  token_version integer NOT NULL CHECK (token_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  used_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (id,user_id,purpose)
);
CREATE INDEX idx_account_actions_pending ON account_actions(user_id,purpose) WHERE used_at IS NULL AND revoked_at IS NULL;
CREATE TABLE account_action_limits (
  bucket_key varchar(80) PRIMARY KEY,
  attempt_count integer NOT NULL CHECK (attempt_count > 0),
  expires_at timestamptz NOT NULL
);
CREATE INDEX idx_account_action_limits_expiry ON account_action_limits(expires_at);
ALTER TABLE notifications ADD COLUMN account_action_id uuid,
  ADD CONSTRAINT fk_notifications_account_action FOREIGN KEY (account_action_id,recipient_id,type)
    REFERENCES account_actions(id,user_id,purpose) ON DELETE RESTRICT,
  DROP CONSTRAINT ck_notification_type,
  DROP CONSTRAINT ck_notification_subject,
  ADD CONSTRAINT ck_notification_type CHECK (type IN (
    'REQUEST_SUBMITTED','REQUEST_APPROVED','REQUEST_REJECTED','REQUEST_COMPLETED','REQUEST_RECONCILIATION_REQUIRED',
    'ASSET_EXPIRING','ASSET_EXPIRED','ASSET_REVOKED','INVITATION','PASSWORD_RESET','PASSWORD_RESET_COMPLETED'
  )),
  ADD CONSTRAINT ck_notification_subject CHECK (
    (type IN ('INVITATION','PASSWORD_RESET') AND channel='EMAIL' AND account_action_id IS NOT NULL AND request_id IS NULL AND asset_id IS NULL)
    OR (type='PASSWORD_RESET_COMPLETED' AND channel='EMAIL' AND account_action_id IS NULL AND request_id IS NULL AND asset_id IS NULL)
    OR (type NOT IN ('INVITATION','PASSWORD_RESET','PASSWORD_RESET_COMPLETED') AND account_action_id IS NULL AND (asset_id IS NOT NULL OR request_id IS NOT NULL))
  );
CREATE UNIQUE INDEX uq_notifications_account_action ON notifications(account_action_id) WHERE account_action_id IS NOT NULL;
`},
{version:'013_provider_recovery',sql:`
ALTER TABLE provider_operations
  ADD COLUMN claim_version integer CHECK (claim_version > 0),
  ADD COLUMN retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 3),
  ADD COLUMN retry_after timestamptz,
  ADD COLUMN failure_class varchar(30) CHECK (failure_class IN ('UNSENT_TRANSIENT','UNSENT_PERMANENT','OUTCOME_UNKNOWN','RESULT_RECORDED')),
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN receipt_at timestamptz,
  ADD COLUMN input_digest char(64) CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  ADD COLUMN receipt jsonb CHECK (jsonb_typeof(receipt)='object'),
  ADD CONSTRAINT ck_provider_retry_state CHECK (retry_after IS NULL OR
    (status='CLAIMED' AND attempt_count=0 AND provider_reference IS NULL AND claim_version IS NOT NULL)),
  DROP CONSTRAINT provider_operations_status_check,
  ADD CONSTRAINT provider_operations_status_check CHECK (status IN (
    'CLAIMED','SENT','PROVIDER_SUCCEEDED','COMPLETED','RECONCILIATION_REQUIRED','FAILED'
  ));
ALTER TABLE notifications DROP CONSTRAINT ck_notification_type;
ALTER TABLE notifications ADD CONSTRAINT ck_notification_type CHECK (type IN (
  'REQUEST_SUBMITTED','REQUEST_APPROVED','REQUEST_REJECTED','REQUEST_COMPLETED','REQUEST_RECONCILIATION_REQUIRED','REQUEST_FAILED',
  'ASSET_EXPIRING','ASSET_EXPIRED','ASSET_REVOKED','INVITATION','PASSWORD_RESET','PASSWORD_RESET_COMPLETED'
));
`},
{version:'014_asset_provider_scope',sql:`
ALTER TABLE crypto_assets ADD COLUMN provider_scope varchar(64)
  CHECK (provider_scope='MOCK' OR provider_scope ~ '^[a-f0-9]{64}$');
UPDATE crypto_assets a SET provider_scope='MOCK'
WHERE a.provider_reference IS NOT NULL AND EXISTS (
  SELECT 1 FROM audit_logs l WHERE l.entity_type='CRYPTO_ASSET' AND l.entity_id=a.id::text
    AND l.actor_type='SYSTEM' AND l.outcome='SUCCESS' AND l.action IN ('ASSET_CREATED','ASSET_RENEWED')
    AND l.metadata->>'provider'='MOCK'
);
UPDATE crypto_assets a SET provider_scope='MOCK' FROM (VALUES
  ('a1111111-1111-1111-1111-111111111111'::uuid,'mock-key-dev-001'),
  ('a1111112-1111-1111-1111-111111111111'::uuid,'mock-key-dev-old'),
  ('a1111113-1111-1111-1111-111111111111'::uuid,'mock-key-dev-new'),
  ('a1111114-1111-1111-1111-111111111111'::uuid,'mock-key-dev-revoked'),
  ('a2222221-2222-2222-2222-222222222221'::uuid,'mock-cert-fin-expired'),
  ('a2222222-2222-2222-2222-222222222222'::uuid,'mock-cert-fin-soon'),
  ('a2222223-2222-2222-2222-222222222222'::uuid,'mock-cert-fin-active')
) seed(id,reference) WHERE a.id=seed.id AND a.provider_reference=seed.reference;
`},
{version:'015_demo_asset_provider_scope',sql:`
UPDATE crypto_assets a SET provider_scope='MOCK' FROM (VALUES
  ('a1111112-1111-1111-1111-111111111112'::uuid,'mock-key-dev-old'),
  ('a1111113-1111-1111-1111-111111111113'::uuid,'mock-key-dev-new'),
  ('a1111114-1111-1111-1111-111111111114'::uuid,'mock-key-dev-revoked')
) seed(id,reference) WHERE a.id=seed.id AND a.provider_reference=seed.reference AND a.provider_scope IS NULL;
`},
{version:'016_demo_certificate_provider_scope',sql:`
UPDATE crypto_assets SET provider_scope='MOCK'
WHERE id='a2222223-2222-2222-2222-222222222223'::uuid
  AND asset_code='CRT-FIN-ACTIVE' AND asset_type='CERTIFICATE'
  AND provider_reference='mock-cert-fin-active' AND provider_scope IS NULL;
`},
{version:'017_audit_search_trigram',sql:`
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
DO $$
DECLARE
  extension_schema name;
  previous_lock_timeout text := current_setting('lock_timeout');
BEGIN
  SELECT n.nspname INTO STRICT extension_schema
  FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace
  WHERE e.extname='pg_trgm';

  PERFORM set_config('lock_timeout', '5s', true);
  EXECUTE format('CREATE INDEX idx_audit_text_trgm ON public.audit_logs USING gin (action %1$I.gin_trgm_ops, entity_id %1$I.gin_trgm_ops)', extension_schema);
  PERFORM set_config('lock_timeout', previous_lock_timeout, true);
END $$;
`},
{version:'018_key_asset_identity',sql:`
CREATE OR REPLACE FUNCTION public.reject_key_asset_reassignment() RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  RAISE EXCEPTION 'KEY_ASSET_LINK_IMMUTABLE' USING ERRCODE='23514';
END;
$function$;
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
      WHERE tgrelid='public.cryptographic_keys'::regclass AND tgname='trg_key_asset_identity' AND NOT tgisinternal) THEN
    CREATE TRIGGER trg_key_asset_identity BEFORE UPDATE OF asset_id ON public.cryptographic_keys
      FOR EACH ROW WHEN (OLD.asset_id IS DISTINCT FROM NEW.asset_id)
      EXECUTE FUNCTION public.reject_key_asset_reassignment();
  END IF;
END;
$migration$;
`},
{version:'019_auth_mfa',sql:`
ALTER TABLE public.auth_sessions ADD COLUMN mfa_token_version INTEGER CHECK (mfa_token_version>0);

CREATE TABLE public.auth_mfa (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  credential_id UUID UNIQUE,
  sealed_secret TEXT,
  last_step BIGINT,
  recovery_hashes TEXT[] NOT NULL DEFAULT '{}',
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  CONSTRAINT ck_mfa_factor CHECK (
    (credential_id IS NULL AND sealed_secret IS NULL AND last_step IS NULL AND cardinality(recovery_hashes)=0) OR
    (credential_id IS NOT NULL AND sealed_secret IS NOT NULL AND last_step IS NOT NULL AND last_step>=0)
  ),
  CONSTRAINT ck_mfa_recovery_size CHECK (cardinality(recovery_hashes)<=10 AND array_position(recovery_hashes,NULL) IS NULL),
  CONSTRAINT ck_mfa_failed_attempts CHECK (failed_attempts BETWEEN 0 AND 5)
);

CREATE TABLE public.auth_mfa_challenges (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  token_version INTEGER NOT NULL CHECK (token_version>0),
  purpose TEXT NOT NULL CHECK (purpose IN ('VERIFY','ENROLL','RECOVER','REPLACE')),
  expires_at TIMESTAMPTZ NOT NULL,
  pending_id UUID UNIQUE,
  pending_secret TEXT,
  pending_step BIGINT,
  pending_hashes TEXT[],
  CONSTRAINT ck_mfa_challenge_pending CHECK ((pending_id IS NULL)=(pending_secret IS NULL)),
  CONSTRAINT ck_mfa_challenge_verified CHECK (
    (pending_step IS NULL AND pending_hashes IS NULL) OR
    (pending_id IS NOT NULL AND pending_step IS NOT NULL AND pending_step>=0 AND
      pending_hashes IS NOT NULL AND cardinality(pending_hashes)=10 AND array_position(pending_hashes,NULL) IS NULL)
  ),
  CONSTRAINT ck_mfa_verify_has_no_pending CHECK (purpose<>'VERIFY' OR pending_id IS NULL)
);
ALTER TABLE public.notifications DROP CONSTRAINT ck_notification_type;
ALTER TABLE public.notifications ADD CONSTRAINT ck_notification_type CHECK (type IN (
  'REQUEST_SUBMITTED','REQUEST_APPROVED','REQUEST_REJECTED','REQUEST_COMPLETED','REQUEST_RECONCILIATION_REQUIRED','REQUEST_FAILED',
  'ASSET_EXPIRING','ASSET_EXPIRED','ASSET_REVOKED','INVITATION','PASSWORD_RESET','PASSWORD_RESET_COMPLETED',
  'MFA_SECURITY_CHANGED'
));
`},
{version:'020_two_stage_approval',sql:`
ALTER TABLE public.policy_versions ADD CONSTRAINT ck_policy_approval_configuration CHECK (
  CASE WHEN configuration->'approval_levels'='2'::jsonb THEN
    COALESCE(jsonb_typeof(configuration->'approval_deadline_hours')='number'
      AND configuration->>'approval_deadline_hours' ~ '^[1-9][0-9]{0,2}$'
      AND (configuration->>'approval_deadline_hours')::numeric BETWEEN 1 AND 168,FALSE)
  ELSE (NOT configuration ? 'approval_levels' OR configuration->'approval_levels'='1'::jsonb)
    AND NOT configuration ? 'approval_deadline_hours' END
);

ALTER TABLE public.request_decisions
  ADD COLUMN approval_level SMALLINT NOT NULL DEFAULT 1 CHECK (approval_level IN (1,2)),
  DROP CONSTRAINT uq_request_final_decision,
  ADD CONSTRAINT uq_request_decision_level UNIQUE (request_id,approval_level),
  ADD CONSTRAINT uq_request_decision_actor UNIQUE (request_id,approver_id);

CREATE OR REPLACE FUNCTION public.enforce_request_decision_rules() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $function$
DECLARE
  v_request public.requests%ROWTYPE;
  v_policy JSONB;
BEGIN
  SELECT * INTO v_request FROM public.requests WHERE id=NEW.request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF NEW.approver_id=v_request.creator_id THEN RAISE EXCEPTION 'SOD_VIOLATION'; END IF;
  IF v_request.status<>'PENDING' OR v_request.submitted_at IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST_STATE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=NEW.approver_id AND status='ACTIVE') THEN
    RAISE EXCEPTION 'APPROVER_INACTIVE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
      WHERE ur.user_id=NEW.approver_id AND r.code='APPROVER') THEN RAISE EXCEPTION 'APPROVER_ROLE_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.approver_scopes WHERE user_id=NEW.approver_id AND department_id=v_request.department_id) THEN
    RAISE EXCEPTION 'APPROVER_OUT_OF_SCOPE';
  END IF;
  SELECT configuration INTO v_policy FROM public.policy_versions WHERE id=v_request.policy_version_id;
  IF v_policy->'approval_levels'='2'::jsonb THEN
    IF clock_timestamp()>=v_request.submitted_at+make_interval(hours=>(v_policy->>'approval_deadline_hours')::int) THEN
      RAISE EXCEPTION 'APPROVAL_DEADLINE_EXPIRED' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.approval_level<>1 THEN
    RAISE EXCEPTION 'APPROVAL_LEVEL_NOT_REQUIRED' USING ERRCODE='23514';
  END IF;
  IF NEW.approval_level=2 AND NOT EXISTS (SELECT 1 FROM public.request_decisions
      WHERE request_id=NEW.request_id AND approval_level=1 AND decision='APPROVED') THEN
    RAISE EXCEPTION 'FIRST_APPROVAL_REQUIRED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.enforce_sensitive_request_approval() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $function$
DECLARE
  v_two_stage BOOLEAN;
BEGIN
  IF TG_OP='UPDATE' AND OLD.submitted_at IS NOT NULL AND (
      NEW.policy_version_id IS DISTINCT FROM OLD.policy_version_id OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR
      NEW.department_id IS DISTINCT FROM OLD.department_id) AND
      EXISTS (SELECT 1 FROM public.policy_versions WHERE id IN (NEW.policy_version_id,OLD.policy_version_id)
        AND configuration->'approval_levels'='2'::jsonb) THEN
    RAISE EXCEPTION 'SUBMITTED_APPROVAL_POLICY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  SELECT configuration->'approval_levels'='2'::jsonb INTO v_two_stage FROM public.policy_versions WHERE id=NEW.policy_version_id;
  IF v_two_stage AND NEW.status IN ('APPROVED','PROCESSING','COMPLETED','FAILED','RECONCILIATION_REQUIRED') AND
      (SELECT count(*) FROM public.request_decisions WHERE request_id=NEW.id AND decision='APPROVED')<>2 THEN
    RAISE EXCEPTION 'TWO_APPROVALS_REQUIRED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_sensitive_request_approval BEFORE INSERT OR UPDATE OF status,policy_version_id,submitted_at,department_id
  ON public.requests FOR EACH ROW EXECUTE FUNCTION public.enforce_sensitive_request_approval();

ALTER TABLE public.notifications DROP CONSTRAINT ck_notification_type;
ALTER TABLE public.notifications ADD CONSTRAINT ck_notification_type CHECK (type IN (
  'REQUEST_SUBMITTED','REQUEST_APPROVED','REQUEST_REJECTED','REQUEST_COMPLETED','REQUEST_RECONCILIATION_REQUIRED','REQUEST_FAILED',
  'ASSET_EXPIRING','ASSET_EXPIRED','ASSET_REVOKED','INVITATION','PASSWORD_RESET','PASSWORD_RESET_COMPLETED',
  'MFA_SECURITY_CHANGED','REQUEST_SECOND_APPROVAL'
));
`},
{version:'021_auth_oidc',sql:`
CREATE TABLE auth_oidc_links (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  issuer varchar(2048) NOT NULL,
  subject varchar(255) NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  UNIQUE (issuer,subject)
);
CREATE TABLE auth_oidc_flows (
  ticket_hash char(64) PRIMARY KEY,
  browser_hash char(64) NOT NULL,
  phase text NOT NULL CHECK (phase IN ('AUTHORIZE','HANDOFF')),
  sealed_payload text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX idx_auth_oidc_flows_expiry ON auth_oidc_flows(expires_at);
CREATE TABLE auth_oidc_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth_oidc_links(user_id) ON DELETE RESTRICT,
  issuer varchar(2048) NOT NULL,
  subject varchar(255) NOT NULL,
  sid varchar(255) NOT NULL,
  sealed_tokens text,
  access_expires_at timestamptz NOT NULL,
  authenticated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '12 hours'),
  revoked_at timestamptz,
  UNIQUE (id,user_id)
);
CREATE INDEX idx_auth_oidc_sessions_user ON auth_oidc_sessions(user_id);
CREATE INDEX idx_auth_oidc_sessions_sid ON auth_oidc_sessions(issuer,sid);
CREATE TABLE auth_oidc_revocations (
  issuer varchar(2048) NOT NULL,
  sid varchar(255) NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (issuer,sid)
);
ALTER TABLE auth_sessions ADD COLUMN oidc_session_id uuid,
  ADD FOREIGN KEY (oidc_session_id,user_id) REFERENCES auth_oidc_sessions(id,user_id) ON DELETE RESTRICT;
ALTER TABLE auth_mfa_challenges ADD COLUMN oidc_session_id uuid,
  ADD FOREIGN KEY (oidc_session_id,user_id) REFERENCES auth_oidc_sessions(id,user_id) ON DELETE RESTRICT;
`},
{version:'022_report_exports',sql:`
CREATE TABLE report_exports (
  id uuid PRIMARY KEY,
  request_key uuid NOT NULL,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_version integer NOT NULL CHECK (token_version > 0),
  dataset text NOT NULL CHECK (dataset IN ('ASSETS','REQUESTS','AUDIT')),
  format text NOT NULL CHECK (format IN ('CSV','PDF')),
  filters jsonb NOT NULL CHECK (jsonb_typeof(filters)='object'),
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope)='object'),
  state text NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED','RUNNING','READY','FAILED','CANCELLED','EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  expires_at timestamptz,
  lease_until timestamptz,
  claim_token uuid,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  row_count integer CHECK (row_count BETWEEN 1 AND 10000),
  failure_code text,
  content bytea CHECK (octet_length(content) <= 8388608),
  UNIQUE (requester_id,request_key),
  CHECK ((state='RUNNING') = (claim_token IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK ((state='READY') = (content IS NOT NULL)),
  CHECK (state<>'READY' OR (expires_at IS NOT NULL AND row_count IS NOT NULL))
);
CREATE INDEX idx_report_exports_owner ON report_exports(requester_id,created_at DESC);
CREATE INDEX idx_report_exports_queue ON report_exports(created_at,id) WHERE state IN ('QUEUED','RUNNING');
CREATE INDEX idx_report_exports_file_expiry ON report_exports(expires_at) WHERE state='READY';
CREATE INDEX idx_report_exports_retention ON report_exports(finished_at) WHERE finished_at IS NOT NULL;
`},
{version:'023_audit_anchor_source',sql:`
CREATE VIEW public.audit_anchor_rows AS
SELECT id, jsonb_build_array(
  id::text, actor_id::text, actor_type, action, entity_type, entity_id, outcome, request_id::text,
  ip_address::text, metadata, extract(epoch FROM occurred_at)::text
)::text AS canonical
FROM public.audit_logs;
REVOKE ALL ON public.audit_anchor_rows FROM PUBLIC;

CREATE FUNCTION public.capture_audit_anchor_rows(p_after bigint, p_limit integer)
RETURNS TABLE(id bigint, canonical text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $anchor$
BEGIN
  IF p_after IS NULL OR p_after<0 OR p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN
    RAISE EXCEPTION 'AUDIT_ANCHOR_RANGE_INVALID' USING ERRCODE='22023';
  END IF;
  LOCK TABLE public.audit_logs IN SHARE MODE;
  IF EXISTS (SELECT 1 FROM public.audit_logs a WHERE a.id<=0) THEN
    RAISE EXCEPTION 'AUDIT_ANCHOR_ID_INVALID' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT a.id,a.canonical FROM public.audit_anchor_rows a
    WHERE a.id>p_after ORDER BY a.id LIMIT p_limit;
END;
$anchor$;
REVOKE ALL ON FUNCTION public.capture_audit_anchor_rows(bigint,integer) FROM PUBLIC;
`},
{version:'024_asset_expiry_page_index',sql:`
DO $$
DECLARE previous_lock_timeout text := current_setting('lock_timeout');
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  CREATE INDEX idx_assets_expiry_page ON public.crypto_assets (expires_at, id);
  PERFORM set_config('lock_timeout', previous_lock_timeout, true);
END $$;
`},
{version:'025_expiry_scan_status',sql:`
CREATE TABLE public.expiry_scan_status (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  initialized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_failed boolean NOT NULL DEFAULT false
);
INSERT INTO public.expiry_scan_status DEFAULT VALUES;
`}
];

export async function assertMigrationLedger(client: PoolClient) {
  const rows = await client.query<{ version: string; checksum: string | null }>('SELECT version,checksum FROM public.schema_migrations');
  const known = new Set(migrations.map(migration => migration.version));
  for (const row of rows.rows) {
    if (!known.has(row.version)) throw new Error(`UNKNOWN_DATABASE_MIGRATION:${row.version}`);
  }
  const existing = new Map(rows.rows.map(row => [row.version, row.checksum]));
  for (const migration of migrations) {
    if (!existing.has(migration.version)) throw new Error(`DATABASE_MIGRATION_PENDING:${migration.version}`);
    const recorded = existing.get(migration.version);
    if (typeof recorded !== 'string' || !/^[a-f0-9]{64}$/.test(recorded.trim())) {
      throw new Error(`DATABASE_MIGRATION_CHECKSUM_REQUIRED:${migration.version}`);
    }
    if (recorded.trim() !== createHash('sha256').update(migration.sql).digest('hex')) {
      throw new Error(`DATABASE_MIGRATION_CHANGED:${migration.version}`);
    }
  }
}

@Injectable()
export class MigrationService implements OnModuleInit {
  private readonly logger = new Logger(MigrationService.name);
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onModuleInit() {
    const mode = process.env.DATABASE_MIGRATION_MODE ?? 'validate';
    if (mode === 'validate') return this.validateApplied();
    if (mode === 'apply') return this.applyPending();
    throw new Error('INVALID_DATABASE_MIGRATION_MODE');
  }

  async validateApplied() {
    const production = process.env.CRYPTA_DEPLOYMENT_MODE === 'production';
    const client = await this.pool.connect().catch(error => {
      if (!production) throw error;
      throw new Error('PRODUCTION_DATABASE_CONNECTION_FAILED');
    });
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if (production) await assertProductionRuntime(client);
      await assertMigrationLedger(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && typeof error === 'object' && 'code' in error && ['42P01','42703'].includes(String(error.code))) {
        throw new Error('DATABASE_MIGRATIONS_REQUIRED');
      }
      throw error;
    } finally { client.release(); }
  }

  async applyPending(initialize?: (client: PoolClient) => Promise<void>) {
    const client = await this.pool.connect();
    const applied: string[] = [];
    try {
      if (initialize) await initialize(client);
      await client.query('BEGIN');
      // Serialize every app instance before checking or changing the migration ledger.
      await client.query('SELECT pg_advisory_xact_lock(17232,2)');
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations(version varchar(100) PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT NOW())`);
      await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum char(64)');
      const rows = await client.query<{ version: string; checksum: string | null }>('SELECT version,checksum FROM schema_migrations');
      const known = new Set(migrations.map((migration) => migration.version));
      for (const row of rows.rows) {
        if (!known.has(row.version)) throw new Error(`UNKNOWN_DATABASE_MIGRATION:${row.version}`);
      }
      const existing = new Map(rows.rows.map((row) => [row.version, row.checksum]));
      for (const migration of migrations) {
        const checksum = createHash('sha256').update(migration.sql).digest('hex');
        if (existing.has(migration.version)) {
          const recorded = existing.get(migration.version);
          if (recorded && recorded.trim() !== checksum) throw new Error(`DATABASE_MIGRATION_CHANGED:${migration.version}`);
          // Older installations have no checksum yet. Record the code version now in use.
          if (!recorded) await client.query('UPDATE schema_migrations SET checksum=$2 WHERE version=$1', [migration.version, checksum]);
          continue;
        }
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)', [migration.version, checksum]);
        applied.push(migration.version);
      }
      await client.query('COMMIT');
      for (const version of applied) this.logger.log(`Applied migration ${version}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
