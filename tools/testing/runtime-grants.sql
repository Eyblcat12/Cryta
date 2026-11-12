-- Operator template; run only after review/provisioning of a separate, non-owner runtime role.
-- psql -v database=<database> -v runtime_role=<role> -f tools/testing/runtime-grants.sql
-- Test runner substitutes only validated generated identifiers inside its newly allocated DB.
BEGIN;
SET LOCAL search_path = pg_catalog, public;
SELECT set_config('crypta.grants_database', :'database', true),set_config('crypta.grants_runtime_role', :'runtime_role', true);
DO $guard$
DECLARE target pg_roles%ROWTYPE;
BEGIN
  IF current_database() <> current_setting('crypta.grants_database') THEN
    RAISE EXCEPTION 'DATABASE_SCOPE_MISMATCH' USING ERRCODE='22023';
  END IF;
  SELECT * INTO target FROM pg_roles WHERE rolname=current_setting('crypta.grants_runtime_role');
  IF NOT FOUND THEN RAISE EXCEPTION 'RUNTIME_ROLE_MISSING' USING ERRCODE='22023'; END IF;
  IF NOT target.rolcanlogin OR target.rolsuper OR target.rolcreatedb OR target.rolcreaterole
    OR target.rolreplication OR target.rolbypassrls OR target.rolinherit
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=target.oid)
    OR EXISTS(SELECT 1 FROM pg_class WHERE relowner=target.oid)
    OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner=target.oid)
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=target.oid)
    OR EXISTS(SELECT 1 FROM pg_database WHERE datdba=target.oid) THEN
    RAISE EXCEPTION 'UNSAFE_RUNTIME_ROLE' USING ERRCODE='22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
      LATERAL aclexplode(COALESCE(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) acl
    WHERE n.nspname='public' AND c.relname IN ('departments','roles','policies','users','user_roles',
      'approver_scopes','auth_sessions','policy_versions','crypto_assets','cryptographic_keys','certificates',
      'requests','request_decisions','provider_operations','audit_logs','notifications','account_actions','account_action_limits',
      'auth_mfa','auth_mfa_challenges','auth_oidc_links','auth_oidc_flows','auth_oidc_sessions','auth_oidc_revocations',
      'report_exports','expiry_scan_status','email_worker_status','schema_migrations','audit_logs_id_seq')
      AND acl.grantee=0
  ) OR EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace,
      LATERAL aclexplode(a.attacl) acl
    WHERE n.nspname='public' AND c.relname IN ('departments','roles','policies','users','user_roles',
      'approver_scopes','auth_sessions','policy_versions','crypto_assets','cryptographic_keys','certificates',
      'requests','request_decisions','provider_operations','audit_logs','notifications','account_actions','account_action_limits',
      'auth_mfa','auth_mfa_challenges','auth_oidc_links','auth_oidc_flows','auth_oidc_sessions','auth_oidc_revocations',
      'report_exports','expiry_scan_status','email_worker_status','schema_migrations') AND acl.grantee=0
  ) OR EXISTS (
    SELECT 1 FROM pg_database d,LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) acl
    WHERE d.datname=current_database() AND acl.grantee=0 AND acl.privilege_type='CREATE'
  ) THEN
    RAISE EXCEPTION 'UNSAFE_PUBLIC_GRANTS' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.cryptographic_keys')
      AND tgname='trg_key_asset_identity' AND NOT tgisinternal AND tgenabled IN ('O','A')
      AND tgfoid=to_regprocedure('public.reject_key_asset_reassignment()')
  ) THEN
    RAISE EXCEPTION 'KEY_IDENTITY_GUARD_REQUIRED' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.requests')
      AND tgname='trg_sensitive_request_approval' AND NOT tgisinternal AND tgenabled IN ('O','A')
      AND tgfoid=to_regprocedure('public.enforce_sensitive_request_approval()')
  ) THEN
    RAISE EXCEPTION 'SENSITIVE_APPROVAL_GUARD_REQUIRED' USING ERRCODE='22023';
  END IF;
END;
$guard$;
-- Reset direct ACLs, including column ACLs left intact by table-level REVOKE.
-- The PUBLIC guards above reject inherited table/sequence rights before any reset.
REVOKE ALL ON DATABASE :"database" FROM :"runtime_role";
REVOKE ALL ON SCHEMA public FROM :"runtime_role";
REVOKE ALL ON departments,roles,policies,users,user_roles,approver_scopes,auth_sessions,
  policy_versions,crypto_assets,cryptographic_keys,certificates,requests,request_decisions,
  provider_operations,audit_logs,notifications,account_actions,account_action_limits,auth_mfa,auth_mfa_challenges,
  auth_oidc_links,auth_oidc_flows,auth_oidc_sessions,auth_oidc_revocations,report_exports,expiry_scan_status,email_worker_status,schema_migrations FROM :"runtime_role";
REVOKE ALL ON SEQUENCE audit_logs_id_seq FROM :"runtime_role";
-- A restore without ACLs gives new functions their default PUBLIC EXECUTE.
REVOKE ALL ON public.audit_anchor_rows FROM PUBLIC, :"runtime_role";
REVOKE ALL ON FUNCTION public.capture_audit_anchor_rows(bigint,integer) FROM PUBLIC, :"runtime_role";
DO $columns$
DECLARE column_acl RECORD;
BEGIN
  FOR column_acl IN
    SELECT c.relname,a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('departments','roles','policies','users','user_roles',
      'approver_scopes','auth_sessions','policy_versions','crypto_assets','cryptographic_keys','certificates',
      'requests','request_decisions','provider_operations','audit_logs','notifications','account_actions','account_action_limits',
      'auth_mfa','auth_mfa_challenges','auth_oidc_links','auth_oidc_flows','auth_oidc_sessions','auth_oidc_revocations',
      'report_exports','expiry_scan_status','email_worker_status','schema_migrations')
      AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
  LOOP
    EXECUTE format('REVOKE ALL (%I) ON TABLE public.%I FROM %I',column_acl.attname,column_acl.relname,current_setting('crypta.grants_runtime_role'));
  END LOOP;
END;
$columns$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE :"database" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database" TO :"runtime_role";
GRANT USAGE ON SCHEMA public TO :"runtime_role";
GRANT SELECT ON departments,roles,policies,users,user_roles,approver_scopes,auth_sessions,
  policy_versions,crypto_assets,cryptographic_keys,certificates,requests,request_decisions,
  provider_operations,audit_logs,notifications,account_actions,account_action_limits,auth_mfa,auth_mfa_challenges,
  auth_oidc_links,auth_oidc_flows,auth_oidc_sessions,auth_oidc_revocations,report_exports,expiry_scan_status,email_worker_status,schema_migrations TO :"runtime_role";
GRANT INSERT ON departments,users,user_roles,approver_scopes,auth_sessions,policy_versions,crypto_assets,
  cryptographic_keys,certificates,requests,request_decisions,provider_operations,audit_logs,notifications,account_actions,account_action_limits TO :"runtime_role";
GRANT INSERT(code,name) ON policies TO :"runtime_role";
GRANT DELETE ON user_roles,approver_scopes,account_action_limits TO :"runtime_role";
GRANT INSERT ON auth_mfa,auth_mfa_challenges TO :"runtime_role";
GRANT DELETE ON auth_mfa_challenges TO :"runtime_role";
GRANT UPDATE(credential_id,sealed_secret,last_step,recovery_hashes,failed_attempts,locked_until) ON auth_mfa TO :"runtime_role";
GRANT UPDATE(token_hash,token_version,purpose,expires_at,pending_id,pending_secret,pending_step,pending_hashes,oidc_session_id) ON auth_mfa_challenges TO :"runtime_role";
GRANT INSERT ON auth_oidc_flows,auth_oidc_sessions,auth_oidc_revocations TO :"runtime_role";
GRANT DELETE ON auth_oidc_flows TO :"runtime_role";
GRANT UPDATE (expires_at) ON auth_oidc_flows TO :"runtime_role";
GRANT UPDATE (sealed_tokens,access_expires_at,revoked_at) ON auth_oidc_sessions TO :"runtime_role";
GRANT INSERT,DELETE ON report_exports TO :"runtime_role";
GRANT UPDATE (state,finished_at,expires_at,lease_until,claim_token,attempts,row_count,failure_code,content) ON report_exports TO :"runtime_role";
GRANT UPDATE(password_hash,must_change_password,token_version,failed_login_attempts,locked_until,last_login_at,status,department_id,invitation_pending) ON users TO :"runtime_role";
GRANT UPDATE(code,name,is_active,version) ON departments TO :"runtime_role";
GRANT UPDATE(used_at,revoked_at) ON account_actions TO :"runtime_role";
GRANT UPDATE(attempt_count,expires_at) ON account_action_limits TO :"runtime_role";
GRANT UPDATE(revoked_at,last_used_at,replaced_by) ON auth_sessions TO :"runtime_role";
GRANT UPDATE(status,version) ON crypto_assets TO :"runtime_role";
GRANT UPDATE(status,version,updated_at,result_asset_id,completed_at,request_type,policy_version_id,target_asset_id,
  reason,emergency,requested_parameters,submitted_at,department_id,cancellation_reason) ON requests TO :"runtime_role";
GRANT UPDATE(status,attempt_count,provider_reference,last_error_code,updated_at,claim_version,retry_count,
  retry_after,failure_class,sent_at,receipt_at,input_digest,receipt) ON provider_operations TO :"runtime_role";
GRANT UPDATE(read_at,delivery_status,attempt_count,claimed_at,failed_at,scheduled_for,error_message,sent_at) ON notifications TO :"runtime_role";
GRANT UPDATE(last_attempt_at,last_success_at,last_failed) ON expiry_scan_status TO :"runtime_role";
GRANT UPDATE(last_poll_at,last_poll_succeeded) ON email_worker_status TO :"runtime_role";
-- PostgreSQL row locks require UPDATE privilege on a column, even without a data UPDATE.
-- Key identity changes are blocked by migration 018 while SELECT FOR SHARE can lock metadata.
GRANT UPDATE(is_active) ON policies TO :"runtime_role";
GRANT UPDATE(asset_id) ON cryptographic_keys TO :"runtime_role";
GRANT USAGE ON SEQUENCE audit_logs_id_seq TO :"runtime_role";
COMMIT;
