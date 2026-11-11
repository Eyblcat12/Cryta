// Runs browser, API, PostgreSQL and an in-container SMTP fixture on a retained test stack.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');

async function main(reportArgument, playwrightDirectory) {
  const root = path.resolve(__dirname, '..');
  const reportPath = await fs.realpath(path.resolve(reportArgument));
  const artifactRoot = await fs.realpath(path.join(__dirname, 'test-artifacts', 'integration'));
  assert.ok(reportPath.startsWith(artifactRoot + path.sep));
  const stack = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  const directory = path.dirname(reportPath);
  assert.match(stack.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.equal(path.basename(directory), stack.project);
  assert.ok(stack.started && stack.keptStack && !stack.cleanupCompleted && !stack.fixtureOnly);
  assert.equal(stack.database, 'crypta_t30_test');
  assert.equal(stack.provider, 'MOCK');
  assert.equal(stack.smtpEnabled, false);
  const origin = new URL(stack.origin);
  assert.equal(origin.protocol, 'http:');
  assert.equal(origin.hostname, '127.0.0.1');
  assert.ok(origin.port && origin.port !== '8080');
  const compose = ['compose', '--project-name', stack.project, '--env-file', path.join(directory, 'test.env'), '--file', path.join(root, 'tools/testing/compose.t30.yml')];
  function docker(args, timeout = 30000) {
    try { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout, maxBuffer: 4 * 1024 * 1024 }).trim(); }
    catch { throw new Error('ISOLATED_DOCKER_COMMAND_FAILED'); }
  }
  const ids = docker([...compose, 'ps', '-q']).split(/\r?\n/);
  assert.equal(ids.length, 3);
  const containers = JSON.parse(docker(['inspect', ...ids]));
  assert.ok(containers.every(item => item.Config.Labels['com.docker.compose.project'] === stack.project && item.State.Running));
  const postgres = containers.find(item => item.Config.Labels['com.docker.compose.service'] === 'postgres');
  const backend = containers.find(item => item.Config.Labels['com.docker.compose.service'] === 'backend');
  const frontend = containers.find(item => item.Config.Labels['com.docker.compose.service'] === 'frontend');
  assert.ok(postgres.Config.Env.includes('POSTGRES_DB=crypta_t30_test'));
  assert.ok(postgres.Mounts.some(mount => mount.Name === stack.project + '_test_postgres'));
  assert.ok(backend.Config.Env.includes('CRYPTO_PROVIDER_MODE=MOCK') && backend.Config.Env.includes('SMTP_ENABLED=false'));
  const bindings = frontend.NetworkSettings.Ports['80/tcp'];
  assert.ok(bindings.length === 1 && bindings[0].HostIp === '127.0.0.1' && bindings[0].HostPort === origin.port);
  const outside = () => docker(['ps','-a','--no-trunc','--format','{{.ID}}|{{.Label "com.docker.compose.project"}}']).split(/\r?\n/)
    .filter(line => line && line.split('|')[1] !== stack.project).sort();
  const outsideBefore = outside();
  const output = path.join(directory, 'account-actions-ui-' + Date.now());
  await fs.mkdir(output);
  const fixture = path.join(output, 'fixture.env');
  const report = { project: stack.project, origin: origin.origin, results: [], accountActionsLoopback: true, baselineRestored: false };
  const { chromium } = require(path.join(playwrightDirectory, 'playwright'));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const applicationPassword = 'UiAccount#202611';
  const resetPassword = 'UiRecovered#202611';
  async function mailbox(email, route) {
    const url = new URL('http://127.0.0.1:2528/');
    url.searchParams.set('email', email);
    url.searchParams.set('route', route);
    const script = `fetch(${JSON.stringify(url.href)}).then(async r=>{if(r.ok)process.stdout.write(await r.text())}).catch(()=>{process.exitCode=1})`;
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline) {
      const credential = docker([...compose,'exec','-T','backend','node','-e',script]);
      if (/^[A-Za-z0-9_-]{43}$/.test(credential)) return credential;
      await sleep(250);
    }
    throw new Error('UI_MAILBOX_TIMEOUT');
  }
  async function fillPassword(page, password) {
    await page.getByLabel(/^Mật khẩu mới/).fill(password);
    await page.getByLabel('Nhập lại mật khẩu', { exact:true }).fill(password);
  }
  async function signIn(page, email, password) {
    await page.getByRole('heading', {name:'Chào mừng trở lại'}).waitFor();
    await page.getByLabel('Email', {exact:true}).fill(email);
    await page.getByLabel('Mật khẩu', {exact:true}).fill(password);
    await page.getByRole('button', {name:'Đăng nhập',exact:true}).click();
  }
  async function test(name, run) {
    try { await run(); report.results.push({ name, passed:true }); console.log('PASS ' + name); }
    catch (error) { report.results.push({ name, passed:false, error: String(error.message).split('\n')[0].replace(/#token=[A-Za-z0-9_-]+/g, '#token=[redacted]').slice(0, 220) }); console.log('FAIL ' + name); }
  }
  let startedOverride = false;
  try {
    await fs.writeFile(fixture, `T07_TEST_PROJECT=${stack.project}\nT07_TEST_KEY=${randomBytes(32).toString('hex')}\n`, { flag:'wx' });
    const override = [...compose,'--env-file',fixture,'--file',path.join(root,'tools/testing/compose.account-actions.yml')];
    const config = JSON.parse(docker([...override,'config','--format','json']));
    assert.equal(config.name, stack.project);
    assert.equal(config.services.backend.environment.SMTP_HOST, '127.0.0.1');
    assert.ok(!config.services.backend.ports?.length);
    startedOverride = true;
    docker([...override,'up','-d','--wait','--force-recreate','--no-deps','backend','frontend'], 90000);
    const backendId = docker([...compose,'ps','-q','backend']);
    const frontendId = docker([...compose,'ps','-q','frontend']);
    report.runtimeImages = { backend:docker(['inspect','--format','{{.Image}}',backendId]), frontend:docker(['inspect','--format','{{.Image}}',frontendId]) };
    const html = await (await fetch(origin.origin + '/account/forgot-password')).text();
    const asset = /src="\/assets\/([^"/]+\.js)"/.exec(html)?.[1];
    assert.ok(asset);
    const served = Buffer.from(await (await fetch(origin.origin + '/assets/' + asset)).arrayBuffer());
    report.frontendAsset = { file:asset, sha256:createHash('sha256').update(served).digest('hex') };
    assert.equal(report.frontendAsset.sha256,createHash('sha256').update(await fs.readFile(path.join(root,'frontend/dist/assets',asset))).digest('hex'));
    for (const [channel, width, theme] of [['msedge',1440,'light'], ['chrome',390,'dark']]) {
      const browser = await chromium.launch({ channel });
      try {
        const adminContext = await browser.newContext({viewport:{width,height:900}});
        const guestContext = await browser.newContext({viewport:{width,height:900}});
        await guestContext.addInitScript(value=>localStorage.setItem('crypta-theme',value),theme);
        const admin = await adminContext.newPage();
        const guest = await guestContext.newPage();
        const email = `t07-ui-${randomBytes(5).toString('hex')}@example.test`;
        let invitation, reset, apiPaths = [];
        guest.on('request', request => {
          const url = new URL(request.url());
          if (url.pathname.startsWith('/api/')) apiPaths.push(url.pathname);
        });
        await test(`${channel} Admin invites through the approved form`, async()=>{
          await admin.goto(origin.origin + '/users');
          await signIn(admin,'admin@congty.com','Password@123');
          await admin.getByRole('button',{name:'Mời tài khoản',exact:true}).click();
          const dialog=admin.getByRole('dialog',{name:'Mời tài khoản'});
          await dialog.getByLabel(/Họ và tên/).fill('T07 browser test');
          await dialog.getByLabel(/Email tổ chức/).fill(email);
          assert.equal(await dialog.locator('input[type=password]').count(),0);
          await dialog.getByRole('button',{name:'Gửi lời mời'}).click();
          await dialog.waitFor({state:'hidden'});
          invitation=await mailbox(email,'activate');
        });
        await test(`${channel} invitation link activates and keeps the credential out of navigation`, async()=>{
          assert.ok(invitation);
          const navigation=await guest.goto(`${origin.origin}/account/activate#token=${invitation}`);
          assert.equal(navigation.headers()['referrer-policy'],'no-referrer');
          await guest.getByRole('heading',{name:'Kích hoạt tài khoản'}).waitFor();
          assert.equal(new URL(guest.url()).hash,'');
          assert.ok((await guest.getByLabel(/^Mật khẩu mới/).boundingBox()).height >= 44);
          await guest.screenshot({path:path.join(output,`${channel}-activation.png`)});
          await fillPassword(guest, applicationPassword);
          await guest.getByRole('button',{name:'Kích hoạt tài khoản'}).click();
          await guest.getByRole('heading',{name:'Mật khẩu đã được lưu'}).waitFor();
          assert.ok(!apiPaths.some(value=>value.endsWith('/auth/refresh')));
          await guest.getByRole('link',{name:'Về đăng nhập'}).click();
          await signIn(guest,email,applicationPassword);
          await guest.waitForURL('**/dashboard');
        });
        await test(`${channel} self-service reset follows the email and rejects replay`, async()=>{
          const otherContext = await browser.newContext({viewport:{width,height:900}});
          try {
            await otherContext.addInitScript(value=>localStorage.setItem('crypta-theme',value),theme);
            const other=await otherContext.newPage();
            await other.goto(origin.origin + '/login');
            await other.getByRole('link',{name:'Quên mật khẩu?'}).click();
            await other.getByLabel('Email công việc').fill(email);
            await other.getByRole('button',{name:'Gửi yêu cầu'}).click();
            await other.getByRole('heading',{name:'Kiểm tra hộp thư'}).waitFor();
            await other.screenshot({path:path.join(output,`${channel}-reset-request.png`)});
            reset=await mailbox(email,'reset-password');
            await other.goto(`${origin.origin}/account/reset-password#token=${reset}`);
            await fillPassword(other, resetPassword);
            await other.getByRole('button',{name:'Lưu mật khẩu mới'}).click();
            await other.getByRole('heading',{name:'Mật khẩu đã được lưu'}).waitFor();
            await guest.reload();
            await guest.getByRole('heading',{name:'Chào mừng trở lại'}).waitFor();
            await other.goto(`${origin.origin}/account/reset-password#token=${reset}`);
            await other.getByRole('heading',{name:'Đặt lại mật khẩu',exact:true}).waitFor();
            assert.equal(new URL(other.url()).hash,'');
            await fillPassword(other, resetPassword);
            await other.getByRole('button',{name:'Lưu mật khẩu mới'}).click();
            await other.getByRole('heading',{name:'Liên kết không còn hiệu lực'}).waitFor();
            await other.getByRole('link',{name:'Về đăng nhập'}).click();
            await signIn(other,email,resetPassword);
            await other.waitForURL('**/dashboard');
          } finally { await otherContext.close(); }
        });
      } finally { await browser.close(); }
    }
  } finally {
    try {
      if (startedOverride) {
        docker([...compose,'up','-d','--wait','--force-recreate','--no-deps','backend','frontend'],90000);
        const capability=await (await fetch(origin.origin+'/api/v1/auth/account-actions')).json();
        assert.equal(capability.data.enabled,false);
        report.baselineRestored=true;
      }
    } finally {
      await fs.rm(fixture,{force:true});
      report.outsideContainersPreserved=JSON.stringify(outside())===JSON.stringify(outsideBefore);
      report.success=report.results.length===6&&report.results.every(result=>result.passed)&&report.baselineRestored&&report.outsideContainersPreserved;
      await fs.writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2));
      console.log(`T07 browser report: ${path.join(output,'results.json')}`);
    }
  }
  if (!report.success) process.exitCode=1;
}
main(process.argv[2],process.argv[3]).catch(error=>{console.error(String(error.message).replace(/#token=[A-Za-z0-9_-]+/g,'#token=[redacted]'));process.exitCode=1});
