import { createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { link, lstat, open, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { assertVerifiedDatabaseUrl } from '../common/deployment-config';
import {
  anchorRowsLimit, auditAnchorDigest, auditRowsDigest, isAuditDigest, parseAuditAnchor,
  signAuditAnchor, verifyAuditAnchor, type AuditRow, type SignedAuditAnchor,
} from './audit-anchor-format';

type Command = 'seal' | 'verify';
const namePattern = /^[0-9]{12}\.json$/;
const fileName = (sequence: number) => String(sequence).padStart(12, '0') + '.json';

function config(command: Command) {
  const {
    AUDIT_ANCHOR_DATABASE_URL: database,
    AUDIT_ANCHOR_DEPLOYMENT: deployment,
    AUDIT_ANCHOR_DIRECTORY: anchors,
    AUDIT_ANCHOR_PUBLIC_KEYS_DIRECTORY: publicKeys,
    AUDIT_ANCHOR_SIGNING_KEY_FILE: privateKey,
    AUDIT_ANCHOR_EXPECTED_HEAD: expectedHead,
  } = process.env;
  if (!database || !deployment || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(deployment) ||
      !anchors || !isAbsolute(anchors) || !publicKeys || !isAbsolute(publicKeys) ||
      (command === 'seal' && (!privateKey || !isAbsolute(privateKey))) ||
      (!isAuditDigest(expectedHead) && !(command === 'seal' && expectedHead === 'none'))) {
    throw new Error('AUDIT_ANCHOR_CONFIG_INVALID');
  }
  if (process.env.AUDIT_ANCHOR_TEST_PLAINTEXT === 'true') {
    const url = new URL(database);
    if (process.env.CRYPTA_DEPLOYMENT_MODE === 'production' || !['127.0.0.1', 'postgres'].includes(url.hostname) ||
        !/^\/crypta_(?:t30_test|anchor_test_[0-9a-f]+)$/.test(url.pathname)) throw new Error('AUDIT_ANCHOR_TEST_DATABASE_INVALID');
  } else assertVerifiedDatabaseUrl(database);
  return { database, deployment, anchors, publicKeys, privateKey, expectedHead };
}

async function smallFile(file: string, privateFile = false) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size > 16_384 || (privateFile && process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
    throw new Error('AUDIT_ANCHOR_FILE_INVALID');
  }
  return readFile(file);
}

async function readChain(directory: string, keys: string, deployment: string) {
  const names = (await readdir(directory)).filter(name => name.endsWith('.json')).sort();
  const chain: SignedAuditAnchor[] = [];
  const publicKeys = new Map<string, ReturnType<typeof createPublicKey>>();
  let previous: SignedAuditAnchor | undefined;
  for (const name of names) {
    if (!namePattern.test(name) || name !== fileName(chain.length + 1)) throw new Error('AUDIT_ANCHOR_CHAIN_GAP');
    const anchor = parseAuditAnchor(JSON.parse((await smallFile(join(directory, name))).toString('utf8')));
    if (anchor.deployment !== deployment || anchor.sequence !== chain.length + 1 ||
        anchor.afterId !== (previous?.throughId ?? '0') || anchor.previous !== (previous ? auditAnchorDigest(previous) : null)) {
      throw new Error(`AUDIT_ANCHOR_CHAIN_MISMATCH:${anchor.sequence}`);
    }
    let key = publicKeys.get(anchor.keyId);
    if (!key) {
      key = createPublicKey(await smallFile(join(keys, anchor.keyId + '.pem')));
      publicKeys.set(anchor.keyId, key);
    }
    verifyAuditAnchor(anchor, key);
    chain.push(anchor);
    previous = anchor;
  }
  return chain;
}

async function publish(directory: string, anchor: SignedAuditAnchor) {
  const temporary = join(directory, `.audit-anchor-${randomUUID()}.tmp`);
  const file = await open(temporary, 'wx', 0o600);
  try {
    try {
      await file.writeFile(JSON.stringify(anchor) + '\n', 'utf8');
      await file.sync();
    } finally { await file.close(); }
    try { await link(temporary, join(directory, fileName(anchor.sequence))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('AUDIT_ANCHOR_CONCURRENT_PUBLISH', { cause: error });
      throw error;
    }
    if (process.platform !== 'win32') {
      const folder = await open(directory, 'r');
      try { await folder.sync(); } finally { await folder.close(); }
    }
  } finally { await unlink(temporary).catch(() => undefined); }
}

async function verifySegment(client: PoolClient, anchor: SignedAuditAnchor) {
  const { rows } = await client.query<AuditRow>(`SELECT id::text,canonical FROM public.audit_anchor_rows
    WHERE id>$1 AND id<=$2 ORDER BY id LIMIT $3`, [anchor.afterId, anchor.throughId, anchor.rowCount + 1]);
  if (rows.length !== anchor.rowCount || rows.at(-1)?.id !== anchor.throughId ||
      auditRowsDigest(rows, anchor.afterId) !== anchor.rowsDigest) {
    throw new Error(`AUDIT_ANCHOR_CONTENT_MISMATCH:${anchor.sequence}`);
  }
}

async function transaction<T>(pool: Pool, mode: string, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query(mode);
    await client.query("SET LOCAL lock_timeout='2s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function run(command: Command) {
  const options = config(command);
  const directory = await realpath(options.anchors);
  const keys = await realpath(options.publicKeys);
  if (directory === keys) throw new Error('AUDIT_ANCHOR_KEYS_MUST_BE_SEPARATE');
  const chain = await readChain(directory, keys, options.deployment);
  const last = chain.at(-1);
  const head = last ? auditAnchorDigest(last) : 'none';
  if (head !== options.expectedHead) throw new Error('AUDIT_ANCHOR_HEAD_MISMATCH');
  const pool = new Pool({ connectionString: options.database, max: 1, connectionTimeoutMillis: 4_000,
    application_name: 'crypta-audit-anchor' });
  try {
    if (command === 'verify') {
      if (!last) throw new Error('AUDIT_ANCHOR_MISSING');
      return await transaction(pool, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', async client => {
        if ((await client.query('SELECT id FROM public.audit_anchor_rows WHERE id<=0 LIMIT 1')).rowCount) {
          throw new Error('AUDIT_ANCHOR_ID_INVALID');
        }
        for (const anchor of chain) await verifySegment(client, anchor);
        const { count } = (await client.query<{ count: string }>('SELECT count(*)::text AS count FROM public.audit_anchor_rows WHERE id>$1',
          [last.throughId])).rows[0];
        return { deployment: options.deployment, head, checkpoints: chain.length, throughId: last.throughId,
          anchoredRows: chain.reduce((total, anchor) => total + BigInt(anchor.rowCount), 0n).toString(), unanchoredRows: count };
      });
    }
    const privatePath = await realpath(options.privateKey!);
    const keyRelative = relative(directory, privatePath);
    if (!isAbsolute(keyRelative) && keyRelative !== '..' && !keyRelative.startsWith('..' + sep)) {
      throw new Error('AUDIT_ANCHOR_KEYS_MUST_BE_SEPARATE');
    }
    const key = createPrivateKey(await smallFile(privatePath, true));
    const afterId = last?.throughId ?? '0';
    const rows = await transaction(pool, 'BEGIN', async client => {
      const result = await client.query<AuditRow>(`SELECT captured.id::text AS id,captured.canonical
        FROM public.capture_audit_anchor_rows($1,$2) captured ORDER BY captured.id`, [afterId, anchorRowsLimit]);
      if (last) await verifySegment(client, last);
      return result.rows;
    });
    if (!rows.length) return { deployment: options.deployment, head, checkpointCreated: false };
    const anchor = signAuditAnchor({
      deployment: options.deployment, sequence: chain.length + 1, afterId, throughId: rows.at(-1)!.id,
      rowCount: rows.length, rowsDigest: auditRowsDigest(rows, afterId), previous: head === 'none' ? null : head,
      createdAt: new Date().toISOString(),
    }, key);
    verifyAuditAnchor(anchor, createPublicKey(await smallFile(join(keys, anchor.keyId + '.pem'))));
    await publish(directory, anchor);
    return { deployment: options.deployment, head: auditAnchorDigest(anchor), checkpointCreated: true,
      sequence: anchor.sequence, throughId: anchor.throughId, rows: anchor.rowCount };
  } finally { await pool.end(); }
}

const command = process.argv[2];
if ((command !== 'seal' && command !== 'verify') || process.argv.length !== 3) {
  console.error('Usage: node dist/audit/audit-anchor.cli.js seal|verify');
  process.exitCode = 2;
} else {
  void run(command).then(result => console.log(JSON.stringify(result))).catch(error => {
    const code = error instanceof Error && /^(AUDIT_ANCHOR_|PRODUCTION_DATABASE_)[A-Z_]+(?::\d+)?$/.test(error.message)
      ? error.message : 'AUDIT_ANCHOR_OPERATION_FAILED';
    console.error(code);
    process.exitCode = 1;
  });
}
