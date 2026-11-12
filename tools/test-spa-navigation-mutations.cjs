// NAV-13/15 UI contract checks using isolated HTTP fixtures, not real DB/provider proof.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const playwright=require(path.join(process.argv[2],'playwright'));
const {fixture,visible}=require('./test-spa-workspace.cjs');
const origin=process.env.CRYPTA_UI_TEST_URL||'http://127.0.0.1:4173';
const channel=process.env.CRYPTA_TEST_BROWSER||'msedge';
const width=Number(process.env.CRYPTA_NAV_MUTATION_WIDTH||1440),theme=process.env.CRYPTA_NAV_MUTATION_THEME||'light';
const output=path.resolve(process.env.CRYPTA_NAV_MUTATION_OUTPUT||path.join(__dirname,'test-artifacts','spa',`navigation-mutations-${Date.now()}`));
const results=[];
let browser;
const apiPath=request=>new URL(request.url()).pathname.slice('/api/v1'.length);
async function check(name,role,body,options={}){
  if(process.env.CRYPTA_NAV_MUTATION_FILTER&&!name.includes(process.env.CRYPTA_NAV_MUTATION_FILTER))return;
  const f=await fixture(browser,role,options),item={name,status:'passed',evidence:{}};
  await f.page.setViewportSize({width,height:1000});await f.page.addInitScript(value=>localStorage.setItem('crypta-theme',value),theme);
  const writes=[];f.page.on('request',request=>{
    if((request.method()==='POST'&&apiPath(request)==='/requests')||(request.method()==='PUT'&&/^\/users\/[^/]+\/access$/.test(apiPath(request))))writes.push({method:request.method(),endpoint:apiPath(request),body:request.postDataJSON()});
  });
  try{await body({...f,writes,evidence:item.evidence});assert.deepEqual(f.errors,[])}
  catch(error){item.status='failed';item.error=error.stack;process.exitCode=1;await f.page.screenshot({path:path.join(output,`${results.length+1}-failed.png`),fullPage:true})}
  finally{item.evidence.writes=writes;await f.context.tracing.stop({path:path.join(output,`${results.length+1}.zip`)});await f.context.close();results.push(item);console.log(`${item.status==='passed'?'PASS':'FAIL'} ${name}${item.error?'\n'+item.error:''}`)}
}
async function usersMenu(page){
  const menu=page.getByRole('button',{name:'Mở điều hướng',exact:true});if(await menu.isVisible())await menu.click();await page.locator('a.nav-item[href="/users"]').click();await visible(page,'Người dùng và vai trò');
}
const asset={id:'asset-300',code:'ASSET-0300',purpose:'Tài sản 300',type:'KEY',status:'ACTIVE',algorithm:'RSA',keySize:2048,expiresAt:'2027-09-30T00:00:00Z',ownerId:'session-USER',ownerName:'Người dùng mẫu',departmentId:'department-1',departmentName:'Đơn vị mẫu',policyVersionId:'asset-policy-9',policyCode:'CURRENT',version:9,publicKeyFingerprint:'public-fixture-fingerprint'};
(async()=>{
  await fs.mkdir(output,{recursive:true});const initialHtml=await(await fetch(origin)).text(),buildAssets=[...initialHtml.matchAll(/\/assets\/[^"']+/g)].map(match=>match[0]);
  browser=channel==='firefox'?await playwright.firefox.launch({headless:true}):await playwright.chromium.launch({channel,headless:true});const browserVersion=browser.version(),browserEngine=browser.browserType().name();
  try{
    for(const change of [{label:'grant access',id:'person-1',page:1,from:'USER',to:'APPROVER',scopes:['department-1']},{label:'edit access on page two',id:'person-21',page:2,from:'APPROVER',to:'USER',scopes:[]}])await check(`NAV-13 ${change.label} writes the selected ID once, revalidates access and updates Users across F5`,'ADMIN',async({page,state,mutations,writes,calls,evidence})=>{
      if(change.from==='APPROVER')state.userOverrides={[change.id]:{roles:['APPROVER'],approverDepartmentIds:['department-1']}};
      state.mutationStarted=endpoint=>{
        if(endpoint!==`/users/${change.id}/access`)return;const body=mutations.at(-1).body;
        state.userOverrides={...state.userOverrides,[change.id]:{roles:[...body.roles],approverDepartmentIds:[...body.approverDepartmentIds]}};
      };
      await page.goto(origin+'/users/access');const user=page.getByLabel('Người dùng',{exact:true});await user.locator('option[value="person-1"]').waitFor({state:'attached'});
      if(change.page===2){await page.getByRole('button',{name:'Sau',exact:true}).click();await user.locator(`option[value="${change.id}"]`).waitFor({state:'attached'})}
      await user.selectOption(change.id);const role=page.getByLabel('Vai trò',{exact:true});assert.equal(await role.inputValue(),change.from);await role.selectOption(change.to);
      if(change.to==='APPROVER')await page.getByRole('checkbox',{name:'Đơn vị mẫu',exact:true}).check();await page.getByRole('checkbox',{name:'Xác nhận thay đổi quyền của tài khoản đã chọn.',exact:true}).check();
      const beforeReads=calls.filter(call=>call.startsWith('GET /users?')).length;
      const revalidated=page.waitForRequest(request=>request.method()==='GET'&&apiPath(request)==='/users'&&new URL(request.url()).searchParams.get('page')===String(change.page));
      await page.getByRole('button',{name:'Lưu quyền truy cập',exact:true}).click();await page.getByRole('region',{name:'Phân quyền và phạm vi phòng ban',exact:true}).getByRole('status').filter({hasText:'Đã cập nhật quyền. Người dùng cần đăng nhập lại.'}).waitFor();await revalidated;
      assert.equal(writes.length,1);assert.deepEqual(writes[0],{method:'PUT',endpoint:`/users/${change.id}/access`,body:{roles:[change.to],approverDepartmentIds:change.scopes}});assert.equal(mutations.length,1);assert(calls.filter(call=>call.startsWith('GET /users?')).length>beforeReads);
      await user.selectOption(change.id);assert.equal(await role.inputValue(),change.to);if(change.to==='APPROVER')assert.equal(await page.getByRole('checkbox',{name:'Đơn vị mẫu',exact:true}).isChecked(),true);
      await usersMenu(page);const email=`person${change.id.slice('person-'.length)}@example.test`,row=page.getByRole('row').filter({hasText:email});await row.waitFor();assert.equal((await row.locator('td').nth(2).innerText()).trim(),change.to);
      await page.reload();await row.waitFor();assert.equal((await row.locator('td').nth(2).innerText()).trim(),change.to);assert.equal(writes.length,1);assert.equal(mutations.length,1);
      evidence.targetId=change.id;evidence.accessPage=change.page;evidence.confirmedRoles=[change.to];evidence.confirmedScopes=change.scopes;evidence.listReadsAfter=calls.filter(call=>call.startsWith('GET /users?'));await page.screenshot({path:path.join(output,`${change.id}-users-after.png`),fullPage:true});
    });
    for(const type of ['CREATE','RENEW','REVOKE'])for(const entry of ['UI','URL'])await check(`NAV-15 ${type} from ${entry} sends current target/policy once and its result opens and reloads by request URL`,'USER',async({page,mutations,writes,calls,user,evidence})=>{
      const assetReads=[],resultReads=[];const createdId='fixture-created',reason=`${type} ${entry} phục vụ kiểm thử kết quả điều hướng`;
      await page.route('**/api/v1/**',async route=>{
        const request=route.request(),endpoint=apiPath(request);if(request.method()!=='GET')return route.fallback();
        if(endpoint==='/assets/asset-300'){
          assetReads.push({method:'GET',endpoint,assetVersion:asset.version,policyVersionId:asset.policyVersionId});
          return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:asset})});
        }
        if(endpoint===`/requests/${createdId}`){
          const write=writes.find(item=>item.method==='POST'&&item.endpoint==='/requests');assert(write,'Request detail is unavailable until the explicit form POST');
          const data={id:createdId,type:write.body.type,reason:write.body.reason,status:'PENDING',submittedAt:'2026-10-05T00:00:00Z',creatorId:user.id,creatorName:user.displayName,departmentId:user.departmentId,departmentName:user.departmentName,policyVersionId:write.body.policyVersionId,targetAssetId:write.body.targetAssetId,targetAssetCode:write.body.targetAssetId?asset.code:undefined,emergency:write.body.emergency,version:1};
          resultReads.push({method:'GET',endpoint,requestVersion:data.version,policyVersionId:data.policyVersionId,targetAssetId:data.targetAssetId});
          return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data})});
        }
        return route.fallback();
      });
      if(entry==='URL')await page.goto(origin+`/requests/new?type=${type}${type==='CREATE'?'':'&assetId=asset-300'}`);
      else if(type==='CREATE'){
        await page.goto(origin+'/assets');await visible(page,'Tài sản của tôi');await page.getByRole('button',{name:'Tạo yêu cầu',exact:true}).click();
      }else{
        await page.goto(origin+'/assets/asset-300');await visible(page,'Tài sản 300');await page.getByRole('button',{name:type==='RENEW'?'Yêu cầu gia hạn':'Thu hồi',exact:true}).click();
      }
      const dialog=page.getByRole('dialog');await dialog.waitFor();assert.equal(await dialog.locator(`input[name="type"][value="${type}"]`).isChecked(),true);assert.equal(new URL(page.url()).pathname,'/requests/new');
      if(type==='CREATE'){await dialog.getByRole('option',{name:'Chính sách RSA v1',exact:true}).waitFor({state:'attached'});assert.equal(await dialog.locator('#request-asset').count(),0)}
      else{
        await page.waitForFunction(()=>document.querySelector('#request-asset')?.selectedOptions[0]?.textContent?.includes('ASSET-0300'));
        await page.waitForFunction(()=>{const submit=document.querySelector('[role=dialog] footer button[type=submit]');return submit&&!submit.disabled});
        assert.equal(await dialog.locator('#request-asset').inputValue(),'asset-300');assert.equal(new URL(page.url()).searchParams.get('assetId'),'asset-300');assert(assetReads.length>=(entry==='UI'?2:1),'Picker must fetch its current selected object independently');assert(calls.some(call=>call.startsWith('GET /assets?')&&call.includes('eligible=true')&&call.includes('ownedOnly=true')));
      }
      await dialog.locator('textarea').fill(reason);assert.equal(mutations.length,0);
      await dialog.getByRole('button',{name:type==='REVOKE'?'Tiếp tục thu hồi':'Gửi yêu cầu',exact:true}).click();
      if(type==='REVOKE'){assert.equal(mutations.length,0);await dialog.getByRole('heading',{name:'Thu hồi Tài sản 300',exact:true}).waitFor();await dialog.getByRole('button',{name:'Xác nhận thu hồi',exact:true}).click()}
      await visible(page,'Yêu cầu của tôi');assert.equal(mutations.length,1);assert.equal(writes.length,1);const body=writes[0].body;
      assert.equal(writes[0].method,'POST');assert.equal(writes[0].endpoint,'/requests');assert.equal(body.type,type);assert.equal(body.reason,reason);assert.equal(body.policyVersionId,type==='CREATE'?'version-1':asset.policyVersionId);assert.equal(body.targetAssetId,type==='CREATE'?undefined:asset.id);assert.equal(body.emergency,false);assert.deepEqual(body.parameters,type==='CREATE'?{assetType:'KEY'}:{});
      await page.locator('.request-item').filter({hasText:reason}).click();await visible(page,reason);assert.equal(new URL(page.url()).pathname,`/requests/${createdId}`);assert.equal(resultReads.length,1);
      await page.reload();await visible(page,reason);assert.equal(new URL(page.url()).pathname,`/requests/${createdId}`);assert.equal(resultReads.length,2);assert.equal(mutations.length,1);assert.equal(writes.length,1);assert.equal(await page.getByRole('alertdialog').count(),0);
      evidence.entry=entry;evidence.type=type;evidence.assetReads=assetReads;evidence.createdRequestId=createdId;evidence.resultReads=resultReads;evidence.finalPath=new URL(page.url()).pathname;await page.screenshot({path:path.join(output,`${type}-${entry}-result.png`),fullPage:true});
    });
  }finally{await browser.close();const finalHtml=await(await fetch(origin)).text();assert.deepEqual([...finalHtml.matchAll(/\/assets\/[^"']+/g)].map(match=>match[0]),buildAssets,'The preview bundle changed during the navigation mutation suite');await fs.writeFile(path.join(output,'results.json'),JSON.stringify({origin,browserChannel:channel,browserEngine,browserVersion,buildAssets,width,theme,fixtureOnly:true,scope:'NAV-13 access UI success and NAV-15 CREATE/RENEW/REVOKE form/POST/current policy/result URL/F5; simulated HTTP persistence only, not real authorization/concurrency/provider execution.',protocolLimits:['Access uses PUT without expectedVersion.','Request creation carries policyVersionId and optional targetAssetId, not an expected asset/request version; fixture GET models the new request version as 1.','Created request GET and updated user reads are fixture state; provider completion and real DB/SMTP are not exercised.'],results},null,2))}
  assert(results.length>0,'No matching navigation mutation checks');console.log(`${results.filter(item=>item.status==='passed').length}/${results.length} navigation mutation checks passed`);
})().catch(error=>{console.error(error);process.exitCode=1});
