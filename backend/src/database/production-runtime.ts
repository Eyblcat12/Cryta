import type { PoolClient } from 'pg';

export async function assertProductionRuntime(client: PoolClient) {
  const result = await client.query<{ tls: boolean; restricted: boolean }>(`
    SELECT EXISTS (SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS tls,
      session_user=current_user AND r.rolcanlogin AND NOT
        (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit)
      AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member=r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relowner=r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proowner=r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner=r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_database WHERE datdba=r.oid)
      AND NOT has_schema_privilege('public', 'CREATE')
      AND NOT has_database_privilege(current_database(), 'CREATE,TEMP')
      AS restricted
    FROM pg_roles r WHERE r.rolname=current_user`);
  if (result.rows[0]?.tls !== true) throw new Error('PRODUCTION_DATABASE_TLS_REQUIRED');
  if (result.rows[0]?.restricted !== true) throw new Error('PRODUCTION_DATABASE_RUNTIME_ROLE_REQUIRED');
}
