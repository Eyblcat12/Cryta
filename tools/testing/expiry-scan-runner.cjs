// Fed to node stdin inside the validated generated backend container.
// No bootstrap application, cron timer, CryptoProviderService or SMTP worker runs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

async function main(options) {
  assert.match(options.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.match(options.database, /^crypta_expiry_test_[a-f0-9]{12}$/);
  assert.equal(process.env.CRYPTO_PROVIDER_MODE, 'MOCK');
  assert.equal(process.env.SMTP_ENABLED, 'false');
  const connection = new URL(process.env.DATABASE_URL);
  assert.equal(connection.protocol, 'postgresql:');
  assert.equal(connection.hostname, 'postgres');
  assert.equal(connection.pathname, '/crypta_t30_test');
  assert.equal(connection.username, 'crypta_t30_test');
  connection.pathname = `/${options.database}`;
  require('/app/node_modules/reflect-metadata');
  const { Pool } = require('/app/node_modules/pg');
  const { Logger } = require('/app/node_modules/@nestjs/common');
  const { ExpiryScanService } = require('/app/dist/jobs/expiry-scan.service.js');
  const { NotificationsService } = require('/app/dist/notifications/notifications.service.js');
  const { MigrationService } = require('/app/dist/database/migration.service.js');
  Logger.overrideLogger([]);
  const pool = new Pool({ connectionString: connection.href, max: 6,
    statement_timeout: 10000, application_name: 'crypta-expiry-integration' });
  const results = [];
  const report = {
    database: options.database, fixtureOnly: false, provider: 'MOCK', smtpEnabled: false,
    clockMethod: 'Schema-local now() with explicit search_path and per-session test time and zone; service SQL is unchanged.',
    actualServiceInstances: ['ExpiryScanService', 'NotificationsService', 'MigrationService'],
    plannedTotal: 20,
    compiledServiceHashes: Object.fromEntries(['jobs/expiry-scan.service.js', 'jobs/expiry-warning-policy.js', 'audit/audit-context.js', 'notifications/asset-alert-recipient.js',
      'notifications/notifications.service.js', 'database/migration.service.js'].map(relative => [relative,
      crypto.createHash('sha256').update(fs.readFileSync(`/app/dist/${relative}`)).digest('hex')])),
    results,
  };
  const base = Date.parse('2032-01-01T12:00:00.000Z');
  const day = 24 * 60 * 60 * 1000;
  let now = base;
  let sessionZone = 'UTC';
  let connectCount = 0;
  const locks = [];
  let pauseAfterLock;
  let pauseBeforeWarnings, pauseAfterWarnings, warningPid;
  const children = new Set();
  const { spawn } = require('node:child_process');
  async function waitUntil(check, message, timeout=7000){
    const until=Date.now()+timeout;
    while(Date.now()<until){if(await check())return;await new Promise(resolve=>setTimeout(resolve,25));}
    throw new Error(message);
  }
  function startScannerProcess(pause){
    const childSource=`(async()=>{
      const assert=require('node:assert/strict');require('/app/node_modules/reflect-metadata');
      const {Pool}=require('/app/node_modules/pg'),{Logger}=require('/app/node_modules/@nestjs/common');Logger.overrideLogger([]);
      const {ExpiryScanService}=require('/app/dist/jobs/expiry-scan.service'),{NotificationsService}=require('/app/dist/notifications/notifications.service');
      const url=new URL(process.env.CRYPTA_EXPIRY_TEST_URL);assert.equal(url.hostname,'postgres');assert.equal(url.pathname,'/'+process.env.CRYPTA_EXPIRY_TEST_DATABASE);assert.match(process.env.CRYPTA_EXPIRY_TEST_DATABASE,/^crypta_expiry_test_[a-f0-9]{12}$/);
      const pool=new Pool({connectionString:url.href,max:2,application_name:'crypta-expiry-child',statement_timeout:10000});
      const scannerPool={connect:async()=>{const client=await pool.connect();await client.query("SELECT set_config('TimeZone','UTC',false),set_config('search_path','expiry_test_clock,public,pg_catalog',false),set_config('crypta.expiry_test_now',$1,false)",[process.env.CRYPTA_EXPIRY_TEST_NOW]);return{query:async(text,values)=>{const result=await client.query(text,values);if(process.env.CRYPTA_EXPIRY_TEST_PAUSE==='true'&&typeof text==='string'&&text.includes('INSERT INTO notifications')){process.stdout.write('ENQUEUED\\n');await new Promise(()=>{});}return result},release:()=>client.release()}}};
      const scanner=new ExpiryScanService(scannerPool,new NotificationsService(pool));
      const run=scanner.run.bind(scanner);scanner.run=async()=>{await run();scanner.onModuleDestroy();await pool.end();process.stdout.write('FINISHED\\n')};
      scanner.onModuleInit();
    })().catch(()=>{process.stderr.write('EXPIRY_CHILD_FAILURE');process.exitCode=1});`;
    const child=spawn(process.execPath,['-e',childSource],{env:{...process.env,CRYPTA_EXPIRY_TEST_URL:connection.href,
      CRYPTA_EXPIRY_TEST_DATABASE:options.database,CRYPTA_EXPIRY_TEST_NOW:new Date(now).toISOString(),CRYPTA_EXPIRY_TEST_PAUSE:String(pause)},stdio:['ignore','pipe','pipe']});
    const item={child,output:'',closed:false,code:null,signal:null};children.add(item);
    child.stdout.on('data',data=>{item.output+=data.toString();if(item.output.length>4096)child.kill('SIGKILL')});
    child.stderr.on('data',()=>{});child.on('error',()=>{item.closed=true;item.code=-1});
    child.on('close',(code,signal)=>{item.closed=true;item.code=code;item.signal=signal});
    return item;
  }
  async function stopScannerProcess(item){
    if(!item.closed)item.child.kill('SIGKILL');
    await waitUntil(()=>item.closed,'EXPIRY_CHILD_DID_NOT_STOP');children.delete(item);
  }
  const scannerPool = {
    async connect() {
      connectCount += 1;
      const client = await pool.connect();
      try {
        await client.query("SELECT set_config('TimeZone',$2,false), set_config('search_path','expiry_test_clock,public,pg_catalog',false), set_config('crypta.expiry_test_now',$1,false)", [new Date(now).toISOString(), sessionZone]);
        assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name, options.database);
      } catch (error) { client.release(); throw error; }
      return {
        async query(text, parameters) {
          const warnings = typeof text === 'string' && text.includes('SELECT a.id, thresholds.warning_day');
          if (warnings && pauseBeforeWarnings) await pauseBeforeWarnings();
          const value = await client.query(text, parameters);
          if (warnings && pauseAfterWarnings) { warningPid = client.processID; await pauseAfterWarnings(); }
          if (typeof text === 'string' && text.includes('pg_try_advisory_xact_lock')) {
            locks.push(Boolean(value.rows[0].locked));
            if (value.rows[0].locked && pauseAfterLock) await pauseAfterLock();
          }
          return value;
        },
        release() { client.release(); },
      };
    },
  };
  const notifications = new NotificationsService(pool);
  const scanner = new ExpiryScanService(scannerPool, notifications);
  const secondScanner = new ExpiryScanService(scannerPool, notifications);
  const id = () => crypto.randomUUID();
  const department = id(), owner = id(), approver = id(), admin = id();
  const policy = id(), originalVersion = id(), latestVersion = id();
  async function asset(code, expires, status = 'ACTIVE', policyVersion = originalVersion, assetType = 'KEY', version = 1) {
    const assetId = id();
    await pool.query(`INSERT INTO crypto_assets(id,asset_code,asset_type,owner_id,department_id,policy_version_id,purpose,status,valid_from,expires_at,version)
      VALUES($1,$2,$3,$4,$5,$6,'Expiry integration metadata',$7,$8,$9,$10)`,
    [assetId, code, assetType, owner, department, policyVersion, status,
      new Date(base - 365 * day), new Date(expires), version]);
    return assetId;
  }
  async function reset() {
    // This is the newly-created expiry database, never the retained source DB.
    assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, options.database);
    await pool.query('TRUNCATE public.notifications,public.audit_logs,public.crypto_assets CASCADE');
    now = base;
    sessionZone = 'UTC';
    locks.length = 0;
  }
  async function state(assetId) {
    const found = await pool.query('SELECT status,version FROM public.crypto_assets WHERE id=$1', [assetId]);
    assert.equal(found.rowCount, 1);
    return found.rows[0];
  }
  async function notices(assetId) {
    return (await pool.query(`SELECT recipient_id,type,channel,delivery_status,deduplication_key,attempt_count,
      sent_at IS NOT NULL AS has_sent_at FROM public.notifications WHERE asset_id=$1 ORDER BY deduplication_key`, [assetId])).rows;
  }
  async function audit(assetId) {
    return (await pool.query(`SELECT actor_type,actor_id,action,entity_type,outcome FROM public.audit_logs
      WHERE entity_id=$1 ORDER BY id`, [assetId])).rows;
  }
  async function pair(assetId, suffix, type = 'ASSET_EXPIRING') {
    const rows = (await notices(assetId)).filter(row => row.type === type && row.deduplication_key.includes(`:${suffix}:`));
    assert.equal(rows.length, 6);
    assert.deepEqual([...new Set(rows.map(row => row.recipient_id))].sort(),[owner,approver,admin].sort());
    for (const row of rows) {
      assert([owner,approver,admin].includes(row.recipient_id));
      assert.equal(row.attempt_count, 0);
      assert.equal(row.deduplication_key, `${type.toLowerCase()}:${assetId}:${suffix}:${row.recipient_id}:${row.channel.toLowerCase()}`);
      assert.equal(row.delivery_status, row.channel === 'IN_APP' ? 'SENT' : 'PENDING');
      assert.equal(row.has_sent_at, row.channel === 'IN_APP');
    }
  }
  async function test(name, run) {
    try { results.push({ name, passed: true, evidence: await run() ?? null }); }
    catch (error) {
      results.push({ name, passed: false, error: error instanceof assert.AssertionError
        ? error.message : `${error.name}: ${String(error.message).slice(0, 300)}` });
      throw error;
    }
  }
  try {
    assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, options.database);
    await new MigrationService(pool).applyPending();
    await pool.query(`CREATE SCHEMA expiry_test_clock;
      CREATE FUNCTION expiry_test_clock.now() RETURNS timestamptz LANGUAGE sql STABLE
      AS $$ SELECT current_setting('crypta.expiry_test_now')::timestamptz $$`);
    await pool.query("INSERT INTO departments(id,code,name) VALUES($1,'EXPIRY_TEST','Expiry isolated integration')", [department]);
    for (const [userId, role] of [[owner, 'USER'], [approver, 'APPROVER'], [admin, 'ADMIN']]) {
      const roleId = id();
      await pool.query('INSERT INTO roles(id,code,name) VALUES($1,$2,$2)', [roleId, role]);
      await pool.query(`INSERT INTO users(id,department_id,email,password_hash,display_name)
        VALUES($1,$2,$3,'not-a-login-credential',$4)`, [userId, department, `${role.toLowerCase()}@expiry.example.test`, `Expiry ${role}`]);
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [userId, roleId]);
    }
    await pool.query('INSERT INTO approver_scopes(user_id,department_id) VALUES($1,$2)', [approver, department]);
    await pool.query("INSERT INTO policies(id,code,name) VALUES($1,'EXPIRY_TEST','Expiry version integration')", [policy]);
    await pool.query(`INSERT INTO policy_versions(id,policy_id,version,configuration)
      VALUES($1,$2,1,'{"warning_days":[30,7,1]}'),($3,$2,2,'{"warning_days":[14,2]}')`, [originalVersion, policy, latestVersion]);
    await test('SQL clock is UTC and deterministic only in the allocated test database', async () => {
      const client = await scannerPool.connect();
      try {
        const result = (await client.query("SELECT current_database() AS database,current_setting('TimeZone') AS zone,now() AS injected,pg_catalog.now() AS wall")).rows[0];
        assert.equal(result.database, options.database);
        assert.equal(result.zone, 'UTC');
        assert.equal(result.injected.toISOString(), new Date(base).toISOString());
        assert.notEqual(result.wall.toISOString(), result.injected.toISOString());
      } finally { client.release(); }
      return { fixedUtc: new Date(base).toISOString(), serviceSqlRewritten: false, sourceDatabaseClockChanged: false };
    });
    await test('Warning days come from the asset policy version rather than the latest version or a fixed 30 days', async () => {
      await reset();
      const old = await asset('POLICY_OLD', base + 30 * day);
      const current = await asset('POLICY_NEW', base + 20 * day, 'ACTIVE', latestVersion);
      await scanner.run();
      await pair(old, '30-days');
      assert.deepEqual(await state(old), { status: 'EXPIRING_SOON', version: 2 });
      assert.deepEqual(await state(current), { status: 'ACTIVE', version: 1 });
      assert.equal((await notices(current)).length, 0);
      return { attachedWarningDays: [30, 7, 1], newerPolicyWarningDays: [14, 2] };
    });
    await test('One-day warning is 24 hours across both daylight-saving transitions in the database session', async () => {
      const transitions = [
        ['2032-03-13T17:00:00Z', 23],
        ['2032-11-06T16:00:00Z', 25],
      ];
      for (const [boundary, calendarDayHours] of transitions) {
        await reset();
        sessionZone = 'America/New_York';
        const boundaryTime = Date.parse(boundary);
        const target = await asset('DST_BOUNDARY', boundaryTime + day);
        now = boundaryTime;
        const client = await scannerPool.connect();
        try {
          const { rows: [duration] } = await client.query(`SELECT
            EXTRACT(EPOCH FROM ((now()+INTERVAL '1 day')-now()))::int AS seconds`);
          assert.equal(duration.seconds, calendarDayHours * 3600);
        } finally { client.release(); }
        now = boundaryTime - 1;
        await scanner.run();
        await pair(target, '7-days');
        assert.equal((await notices(target)).length, 6, `One-day reminder was early across a ${calendarDayHours}-hour calendar day.`);
        now = boundaryTime;
        await scanner.run();
        await pair(target, '1-days');
        assert.equal((await notices(target)).length, 12);
      }
      return { databaseZone: sessionZone, calendarDayHours: [23, 25], warningHours: 24 };
    });
    await reset();
    const lifecycle = await asset('UTC_BOUNDARIES', base + 30 * day + 1);
    const expiry = base + 30 * day + 1;
    await test('30-day UTC boundary is inclusive and 1 ms before it is not due', async () => {
      await scanner.run();
      assert.deepEqual(await state(lifecycle), { status: 'ACTIVE', version: 1 });
      assert.equal((await notices(lifecycle)).length, 0);
      now = base + 1;
      await scanner.run();
      await pair(lifecycle, '30-days');
      assert.deepEqual(await state(lifecycle), { status: 'EXPIRING_SOON', version: 2 });
      assert.equal((await audit(lifecycle)).length, 1);
      return { boundaryUtc: new Date(now).toISOString(), notificationChannelsPerRecipient: 2, recipients: 3 };
    });
    for (const threshold of [7, 1]) await test(`${threshold}-day UTC boundary adds only its own deduplicated threshold`, async () => {
      const beforeCount = (await notices(lifecycle)).length;
      now = expiry - threshold * day - 1;
      await scanner.run();
      assert.equal((await notices(lifecycle)).length, beforeCount);
      now += 1;
      await scanner.run();
      await pair(lifecycle, `${threshold}-days`);
      assert.equal((await notices(lifecycle)).length, beforeCount + 6);
      assert.deepEqual(await state(lifecycle), { status: 'EXPIRING_SOON', version: 2 });
      assert.equal((await audit(lifecycle)).length, 1, 'Only the first ACTIVE→EXPIRING_SOON transition is audited.');
      return { boundaryUtc: new Date(now).toISOString(), transitionAuditCount: 1 };
    });
    await test('Exact expiry UTC changes state once, increments version once and emits a SYSTEM audit', async () => {
      now = expiry - 1;
      await scanner.run();
      assert.deepEqual(await state(lifecycle), { status: 'EXPIRING_SOON', version: 2 });
      now = expiry;
      await scanner.run();
      await pair(lifecycle, 'expired', 'ASSET_EXPIRED');
      assert.deepEqual(await state(lifecycle), { status: 'EXPIRED', version: 3 });
      const rows = await audit(lifecycle);
      assert.deepEqual(rows.map(row => row.action), ['ASSET_MARKED_EXPIRING_SOON', 'ASSET_MARKED_EXPIRED']);
      for (const row of rows) assert.deepEqual({ actorType: row.actor_type, actorId: row.actor_id,
        entity: row.entity_type, outcome: row.outcome },
      { actorType: 'SYSTEM', actorId: null, entity: 'CRYPTO_ASSET', outcome: 'SUCCESS' });
      await scanner.run();
      await secondScanner.run();
      assert.equal((await notices(lifecycle)).length, 24);
      assert.equal((await audit(lifecycle)).length, 2);
      assert.equal((await state(lifecycle)).version, 3);
      return { exactExpiryUtc: new Date(expiry).toISOString(), expiredAuditCount: 1, repeatsDuplicated: false };
    });
    await test('REVOKED and SUPERSEDED assets never warn or expire, even when overdue', async () => {
      await reset();
      const excluded = [];
      for (const status of ['REVOKED', 'SUPERSEDED']) for (const offset of [-day, day]) {
        excluded.push({ assetId: await asset(`${status}_${offset}`, base + offset, status), status });
      }
      await scanner.run();
      for (const item of excluded) {
        assert.deepEqual(await state(item.assetId), { status: item.status, version: 1 });
        assert.equal((await notices(item.assetId)).length, 0);
        assert.equal((await audit(item.assetId)).length, 0);
      }
      return { excludedStatuses: ['REVOKED', 'SUPERSEDED'], futureAndOverdueCases: 4 };
    });
    await test('Downtime catch-up selects the nearest due threshold and overdue assets receive only expiry', async () => {
      await reset();
      const seven = await asset('CATCHUP_7', base + 4 * day);
      const one = await asset('CATCHUP_1', base + day / 2);
      const overdue = await asset('CATCHUP_EXPIRED', base - 1);
      await scanner.run();
      await pair(seven, '7-days');
      await pair(one, '1-days');
      await pair(overdue, 'expired', 'ASSET_EXPIRED');
      for (const assetId of [seven, one, overdue]) assert.equal((await notices(assetId)).length, 6);
      assert.deepEqual(await state(overdue), { status: 'EXPIRED', version: 2 });
      return { remainingDays: [4, 0.5, -1 / day], suffixes: ['7-days', '1-days', 'expired'] };
    });
    await test('Missing warning days use fallback30; empty and nonpositive lists have no warning; duplicates pick one nearest value', async () => {
      await reset();
      const cases = [{ name: 'FALLBACK', config: {}, expiryDays: 20, suffix: '30-days' },
        { name: 'EMPTY', config: { warning_days: [] }, expiryDays: 1 },
        { name: 'NONPOSITIVE', config: { warning_days: [0, -1] }, expiryDays: 1 },
        { name: 'DUPLICATE', config: { warning_days: [30, 7, 1, 7, 0, -2] }, expiryDays: 4, suffix: '7-days' }];
      for (let index = 0; index < cases.length; index += 1) {
        const item = cases[index], versionId = id();
        await pool.query('INSERT INTO policy_versions(id,policy_id,version,configuration) VALUES($1,$2,$3,$4::jsonb)',
          [versionId, policy, index + 3, JSON.stringify(item.config)]);
        item.assetId = await asset(item.name, base + item.expiryDays * day, 'ACTIVE', versionId);
      }
      await scanner.run();
      for (const item of cases) {
        if (item.suffix) await pair(item.assetId, item.suffix);
        else { assert.deepEqual(await state(item.assetId), { status: 'ACTIVE', version: 1 });
          assert.equal((await notices(item.assetId)).length, 0); }
      }
      return { configurations: cases.map(item => ({ name: item.name, suffix: item.suffix ?? null })) };
    });
    await test('Two actual scanners contend on PostgreSQL advisory lock; repeat and same-instance overlap do not duplicate', async () => {
      await reset();
      const target = await asset('CONCURRENT', base + 4 * day);
      let acquired;
      const locked = new Promise(resolve => { acquired = resolve; });
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      pauseAfterLock = async () => { acquired(); await gate; };
      const beforeConnect = connectCount;
      const first = scanner.run();
      try {
        await Promise.race([locked, new Promise((_, reject) => setTimeout(() => reject(new Error('Scanner lock precondition timed out')), 10000))]);
        await secondScanner.run();
        await scanner.run();
        assert.equal(connectCount - beforeConnect, 2, 'Same-instance running guard must not acquire a third client.');
        assert.deepEqual(locks, [true, false]);
      } finally { pauseAfterLock = undefined; release(); await first; }
      await Promise.all([scanner.run(), secondScanner.run()]);
      await pair(target, '7-days');
      assert.equal((await notices(target)).length, 6);
      assert.equal((await audit(target)).length, 1);
      assert.deepEqual(await state(target), { status: 'EXPIRING_SOON', version: 2 });
      return { realDatabaseLockContention: [true, false], scannerInstances: 2,
        repeatedNotificationRows: 6, stateTransitionAudits: 1, sameInstanceGuard: true };
    });
    await test('Failure after real enqueue rolls back state, notification and audit; the same scanner successfully reruns', async () => {
      await reset();
      const expired = await asset('ROLLBACK_EXPIRED', base - 1);
      const warning = await asset('ROLLBACK_WARNING', base + 4 * day);
      const realNotifications = new NotificationsService(pool);
      const actualEnqueue = realNotifications.enqueueAsset.bind(realNotifications);
      let injected = 0;
      realNotifications.enqueueAsset = async (client, assetId, type, suffix) => {
        await actualEnqueue(client, assetId, type, suffix);
        if (assetId === warning && injected === 0) { injected += 1; throw new Error('CRYPTA_EXPIRY_TEST_ENQUEUE_FAILURE'); }
      };
      const recovering = new ExpiryScanService(scannerPool, realNotifications);
      await recovering.run();
      assert.equal(injected, 1, 'Failure must occur after the actual enqueue INSERT.');
      for (const assetId of [expired, warning]) {
        assert.deepEqual(await state(assetId), { status: 'ACTIVE', version: 1 });
        assert.equal((await notices(assetId)).length, 0);
        assert.equal((await audit(assetId)).length, 0);
      }
      assert.equal(recovering.running, false, 'Failure must release the running guard.');
      await recovering.run();
      await pair(expired, 'expired', 'ASSET_EXPIRED');
      await pair(warning, '7-days');
      assert.deepEqual(await state(expired), { status: 'EXPIRED', version: 2 });
      assert.deepEqual(await state(warning), { status: 'EXPIRING_SOON', version: 2 });
      assert.equal((await audit(expired)).length, 1);
      assert.equal((await audit(warning)).length, 1);
      await recovering.run();
      assert.equal((await notices(expired)).length, 6);
      assert.equal((await notices(warning)).length, 6);
      return { faultAfterActualInsert: true, rolledBackRowsAndVersions: true,
        runningFlagRecovered: true, successfulSameInstanceRerun: true };
    });
    await test('KEY and CERTIFICATE ACTIVE or EXPIRING_SOON assets at expiry transition once', async () => {
      await reset();
      const key = await asset('KEY_EXPIRY', base, 'ACTIVE', originalVersion, 'KEY', 1);
      const certificate = await asset('CERT_EXPIRY', base, 'EXPIRING_SOON', originalVersion, 'CERTIFICATE', 4);
      await scanner.run();
      assert.deepEqual(await state(key), { status: 'EXPIRED', version: 2 });
      assert.deepEqual(await state(certificate), { status: 'EXPIRED', version: 5 });
      for (const assetId of [key, certificate]) {
        await pair(assetId, 'expired', 'ASSET_EXPIRED');
        assert.equal((await audit(assetId)).length, 1);
      }
      return { types: ['KEY', 'CERTIFICATE'], inputStatuses: ['ACTIVE', 'EXPIRING_SOON'] };
    });
    await test('Approved owner, scoped Approver and Admin recipients each receive both channels once', async () => {
      const recipients = (await pool.query('SELECT DISTINCT recipient_id FROM public.notifications')).rows;
      assert.deepEqual(recipients.map(row => row.recipient_id).sort(), [owner,approver,admin].sort());
      assert.equal((await pool.query('SELECT COUNT(*)::int AS total FROM public.notifications WHERE recipient_id=ANY($1::uuid[])', [[approver, admin]])).rows[0].total, 8);
      assert.equal((await pool.query("SELECT COUNT(*)::int AS total FROM public.notifications WHERE channel='EMAIL' AND delivery_status='PENDING'")).rows[0].total, 6);
      return { measuredRecipientScope: 'owner-scoped-approver-admin', recipientPolicyAccepted: true,
        smtpWorkerStarted: false, pendingEmailRows: (await pool.query("SELECT count(*)::int AS n FROM notifications WHERE channel='EMAIL'")).rows[0].n };
    });
    await test('Malformed legacy policy values cannot roll back healthy warnings or expiry transitions', async () => {
      await reset();
      const healthy = await asset('HEALTHY_WITH_BAD_POLICIES', base + 4 * day);
      const overdue = await asset('OVERDUE_WITH_BAD_POLICIES', base - 1);
      const invalidRoots=[null,7,'private-policy-fixture',[]];
      for(let index=0;index<invalidRoots.length;index++)await assert.rejects(()=>pool.query('INSERT INTO policy_versions(id,policy_id,version,configuration) VALUES($1,$2,$3,$4::jsonb)',[id(),policy,2000+index,JSON.stringify(invalidRoots[index])]),error=>error.code==='23514');
      const cases = [{warning_days:null}, {warning_days:7}, {warning_days:'7'},
        {warning_days:{}}, {warning_days:[null,true,{},[],1.5,2**40,1e100,'private-policy-fixture']},
        {warning_days:Array(3651).fill(7)}, {warning_days:[30,'private-policy-fixture',null,7]}];
      const fixtures=[];
      for(let index=0;index<cases.length;index++){
        const versionId=id();await pool.query('INSERT INTO policy_versions(id,policy_id,version,configuration) VALUES($1,$2,$3,$4::jsonb)',[versionId,policy,1000+index,JSON.stringify(cases[index])]);
        fixtures.push(await asset('MALFORMED_'+index,base+4*day,'ACTIVE',versionId));
      }
      await scanner.run();await pair(healthy,'7-days');await pair(overdue,'expired','ASSET_EXPIRED');
      assert.deepEqual(await state(overdue),{status:'EXPIRED',version:2});
      for(let index=0;index<fixtures.length;index++){
        if(index===cases.length-1)await pair(fixtures[index],'7-days');
        else{assert.deepEqual(await state(fixtures[index]),{status:'ACTIVE',version:1});assert.equal((await notices(fixtures[index])).length,0);}
      }
      await scanner.run();assert.equal((await notices(healthy)).length,6);assert.equal((await notices(overdue)).length,6);
      return{invalidRootsRejectedByDatabase:invalidRoots.length,malformedWarningConfigurations:cases.length,healthyWarningPreserved:true,expiryCommitted:true,validMembersInMixedArrayRetained:true};
    });
    await test('Recipient expansion excludes inactive and outside-scope users and deduplicates an owner who is also an Approver',async()=>{
      await reset();const foreignDepartment=id(),outside=id(),inactive=id();
      await pool.query("INSERT INTO departments(id,code,name) VALUES($1,'EXPIRY_OUTSIDE','Outside scope')",[foreignDepartment]);
      await pool.query("INSERT INTO users(id,department_id,email,password_hash,display_name,status) VALUES($1,$3,'outside@expiry.example.test','fixture','Outside','ACTIVE'),($2,$3,'inactive@expiry.example.test','fixture','Inactive','INACTIVE')",[outside,inactive,department]);
      const roles=(await pool.query("SELECT id,code FROM roles WHERE code IN ('ADMIN','APPROVER')")).rows;
      const approverRole=roles.find(row=>row.code==='APPROVER').id,adminRole=roles.find(row=>row.code==='ADMIN').id;
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$3),($2,$4),($5,$3)',[outside,inactive,approverRole,adminRole,owner]);
      await pool.query('INSERT INTO approver_scopes(user_id,department_id) VALUES($1,$3),($2,$4)',[outside,owner,foreignDepartment,department]);
      try{
        const target=await asset('RECIPIENT_DEDUP',base+4*day);await scanner.run();await pair(target,'7-days');
        assert.equal((await notices(target)).filter(row=>row.recipient_id===owner).length,2);
        assert.equal((await notices(target)).filter(row=>[outside,inactive].includes(row.recipient_id)).length,0);
      }finally{await pool.query('DELETE FROM approver_scopes WHERE user_id=$1',[owner]);await pool.query('DELETE FROM user_roles WHERE user_id=$1 AND role_id=$2',[owner,approverRole]);}
      return{ownerRoleOverlapDeduplicated:true,inactiveAdminExcluded:true,outsideApproverExcluded:true,recipientCount:3};
    });
    await test('A legacy owner EMAIL key suppresses only that recipient and channel while adding missing recipients',async()=>{
      await reset();const target=await asset('LEGACY_RECIPIENT_KEY',base+4*day);
      const legacy=`asset_expiring:${target}:7-days:email`;
      await pool.query("INSERT INTO notifications(recipient_id,asset_id,type,channel,deduplication_key) VALUES($1,$2,'ASSET_EXPIRING','EMAIL',$3)",[owner,target,legacy]);
      await scanner.run();await scanner.run();const rows=await notices(target);assert.equal(rows.length,6);
      for(const recipient of [owner,approver,admin])assert.deepEqual(rows.filter(row=>row.recipient_id===recipient).map(row=>row.channel).sort(),['EMAIL','IN_APP']);
      assert.equal(rows.filter(row=>row.deduplication_key===legacy).length,1);
      assert(rows.some(row=>row.recipient_id===owner&&row.channel==='IN_APP'&&row.deduplication_key.includes(owner)));
      return{legacyOwnerEmailPreserved:true,missingOwnerInAppAdded:true,newRecipients:2,repeatsDuplicated:false};
    });
    await test('A revocation committed before warning selection prevents both warning state and notifications', async () => {
      await reset();const target=await asset('REVOKED_BEFORE_WARNING',base+4*day);
      let entered,release;const ready=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve});
      pauseBeforeWarnings=async()=>{entered();await gate;};const running=scanner.run();
      try{
        await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('WARNING_SELECTION_NOT_REACHED')),5000))]);
        await pool.query("UPDATE crypto_assets SET status='REVOKED',version=version+1 WHERE id=$1",[target]);
      }finally{release();await running;pauseBeforeWarnings=undefined;}
      assert.deepEqual(await state(target),{status:'REVOKED',version:2});assert.equal((await notices(target)).length,0);assert.equal((await audit(target)).length,0);
      return{revocationWon:true,warningNotifications:0,warningAudit:0};
    });
    await test('Warning selection holds the asset lock until its transaction commits before a competing revoke', async () => {
      await reset();const target=await asset('WARNING_BEFORE_REVOKE',base+4*day);
      let entered,release;const ready=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve});
      pauseAfterWarnings=async()=>{entered();await gate;};const running=scanner.run();
      const revoker=await pool.connect();let changed,changeError,committed=false;
      try{
        await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('WARNING_LOCK_NOT_REACHED')),5000))]);
        const pid=(await revoker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await revoker.query('BEGIN');await revoker.query("SET LOCAL lock_timeout='5s'");
        changed=revoker.query("UPDATE crypto_assets SET status='REVOKED',version=version+1 WHERE id=$1",[target]).catch(error=>{changeError=error});
        const until=Date.now()+3000;let blocked=false;
        while(Date.now()<until){
          const row=(await pool.query('SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS blocked',[pid,warningPid])).rows[0];
          if(row.blocked){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,25));
        }
        assert(blocked,'The revoker must wait on the scanner asset row lock');
        release();await running;await changed;if(changeError)throw changeError;
        await revoker.query('COMMIT');committed=true;
        await pair(target,'7-days');assert.deepEqual(await state(target),{status:'REVOKED',version:3});assert.equal((await audit(target)).length,1);
        return{observedPostgresBlocking:true,warningCommittedBeforeRevoke:true,warningNotifications:6,finalState:'REVOKED'};
      }finally{
        release();await running;if(changed)await changed;if(!committed)await revoker.query('ROLLBACK').catch(()=>undefined);
        revoker.release();pauseAfterWarnings=undefined;
      }
    });
    await test('OS process termination after enqueue rolls back and real OnModuleInit startup catches up without duplicates', async()=>{
      await reset();const expired=await asset('PROCESS_CRASH_EXPIRED',base-1),warning=await asset('PROCESS_CRASH_WARNING',base+4*day);
      const crashed=startScannerProcess(true);
      try{
        await waitUntil(()=>crashed.output.includes('ENQUEUED')||crashed.closed,'EXPIRY_CHILD_ENQUEUE_NOT_REACHED');
        assert(crashed.output.includes('ENQUEUED'),'The child must insert a real notification before it is killed');
        await stopScannerProcess(crashed);assert.equal(crashed.signal,'SIGKILL');
        await waitUntil(async()=>Number((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND application_name='crypta-expiry-child'")).rows[0].n)===0,'EXPIRY_CRASH_CONNECTION_NOT_CLOSED');
        for(const assetId of [expired,warning]){assert.deepEqual(await state(assetId),{status:'ACTIVE',version:1});assert.equal((await notices(assetId)).length,0);assert.equal((await audit(assetId)).length,0);}
        for(let restart=0;restart<2;restart++){
          const resumed=startScannerProcess(false);
          try{
            await waitUntil(()=>resumed.closed,'EXPIRY_RESTART_DID_NOT_FINISH',10000);
            assert.equal(resumed.code,0);assert(resumed.output.includes('FINISHED'));
          }finally{await stopScannerProcess(resumed);}
          await pair(expired,'expired','ASSET_EXPIRED');await pair(warning,'7-days');
          assert.deepEqual(await state(expired),{status:'EXPIRED',version:2});assert.deepEqual(await state(warning),{status:'EXPIRING_SOON',version:2});
          for(const assetId of [expired,warning]){assert.equal((await notices(assetId)).length,6);assert.equal((await audit(assetId)).length,1);}
        }
        report.processCrashRecoveryCovered=true;
        return{terminationSignal:'SIGKILL',uncommittedRowsRolledBack:true,startupRuns:2,notificationRowsPerAsset:6,transitionAuditsPerAsset:1,hourlyTimerWaited:false};
      }finally{await stopScannerProcess(crashed);}
    });
    report.success = results.length===report.plannedTotal&&results.every(test=>test.passed);
  } catch {
    report.success = false;
    if (!results.some(test => !test.passed)) results.push({ name: 'Harness initialization', passed: false,
      error: 'Isolated harness initialization failed without exposing connection data.' });
  } finally {
    pauseAfterLock = undefined;
    pauseBeforeWarnings = undefined; pauseAfterWarnings = undefined;
    scanner.onModuleDestroy();
    secondScanner.onModuleDestroy();
    for(const child of [...children])await stopScannerProcess(child);
    await pool.end();
  }
  return report;
}

// Host appends main(options) after this script; merely importing never runs DB work.
if (typeof module !== 'undefined') module.exports = { main };
