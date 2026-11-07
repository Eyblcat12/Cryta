BEGIN;
SET LOCAL statement_timeout = '90s';
DO $$
BEGIN
  IF current_database() <> 'crypta_t30_test' OR current_user <> 'crypta_t30_test' THEN
    RAISE EXCEPTION 'Capacity fixture requires its isolated database';
  END IF;
END $$;

INSERT INTO users (id, department_id, email, password_hash, display_name)
SELECT md5('t50-user-' || n)::uuid,
       CASE WHEN n <= 2000 THEN 'd1111111-1111-1111-1111-111111111111'::uuid
            ELSE 'd2222222-2222-2222-2222-222222222222'::uuid END,
       'capacity-' || n || '@example.test', 'fixture-no-login', 'Capacity User ' || n
FROM generate_series(1, 4000) n;

WITH inserted AS (
  INSERT INTO crypto_assets (id, asset_code, asset_type, owner_id, department_id, policy_version_id,
      purpose, status, valid_from, expires_at, provider_scope, provider_reference, created_at)
  SELECT md5('t50-asset-' || n)::uuid, 'T50-ASSET-' || lpad(n::text, 6, '0'), 'KEY',
         CASE WHEN n <= 8000 THEN '04444444-3333-3333-3333-333333333333'::uuid
              WHEN n <= 29000 THEN md5('t50-user-' || (n % 2000 + 1))::uuid
              ELSE md5('t50-user-' || (n % 2000 + 2001))::uuid END,
         CASE WHEN n <= 29000 THEN 'd1111111-1111-1111-1111-111111111111'::uuid
              ELSE 'd2222222-2222-2222-2222-222222222222'::uuid END,
         '05555555-1111-1111-1111-111111111112', 'Capacity validation key ' || n,
         CASE WHEN n % 6 = 0 THEN 'EXPIRED' ELSE 'ACTIVE' END, now() - interval '2 years',
         CASE WHEN n % 6 = 0 THEN now() - make_interval(days => n % 180 + 1)
              ELSE now() + make_interval(days => n % 180 + 90) END,
         'MOCK', 'capacity-key-' || n, now() - make_interval(days => n % 360)
  FROM generate_series(1, 50000) n RETURNING id, asset_code
)
INSERT INTO cryptographic_keys (asset_id, algorithm, key_size, usage, public_key_fingerprint)
SELECT id, 'RSA', 2048, 'ENCRYPTION', 'capacity:' || asset_code FROM inserted;

INSERT INTO requests (id, request_type, creator_id, department_id, policy_version_id,
    status, reason, emergency, requested_parameters, submitted_at)
SELECT md5('t50-request-' || n)::uuid, 'CREATE',
       CASE WHEN n <= 8000 THEN '04444444-3333-3333-3333-333333333333'::uuid
            WHEN n <= 23000 THEN md5('t50-user-' || (n % 2000 + 1))::uuid
            ELSE md5('t50-user-' || (n % 2000 + 2001))::uuid END,
       CASE WHEN n <= 23000 THEN 'd1111111-1111-1111-1111-111111111111'::uuid
            ELSE 'd2222222-2222-2222-2222-222222222222'::uuid END,
       '05555555-1111-1111-1111-111111111112',
       CASE WHEN n % 5 = 0 THEN 'PENDING' ELSE 'REJECTED' END,
       'T50 capacity request ' || n, n % 15 = 0,
       '{"assetType":"KEY","algorithm":"RSA","keySize":2048,"validityDays":90}',
       now() - make_interval(days => n % 365)
FROM generate_series(1, 40000) n;

INSERT INTO audit_logs (actor_id, actor_type, action, entity_type, entity_id, outcome, occurred_at)
SELECT CASE WHEN n % 3 = 0 THEN md5('t50-user-' || (n % 4000 + 1))::uuid END,
       CASE WHEN n % 3 = 0 THEN 'USER' ELSE 'SYSTEM' END,
       CASE WHEN n % 50 = 0 THEN 'T50_ASSET_ROTATED' ELSE 'T50_READ' END,
       'CRYPTO_ASSET', 't50-audit-' || lpad(n::text, 6, '0'), 'SUCCESS', now() - (n * interval '8 seconds')
FROM generate_series(1, 250000) n;

INSERT INTO notifications (id, recipient_id, request_id, type, channel, delivery_status,
    deduplication_key, scheduled_for, created_at, sent_at)
SELECT md5('t50-notice-' || n)::uuid,
       CASE WHEN n <= 8000 THEN '04444444-3333-3333-3333-333333333333'::uuid
            ELSE md5('t50-user-' || (n % 4000 + 1))::uuid END,
       md5('t50-request-' || (1 + (n-1) % 40000))::uuid, 'REQUEST_SUBMITTED',
       CASE WHEN n % 5 = 0 THEN 'EMAIL' ELSE 'IN_APP' END,
       CASE WHEN n % 5 = 0 THEN 'PENDING' ELSE 'SENT' END,
       'capacity-notice-' || n, now() + interval '1 day', now() - (n * interval '8 seconds'),
       CASE WHEN n % 5 <> 0 THEN now() - (n * interval '8 seconds') END
FROM generate_series(1, 50000) n;

ANALYZE users, crypto_assets, cryptographic_keys, requests, audit_logs, notifications;
COMMIT;
