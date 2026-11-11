const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Isolated Docker operation failed.');
  return result.stdout.trim();
}

async function main(reportArgument, playwrightDirectory, channel = 'msedge') {
  assert.ok(['msedge', 'chrome'].includes(channel));
  const root = path.resolve(__dirname, '..');
  const artifactRoot = await fs.realpath(path.join(__dirname, 'test-artifacts/integration'));
  const reportPath = await fs.realpath(reportArgument);
  assert.ok(reportPath.startsWith(artifactRoot + path.sep));
  const stack = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.match(stack.project, /^crypta-t30-test-[a-f0-9]{12}$/);
  assert.equal(path.basename(path.dirname(reportPath)), stack.project);
  assert.ok(stack.started && stack.keptStack && !stack.cleanupCompleted && stack.status === 'PASSED');
  assert.ok(stack.database === 'crypta_t30_test' && stack.provider === 'MOCK' && stack.smtpEnabled === false);
  assert.match(stack.origin, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
  const ids = docker(['ps', '-q', '--filter', `label=com.docker.compose.project=${stack.project}`]).split(/\s+/);
  assert.equal(ids.length, 3);
  const containers = JSON.parse(docker(['inspect', ...ids]));
  assert.ok(containers.every(c => c.Config.Labels['com.docker.compose.project'] === stack.project && c.State.Running));
  const postgres = containers.find(c => c.Config.Labels['com.docker.compose.service'] === 'postgres');
  const backend = containers.find(c => c.Config.Labels['com.docker.compose.service'] === 'backend');
  const frontend = containers.find(c => c.Config.Labels['com.docker.compose.service'] === 'frontend');
  assert.ok(backend.Config.Env.includes('CRYPTO_PROVIDER_MODE=MOCK') && backend.Config.Env.includes('SMTP_ENABLED=false'));
  assert.ok(postgres.Config.Env.includes('POSTGRES_DB=crypta_t30_test'));
  assert.ok(postgres.Mounts.some(m => m.Name === `${stack.project}_test_postgres`));
  assert.deepEqual(frontend.NetworkSettings.Ports['80/tcp'], [{ HostIp: '127.0.0.1', HostPort: new URL(stack.origin).port }]);
  const sql = query => JSON.parse(docker([
    'exec', '-i', postgres.Id, 'psql', '-XqAt', '-U', 'crypta_t30_test', '-d', stack.database,
    '-v', 'ON_ERROR_STOP=1',
  ], query));
  const output=path.join(path.dirname(reportPath),`departments-${channel}-${Date.now()}`);await fs.mkdir(output);
  const results=[],report={success:false,project:stack.project,fixtureOnly:false,provider:'MOCK',smtpEnabled:false,images:{backend:backend.Image,frontend:frontend.Image},results};
  const {chromium}=require(path.join(playwrightDirectory,'playwright')),{expect}=require(path.join(playwrightDirectory,'playwright/test'));
  const browser=await chromium.launch({channel,headless:true});report.browserVersion=browser.version();
  async function call(method,endpoint,body,token){const response=await fetch(stack.origin+'/api/v1'+endpoint,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const envelope=await response.json();return{status:response.status,data:envelope.data,code:envelope.error?.code,details:envelope.error?.details}}
  function status(value,expected,code){assert.equal(value.status,expected,`HTTP ${value.status}; expected ${expected}; code ${value.code??'-'}`);if(code)assert.equal(value.code,code);return value.data}
  const temporaryPassword='Initial@Test12345',password='Changed@Test12345';
  async function login(email,pwd='Password@123'){return status(await call('POST','/auth/login',{email,password:pwd}),200)}
  const admin=await login('admin@congty.com'),dev=await login('dev.nguyen@congty.com');
  const ref=status(await call('GET','/users/reference-data',undefined,admin.accessToken),200),it=ref.departments.find(row=>row.code==='IT').id;
  const policy=status(await call('GET','/policies',undefined,dev.accessToken),200).find(row=>row.configuration.algorithm==='RSA'&&Number(row.configuration.minimum_key_size)===2048);assert.ok(policy);
  const parameters={assetType:'KEY',algorithm:'RSA',keySize:2048,validityDays:90};
  async function department(){const id=randomUUID(),code='D'+randomUUID().replaceAll('-','').slice(0,15).toUpperCase();return status(await call('PUT','/departments/'+id,{code,name:'Department '+code},admin.accessToken),200)}
  async function user(departmentId=it,roles=['USER'],scopes=[]){const email='department.'+randomUUID()+'@example.test';const created=status(await call('POST','/users',{email,displayName:'Department user '+email.slice(11,19),departmentId,roles,approverDepartmentIds:scopes,temporaryPassword},admin.accessToken),201);const first=await login(email,temporaryPassword);status(await call('POST','/auth/change-password',{currentPassword:temporaryPassword,newPassword:password},first.accessToken),200);return{...created,...await login(email,password),email}}
  const userRow=async id=>status(await call('GET','/users?pageSize=1&userId='+id,undefined,admin.accessToken),200).items[0];
  async function request(session,type='CREATE',targetAssetId){return status(await call('POST','/requests',{type,policyVersionId:policy.id,targetAssetId,reason:'Department scope test '+randomUUID(),emergency:false,parameters:type==='CREATE'?parameters:{}},session.accessToken),201)}
  async function approve(session,row){status(await call('POST',`/requests/${row.id}/decision`,{decision:'APPROVED',version:String(row.version),comment:'Approve isolated department test'},session.accessToken),201)}
  async function complete(session,id){const end=Date.now()+20000;while(Date.now()<end){const row=status(await call('GET','/requests/'+id,undefined,session.accessToken),200);if(row.status==='COMPLETED')return row;await new Promise(resolve=>setTimeout(resolve,200))}throw new Error('Worker completion timeout')}
  async function test(name,run){if(process.env.CRYPTA_DEPARTMENT_FILTER&&!name.includes(process.env.CRYPTA_DEPARTMENT_FILTER))return;try{results.push({name,passed:true,evidence:await run()});console.log('PASS '+name)}catch(error){results.push({name,passed:false,error:error instanceof assert.AssertionError?error.message:error.name+': '+String(error.message).slice(0,700)});console.log('FAIL '+name)}}
  async function until(read,label){const end=Date.now()+12000;while(Date.now()<end){const value=read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('Timeout waiting for '+label)}
  async function holder(query){const app='t30_department_'+randomUUID().replaceAll('-','');const process=spawn('docker',['exec','-e','PGAPPNAME='+app,postgres.Id,'psql','-XqAt','-U','crypta_t30_test','-d',stack.database,'-v','ON_ERROR_STOP=1','-c',`BEGIN; ${query}; SELECT pg_sleep(45); ROLLBACK;`],{stdio:['ignore','pipe','pipe']});const done=new Promise(resolve=>{process.once('close',resolve);process.once('error',()=>resolve(-1))});const pid=await until(()=>sql(`SELECT coalesce((SELECT pid FROM pg_stat_activity WHERE application_name='${app}' AND wait_event='PgSleep'),0);`),'lock holder');return{pid,async release(){sql(`SELECT coalesce(json_agg(pg_terminate_backend(pid)),'[]'::json) FROM pg_stat_activity WHERE pid=${pid} AND application_name='${app}' AND datname='crypta_t30_test' AND usename='crypta_t30_test';`);await done}}}
  try{
    await test('API role boundaries and malformed input are rejected',async()=>{status(await call('GET','/departments',undefined,dev.accessToken),403);status(await call('PUT','/departments/'+randomUUID(),{code:'BAD',name:'Bad'},dev.accessToken),403);status(await call('PUT','/departments/'+randomUUID(),{code:'bad',name:'Name'},admin.accessToken),400);status(await call('PUT','/departments/'+randomUUID(),{code:'OK',name:'  '},admin.accessToken),400);status(await call('PATCH','/departments/'+it+'/status',{active:false,version:null},admin.accessToken),400);status(await call('PUT','/users/'+dev.user.id+'/department',{departmentId:it,version:1.5},admin.accessToken),400);return{deniedRole:true,invalidBodies:4}});
    await test('API idempotent creation, duplicate code, concurrent edits and reversible activation',async()=>{
      const row=await department();status(await call('PUT','/departments/'+row.id,{code:row.code,name:row.name},admin.accessToken),200);assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE entity_id='${row.id}' AND action='DEPARTMENT_CREATED'`),1);
      status(await call('PUT','/departments/'+randomUUID(),{code:row.code,name:'Duplicate'},admin.accessToken),409,'DEPARTMENT_CODE_EXISTS');
      const changed=await Promise.all(['First name','Second name'].map(name=>call('PUT','/departments/'+row.id,{code:row.code,name,version:1},admin.accessToken)));assert.deepEqual(changed.map(row=>row.status).sort(),[200,409]);
      const current=status(await call('GET','/departments/'+row.id,undefined,admin.accessToken),200);assert.equal(current.version,2);
      status(await call('PATCH','/departments/'+row.id+'/status',{active:false,version:2},admin.accessToken),200);status(await call('PATCH','/departments/'+row.id+'/status',{active:true,version:3},admin.accessToken),200);
      assert.equal(sql(`SELECT count(*) FROM departments WHERE id='${row.id}'`),1);return{firstSaveAudits:1,editStatuses:changed.map(row=>row.status),finalVersion:4};
    });
    await test('API deactivation detects users, scopes, open requests and active assets independently',async()=>{
      const fields=[];for(const field of ['users','approverScopes','openRequests','activeAssets']){const row=await department();
        if(field==='users')await user(row.id);
        if(field==='approverScopes')await user(it,['APPROVER'],[row.id]);
        if(field==='openRequests')sql(`INSERT INTO requests(id,request_type,creator_id,department_id,policy_version_id,status,reason,requested_parameters)VALUES('${randomUUID()}','CREATE','${dev.user.id}','${row.id}','${policy.id}','PENDING','Department deactivation fixture','{}');SELECT 1;`);
        if(field==='activeAssets')sql(`INSERT INTO crypto_assets(id,asset_code,asset_type,owner_id,department_id,policy_version_id,purpose,status,valid_from,expires_at)VALUES('${randomUUID()}','DEP-${randomUUID()}','KEY','${dev.user.id}','${row.id}','${policy.id}','Department deactivation fixture','ACTIVE',NOW(),NOW()+INTERVAL '1 day');SELECT 1;`);
        const blocked=await call('PATCH','/departments/'+row.id+'/status',{active:false,version:1},admin.accessToken);status(blocked,409,'DEPARTMENT_IN_USE');assert.equal(blocked.details[field],1);fields.push(field);
      }return{blockedBy:fields};
    });
    await test('API transfer revokes sessions, keeps historical departments and filters cross-department asset history',async()=>{
      const first=await department(),second=await department(),owner=await user(first.id),approverA=await user(it,['APPROVER'],[first.id]),approverB=await user(it,['APPROVER'],[second.id]);
      const created=await request(owner);await approve(approverA,created);const completed=await complete(owner,created.id),asset=completed.resultAssetId;assert.ok(asset);
      const before=await userRow(owner.id);status(await call('PUT',`/users/${owner.id}/department`,{departmentId:second.id,version:before.version},admin.accessToken),200);
      status(await call('GET','/auth/me',undefined,owner.accessToken),401);assert.equal(sql(`SELECT count(*) FROM auth_sessions WHERE user_id='${owner.id}' AND revoked_at IS NULL`),0);
      assert.equal(sql(`SELECT count(*) FROM requests WHERE id='${created.id}' AND department_id='${first.id}'`),1);assert.equal(sql(`SELECT count(*) FROM crypto_assets WHERE id='${asset}' AND department_id='${first.id}'`),1);
      const fresh=await login(owner.email,password),renewed=await request(fresh,'RENEW',asset);assert.equal(renewed.departmentId,second.id);await approve(approverB,renewed);await complete(fresh,renewed.id);
      status(await call('GET','/requests/'+renewed.id,undefined,approverA.accessToken),404);
      const history=status(await call('GET',`/assets/${asset}/history?page=1&pageSize=50`,undefined,approverA.accessToken),200);assert.ok(!history.items.some(item=>item.requestId===renewed.id));
      const ownedHistory=status(await call('GET',`/assets/${asset}/history?page=1&pageSize=50`,undefined,fresh.accessToken),200);assert.ok(ownedHistory.items.some(item=>item.requestId===renewed.id));
      return{sessionsRevoked:true,historicalRowsPreserved:true,newRequestDepartmentCorrect:true,foreignRequestEventsHidden:true};
    });
    await test('API audit faults roll back department and user/session mutations',async()=>{
      const row=await department(),target=await user(),before=await userRow(target.id),guard='t30_department_'+randomUUID().replaceAll('-','');
      sql(`CREATE FUNCTION ${guard}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.entity_id IN ('${row.id}','${target.id}') AND NEW.action IN ('DEPARTMENT_DEACTIVATED','USER_DEPARTMENT_CHANGED') THEN RAISE EXCEPTION 'isolated audit fault';END IF;RETURN NEW;END$$;CREATE TRIGGER ${guard} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${guard}();SELECT 1;`);
      try{status(await call('PATCH',`/departments/${row.id}/status`,{active:false,version:1},admin.accessToken),500);status(await call('PUT',`/users/${target.id}/department`,{departmentId:row.id,version:before.version},admin.accessToken),500);assert.deepEqual(await userRow(target.id),before);status(await call('GET','/auth/me',undefined,target.accessToken),200);assert.equal(status(await call('GET','/departments/'+row.id,undefined,admin.accessToken),200).active,true)}finally{sql(`DROP TRIGGER ${guard} ON audit_logs;DROP FUNCTION ${guard}();SELECT 1;`)}return{rollbackVerified:true};
    });
    await test('API request already past the guard cannot submit after transfer commits first',async()=>{
      const row=await department(),target=await user(),before=await userRow(target.id),lock=await holder(`SELECT id FROM users WHERE id='${target.id}' FOR UPDATE`);let transfer,queued;
      const waits=pattern=>sql(`SELECT count(*) FROM pg_stat_activity WHERE datname='crypta_t30_test' AND wait_event_type='Lock' AND query LIKE '${pattern}';`);
      try{transfer=call('PUT',`/users/${target.id}/department`,{departmentId:row.id,version:before.version},admin.accessToken);await until(()=>waits('SELECT department_id,token_version FROM users%')===1,'transfer waiting');queued=call('POST','/requests',{type:'CREATE',policyVersionId:policy.id,reason:'Queued department transfer '+randomUUID(),parameters},target.accessToken);await until(()=>waits('SELECT u.status,u.token_version,u.department_id%')===1,'request waiting after guard')}finally{await lock.release()}
      status(await transfer,200);status(await queued,401,'SESSION_REVOKED');return{transfer:200,queuedSubmission:401};
    });
    await test('API a first user assignment and department deactivation cannot leave an inactive assigned department',async()=>{
      const outcomes=[];for(const deactivateFirst of [true,false]){const row=await department(),lock=await holder('SELECT pg_advisory_xact_lock(17232,1)'),email='race.'+randomUUID()+'@example.test';let first,second;
        const deactivate=()=>call('PATCH',`/departments/${row.id}/status`,{active:false,version:1},admin.accessToken),create=()=>call('POST','/users',{email,displayName:'Department race',departmentId:row.id,roles:['USER'],approverDepartmentIds:[],temporaryPassword},admin.accessToken);
        const waiters=()=>sql("SELECT count(*) FROM pg_stat_activity WHERE datname='crypta_t30_test' AND wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock(17232,1)%'");
        try{first=(deactivateFirst?deactivate:create)();await until(()=>waiters()===1,'first administration operation');second=(deactivateFirst?create:deactivate)();await until(()=>waiters()===2,'second administration operation')}finally{await lock.release()}
        const responses=await Promise.all([first,second]);assert.deepEqual(responses.map(row=>row.status).sort(),deactivateFirst?[200,409]:[201,409]);
        assert.equal(sql(`SELECT count(*) FROM users u JOIN departments d ON d.id=u.department_id WHERE d.id='${row.id}' AND d.is_active=FALSE`),0);outcomes.push(responses.map(row=>row.status));
      }return{outcomes};
    });
    async function pageFor(width,theme){const context=await browser.newContext({viewport:{width,height:900}});await context.addInitScript(theme=>localStorage.setItem('crypta-theme',theme),theme);const page=await context.newPage();await page.goto(stack.origin+'/users?section=departments');await page.locator('.login-card input[type=email]').fill('admin@congty.com');await page.locator('.login-card input[type=password]').fill('Password@123');await page.locator('.login-card button[type=submit],.login-card button.login-submit').click();await page.getByRole('heading',{name:'Quản lý đơn vị',exact:true}).waitFor();await page.locator('.table-shell[aria-busy=false]').waitFor();return{page,context}}
    for(const [width,theme]of [[1440,'light'],[390,'dark']]){
      await test(`UI ${width}/${theme}: create, edit, deactivate, reload and preserve a dirty form on cancel`,async()=>{
        const {page,context}=await pageFor(width,theme),code='U'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase();try{
          await page.getByRole('button',{name:'Thêm đơn vị',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Thêm đơn vị',exact:true});await dialog.getByLabel(/Mã đơn vị/).fill(code);await dialog.getByLabel(/Tên đơn vị/).fill('UI '+code);
          await dialog.getByRole('button',{name:'Hủy',exact:true}).click();await page.getByRole('button',{name:'Ở lại',exact:true}).click();await expect(dialog.getByLabel(/Tên đơn vị/)).toHaveValue('UI '+code);
          const saved=page.waitForResponse(response=>response.request().method()==='PUT'&&new URL(response.url()).pathname.startsWith('/api/v1/departments/'));await dialog.getByRole('button',{name:'Lưu đơn vị',exact:true}).click();const result=await(await saved).json();assert.equal(result.data.version,1);
          await page.getByRole('textbox',{name:'Tìm đơn vị',exact:true}).fill(code);await page.getByRole('button',{name:'Tìm',exact:true}).click();let row=page.locator('tbody tr').filter({hasText:code});await expect(row).toHaveCount(1);await row.getByRole('button',{name:'Sửa',exact:true}).click();const edit=page.getByRole('dialog',{name:'Sửa đơn vị',exact:true});await edit.getByLabel(/Tên đơn vị/).fill('Edited '+code);await edit.getByRole('button',{name:'Lưu đơn vị',exact:true}).click();await expect(row).toContainText('Edited '+code);
          await row.getByRole('button',{name:'Ngừng hoạt động',exact:true}).click();const stop=page.getByRole('dialog',{name:'Ngừng hoạt động đơn vị',exact:true});await stop.getByRole('button',{name:'Xác nhận ngừng hoạt động',exact:true}).click();await expect(row).toContainText('Ngừng hoạt động');await page.reload();await expect(page.locator('tbody tr').filter({hasText:code})).toContainText('Ngừng hoạt động');
          await page.screenshot({path:path.join(output,`departments-${width}-${theme}.png`),fullPage:true,animations:'disabled'});return{createdId:result.data.id,finalVersion:3};
        }finally{await context.close()}
      });
      await test(`UI ${width}/${theme}: a stale edit keeps its input and cannot overwrite another tab`,async()=>{
        const target=await department(),first=await pageFor(width,theme),second=await pageFor(width,theme);
        try{
          for(const entry of [first,second]){await entry.page.goto(stack.origin+'/users?section=departments&q='+target.code);await entry.page.locator('tbody tr').filter({hasText:target.code}).getByRole('button',{name:'Sửa',exact:true}).click()}
          const left=first.page.getByRole('dialog',{name:'Sửa đơn vị',exact:true}),right=second.page.getByRole('dialog',{name:'Sửa đơn vị',exact:true});
          await left.getByLabel(/Tên đơn vị/).fill('Winner '+target.code);await right.getByLabel(/Tên đơn vị/).fill('Unsaved '+target.code);
          await left.getByRole('button',{name:'Lưu đơn vị',exact:true}).click();await expect(left).toHaveCount(0);
          await right.getByRole('button',{name:'Lưu đơn vị',exact:true}).click();await expect(right.getByRole('alert')).toContainText('đã thay đổi');
          await expect(right.getByLabel(/Tên đơn vị/)).toHaveValue('Unsaved '+target.code);await expect(right.getByRole('button',{name:'Lưu đơn vị',exact:true})).toBeDisabled();
          assert.equal(status(await call('GET','/departments/'+target.id,undefined,admin.accessToken),200).name,'Winner '+target.code);
          await right.getByRole('button',{name:'Tải lại bản hiện tại',exact:true}).click();await expect(right.getByLabel(/Tên đơn vị/)).toHaveValue('Winner '+target.code);
          return{conflictPreservedInput:true,explicitReload:true,version:2};
        }finally{await first.context.close();await second.context.close()}
      });
      await test(`UI ${width}/${theme}: lost first-save response is inspected and retried with the same ID`,async()=>{
        const {page,context}=await pageFor(width,theme),code='L'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase();let committedId,intercepted=false;
        try{
          await page.route('**/api/v1/departments/*',async route=>{if(route.request().method()!=='PUT'||intercepted)return route.continue();intercepted=true;const response=await route.fetch();assert.equal(response.status(),200);committedId=(await response.json()).data.id;await route.abort('failed')});
          await page.getByRole('button',{name:'Thêm đơn vị',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Thêm đơn vị',exact:true});await dialog.getByLabel(/Mã đơn vị/).fill(code);await dialog.getByLabel(/Tên đơn vị/).fill('Lost '+code);await dialog.getByRole('button',{name:'Lưu đơn vị',exact:true}).click();
          await dialog.getByRole('button',{name:'Kiểm tra dữ liệu',exact:true}).waitFor();await expect(dialog.getByRole('button',{name:'Lưu đơn vị',exact:true})).toBeDisabled();await expect(dialog.getByLabel(/Tên đơn vị/)).toHaveValue('Lost '+code);
          await dialog.getByRole('button',{name:'Kiểm tra dữ liệu',exact:true}).click();await dialog.getByLabel('Tôi đã đối chiếu dữ liệu',{exact:false}).check();await dialog.getByRole('button',{name:'Kết thúc đối chiếu',exact:true}).click();await dialog.getByRole('button',{name:'Lưu đơn vị',exact:true}).click();await expect(dialog).toHaveCount(0);
          assert.ok(committedId);assert.equal(sql(`SELECT count(*) FROM departments WHERE id='${committedId}' AND version=1`),1);assert.equal(sql(`SELECT count(*) FROM audit_logs WHERE entity_id='${committedId}' AND action='DEPARTMENT_CREATED'`),1);return{rowCount:1,version:1,createdAudits:1,forwardThenAbort:true};
        }finally{await context.close()}
      });
      await test(`UI ${width}/${theme}: no other active department explains why transfer is unavailable`,async()=>{
        const target=await user(),{page,context}=await pageFor(width,theme);try{
          await page.route('**/api/v1/users/reference-data',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:{departments:ref.departments.filter(row=>row.id===it),roles:ref.roles}})}));
          await page.goto(stack.origin+'/users?q='+encodeURIComponent(target.email));await page.locator('tbody tr').filter({hasText:target.email}).getByRole('button',{name:'Chuyển đơn vị',exact:true}).click();
          const dialog=page.getByRole('dialog',{name:'Chuyển đơn vị',exact:true});await expect(dialog).toContainText('Chưa có đơn vị khác đang hoạt động');await expect(dialog.getByRole('button',{name:'Xác nhận chuyển',exact:true})).toBeDisabled();return{referenceResponseFixture:true,noDestination:true};
        }finally{await context.close()}
      });
      await test(`UI ${width}/${theme}: changing scope, role or target requires a fresh confirmation`,async()=>{
        const departmentA=await department(),departmentB=await department(),first=await user(),second=await user();
        const {page,context}=await pageFor(width,theme);
        try{
          await page.goto(stack.origin+'/users/access');
          const search=page.getByRole('textbox',{name:'Tìm tài khoản để phân quyền'});
          const searchButton=page.getByRole('button',{name:'Tìm tài khoản',exact:true});
          const target=page.getByLabel('Người dùng',{exact:true});
          const role=page.getByLabel('Vai trò',{exact:true});
          const confirm=page.getByRole('checkbox',{name:/Xác nhận thay đổi quyền/});
          const save=page.getByRole('button',{name:'Lưu quyền truy cập',exact:true});
          await search.fill(first.email);await searchButton.click();await target.selectOption(first.id);
          await role.selectOption('APPROVER');await confirm.check();await expect(save).toBeDisabled();
          await page.getByRole('checkbox',{name:departmentA.name,exact:true}).check();await expect(confirm).not.toBeChecked();
          await confirm.check();await expect(save).toBeEnabled();
          await page.getByRole('checkbox',{name:departmentB.name,exact:true}).check();await expect(confirm).not.toBeChecked();
          await confirm.check();await role.selectOption('ADMIN');await expect(confirm).not.toBeChecked();
          await confirm.check();await search.fill(second.email);await searchButton.click();await target.selectOption(second.id);
          await page.getByRole('button',{name:'Bỏ thay đổi',exact:true}).click();await expect(confirm).not.toBeChecked();await expect(save).toBeDisabled();
          return{resetAfterScopeChange:true,resetAfterRoleChange:true,resetAfterTargetChange:true,emptyScopeBlocked:true};
        }finally{await context.close()}
      });
      await test(`UI ${width}/${theme}: transfer a user and require login again`,async()=>{
        const destination=await department(),target=await user(),{page,context}=await pageFor(width,theme);try{
          await page.goto(stack.origin+'/users?q='+encodeURIComponent(target.email));const row=page.locator('tbody tr').filter({hasText:target.email});await row.getByRole('button',{name:'Chuyển đơn vị',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Chuyển đơn vị',exact:true});await dialog.getByLabel(/Đơn vị mới/).selectOption(destination.id);await page.screenshot({path:path.join(output,`transfer-${width}-${theme}.png`),fullPage:true,animations:'disabled'});await dialog.getByRole('button',{name:'Xác nhận chuyển',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(row).toContainText(destination.name);status(await call('GET','/auth/me',undefined,target.accessToken),401);return{destinationMatches:true,oldAccessDenied:true};
        }finally{await context.close()}
      });
    }
  }finally{report.success=results.length>0&&results.every(row=>row.passed);report.sourceHashes={};for(const file of ['backend/src/departments/departments.service.ts','backend/src/users/users.service.ts','backend/src/requests/requests.service.ts','backend/src/assets/assets.service.ts','frontend/src/DepartmentManager.tsx','frontend/src/WorkspacePages.tsx','tools/test-real-departments.cjs'])report.sourceHashes[file]=createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');await fs.writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2));await browser.close();console.log(`${results.filter(row=>row.passed).length}/${results.length}; report ${path.join(output,'results.json')}`);if(!report.success)process.exitCode=1}
}
main(...process.argv.slice(2)).catch(error=>{console.error(error.name+': '+String(error.message).slice(0,700));process.exitCode=1});
