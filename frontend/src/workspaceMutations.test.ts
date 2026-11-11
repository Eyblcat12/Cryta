import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const user={id:'owner',roles:['USER'],email:'owner@example.test',displayName:'Owner',departmentId:'IT',approverDepartmentIds:[],mustChangePassword:false};
const ok=(data:unknown)=>new Response(JSON.stringify({data}),{status:200});
const fail=(status:number)=>new Response(JSON.stringify({error:{code:'TEST_ERROR',message:'Fixture error'},requestId:'request-correlation'}),{status});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return{resolve,promise}}
beforeEach(()=>{vi.resetModules();const storage=new Map();vi.stubGlobal('window',{sessionStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)}})});
afterEach(()=>vi.unstubAllGlobals());
async function session(write:(url:string,options:RequestInit)=>Promise<Response>){
  const {api}=await import('./api');const journal=await import('./workspaceMutations');
  const fetchMock=vi.fn(async(url:string,options:RequestInit)=>url.endsWith('/auth/login')?ok({accessToken:'fixture',user}):write(url,options));
  vi.stubGlobal('fetch',fetchMock);await api.login(user.email,'fixture-secret');return{api,journal,fetchMock};
}
describe('workspace write outcomes',()=>{
  it.each([
    ['RETRY','APPROVED'],['CONFIRM','COMPLETED'],['ABANDON','FAILED'],
  ] as const)('acknowledges provider %s only for its request and next version',async(action,status)=>{
    const {api,journal,fetchMock}=await session(async()=>ok({id:'provider-request',status,version:8}));
    await api.recoverProviderIssue('provider-request',{action,version:7,reason:'Sensitive recovery justification'});
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/v1/operations/provider-issues/provider-request/actions');
    expect(journal.mutationSnapshot()[0]).toMatchObject({kind:'provider-recovery',phase:'confirmed',targetId:'provider-request',expectedVersion:7,expectedStatus:status});
    expect(journal.mutationSnapshot()[0].resources).toContain('providerRecovery');
    expect(JSON.stringify(journal.mutationSnapshot())).not.toContain('Sensitive recovery justification');
  });
  it.each([
    {id:'other-request',status:'COMPLETED',version:8},
    {id:'provider-request',status:'APPROVED',version:8},
    {id:'provider-request',status:'COMPLETED',version:7},
  ])('keeps a mismatched provider acknowledgment unresolved %#',async(response)=>{
    const {api,journal,fetchMock}=await session(async()=>ok(response));
    await expect(api.recoverProviderIssue('provider-request',{action:'CONFIRM',version:7,reason:'Confirm recorded provider output'})).rejects.toMatchObject({code:'MUTATION_UNKNOWN'});
    await expect(api.recoverProviderIssue('provider-request',{action:'ABANDON',version:7,reason:'Attempt competing close action'})).rejects.toMatchObject({code:'OPERATION_UNRESOLVED'});
    expect(journal.mutationSnapshot()[0]).toMatchObject({kind:'provider-recovery',phase:'unknown'});
    expect(fetchMock.mock.calls.filter(([url,options])=>url.endsWith('/actions')&&options.method==='POST')).toHaveLength(1);
  });
  it('reads provider status after a lost recovery response without replaying the action',async()=>{
    const {api,journal,fetchMock}=await session(async(_url,options)=>{
      if(options.method==='POST')throw new TypeError('Response lost after commit');
      return ok({id:'provider-request',status:'RETRY_SCHEDULED',version:8});
    });
    await expect(api.recoverProviderIssue('provider-request',{action:'RETRY',version:7,reason:'Confirm unsent database recovery'})).rejects.toMatchObject({code:'MUTATION_UNKNOWN'});
    const {readMutationState}=await import('./mutationReview');
    const operation=journal.mutationSnapshot()[0];
    await journal.inspectMutation(operation.id,readMutationState);
    expect(journal.mutationSnapshot()[0]).toMatchObject({phase:'unknown',review:expect.stringContaining('Đang chờ thử lại')});
    expect(fetchMock.mock.calls.filter(([url,options])=>url.endsWith('/actions')&&options.method==='POST')).toHaveLength(1);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/v1/operations/provider-issues/provider-request');
  });
  it('tracks draft saves by ID and expected version without retaining the form',async()=>{
    const {api,journal,fetchMock}=await session(async()=>ok({id:'draft-id',status:'DRAFT',version:5}));
    await api.saveDraft('draft-id',{type:'CREATE',reason:'sensitive draft text',emergency:false,parameters:{assetType:'KEY'}},4);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/v1/requests/drafts/draft-id');
    expect(journal.mutationSnapshot()[0]).toMatchObject({
      kind:'request-draft-save',phase:'confirmed',targetId:'draft-id',expectedVersion:4,resultId:'draft-id',
    });
    expect(JSON.stringify(journal.mutationSnapshot())).not.toContain('sensitive draft text');
  });
  it('keeps an unexpected draft submit version unresolved and prevents a repeat',async()=>{
    const {api,journal,fetchMock}=await session(async()=>ok({id:'draft-id',status:'PENDING',version:8}));
    await expect(api.submitDraft('draft-id',4)).rejects.toMatchObject({code:'MUTATION_UNKNOWN'});
    expect(journal.mutationSnapshot()[0]).toMatchObject({phase:'unknown',kind:'request-draft-submit'});
    await expect(api.submitDraft('draft-id',4)).rejects.toMatchObject({code:'OPERATION_UNRESOLVED'});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('keeps a lost response unresolved, blocks repeats, and stores no payload or secrets',async()=>{
    let writes=0;const {api,journal}=await session(async()=>{writes++;throw new TypeError('Network failed after server commit')});
    await expect(api.createRequest({reason:'private-note',temporaryPassword:'secret',parameters:{privateKey:'key-material'}})).rejects.toMatchObject({code:'MUTATION_UNKNOWN',outcome:'unknown'});
    const operation=journal.mutationSnapshot()[0];expect(operation).toMatchObject({phase:'unknown',owner:'owner',key:'request:create'});
    expect(JSON.stringify(operation)).not.toMatch(/private-note|secret|key-material/);
    await expect(api.createRequest({reason:'another'})).rejects.toMatchObject({code:'OPERATION_UNRESOLVED'});expect(writes).toBe(1);
    expect(journal.dismissMutation(operation.id)).toBe(false);
  });
  it('only reads during inspection; current data never confirms the original write',async()=>{
    const {api,journal,fetchMock}=await session(async(url)=>url.includes('/requests?')?ok({items:[],total:0,page:1,pageSize:10}):Promise.reject(new TypeError('lost')));
    await expect(api.createRequest({reason:'note'})).rejects.toThrow();const operation=journal.mutationSnapshot()[0];
    const {readMutationState}=await import('./mutationReview');await journal.inspectMutation(operation.id,readMutationState);
    expect(journal.mutationSnapshot()[0]).toMatchObject({phase:'unknown',reviewedAt:expect.any(Number)});
    expect(journal.mutationSnapshot()[0].review).toContain('chưa xác định được ID');
    expect(fetchMock.mock.calls.filter(([,options])=>options.method==='POST')).toHaveLength(2); // login + one write
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('createdByMe=true');
    expect(journal.dismissMutation(operation.id)).toBe(true);
  });
  it('failed inspection keeps the lock and cannot be acknowledged',async()=>{
    const {api,journal}=await session(async()=>fail(503));await expect(api.cancel('id')).rejects.toThrow();
    const operation=journal.mutationSnapshot()[0];await journal.inspectMutation(operation.id,async()=>{throw new Error('Read unavailable')});
    expect(journal.mutationSnapshot()[0]).toMatchObject({phase:'unknown',reviewError:'Read unavailable',requestId:'request-correlation'});
    expect(journal.dismissMutation(operation.id)).toBe(false);
  });
  it('a definite conflict unlocks the form for a corrected manual submission',async()=>{
    let attempts=0;const {api,journal}=await session(async()=>++attempts===1?fail(409):ok({id:'id',status:'APPROVED'}));
    await expect(api.decide('id',{decision:'APPROVED'})).rejects.toMatchObject({status:409});expect(journal.mutationSnapshot()).toEqual([]);
    await api.decide('id',{decision:'APPROVED'});expect(journal.mutationSnapshot()[0].phase).toBe('confirmed');
  });
  it('an original 401 followed by refresh outage is definitely unsent and remains retryable',async()=>{
    const {api,journal}=await session(async(url)=>fail(url.endsWith('/auth/refresh')?503:401));
    await expect(api.createRequest({reason:'note'})).rejects.toMatchObject({status:503,outcome:'rejected'});
    expect(journal.mutationSnapshot()).toEqual([]);
  });
  it.each([new Response('bad-json',{status:200}),ok({}),ok({id:'different',status:'APPROVED'})])('rejects a malformed success acknowledgment %#',async(response)=>{
    const {api,journal}=await session(async()=>response);await expect(api.decide('id',{decision:'APPROVED'})).rejects.toMatchObject({code:'MUTATION_UNKNOWN'});
    expect(journal.mutationSnapshot()[0].phase).toBe('unknown');
  });
  it('pending and late confirmed results survive route lifetimes without another write',async()=>{
    const pending=deferred<Response>();const {api,journal,fetchMock}=await session(async()=>pending.promise);
    const write=api.createRequest({reason:'note'});expect(journal.mutationSnapshot()[0].phase).toBe('pending');
    await expect(api.createRequest({reason:'new'})).rejects.toMatchObject({code:'OPERATION_UNRESOLVED'});
    pending.resolve(ok({id:'created',status:'PENDING'}));await write;
    expect(journal.mutationSnapshot()[0]).toMatchObject({phase:'confirmed',resultId:'created'});expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('workspace role switch retains the unknown outcome but clears old transport',async()=>{
    const pending=deferred<Response>();const {api,journal}=await session(async()=>pending.promise);
    const write=api.createRequest({reason:'note'});const rejected=expect(write).rejects.toMatchObject({name:'AbortError'});
    api.abandonWorkspaceRequests();pending.resolve(ok({id:'created',status:'PENDING'}));await rejected;
    expect(journal.mutationSnapshot()[0]).toMatchObject({phase:'unknown',owner:'owner'});
  });
  it('logout clears metadata and late responses cannot revive it',async()=>{
    const pending=deferred<Response>();const {api,journal}=await session(async(url)=>url.endsWith('/auth/logout')?ok({loggedOut:true}):pending.promise);
    const write=api.createRequest({reason:'note'});const rejected=expect(write).rejects.toMatchObject({name:'AbortError'});
    await api.logout();pending.resolve(ok({id:'created',status:'PENDING'}));await rejected;expect(journal.mutationSnapshot()).toEqual([]);
  });
  it('permission changes discard old-scope metadata before a write can retry',async()=>{
    const {api,journal,fetchMock}=await session(async(url)=>url.endsWith('/auth/refresh')?ok({accessToken:'new',user:{...user,departmentId:'new'}}):fail(401));
    await expect(api.createRequest({reason:'note'})).rejects.toMatchObject({name:'AbortError'});expect(journal.mutationSnapshot()).toEqual([]);
    expect(fetchMock.mock.calls.filter(([url])=>url.endsWith('/requests'))).toHaveLength(1);
  });
  it('abandoned inspection cannot add read data after the account changes',async()=>{
    const {api,journal}=await session(async()=>fail(503));await expect(api.createUser({email:'person@example.test',temporaryPassword:'secret'})).rejects.toThrow();
    const pending=deferred<string>();const operation=journal.mutationSnapshot()[0];const inspection=journal.inspectMutation(operation.id,async()=>pending.promise);
    journal.bindMutationOwner('other');pending.resolve('Old account data');await inspection;expect(journal.mutationSnapshot()).toEqual([]);
  });
  it('a created account acknowledgment must match the exact submitted email',async()=>{
    const {api,journal}=await session(async()=>ok({id:'created',email:'another@example.test'}));
    await expect(api.createUser({email:'person@example.test'})).rejects.toMatchObject({code:'MUTATION_UNKNOWN'});
    expect(journal.mutationSnapshot()[0]).toMatchObject({phase:'unknown',email:'person@example.test'});
  });
  it.each([{id:'version',policyId:'other',version:2},{id:'version',policyId:'policy',version:1},{id:'version',policyId:'policy',version:'2'}])('a policy acknowledgment must match policy and next numeric version %#',async(response)=>{
    const {api,journal}=await session(async()=>ok(response));
    await expect(api.createPolicyVersion('policy',{expectedVersion:1,maximumValidityDays:365,warningDays:[30]})).rejects.toMatchObject({code:'MUTATION_UNKNOWN'});
    expect(journal.mutationSnapshot()[0]).toMatchObject({phase:'unknown',targetId:'policy',expectedVersion:1});
  });
  it('accepts matching account and policy acknowledgments without storing configuration or credentials',async()=>{
    const {api,journal}=await session(async(url)=>url.endsWith('/versions')?ok({id:'version',policyId:'policy',version:2}):ok({id:'created',email:'person@example.test'}));
    await api.createUser({email:' PERSON@example.test ',temporaryPassword:'private-password'});
    await api.createPolicyVersion('policy',{expectedVersion:1,algorithm:'RSA',maximumValidityDays:365,warningDays:[30]});
    expect(journal.mutationSnapshot().map(item=>item.phase)).toEqual(['confirmed','confirmed']);
    expect(JSON.stringify(journal.mutationSnapshot())).not.toMatch(/private-password|maximumValidityDays|warningDays/);
  });
  it('blocks a second write until the confirmed result has been consumed by the workspace',async()=>{
    const {api,journal,fetchMock}=await session(async()=>ok({id:'created',status:'PENDING'}));
    await api.createRequest({reason:'first'});
    await expect(api.createRequest({reason:'second'})).rejects.toMatchObject({code:'OPERATION_UNRESOLVED'});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(journal.dismissMutation(journal.mutationSnapshot()[0].id)).toBe(true);
    await api.createRequest({reason:'explicit later request'});expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('organization write acknowledgments',()=>{
  it.each(['department-save','department-status','user-department'])('keeps %s unresolved when the returned version is wrong',async kind=>{
    const {api,journal,fetchMock}=await session(async()=>ok({id:'dep',active:false,updated:true,departmentId:'dep',version:99}));
    const write=()=>kind==='department-save'?api.saveDepartment('dep',{code:'IT',name:'Technology',version:2}):kind==='department-status'?api.departmentStatus('dep',false,2):api.transferDepartment('person','dep',2);
    await expect(write()).rejects.toMatchObject({code:'MUTATION_UNKNOWN'});
    expect(journal.mutationSnapshot()[0]).toMatchObject({phase:'unknown',kind});
    await expect(write()).rejects.toMatchObject({code:'OPERATION_UNRESOLVED'});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
