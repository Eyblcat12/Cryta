// Called by the restricted runtime runner after its baseline checks.
async function verifyAccountActions({ api, login, sql, test, sleep, startApi, stopApi, readLog }) {
  const assert = require('node:assert/strict');
  const { createHash, randomBytes } = require('node:crypto');
  const { createServer } = require('node:net');
  const messages = [];
  const sockets = new Set();
  const key = randomBytes(32).toString('hex');
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('utf8');
    socket.write('220 localhost Crypta fixture\r\n');
    let buffer = '', data = '', to = '', inData = false;
    socket.on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') {
            messages.push({ to, text: data.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16))) });
            if (to === 't28-uncertain@example.test') socket.destroy();
            else socket.write('250 captured locally\r\n');
            inData = false;
            data = '';
          } else data += `${line}\r\n`;
        } else if (/^(EHLO|HELO|MAIL FROM|RSET|NOOP)\b/i.test(line)) {
          socket.write('250 localhost\r\n');
        } else if (/^RCPT TO:/i.test(line)) {
          to = /<([^>]+)>/.exec(line)?.[1];
          socket.write(to === 't28-reject@example.test' ? '550 t28-private-smtp-diagnostic\r\n' : '250 captured recipient\r\n');
        } else if (line === 'DATA') {
          inData = true;
          socket.write('354 send data\r\n');
        } else if (line === 'QUIT') socket.end('221 closing\r\n');
        else socket.write('500 unknown\r\n');
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const secretValues = [key];
  let admin, department, invite, inviteToken, resetToken, priorSession;
  const inviteEmail = 't07-invite@example.test';
  const resetEmail = 'dev.nguyen@congty.com';
  const invitePassword = 'InviteTest#202611';
  const resetPassword = 'ResetTest#202611';
  secretValues.push(invitePassword, resetPassword);
  async function received(email, route) {
    const deadline = Date.now() + 16000;
    while (Date.now() < deadline) {
      for (const message of messages.filter(message => message.to === email).reverse()) {
        const match = new RegExp(`/account/${route}#token=([A-Za-z0-9_-]{43})`).exec(message.text);
        if (match) { secretValues.push(match[1]); return match[1]; }
      }
      await sleep(150);
    }
    throw new Error('SMTP_ACCOUNT_LINK_NOT_CAPTURED');
  }
  const complete = (route, token, newPassword, status) => api('POST', '/auth/' + route, { token, newPassword }, null, status);
  const hash = value => createHash('sha256').update(value).digest('hex');
  try {
    await stopApi();
    // Other integration cases leave due mail in this disposable database. Defer it
    // so the account-action cases exercise SMTP without waiting behind unrelated jobs.
    await sql(`UPDATE notifications SET scheduled_for=NOW()+INTERVAL '1 day'
      WHERE channel='EMAIL' AND delivery_status='PENDING' AND account_action_id IS NULL AND scheduled_for<=NOW()`);
    await startApi({ ACCOUNT_ACTIONS_ENABLED: 'true', ACCOUNT_ACTION_KEY: key, SMTP_ENABLED: 'true',
      SMTP_HOST: '127.0.0.1', SMTP_PORT: String(server.address().port), SMTP_USER: '', SMTP_PASSWORD: '',
      SMTP_SECURE: 'false', SMTP_FROM: 'crypta@localhost.test', APP_URL: 'https://crypta.example.test' });
    await test('T07 only Admin can invite and the account cannot activate without its invitation', async () => {
      assert.equal((await api('GET', '/auth/account-actions', null, null, 200)).data.enabled, true);
      const activeAdmin = (await sql(`SELECT u.email FROM users u JOIN user_roles ur ON u.id=ur.user_id JOIN roles r ON r.id=ur.role_id
        WHERE u.status='ACTIVE' AND r.code='ADMIN' ORDER BY u.email LIMIT 1`)).rows[0];
      admin = await login(activeAdmin.email);
      priorSession = await login(resetEmail);
      const reference = (await api('GET', '/users/reference-data', null, admin, 200)).data;
      department = reference.departments.find(row => row.code === 'IT');
      const body = { email: inviteEmail, displayName: 'T07 Invitation Fixture', departmentId: department.id, roles: ['USER'], approverDepartmentIds: [] };
      await api('POST', '/users/invitations', body, null, 401);
      await api('POST', '/users/invitations', body, priorSession, 403);
      invite = (await api('POST', '/users/invitations', body, admin, 201)).data;
      assert.equal(invite.status, 'INACTIVE');
      assert.equal(invite.invitationPending, true);
      assert.equal(Object.keys(invite).some(key => /token|passwordHash|temporaryPassword/i.test(key)), false);
      await api('POST', '/auth/login', { email: inviteEmail, password: invitePassword }, null, 401);
      await api('PATCH', '/users/' + invite.id + '/status', { status: 'ACTIVE' }, admin, 409);
      await api('POST', '/users/' + invite.id + '/invitation', null, admin, 409);
      return { adminOnly: true, initiallyInactive: true, earlyResendRejected: true };
    });
    await test('T07 reset response matches for known and unknown addresses and requests coalesce', async () => {
      const known = await api('POST', '/auth/password-reset', { email: resetEmail }, null, 202);
      const unknown = await api('POST', '/auth/password-reset', { email: 't07-unknown@example.test' }, null, 202);
      assert.deepEqual(known.data, { accepted: true });
      assert.deepEqual(unknown.data, known.data);
      await Promise.all(Array.from({ length: 5 }, () => api('POST', '/auth/password-reset', { email: resetEmail }, null, 202)));
      const count = (await sql(`SELECT count(*)::int AS count FROM account_actions WHERE purpose='PASSWORD_RESET'`)).rows[0].count;
      assert.equal(count, 1);
      assert.equal((await sql(`SELECT max(attempt_count) AS count FROM account_action_limits WHERE bucket_key LIKE 'reset:%'`)).rows[0].count, 3);
      return { identicalResponses: true, issued: count, perAddressLimit: 3 };
    });
    await test('T07 SMTP delivers purpose-bound links whose hashes match the stored credentials', async () => {
      [inviteToken, resetToken] = await Promise.all([received(inviteEmail, 'activate'), received(resetEmail, 'reset-password')]);
      assert.ok(inviteToken !== resetToken);
      for (const [token, purpose] of [[inviteToken, 'INVITATION'], [resetToken, 'PASSWORD_RESET']]) {
        // Capturing SMTP DATA precedes the worker's acknowledgement and DB commit.
        // Wait only for that in-flight commit; terminal failures still fail the test.
        const deadline = Date.now() + 8000;
        let row;
        do {
          row = (await sql(`SELECT a.purpose,n.delivery_status FROM account_actions a JOIN notifications n ON a.id=n.account_action_id WHERE a.token_hash=$1`, [hash(token)])).rows[0];
          if (row?.delivery_status !== 'SENDING') break;
          await sleep(100);
        } while (Date.now() < deadline);
        assert.equal(row?.purpose, purpose);
        assert.equal(row?.delivery_status, 'SENT');
      }
      assert.ok(messages.filter(m => m.to === inviteEmail || m.to === resetEmail).every(m => !m.text.includes(key)));
      await complete('password-reset/complete', inviteToken, invitePassword, 400);
      await complete('invitation/accept', resetToken, resetPassword, 400);
      return { smtpHost: '127.0.0.1', purposeMismatchRejected: true, storedHashesMatch: true };
    });
    await test('T07 invite and reset consume a link once and revoke the previous sessions', async () => {
      const concurrent = await Promise.all([complete('invitation/accept', inviteToken, invitePassword), complete('invitation/accept', inviteToken, invitePassword)]);
      assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 400]);
      assert.ok(await login(inviteEmail, invitePassword));
      await sql(`CREATE FUNCTION public.runtime_test_reject_reset_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action='USER_PASSWORD_RESET' THEN RAISE EXCEPTION 'RUNTIME_TEST_RESET_AUDIT_FAILURE'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER runtime_test_reset_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION runtime_test_reject_reset_audit()`);
      try {
        await complete('password-reset/complete', resetToken, resetPassword, 500);
        await api('GET', '/auth/me', null, priorSession, 200);
        assert.equal((await sql('SELECT used_at FROM account_actions WHERE token_hash=$1', [hash(resetToken)])).rows[0].used_at, null);
        assert.equal((await sql(`SELECT count(*)::int AS count FROM notifications WHERE type='PASSWORD_RESET_COMPLETED'`)).rows[0].count, 0);
      } finally {
        await sql('DROP TRIGGER runtime_test_reset_audit ON audit_logs; DROP FUNCTION public.runtime_test_reject_reset_audit()');
      }
      const reset = await complete('password-reset/complete', resetToken, resetPassword, 200);
      assert.deepEqual(reset.data, { changed: true, loginRequired: true });
      assert.equal(reset.cookie, undefined);
      await complete('password-reset/complete', resetToken, resetPassword, 400);
      await api('GET', '/auth/me', null, priorSession, 401);
      await api('POST', '/auth/refresh', null, priorSession, 401);
      await api('POST', '/auth/login', { email: resetEmail, password: 'Password@123' }, null, 401);
      assert.ok(await login(resetEmail, resetPassword));
      const audits = (await sql(`SELECT action,metadata FROM audit_logs WHERE action IN ('USER_INVITATION_ACCEPTED','USER_PASSWORD_RESET') ORDER BY action`)).rows;
      assert.deepEqual(audits.map(row=>row.action), ['USER_INVITATION_ACCEPTED', 'USER_PASSWORD_RESET']);
      for(const row of audits){assert.deepEqual(Object.keys(row.metadata),['correlationId']);assert.match(row.metadata.correlationId,/^req_[0-9a-f-]{36}$/);}
      const notification = (await sql(`SELECT count(*)::int AS count FROM notifications WHERE type='PASSWORD_RESET_COMPLETED'`)).rows[0].count;
      assert.equal(notification, 1);
      return { concurrentInvitationStatuses: [200, 400], consumedResetRejected: true, accessRevoked: true, refreshRevoked: true, auditRollback: true, auditWithoutCredentials: true };
    });
    await test('T07 expired and replaced links cannot set a password', async () => {
      const email = 't07-expire@example.test';
      const user = (await api('POST', '/users/invitations', { email, displayName: 'T07 Expiry Fixture', departmentId: department.id, roles: ['USER'], approverDepartmentIds: [] }, admin, 201)).data;
      const first = await received(email, 'activate');
      await sql(`UPDATE account_actions SET created_at=clock_timestamp()-INTERVAL '1 day',expires_at=clock_timestamp()-INTERVAL '1 second' WHERE user_id=$1`, [user.id]);
      await complete('invitation/accept', first, invitePassword, 400);
      await api('POST', '/users/' + user.id + '/invitation', null, admin, 201);
      const rows = (await sql(`SELECT revoked_at IS NOT NULL AS revoked FROM account_actions WHERE user_id=$1 ORDER BY created_at`, [user.id])).rows;
      assert.deepEqual(rows, [{ revoked: true }, { revoked: false }]);
      await complete('invitation/accept', first, invitePassword, 400);
      return { expiredRejected: true, oldIssuanceRevoked: true };
    });
    await verifyEmailTestOperations({ api, login, sql, test, messages, secretValues, admin, department, readLog, sleep });
    await test('T07 credentials are absent from API logs', async () => {
      assert.ok(secretValues.every(value => !readLog().includes(value)));
      return { credentialLeak: false };
    });
  } finally {
    await stopApi();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}
