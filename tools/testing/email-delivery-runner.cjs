// Runs in an allocated email-test DB inside the validated isolated backend container.
async function main(options) {
  const assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs'), net = require('node:net');
  const { once } = require('node:events');
  assert.match(options.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.match(options.database, /^crypta_email_test_[a-f0-9]{12}$/);
  assert.equal(process.env.CRYPTO_PROVIDER_MODE, 'MOCK'); assert.equal(process.env.SMTP_ENABLED, 'false');
  const url = new URL(process.env.DATABASE_URL); assert.equal(url.hostname, 'postgres'); assert.equal(url.pathname, '/crypta_t30_test'); url.pathname = '/' + options.database;
  require('/app/node_modules/reflect-metadata');
  const { Pool } = require('/app/node_modules/pg'), nodemailer = require('/app/node_modules/nodemailer');
  const { Logger } = require('/app/node_modules/@nestjs/common'); Logger.overrideLogger([]);
  const { MigrationService } = require('/app/dist/database/migration.service');
  const { NotificationsService } = require('/app/dist/notifications/notifications.service');
  const { EmailWorkerService } = require('/app/dist/notifications/email-worker.service');
  const { OperationsMetricsService } = require('/app/dist/operations/operations-metrics.service');
  const { notificationEmail, accountEmail, emailConfiguration } = require('/app/dist/notifications/email-template');
  const { AssetProcessingService } = require('/app/dist/jobs/asset-processing.service');
  const { CryptoProviderService } = require('/app/dist/jobs/crypto-provider.service');
  const pool = new Pool({ connectionString: url.href, max: 6, statement_timeout: 10000 });
  const sql = (query, values) => pool.query(query, values), id = () => crypto.randomUUID();
  const department = id(), owner = id(), otherOwner = id(), policy = id(), policyVersion = id();
  const notifications = new NotificationsService(pool), provider = new CryptoProviderService();
  const results = [], report = { database: options.database, fixtureOnly: false, provider: 'MOCK', smtpEnabled: false,
    loopbackSmtp: true, externalSmtp: false, plannedTotal: 20, results, compiledServiceHashes: Object.fromEntries([
      'notifications/email-template.js', 'notifications/email-worker.service.js', 'notifications/notifications.service.js', 'notifications/asset-alert-recipient.js',
      'jobs/asset-processing.service.js', 'database/migration.service.js',
    ].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync('/app/dist/' + file)).digest('hex')])) };
  const oldFrom = process.env.SMTP_FROM; process.env.SMTP_FROM = 'Crypta <sender@example.invalid>';
  const reset = async () => sql('TRUNCATE notifications,audit_logs,provider_operations,requests,crypto_assets CASCADE');
  async function approved(type = 'CREATE', target = null) {
    const requestId = id();
    await sql(`INSERT INTO requests(id,request_type,creator_id,department_id,policy_version_id,target_asset_id,status,reason,requested_parameters)
      VALUES($1,$2,$3,$4,$5,$6,'APPROVED','Synthetic private reason excluded from mail',$7::jsonb)`,
      [requestId, type, owner, department, policyVersion, target, JSON.stringify(type === 'CREATE' ? { assetType: 'KEY' } : {})]);
    return requestId;
  }
  async function target() {
    const asset = id();
    await sql(`INSERT INTO crypto_assets(id,asset_code,asset_type,owner_id,department_id,policy_version_id,purpose,status,valid_from,expires_at,provider_reference,provider_scope)
      VALUES($1,$2,'KEY',$3,$4,$5,'Synthetic asset purpose','ACTIVE',NOW(),NOW()+INTERVAL '30 days',$6,'MOCK')`, [asset, 'EMAIL-' + asset, owner, department, policyVersion, 'mock-existing-' + asset]);
    await sql("INSERT INTO cryptographic_keys(asset_id,algorithm,key_size,usage,public_key_fingerprint) VALUES($1,'RSA',2048,'SIGNING',$2)", [asset,crypto.createHash('sha256').update(asset).digest('hex')]);
    return asset;
  }
  async function pair(request, type) {
    const rows = (await sql('SELECT recipient_id,type,channel,delivery_status FROM notifications WHERE request_id=$1 AND type=$2 ORDER BY channel', [request, type])).rows;
    assert.deepEqual(rows, [{ recipient_id: owner, type, channel: 'EMAIL', delivery_status: 'PENDING' }, { recipient_id: owner, type, channel: 'IN_APP', delivery_status: 'SENT' }]);
    await notifications.enqueueExecutionResult(pool, request, type);
    assert.equal((await sql('SELECT count(*)::int AS n FROM notifications WHERE request_id=$1 AND type=$2', [request, type])).rows[0].n, 2);
    return { recipients: 1, channels: 2, repeatedEnqueueRows: 2 };
  }
  async function test(name, run) {
    try { results.push({ name, passed: true, evidence: await run() }); }
    catch (error) { results.push({ name, passed: false, error: error instanceof assert.AssertionError ? error.message : error.name + ': ' + String(error.message).slice(0, 200) }); }
  }
  const sockets = new Set(), messages = [], envelopes = [];
  let dataResponse = '250 queued locally', delayDataResponse;
  const server = net.createServer(socket => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {}); socket.setEncoding('utf8');
    socket.write('220 localhost test\r\n'); let buffer = '', data = false, lines = [], recipients = [];
    socket.on('data', chunk => {
      buffer += chunk; let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (data) { if (line === '.') { messages.push(lines.join('\r\n')); envelopes.push(recipients); lines = []; data = false;
          if (delayDataResponse) {
            const delay = delayDataResponse;
            delayDataResponse = undefined;
            delay(() => socket.write(`${dataResponse}\r\n`));
          } else if (dataResponse) socket.write(`${dataResponse}\r\n`); else socket.destroy();
        } else lines.push(line.replace(/^\.\./, '.')); }
        else if (/^(EHLO|HELO) /.test(line)) socket.write('250 localhost\r\n');
        else if (/^MAIL FROM:/.test(line)) { recipients = []; socket.write('250 ok\r\n'); }
        else if (/^RCPT TO:/.test(line)) { recipients.push(line); socket.write('250 ok\r\n'); }
        else if (line === 'DATA') { data = true; socket.write('354 end with dot\r\n'); }
        else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  let transport;
  try {
    await new MigrationService(pool).applyPending();
    await sql("INSERT INTO departments(id,code,name) VALUES($1,'EMAIL_TEST','Email test')", [department]);
    await sql(`INSERT INTO users(id,department_id,email,password_hash,display_name) VALUES
      ($1,$3,'first@example.invalid','not-a-login-credential','Nguyễn A <img src=x onerror=alert(1)>'),
      ($2,$3,'second@example.invalid','not-a-login-credential','Trần B')`, [owner, otherOwner, department]);
    const adminRole=id();await sql("INSERT INTO roles(id,code,name) VALUES($1,'ADMIN','Fixture Admin')",[adminRole]);
    await sql('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)',[otherOwner,adminRole]);
    await sql("INSERT INTO policies(id,code,name) VALUES($1,'EMAIL_TEST','Email test')", [policy]);
    await sql(`INSERT INTO policy_versions(id,policy_id,version,configuration) VALUES($1,$2,1,'{"algorithm":"RSA","minimum_key_size":2048,"maximum_validity_days":90}')`, [policyVersion, policy]);
    for (const type of ['CREATE', 'RENEW', 'REVOKE']) await test(`${type} completion enqueues exactly one owner result per channel in the worker transaction`, async () => {
      await reset(); const asset = type === 'CREATE' ? null : await target(), request = await approved(type, asset);
      const worker = new AssetProcessingService(pool, provider, notifications), job = await worker.claim(); await worker.process(job);
      assert.equal((await sql('SELECT status FROM requests WHERE id=$1', [request])).rows[0].status, 'COMPLETED');
      const evidence = await pair(request, 'REQUEST_COMPLETED'); await worker.run(); await pair(request, 'REQUEST_COMPLETED'); return evidence;
    });
    await test('an uncertain provider outcome notifies the owner without replaying work', async () => {
      await reset(); const request = await approved(); let calls = 0;
      const worker = new AssetProcessingService(pool, { provision: async () => { calls++; throw new Error('CRYPTO_PROVIDER_TIMEOUT'); } }, notifications);
      await worker.process(await worker.claim()); const evidence = await pair(request, 'REQUEST_RECONCILIATION_REQUIRED'); await worker.run();
      assert.equal(calls, 1); return { ...evidence, providerCalls: calls };
    });
    await test('a completion notification insert failure rolls back result asset and completion before safe reconciliation', async () => {
      await reset(); const request = await approved();
      await sql(`CREATE FUNCTION email_test_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='REQUEST_COMPLETED' THEN RAISE EXCEPTION 'synthetic notification fault'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER email_test_guard BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION email_test_guard();`);
      try {
        const worker = new AssetProcessingService(pool, provider, notifications); await worker.process(await worker.claim());
        assert.equal((await sql('SELECT count(*)::int AS n FROM crypto_assets')).rows[0].n, 0);
        assert.equal((await sql("SELECT count(*)::int AS n FROM audit_logs WHERE action='ASSET_CREATED'")).rows[0].n, 0);
        const row = (await sql('SELECT status,provider_reference FROM provider_operations WHERE request_id=$1', [request])).rows[0];
        assert.equal(row.status, 'RECONCILIATION_REQUIRED'); assert.ok(row.provider_reference);
        return await pair(request, 'REQUEST_RECONCILIATION_REQUIRED');
      } finally { await sql('DROP TRIGGER email_test_guard ON notifications;DROP FUNCTION email_test_guard();'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    transport = nodemailer.createTransport({ host: '127.0.0.1', port: server.address().port, secure: false, ignoreTLS: true, connectionTimeout: 2000, socketTimeout: 3000 });
    await transport.verify(); const captured = [];
    const mailWorker = () => { const worker = new EmailWorkerService(pool); worker.transporter = { sendMail: async options => { captured.push(options); return transport.sendMail(options); } }; return worker; };
    await test('two email workers claim different rows and deliver stable Message-IDs over loopback SMTP', async () => {
      await reset(); const request = await approved(), asset = await target(); await sql("UPDATE requests SET status='COMPLETED',result_asset_id=$2,completed_at=NOW() WHERE id=$1", [request, asset]); await notifications.enqueueExecutionResult(pool, request, 'REQUEST_COMPLETED');
      await sql("INSERT INTO notifications(recipient_id,request_id,type,channel,deduplication_key) VALUES($1,$2,'REQUEST_APPROVED','EMAIL',$3)", [owner, request, id()]);
      const first = mailWorker(), second = mailWorker(), jobs = await Promise.all([first.claim(), second.claim()]);
      assert.ok(jobs[0] && jobs[1] && jobs[0].id !== jobs[1].id);
      await Promise.all([first.deliver(jobs[0]), second.deliver(jobs[1])]);
      assert.equal((await sql("SELECT count(*)::int AS n FROM notifications WHERE channel='EMAIL' AND delivery_status='SENT' AND attempt_count=1")).rows[0].n, 2);
      for (const job of jobs) assert.ok(captured.some(value => value.messageId === `<notification-${job.id}@example.invalid>`));
      return { distinctClaims: 2, sent: 2, attemptsEach: 1, stableMessageIds: true };
    });
    const notificationTypes = ['REQUEST_SUBMITTED','REQUEST_APPROVED','REQUEST_REJECTED','REQUEST_COMPLETED','REQUEST_RECONCILIATION_REQUIRED','REQUEST_FAILED','ASSET_EXPIRING','ASSET_EXPIRED','ASSET_REVOKED'];
    const recipient = id(), approverRole = id();
    await sql("INSERT INTO users(id,department_id,email,password_hash,display_name) VALUES($1,$2,'approver@example.invalid','fixture','Fixture Approver')",[recipient,department]);
    await sql("INSERT INTO roles(id,code,name) VALUES($1,'APPROVER','Fixture Approver')",[approverRole]);
    await sql('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)',[recipient,approverRole]);
    const grantScope = () => sql('INSERT INTO approver_scopes(user_id,department_id) VALUES($1,$2)',[recipient,department]);
    await grantScope();
    await test('all nine operational notification types reach loopback SMTP with isolated recipients and correct links', async () => {
      await reset(); captured.length = 0; const request = await approved(), asset = await target();
      for (const [index, type] of notificationTypes.entries()) await sql('INSERT INTO notifications(recipient_id,request_id,asset_id,type,channel,deduplication_key) VALUES($1,$2,$3,$4,\'EMAIL\',$5)', [type === 'REQUEST_SUBMITTED' ? recipient : index % 2 ? otherOwner : owner, type.startsWith('REQUEST_') ? request : null, type.startsWith('ASSET_') ? asset : null, type, id()]);
      const worker = mailWorker(); await worker.processBatch(); assert.equal(captured.length, notificationTypes.length);
      for (const mail of captured) {
        assert.ok(mail.html.includes(process.env.APP_URL)); assert.ok(mail.text.includes('(Asia/Ho_Chi_Minh)')); assert.ok(!mail.html.includes('<img'));
        assert.ok(!mail.text.includes('Synthetic private reason'));
        assert.ok(mail.to === 'first@example.invalid' ? !mail.text.includes('Trần B') : !mail.text.includes('Nguyễn A'));
      }
      assert.equal((await sql("SELECT count(*)::int AS n FROM notifications WHERE delivery_status='SENT'")).rows[0].n, notificationTypes.length);
      return { types: notificationTypes.length, sent: captured.length, recipientIsolation: true, privateReasonAbsent: true, escapedHtml: true };
    });
    await test('invalid link configuration fails before SMTP and records a known unsent row', async () => {
      await reset(); const request = await approved(); await sql("INSERT INTO notifications(recipient_id,request_id,type,channel,deduplication_key) VALUES($1,$2,'REQUEST_APPROVED','EMAIL',$3)", [owner, request, id()]);
      const worker = mailWorker(), job = await worker.claim(), prior = process.env.APP_URL, before = messages.length;
      try { process.env.APP_URL = 'https://secret:secret@example.invalid/?token=secret'; await worker.deliver(job); }
      finally { process.env.APP_URL = prior; }
      const row = (await sql('SELECT delivery_status,error_message FROM notifications WHERE id=$1', [job.id])).rows[0];
      assert.deepEqual(row, { delivery_status: 'FAILED', error_message: 'Email content could not be prepared' }); assert.equal(messages.length, before);
      return { smtpCalls: 0, status: row.delivery_status, secretAbsent: true };
    });
    await test('A former scoped Approver receives no queued expiry email or restricted notification metadata',async()=>{
      await reset();captured.length=0;const asset=await target();
      await notifications.enqueueAsset(pool,asset,'ASSET_EXPIRING','7-days');
      assert.equal((await sql("SELECT count(*)::int AS n FROM notifications WHERE asset_id=$1",[asset])).rows[0].n,6);
      const worker=mailWorker();await worker.processBatch();assert.equal(captured.length,3);
      assert(captured.some(mail=>mail.to==='approver@example.invalid'));
      const laterAsset=await target();await notifications.enqueueAsset(pool,laterAsset,'ASSET_EXPIRING','7-days');captured.length=0;
      await sql('DELETE FROM approver_scopes WHERE user_id=$1',[recipient]);
      await worker.processBatch();
      assert.equal(captured.length,2);assert(!captured.some(mail=>mail.to==='approver@example.invalid'));
      const failed=(await sql("SELECT delivery_status,error_message FROM notifications WHERE recipient_id=$1 AND asset_id=$2 AND channel='EMAIL'",[recipient,laterAsset])).rows;
      assert.deepEqual(failed,[{delivery_status:'FAILED',error_message:'Email content could not be prepared'}]);
      const page=await notifications.list(recipient,{page:'1',pageSize:'25'});assert.equal(page.total,2);assert(page.items.every(item=>item.assetCode===null));
      assert.equal((await notifications.list(recipient,{page:'1',pageSize:'25',search:(await sql('SELECT asset_code FROM crypto_assets WHERE id=$1',[asset])).rows[0].asset_code})).total,0);
      return{authorizedSmtpMessagesBeforeRevocation:3,authorizedSmtpMessagesAfterRevocation:2,formerApproverSmtpMessagesAfterRevocation:0,restrictedAssetMetadataHidden:true};
    });
    await test('startup rejects invalid link configuration before connecting to SMTP', async () => {
      const before = messages.length, previous = process.env.SMTP_ENABLED, oldUrl = process.env.APP_URL;
      try { process.env.SMTP_ENABLED = 'true'; process.env.APP_URL = 'http://external.example.invalid'; await assert.rejects(new EmailWorkerService(pool).onModuleInit(), { message: 'EMAIL_APP_URL_INVALID' }); }
      finally { process.env.SMTP_ENABLED = previous; process.env.APP_URL = oldUrl; }
      assert.equal(messages.length, before); return { invalidConfigurationRejected: true };
    });
    const config = emailConfiguration(process.env), previewRequest = '11111111-1111-1111-1111-111111111111', previewAsset = '22222222-2222-2222-2222-222222222222';
    report.previews = notificationTypes.map(type => ({ type, activeFlow: true,
      ...notificationEmail({ type, recipientName: 'Nguyễn Minh Anh', requestId: previewRequest, assetId: previewAsset, occurredAt: '2026-11-06T01:02:00Z', expiresAt: '2026-12-01T01:02:00Z' }, config) }));
    for (const purpose of ['INVITATION', 'PASSWORD_RESET']) report.previews.push({ type: purpose, activeFlow: false, ...accountEmail({ purpose, recipientName: 'Nguyễn Minh Anh', actionToken: 'A'.repeat(43), issuedAt: new Date('2026-11-06T01:00:00Z'), expiresAt: new Date('2026-11-06T02:00:00Z') }, config) });
    report.smtpMessages = messages.length; report.smtpRecipients = envelopes.length;
    await test('SMTP DATA preserves stable Message-ID headers including folded MIME headers', async () => {
      const headers = messages.map(message => message.match(/^Message-ID:\s*<([^>]+)>/im)?.[1]);
      report.messageIds = headers;
      assert.equal(messages.length, notificationTypes.length + 7);
      assert.ok(headers.every(header => /^notification-[0-9a-f-]+@example.invalid$/.test(header)));
      return { receivedDataMessages: messages.length, validStableMessageIds: headers.length };
    });
    await test('Queued submission email is blocked when Approver scope is removed before sending', async () => {
      await reset();
      await grantScope();
      const request = await approved();
      await notifications.enqueueRequestSubmitted(pool, request, department);
      await sql('DELETE FROM approver_scopes WHERE user_id=$1', [recipient]);
      const before = messages.length;
      await mailWorker().processBatch();
      assert.equal(messages.length, before);
      const { rows } = await sql(`SELECT channel,delivery_status,attempt_count,error_message FROM notifications
        WHERE recipient_id=$1 AND request_id=$2 ORDER BY channel`, [recipient, request]);
      assert.deepEqual(rows, [
        { channel: 'EMAIL', delivery_status: 'FAILED', attempt_count: 1, error_message: 'Email content could not be prepared' },
        { channel: 'IN_APP', delivery_status: 'SENT', attempt_count: 0, error_message: null },
      ]);
      return { scopeRemovedAfterEnqueue: true, smtpDataCommands: 0 };
    });
    async function pendingEmail() {
      const request = await approved();
      const notification = id();
      await sql(`INSERT INTO notifications(id,recipient_id,request_id,type,channel,deduplication_key)
        VALUES($1::uuid,$2,$3,'REQUEST_APPROVED','EMAIL',$1::uuid::text)`, [notification, owner, request]);
      return notification;
    }
    async function deliveryState(notification) {
      const { rows } = await sql(`SELECT delivery_status AS status,attempt_count AS attempts,failed_at IS NOT NULL AS failed,
        sent_at IS NOT NULL AS sent,scheduled_for>clock_timestamp() AS scheduled_later,error_message
        FROM notifications WHERE id=$1`, [notification]);
      return rows[0];
    }
    await test('Explicit SMTP replies enforce backoff, five-attempt limit and stable Message-ID', async () => {
      await reset();
      const notification = await pendingEmail();
      const before = messages.length;
      try {
        dataResponse = '451 synthetic temporary rejection';
        for (let attempts = 1; attempts <= 5; attempts++) {
          await mailWorker().processBatch();
          assert.deepEqual(await deliveryState(notification), { status: attempts === 5 ? 'FAILED' : 'PENDING',
            attempts, failed: attempts === 5, sent: false, scheduled_later: true, error_message: 'SMTP rejected delivery (451)' });
          await mailWorker().processBatch();
          assert.equal(messages.length - before, attempts);
          await sql('UPDATE notifications SET scheduled_for=NOW() WHERE id=$1', [notification]);
        }
        await mailWorker().processBatch();
        assert.equal(messages.length - before, 5);
        const headers = messages.slice(before).map(message => message.match(/^Message-ID:\s*(<[^>]+>)/im)?.[1]);
        assert.deepEqual([...new Set(headers)], [`<notification-${notification}@example.invalid>`]);
        const rejected = await pendingEmail();
        dataResponse = '550 synthetic permanent rejection';
        await mailWorker().processBatch();
        assert.deepEqual(await deliveryState(rejected), { status: 'FAILED', attempts: 1, failed: true, sent: false,
          scheduled_later: true, error_message: 'SMTP rejected delivery (550)' });
        return { temporaryAttempts: 5, permanentAttempts: 1, stableMessageId: true, retriedBeforeDue: false };
      } finally { dataResponse = '250 queued locally'; }
    });
    await test('An already-exhausted pending row cannot send a sixth SMTP message or block another email', async () => {
      await reset();
      const exhausted = await pendingEmail(), fresh = await pendingEmail();
      await sql(`UPDATE notifications SET attempt_count=5,scheduled_for=NOW()-INTERVAL '1 minute' WHERE id=$1`, [exhausted]);
      const before = messages.length;
      await Promise.all([mailWorker().processBatch(), mailWorker().processBatch()]);
      const row = await deliveryState(exhausted);
      assert.deepEqual([row.status, row.attempts, row.failed, row.sent], ['FAILED', 5, true, false]);
      assert.equal((await deliveryState(fresh)).status, 'SENT');
      assert.equal(messages.length - before, 1);
      assert.ok(messages[before].includes(`<notification-${fresh}@example.invalid>`));
      return { exhaustedAttempts: row.attempts, exhaustedSends: 0, freshSends: 1 };
    });
    await test('SMTP disconnect after DATA and stale Sending are held for reconciliation across workers', async () => {
      await reset();
      const ambiguous = await pendingEmail(), stale = await pendingEmail();
      const before = messages.length;
      await sql(`UPDATE notifications SET delivery_status='SENDING',attempt_count=1,claimed_at=NOW()-INTERVAL '11 minutes' WHERE id=$1`, [stale]);
      try { dataResponse = null; await mailWorker().processBatch(); }
      finally { dataResponse = '250 queued locally'; }
      for (const notification of [ambiguous, stale]) {
        const row = await deliveryState(notification);
        assert.equal(row.status, 'RECONCILIATION_REQUIRED');
        assert.equal(row.attempts, 1);
        assert.equal(row.sent || row.failed, false);
      }
      await Promise.all([mailWorker().processBatch(), mailWorker().processBatch()]);
      assert.equal(messages.length - before, 1);
      return { disconnectedAfterData: 1, staleSending: 1, replayed: 0 };
    });
    await test('an interrupted attempt cannot use SMTP after a new attempt is claimed', async () => {
      await reset();
      const notification = await pendingEmail();
      const first = mailWorker(), second = mailWorker(), original = await first.claim();
      await sql("UPDATE notifications SET claimed_at=NOW()-INTERVAL '11 minutes' WHERE id=$1", [notification]);
      const before = messages.length;
      await first.deliver(original);
      assert.equal(messages.length, before, 'An expired claim cannot send before recovery even runs');
      await second.reconcileStuck();
      assert.equal((await deliveryState(notification)).status, 'RECONCILIATION_REQUIRED');
      // Simulate a later authorized retry in this isolated fixture only.
      await sql("UPDATE notifications SET delivery_status='PENDING',scheduled_for=NOW() WHERE id=$1", [notification]);
      const replacement = await second.claim();
      assert.equal(replacement.attempt_count, original.attempt_count + 1);
      await first.deliver(original);
      assert.equal(messages.length, before, 'The old claim cannot send on a new generation');
      await second.deliver(replacement);
      assert.equal(messages.length, before + 1);
      assert.equal((await deliveryState(notification)).status, 'SENT');
      return { expiredClaimSends: 0, staleGenerationSends: 0, replacementSends: 1 };
    });
    function holdSmtp(worker, job) {
      const observed = new Promise(resolve => { delayDataResponse = resolve; });
      const done = worker.deliver(job);
      const received = Promise.race([observed, done.then(() => { throw new Error('Worker finished before SMTP DATA'); })]);
      return { received, done };
    }
    await test('worker holds the claim while waiting for SMTP and recovery skips a locked stale row', async () => {
      await reset();
      const notification = await pendingEmail(), stale = await pendingEmail();
      await sql("UPDATE notifications SET delivery_status='SENDING',attempt_count=1,claimed_at=NOW()-INTERVAL '11 minutes' WHERE id=$1", [stale]);
      const first = mailWorker(), second = mailWorker();
      const job = await first.claim();
      assert.equal(job.id, notification);
      const smtp = holdSmtp(first, job);
      const blocker = await pool.connect();
      let reply;
      try {
        reply = await smtp.received;
        await assert.rejects(blocker.query('SELECT 1 FROM notifications WHERE id=$1 FOR UPDATE NOWAIT', [notification]), { code: '55P03' });
        await blocker.query('BEGIN');
        await blocker.query('SELECT 1 FROM notifications WHERE id=$1 FOR UPDATE', [stale]);
        await second.reconcileStuck();
        assert.equal((await deliveryState(stale)).status, 'SENDING');
      } finally {
        await blocker.query('ROLLBACK').finally(() => blocker.release());
        reply?.();
        delayDataResponse = undefined;
        await smtp.done;
      }
      assert.equal((await deliveryState(notification)).status, 'SENT');
      await second.reconcileStuck();
      assert.equal((await deliveryState(stale)).status, 'RECONCILIATION_REQUIRED');
      return { smtpProtectedByRowLock: true, lockedStaleRowSkipped: true, recoveredAfterUnlock: true };
    });
    await test('a PostgreSQL disconnect while SMTP is acknowledging leaves the claim for reconciliation', async () => {
      await reset();
      const notification = await pendingEmail(), worker = mailWorker();
      const before = messages.length;
      const smtp = holdSmtp(worker, await worker.claim());
      let reply;
      try {
        reply = await smtp.received;
        const { rows } = await sql(`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
          AND state='idle in transaction' AND query LIKE '%AND n.attempt_count=$2%'`);
        assert.equal(rows.length, 1);
        assert.equal((await sql('SELECT pg_terminate_backend($1) AS terminated', [rows[0].pid])).rows[0].terminated, true);
      } finally {
        reply?.();
        delayDataResponse = undefined;
        await smtp.done;
      }
      assert.equal((await deliveryState(notification)).status, 'SENDING');
      await sql("UPDATE notifications SET claimed_at=NOW()-INTERVAL '11 minutes' WHERE id=$1", [notification]);
      await mailWorker().processBatch();
      assert.equal((await deliveryState(notification)).status, 'RECONCILIATION_REQUIRED');
      assert.equal(messages.length - before, 1);
      return { postgresTerminatedAfterData: true, smtpMessages: 1, replayed: 0 };
    });
    await test('an audited retry waits for its schedule and worker rechecks the current recipient', async () => {
      await reset();
      const actor = { id: otherOwner, tokenVersion: 1 };
      const before = messages.length;
      const schedule = async () => {
        const notification = await pendingEmail();
        await sql("UPDATE notifications SET delivery_status='RECONCILIATION_REQUIRED',attempt_count=1 WHERE id=$1", [notification]);
        const proof = { evidenceReference: 'SMTP-LOOPBACK-2041', attemptCount: 1 };
        await notifications.reconcileDelivery(actor, notification, { ...proof, outcome: 'UNSENT' });
        const queued = await notifications.retryDelivery(actor, notification, proof);
        assert.equal(queued.status, 'PENDING');
        assert.equal((await deliveryState(notification)).attempts, 1);
        return notification;
      };
      const first = await schedule();
      await mailWorker().processBatch();
      assert.equal(messages.length, before);
      await sql('UPDATE notifications SET scheduled_for=NOW() WHERE id=$1', [first]);
      await mailWorker().processBatch();
      assert.equal((await deliveryState(first)).status, 'SENT');
      assert.equal((await deliveryState(first)).attempts, 2);
      assert.equal(messages.length, before + 1);
      const inactive = await schedule();
      await sql("UPDATE users SET status='INACTIVE' WHERE id=$1", [owner]);
      try {
        await sql('UPDATE notifications SET scheduled_for=NOW() WHERE id=$1', [inactive]);
        await mailWorker().processBatch();
        assert.equal((await deliveryState(inactive)).status, 'FAILED');
        assert.equal(messages.length, before + 1);
      } finally { await sql("UPDATE users SET status='ACTIVE' WHERE id=$1", [owner]); }
      return { sentBeforeDue: 0, sentAfterDue: 1, sendsToInactiveRecipient: 0, attemptIncrementedAtClaim: true };
    });
    await test('email queue and worker signals are shared between replicas and recover after a successful poll', async () => {
      await reset();
      await sql('UPDATE public.email_worker_status SET initialized_at=NOW(),last_poll_at=NULL,last_poll_succeeded=NULL');
      const pending = await pendingEmail();
      await sql("UPDATE notifications SET scheduled_for=NOW()-INTERVAL '6 minutes' WHERE id=$1", [pending]);
      const reader = new Pool({ connectionString: url.href, max: 1 });
      const metrics = new OperationsMetricsService(reader);
      const overview = new NotificationsService(reader);
      const savedSetting = process.env.SMTP_ENABLED;
      async function check(state, signal, queueDelayed) {
        const status = await overview.status();
        const snapshot = await metrics.snapshot();
        assert.deepEqual(snapshot.email.worker, status.worker);
        assert.equal(status.worker.state, state);
        assert.equal(status.queueDelayed, queueDelayed);
        const signals = snapshot.signals.filter(code => code.startsWith('EMAIL_WORKER_'));
        assert.deepEqual(signals, signal ? [signal] : []);
        return status;
      }
      try {
        process.env.SMTP_ENABLED = 'true';
        const initial = await check('AWAITING', undefined, true);
        assert.deepEqual(initial.queue, { PENDING: 1 });
        assert.ok(initial.oldestDueSeconds >= 360);
        const brokenWorker = mailWorker();
        brokenWorker.claim = async () => { throw new Error('synthetic poll failure'); };
        await brokenWorker.processBatch();
        const failed = await check('FAILED', 'EMAIL_WORKER_FAILED', true);
        assert.ok(failed.worker.lastPollAt);
        assert.equal(failed.worker.lastPollSucceeded, false);
        await sql("UPDATE public.email_worker_status SET last_poll_at=NOW()-INTERVAL '6 minutes'");
        await check('STALE', 'EMAIL_WORKER_STALE', true);
        await mailWorker().processBatch();
        const recovered = await check('RECENT', undefined, false);
        assert.deepEqual(recovered.queue, { SENT: 1 });
        assert.equal(recovered.oldestDueSeconds, null);
        assert.equal(recovered.worker.lastPollSucceeded, true);
        process.env.SMTP_ENABLED = 'false';
        await check('DISABLED', undefined, false);
        return { replicas: 2, awaiting: true, failed: true, stale: true, recovered: true, disabled: true, smtpOnly: true };
      } finally {
        if (savedSetting === undefined) delete process.env.SMTP_ENABLED; else process.env.SMTP_ENABLED = savedSetting;
        await reader.end();
      }
    });
    report.success = results.length === report.plannedTotal && results.every(value => value.passed);
    return report;
  } finally {
    transport?.close(); for (const socket of sockets) socket.destroy(); if (server.listening) await new Promise(resolve => server.close(resolve));
    if (oldFrom === undefined) delete process.env.SMTP_FROM; else process.env.SMTP_FROM = oldFrom;
    await pool.end();
  }
}
