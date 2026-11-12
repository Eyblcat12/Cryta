-- Run with the operator role, which owns the link and revocation tables.
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('crypta:oidc-links:v1'));
SELECT set_config('crypta.oidc_action', :'oidc_action', true) AS action,
       set_config('crypta.oidc_user_id', :'oidc_user_id', true) AS account,
       set_config('crypta.oidc_issuer', :'oidc_issuer', true) AS issuer,
       set_config('crypta.oidc_subject', :'oidc_subject', true) AS subject,
       set_config('crypta.oidc_reason', :'oidc_reason', true) AS reason
\gset
DO $operator$
DECLARE
  operation text := current_setting('crypta.oidc_action');
  account_id uuid := current_setting('crypta.oidc_user_id')::uuid;
  identity_issuer text := current_setting('crypta.oidc_issuer');
  identity_subject text := current_setting('crypta.oidc_subject');
  reason text := btrim(current_setting('crypta.oidc_reason'));
  account users%ROWTYPE;
BEGIN
  IF operation NOT IN ('link','revoke') OR length(identity_issuer) NOT BETWEEN 1 AND 1024
    OR length(identity_subject) NOT BETWEEN 1 AND 255 OR identity_subject ~ '[[:cntrl:]]'
    OR length(reason) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'OIDC_LINK_INPUT_INVALID';
  END IF;
  SELECT * INTO STRICT account FROM users WHERE id=account_id FOR UPDATE;

  IF operation='link' THEN
    IF account.status<>'ACTIVE' OR account.must_change_password OR account.invitation_pending
      OR NOT EXISTS (SELECT 1 FROM departments WHERE id=account.department_id AND is_active) THEN
      RAISE EXCEPTION 'OIDC_LINK_ACCOUNT_NOT_READY';
    END IF;
    IF EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=account_id AND r.code='ADMIN')
      AND NOT EXISTS (
        SELECT 1 FROM users u JOIN departments d ON d.id=u.department_id
        JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
        JOIN auth_mfa m ON m.user_id=u.id AND m.credential_id IS NOT NULL
        WHERE u.id<>account_id AND u.status='ACTIVE' AND NOT u.must_change_password AND d.is_active AND r.code='ADMIN'
          AND NOT EXISTS (SELECT 1 FROM auth_oidc_links l WHERE l.user_id=u.id)
      ) THEN
      RAISE EXCEPTION 'OIDC_LOCAL_EMERGENCY_ADMIN_REQUIRED';
    END IF;
    INSERT INTO auth_oidc_links (user_id,issuer,subject) VALUES (account_id,identity_issuer,identity_subject)
    ON CONFLICT (user_id) DO UPDATE SET linked_at=clock_timestamp(),revoked_at=NULL
      WHERE auth_oidc_links.issuer=excluded.issuer AND auth_oidc_links.subject=excluded.subject
        AND auth_oidc_links.revoked_at IS NOT NULL;
  ELSE
    UPDATE auth_oidc_links SET revoked_at=clock_timestamp()
    WHERE user_id=account_id AND issuer=identity_issuer AND subject=identity_subject AND revoked_at IS NULL;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'OIDC_LINK_UNCHANGED_OR_MISMATCHED'; END IF;

  UPDATE users SET token_version=token_version+1 WHERE id=account_id;
  UPDATE auth_oidc_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),sealed_tokens=NULL WHERE user_id=account_id;
  UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE user_id=account_id;
  DELETE FROM auth_mfa_challenges WHERE user_id=account_id;
  UPDATE account_actions SET revoked_at=clock_timestamp()
    WHERE user_id=account_id AND revoked_at IS NULL AND used_at IS NULL;
  INSERT INTO audit_logs (actor_type,action,entity_type,entity_id,outcome,metadata)
    VALUES ('SYSTEM',CASE WHEN operation='link' THEN 'OIDC_ACCOUNT_LINKED' ELSE 'OIDC_ACCOUNT_UNLINKED' END,
      'USER',account_id::text,'SUCCESS',jsonb_build_object('databaseOperator',session_user,'reason',reason));
END;
$operator$;
COMMIT;
