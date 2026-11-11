// Included by the restricted runtime runner; SMTP is the allocated loopback only.
async function verifyEmailTestOperations({ api, login, sql, test, messages, secretValues, admin, department, readLog, sleep }) {
  const assert = require('node:assert/strict');
  const { randomUUID } = require('node:crypto');
  const initialPassword = 'InitialT28#202611', password = 'ChangedT28#202611';
  secretValues.push(initialPassword, password, 't28-private-smtp-diagnostic');
  const stamp = randomUUID(), actors = [];
  async function prepare() {
    if (actors.length === 6) return;
    for (let index = actors.length; index < 6; index++) {
      const email = `t28-admin-${index}-${stamp}@example.test`;
      await api('POST', '/users', { email, displayName: 'T28 SMTP fixture', departmentId: department.id,
        temporaryPassword: initialPassword, roles: ['ADMIN'], approverDepartmentIds: [] }, admin, 201);
      const first = await login(email, initialPassword);
      await api('POST', '/auth/change-password', { currentPassword: initialPassword, newPassword: password }, first, 200);
      actors.push(await login(email, password));
    }
  }
  const send = (actor, recipient, status) => api('POST', '/notifications/test-email', { email: recipient }, actor, status);
  const mails = recipient => messages.filter(item => item.to === recipient);
  await test('T28 intent audit failure prevents SMTP and leaves a durable HTTP failure', async () => {
    await prepare(); const recipient = 't28-intent@example.test';
    await sql(`CREATE FUNCTION public.t28_reject_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='EMAIL_TEST_REQUESTED' THEN RAISE EXCEPTION 'T28_INTENT_AUDIT_FAULT'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER t28_intent_fault BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.t28_reject_intent()`);
    try {
      const result = await send(actors[0], recipient, 500);
      assert.equal(mails(recipient).length, 0);
      assert.equal((await sql("SELECT count(*)::int AS n FROM audit_logs WHERE actor_id=$1 AND action='EMAIL_TEST_REQUESTED'", [actors[0].user.id])).rows[0].n, 0);
      assert.equal((await sql("SELECT count(*)::int AS n FROM audit_logs WHERE action='HTTP_REQUEST_FAILED' AND metadata->>'correlationId'=$1", [result.correlationId])).rows[0].n, 1);
    } finally { await sql('DROP TRIGGER t28_intent_fault ON audit_logs; DROP FUNCTION public.t28_reject_intent()'); }
    return { smtpData: 0, intentRolledBack: true, httpFailurePersisted: true };
  });
  await test('T28 concurrent test sends commit one shared budget and SMTP message', async () => {
    await prepare(); const recipient = 't28-concurrent@example.test';
    const results = await Promise.all([send(actors[0], recipient), send(actors[0], recipient)]);
    assert.deepEqual(results.map(item => item.status).sort(), [201, 429]);
    const accepted = results.find(item => item.status === 201);
    assert.equal(mails(recipient).length, 1);
    assert(mails(recipient)[0].text.includes(`<email-test-${accepted.data.operationId}@localhost.test>`));
    const rows = (await sql("SELECT action,entity_id,metadata FROM audit_logs WHERE actor_id=$1 AND entity_type='EMAIL_TEST' ORDER BY id", [actors[0].user.id])).rows;
    assert.deepEqual(rows.map(item => item.action), ['EMAIL_TEST_REQUESTED', 'EMAIL_TEST_ACCEPTED']);
    assert(rows.every(item => item.entity_id === accepted.data.operationId && item.metadata.correlationId === accepted.correlationId));
    assert(!JSON.stringify(rows).includes(recipient));
    return { statuses: [201, 429], smtpData: 1, auditRows: 2, stableOperationMessageId: true };
  });
  await test('T28 post-SMTP audit failure records uncertainty and a repeat cannot resend', async () => {
    await prepare(); const recipient = 't28-ack@example.test';
    await sql(`CREATE FUNCTION public.t28_reject_ack() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='EMAIL_TEST_ACCEPTED' THEN RAISE EXCEPTION 'T28_ACK_AUDIT_FAULT'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER t28_ack_fault BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION public.t28_reject_ack()`);
    try {
      const result = await send(actors[1], recipient, 503);
      assert.equal(result.data.error.code, 'SMTP_TEST_ACKNOWLEDGEMENT_FAILED');
      assert.equal(mails(recipient).length, 1);
      await send(actors[1], recipient, 429); assert.equal(mails(recipient).length, 1);
      const rows = (await sql("SELECT action FROM audit_logs WHERE actor_id=$1 AND entity_type='EMAIL_TEST' ORDER BY id", [actors[1].user.id])).rows;
      assert.deepEqual(rows, [{ action: 'EMAIL_TEST_REQUESTED' }]);
      assert(readLog().includes('email.test_acknowledgement_failed'));
    } finally { await sql('DROP TRIGGER t28_ack_fault ON audit_logs; DROP FUNCTION public.t28_reject_ack()'); }
    return { smtpData: 1, acknowledgementFailed: true, immediateRepeatStatus: 429 };
  });
  await test('T28 explicit SMTP refusal and lost DATA acknowledgement remain distinct without retries', async () => {
    await prepare();
    const rejected = await send(actors[2], 't28-reject@example.test', 503);
    assert.equal(rejected.data.error.code, 'SMTP_TEST_REJECTED'); assert.equal(mails('t28-reject@example.test').length, 0);
    const unknown = await send(actors[3], 't28-uncertain@example.test', 503);
    assert.equal(unknown.data.error.code, 'SMTP_TEST_OUTCOME_UNKNOWN'); assert.equal(mails('t28-uncertain@example.test').length, 1);
    const rows = (await sql("SELECT action,metadata FROM audit_logs WHERE actor_id=ANY($1::uuid[]) AND entity_type='EMAIL_TEST' AND action<>'EMAIL_TEST_REQUESTED' ORDER BY id", [[actors[2].user.id, actors[3].user.id]])).rows;
    assert.deepEqual(rows.map(item => item.action), ['EMAIL_TEST_REJECTED', 'EMAIL_TEST_OUTCOME_UNKNOWN']);
    assert.equal(rows[0].metadata.smtpStatus, 550); assert(!JSON.stringify(rows).includes('t28-private-smtp-diagnostic'));
    assert(!readLog().includes('t28-private-smtp-diagnostic'));
    return { refusalSmtpData: 0, unknownSmtpData: 1, sanitizedRefusalStatus: 550, automaticRetries: 0 };
  });
  await test('T28 shared global rate budget spans different Admin actors', async () => {
    await prepare();
    const count = () => mails('t28-global-1@example.test').length + mails('t28-global-2@example.test').length;
    const before = count();
    const results = await Promise.all([send(actors[4], 't28-global-1@example.test'), send(actors[5], 't28-global-2@example.test')]);
    assert.deepEqual(results.map(item => item.status).sort(), [201, 429]);
    assert.equal(count() - before, 1);
    assert.equal((await sql("SELECT count(*)::int AS n FROM audit_logs WHERE action='EMAIL_TEST_REQUESTED' AND occurred_at>clock_timestamp()-INTERVAL '1 minute'")).rows[0].n, 5);
    return { globalLimit: 5, statuses: [201, 429], smtpData: 1 };
  });
  await test('T28 email queue accounting excludes the existing IN_APP records', async () => {
    await sql("UPDATE notifications SET scheduled_for=NOW()+INTERVAL '1 day' WHERE channel='EMAIL' AND delivery_status='PENDING'");
    const until = Date.now() + 5000;
    while ((await sql("SELECT count(*)::int AS n FROM notifications WHERE channel='EMAIL' AND delivery_status='SENDING'")).rows[0].n) {
      assert(Date.now() < until, 'SMTP fixture queue must settle before comparing totals'); await sleep(50);
    }
    const expected = Object.fromEntries((await sql("SELECT delivery_status,count(*)::int AS n FROM notifications WHERE channel='EMAIL' GROUP BY delivery_status")).rows.map(row => [row.delivery_status, row.n]));
    const result = (await api('GET', '/notifications/status', null, admin, 200)).data;
    assert.deepEqual(result.queue, expected);
    const inApp = (await sql("SELECT count(*)::int AS n FROM notifications WHERE channel='IN_APP'")).rows[0].n;
    assert(inApp > 0); return { inAppRowsExcluded: inApp, emailOnlyQueueMatches: true };
  });
}
