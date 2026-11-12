const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash, createHmac } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const [reportArg, modules] = process.argv.slice(2);
const results = [];
const password = 'Password@123';
const admin = 'admin@congty.com';
const approver = 'it.manager@congty.com';
const apiPath = '/api/v1/auth';

function otp(key, offset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const n = [...key].reduce((value, character) => value * 32n + BigInt(alphabet.indexOf(character)), 0n);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const hmac = createHmac('sha1', Buffer.from(n.toString(16).padStart(40, '0'), 'hex')).update(counter).digest();
  return String((hmac.readUInt32BE(hmac[19] & 15) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function main() {
  const reportPath = path.resolve(reportArg);
  assert.ok(reportPath.startsWith(path.join(__dirname, 'test-artifacts', 'integration') + path.sep));
  const stack = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.match(stack.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.equal(path.basename(path.dirname(reportPath)), stack.project);
  assert.ok(stack.started && stack.keptStack && !stack.cleanupCompleted && stack.mfaRequired);
  assert.equal(stack.database, 'crypta_t30_test');
  assert.equal(stack.provider, 'MOCK');
  assert.equal(stack.smtpEnabled, false);
  assert.equal(stack.fixtureOnly, false);
  const origin = new URL(stack.origin);
  assert.equal(origin.hostname, '127.0.0.1');
  assert.equal(origin.protocol, 'http:');
  assert.ok(origin.port && origin.port !== '8080');
  const compose = ['compose', '--project-name', stack.project, '--env-file', path.join(path.dirname(reportPath), 'test.env'), '--file', path.join(__dirname, 'testing', 'compose.t30.yml')];
  const docker = args => execFileSync('docker', [...compose, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }).trim();
  const ids = docker(['ps','-q']).split(/\s+/);
  assert.equal(ids.length, 3);
  const config = JSON.parse(docker(['config','--format','json']));
  assert.equal(config.name, stack.project);
  assert.equal(String(config.services.backend.environment.MFA_REQUIRED), 'true');
  assert.equal(config.volumes.test_postgres.name, `${stack.project}_test_postgres`);
  assert.equal(config.volumes.test_postgres.external, undefined);
  const sql = query => docker(['exec','-T','postgres','psql','-X','-v','ON_ERROR_STOP=1','-U',stack.database,'-d',stack.database,'-At','-c',query]);
  const output = path.join(path.dirname(reportPath), 'mfa-' + Date.now());
  await fs.mkdir(output);
  const { chromium } = require(path.join(path.resolve(modules), 'playwright'));
  let browser;
  async function test(name, operation) {
    try { const evidence = await operation(); results.push({ name, passed: true, evidence }); console.log(`PASS ${name}`); }
    catch (error) {
      // Never include HTTP bodies, entered values or Playwright action logs in the report.
      const detail = error instanceof assert.AssertionError ? error.message.split('\n')[0] : error.name;
      results.push({ name, passed: false, error: detail }); console.error(`FAIL ${name}: ${detail}`);
    }
  }
  async function call(route, body, session) {
    const response = await fetch(new URL(apiPath + route, origin), {
      method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json', ...(session?.token && { Authorization: `Bearer ${session.token}` }), ...(session?.cookie && { Cookie: session.cookie }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const envelope = await response.json();
    return { status: response.status, data: envelope.data, code: envelope.error?.code,
      cache: response.headers.get('cache-control'), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  function expectStatus(response, status, code) {
    assert.equal(response.status, status, `Expected ${status}, received ${response.status} (${response.code ?? 'ok'})`);
    if (code) assert.equal(response.code, code);
    return response.data;
  }
  const login = email => call('/login',{ email, password });
  const verifyEnrollment = (start, offset = 0) => call('/mfa/enrollment/verify', { challenge: start.challenge, totpCode: otp(start.enrollment.manualKey, offset) });
  const finish = start => call('/mfa/enrollment/finish',{ challenge: start.challenge, savedRecoveryCodes:true });
  const session = response => ({ token: response.data.accessToken, cookie: response.cookie });
  let active, registration, recoveryCodes;
  try {
    await test('Password, enrollment verification and acknowledgement are separate gates', async () => {
      const ordinary = await login('dev.nguyen@congty.com');
      assert.ok(expectStatus(ordinary,200).accessToken);
      const pre = await login(admin);
      registration = expectStatus(pre,200);
      assert.equal(registration.mfa,'ENROLL');
      assert.equal(pre.cache,'no-store');
      assert.equal(registration.accessToken,undefined);
      assert.ok(!pre.cookie || pre.cookie.endsWith('='));
      const saved = sql("SELECT count(*) FROM auth_mfa_challenges WHERE purpose='ENROLL'");
      assert.equal(saved,'1');
      const hash = createHash('sha256').update(registration.challenge).digest('hex');
      assert.equal(sql(`SELECT count(*) FROM auth_mfa_challenges WHERE token_hash='${hash}' AND pending_secret LIKE 'v1.%'`),'1');
      expectStatus(await finish(registration),401,'MFA_CHALLENGE_EXPIRED');
      expectStatus(await call('/mfa/enrollment/finish',{ challenge: registration.challenge,savedRecoveryCodes:false }),400);
      const checked = await verifyEnrollment(registration,-1);
      recoveryCodes = expectStatus(checked,200).recoveryCodes;
      assert.equal(new Set(recoveryCodes).size,10);
      assert.ok(!checked.cookie);
      expectStatus(await verifyEnrollment(registration,-1),401,'MFA_CHALLENGE_EXPIRED');
      const finished = await finish(registration);
      assert.ok(expectStatus(finished,200).user.mfaEnrolled);
      active = session(finished);
      expectStatus(await finish(registration),401,'MFA_CHALLENGE_EXPIRED');
      assert.equal(expectStatus(await call('/mfa/status',undefined,active),200).remaining,10);
      const refreshed = await call('/refresh',{},active);
      expectStatus(refreshed,200);
      active = session(refreshed);
      expectStatus(await call('/me',undefined,active),200);
      return { recoveryCodes:10, accessAfterAck:true, verifiedRefresh:true };
    });

    await test('Concurrent TOTP and recovery requests consume each credential once', async () => {
      const proof = expectStatus(await login(admin),200);
      assert.equal(proof.mfa,'VERIFY');
      const totpCode = otp(registration.enrollment.manualKey,1);
      const input = { challenge:proof.challenge,totpCode };
      const attempts = await Promise.all([call('/mfa/verify',input),call('/mfa/verify',input)]);
      assert.deepEqual(attempts.map(item=>item.status).sort(),[200,401]);
      const latest = session(attempts.find(item=>item.status===200));
      const fresh = expectStatus(await login(admin),200);
      expectStatus(await call('/mfa/verify',{challenge:fresh.challenge,totpCode}),401,'MFA_CODE_INVALID');
      const recovery = { challenge:fresh.challenge,recoveryCode:recoveryCodes[0] };
      const recovered = await Promise.all([call('/mfa/recover',recovery),call('/mfa/recover',recovery)]);
      assert.deepEqual(recovered.map(item=>item.status).sort(),[200,401]);
      const next = expectStatus(recovered.find(item=>item.status===200),200);
      assert.equal(next.mfa,'RECOVER');
      assert.equal(next.accessToken,undefined);
      expectStatus(await call('/me',undefined,latest),401,'SESSION_REVOKED');
      expectStatus(await call('/refresh',{},active),401,'SESSION_INVALID');
      const current = expectStatus(await login(admin),200);
      expectStatus(await call('/mfa/recover',{challenge:current.challenge,recoveryCode:recoveryCodes[0]}),401,'MFA_CODE_INVALID');
      expectStatus(await verifyEnrollment(next),401,'MFA_CHALLENGE_EXPIRED');
      const retry = expectStatus(await call('/mfa/recover',{challenge:current.challenge,recoveryCode:recoveryCodes[1]}),200);
      const newCodes = expectStatus(await verifyEnrollment(retry),200).recoveryCodes;
      assert.ok(newCodes.every(code=>!recoveryCodes.includes(code)));
      const replacement = await finish(retry);
      assert.ok(expectStatus(replacement,200).user.mfaEnrolled);
      expectStatus(await call('/refresh',{},latest),401,'SESSION_INVALID');
      expectStatus(await call('/refresh',{},session(replacement)),200);
      return { oneTotpAccepted:true, oneRecoveryAccepted:true, oldSessionsRevoked:true, recoveryNeedsNewTotp:true };
    });

    await test('Rate limit persists across replacement challenges', async () => {
      for (let attempt=0; attempt<5; attempt++) {
        const start = expectStatus(await login('ciso@congty.com'),200);
        const expected = [-1,0,1].map(offset=>otp(start.enrollment.manualKey,offset));
        const wrong = ['000000','111111','222222','333333'].find(code=>!expected.includes(code));
        expectStatus(await call('/mfa/enrollment/verify',{ challenge:start.challenge,totpCode:wrong }),401,'MFA_CODE_INVALID');
      }
      expectStatus(await login('ciso@congty.com'),429,'MFA_RATE_LIMITED');
      return { sharedAttempts:5, newChallengeBlocked:true };
    });

    browser = await chromium.launch({headless:true});
    await test('Mobile dark enrollment and desktop security UI use the real API', async () => {
      const context = await browser.newContext({viewport:{width:390,height:860},acceptDownloads:true});
      try {
        const page = await context.newPage();
        await page.addInitScript(() => { localStorage.setItem('crypta-theme','dark'); });
        await page.goto(new URL('/approvals',origin).href);
        await page.getByLabel('Email',{exact:true}).fill(approver);
        await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
        await page.getByRole('button',{name:'Đăng nhập',exact:true}).press('Enter');
        const qr = page.getByRole('img',{name:'Mã QR kết nối ứng dụng xác thực'});
        await qr.waitFor();
        assert.ok(await qr.evaluate(canvas=>canvas.width>100 && canvas.getContext('2d').getImageData(0,0,1,1).data[0]===255));
        const key = page.locator('.mfa-manual-key');
        const manual = await key.textContent();
        assert.ok(/^[A-Z2-7]{32}$/.test(manual));
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.screenshot({path:path.join(output,'mobile-enrollment.png'),mask:[qr,key]});
        await page.getByLabel('Mã xác thực 6 số').fill(otp(manual,-1));
        await page.getByRole('button',{name:'Xác minh và tiếp tục'}).press('Enter');
        await page.getByRole('heading',{name:'Lưu mã khôi phục'}).waitFor();
        assert.equal(await page.getByRole('list',{name:'Mười mã khôi phục'}).getByRole('listitem').count(),10);
        const done = page.getByRole('button',{name:'Hoàn tất thiết lập'});
        assert.ok(await done.isDisabled());
        const download = page.waitForEvent('download');
        await page.getByRole('button',{name:'Tải mã khôi phục'}).click();
        const file = await download;
        assert.equal(file.suggestedFilename(),'crypta-ma-khoi-phuc.txt');
        await file.delete();
        await page.getByRole('checkbox',{name:/Tôi đã lưu/}).check();
        await done.press('Enter');
        await page.waitForURL(new URL('/approvals',origin).href);
        await page.setViewportSize({width:1440,height:900});
        await page.getByRole('button',{name:'Chuyển sang giao diện sáng'}).click();
        await page.getByRole('button',{name:'Bảo mật tài khoản'}).press('Enter');
        await page.getByText('Còn 10 mã chưa dùng',{exact:true}).waitFor();
        await page.screenshot({path:path.join(output,'desktop-security.png')});
        await page.getByRole('button',{name:'Thay ứng dụng',exact:true}).click();
        await page.getByLabel('Mật khẩu hiện tại').fill(password);
        await page.getByLabel('Mã xác thực 6 số').fill(otp(manual));
        await page.getByRole('button',{name:'Xác nhận và thay ứng dụng'}).click();
        await page.getByRole('heading',{name:'Kết nối ứng dụng xác thực mới'}).waitFor();
        const replacement = await page.locator('.mfa-manual-key').textContent();
        assert.ok(replacement!==manual);
        await page.getByLabel('Mã xác thực 6 số').fill(otp(replacement));
        await page.getByRole('button',{name:'Xác minh và tiếp tục'}).press('Enter');
        await page.getByRole('checkbox',{name:/Tôi đã lưu/}).check();
        await page.getByRole('button',{name:'Hoàn tất thiết lập'}).press('Enter');
        await page.getByText('Còn 10 mã chưa dùng',{exact:true}).waitFor();
        return { mobileEnrollment:true, download:true, desktopStepUp:true, factorReplaced:true };
      } finally { await context.close(); }
    });
  } finally { await browser?.close(); }
  const passed = results.filter(item=>item.passed).length;
  await fs.writeFile(path.join(output,'results.json'), JSON.stringify({ passed,total:results.length,results },null,2));
  console.log(`MFA ${passed}/${results.length}. ${path.join(output,'results.json')}`);
  if (passed!==4 || results.length!==4) process.exitCode=1;
}

main().catch(error=>{console.error(`MFA setup failed: ${error.name}`);process.exitCode=1;});
