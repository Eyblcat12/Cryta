import 'reflect-metadata';
import { hash, truncates } from 'bcryptjs';
import { isEmail, maxLength, minLength, validateSync } from 'class-validator';
import { Pool, type PoolClient } from 'pg';
import { NewPasswordDto } from '../auth/auth.dto';
import { assertVerifiedDatabaseUrl, productionSecret } from '../common/deployment-config';
import { SaveDepartmentDto } from '../departments/departments.dto';
import { migrationOwnerRole } from './migrate';
import { assertMigrationLedger } from './migration.service';

class BootstrapAdminError extends Error {}

export function readBootstrapConfiguration(env: NodeJS.ProcessEnv) {
  const database = env.BOOTSTRAP_DATABASE_NAME?.trim();
  const email = env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const displayName = env.BOOTSTRAP_ADMIN_NAME?.trim();
  const department = Object.assign(new SaveDepartmentDto(), {
    code: env.BOOTSTRAP_DEPARTMENT_CODE?.trim(),
    name: env.BOOTSTRAP_DEPARTMENT_NAME?.trim(),
  });
  if (!database || Buffer.byteLength(database) > 63) throw new BootstrapAdminError('BOOTSTRAP_DATABASE_NAME_REQUIRED');
  if (!email || !isEmail(email) || !maxLength(email, 254) ||
      !displayName || !minLength(displayName, 2) || !maxLength(displayName, 255)) {
    throw new BootstrapAdminError('BOOTSTRAP_ADMIN_IDENTITY_INVALID');
  }
  if (validateSync(department).length) throw new BootstrapAdminError('BOOTSTRAP_DEPARTMENT_INVALID');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new BootstrapAdminError('BOOTSTRAP_TLS_REQUIRED');

  let databaseUrl: string;
  let password: string;
  let owner: string | undefined;
  try {
    databaseUrl = productionSecret(env, 'DATABASE_URL');
    assertVerifiedDatabaseUrl(databaseUrl);
    password = productionSecret(env, 'BOOTSTRAP_ADMIN_PASSWORD');
    owner = migrationOwnerRole(env.DATABASE_MIGRATION_OWNER_ROLE);
  } catch (error) {
    throw new BootstrapAdminError('BOOTSTRAP_OPERATOR_CONFIGURATION_INVALID', { cause: error });
  }
  const credentials = Object.assign(new NewPasswordDto(), { newPassword: password });
  if (truncates(password) || validateSync(credentials).length) {
    throw new BootstrapAdminError('BOOTSTRAP_TEMPORARY_PASSWORD_INVALID');
  }
  return { database, email, displayName, department, databaseUrl, password, owner };
}

async function insertInitialAdmin(client: PoolClient, configuration: ReturnType<typeof readBootstrapConfiguration>,
  passwordHash: string) {
  const { database, email, displayName, department, owner } = configuration;
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL search_path TO pg_catalog, public');
    if (owner) await client.query(`SET LOCAL ROLE "${owner}"`);
    const target = await client.query<{ correct_database: boolean; tls: boolean }>(`
      SELECT current_database()=$1 AS correct_database,
        EXISTS (SELECT 1 FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) AS tls`, [database]);
    if (!target.rows[0].correct_database) throw new BootstrapAdminError('BOOTSTRAP_DATABASE_MISMATCH');
    if (!target.rows[0].tls) throw new BootstrapAdminError('BOOTSTRAP_TLS_REQUIRED');

    // Use the migration lock before validating the ledger or taking any table lock.
    await client.query('SELECT pg_advisory_xact_lock(17232,2)');
    await assertMigrationLedger(client).catch(error => {
      throw new BootstrapAdminError('BOOTSTRAP_LEDGER_INVALID', { cause: error });
    });
    await client.query('LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE');
    const state = await client.query<{ initialized: boolean }>(`
      SELECT EXISTS (SELECT 1 FROM public.users)
          OR EXISTS (SELECT 1 FROM public.audit_logs)
          OR EXISTS (SELECT 1 FROM public.requests)
          OR EXISTS (SELECT 1 FROM public.crypto_assets) AS initialized`);
    if (state.rows[0].initialized) throw new BootstrapAdminError('BOOTSTRAP_DATABASE_ALREADY_INITIALIZED');

    await client.query(`INSERT INTO public.departments(code,name) VALUES($1,$2) ON CONFLICT (code) DO NOTHING`,
      [department.code, department.name]);
    const departments = await client.query<{ id: string }>(`
      SELECT id FROM public.departments WHERE code=$1 AND name=$2 AND is_active FOR SHARE`,
      [department.code, department.name]);
    const departmentId = departments.rows[0]?.id;
    if (!departmentId) throw new BootstrapAdminError('BOOTSTRAP_DEPARTMENT_CONFLICT');

    await client.query(`INSERT INTO public.roles(code,name) VALUES
      ('ADMIN','Quản trị bảo mật'), ('APPROVER','Người phê duyệt'), ('USER','Người dùng thông thường')
      ON CONFLICT (code) DO NOTHING`);
    const users = await client.query<{ id: string }>(`
      INSERT INTO public.users(email,display_name,department_id,password_hash,must_change_password)
      VALUES($1,$2,$3,$4,TRUE) RETURNING id`, [email, displayName, departmentId, passwordHash]);
    const userId = users.rows[0].id;
    await client.query(`INSERT INTO public.user_roles(user_id,role_id)
      VALUES($1,(SELECT id FROM public.roles WHERE code='ADMIN'))`, [userId]);
    await client.query(`INSERT INTO public.audit_logs(actor_type,action,entity_type,entity_id,outcome)
      VALUES('SYSTEM','BOOTSTRAP_ADMIN_CREATED','USER',$1,'SUCCESS')`, [userId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function bootstrapAdmin() {
  const configuration = readBootstrapConfiguration(process.env);
  const passwordHash = await hash(configuration.password, 12);
  const pool = new Pool({ connectionString: configuration.databaseUrl, max: 1,
    statement_timeout: 30_000, connectionTimeoutMillis: 10_000, application_name: 'crypta-bootstrap-admin' });
  pool.on('error', () => { process.stderr.write('BOOTSTRAP_CONNECTION_FAILED\n'); });
  try {
    const client = await pool.connect();
    try { await insertInitialAdmin(client, configuration, passwordHash); }
    finally { client.release(); }
  } finally { await pool.end(); }
}

if (require.main === module) void bootstrapAdmin().then(() => {
  process.stdout.write('BOOTSTRAP_ADMIN_CREATED\n');
}).catch(error => {
  process.stderr.write((error instanceof BootstrapAdminError ? error.message : 'BOOTSTRAP_ADMIN_FAILED') + '\n');
  process.exitCode = 1;
});
