import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

const user={id:'owner',roles:['USER'],email:'owner@example.test',displayName:'Owner',departmentId:'IT',approverDepartmentIds:[],mustChangePassword:false};
const ok=(data:unknown)=>new Response(JSON.stringify({data}),{status:200});
const denied=(status=401)=>new Response(JSON.stringify({error:{code:status===401?'INVALID_SESSION':'UNAVAILABLE',message:'Test failure'}}),{status});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return {promise,resolve}}
beforeEach(()=>{vi.resetModules();const storage=new Map<string,string>();vi.stubGlobal('window',{sessionStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)}})});
afterEach(()=>vi.unstubAllGlobals());

describe('API session boundaries',()=>{
  it('keeps the MFA attempt after a wrong code and accepts the verified session after releasing the cookie lock',async()=>{
    const {api,subscribeSession}=await import('./api');
    const events=vi.fn();subscribeSession(events);
    const challenge='a'.repeat(43), mfaUser={...user,roles:['APPROVER'],mfaEnrolled:true};
    let verifyAttempts=0;
    const fetchMock=vi.fn(async(url:string,options:RequestInit)=>{
      if(url.endsWith('/auth/login'))return ok({mfa:'VERIFY',challenge});
      if(url.endsWith('/auth/mfa/verify')){
        verifyAttempts++;
        if(verifyAttempts===1)return new Response(JSON.stringify({error:{code:'MFA_CODE_INVALID',message:'Test denial'}}),{status:401});
        return ok({accessToken:'verified-mfa-token',user:mfaUser});
      }
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer verified-mfa-token');
      return ok({metrics:{total:4}});
    });
    vi.stubGlobal('fetch',fetchMock);
    await expect(api.login(user.email,'fixture-password')).resolves.toMatchObject({mfa:'VERIFY'});
    await expect(api.verifyMfa(challenge,'123456')).rejects.toMatchObject({code:'MFA_CODE_INVALID'});
    await expect(api.verifyMfa(challenge,'654321')).resolves.toEqual(mfaUser);
    expect((await api.dashboard()).metrics.total).toBe(4);
    expect(fetchMock.mock.calls.some(([url])=>url.endsWith('/auth/refresh'))).toBe(false);
    expect(events).not.toHaveBeenCalled();
  });
  it('shares one refresh across simultaneous 401 responses and retries with the new token',async()=>{
    const {api}=await import('./api');
    const fetchMock=vi.fn(async(url:string,options:RequestInit)=>{
      if(url.endsWith('/auth/refresh'))return ok({accessToken:'fresh',user});
      return new Headers(options.headers).get('Authorization')==='Bearer fresh'?ok({metrics:{total:2},total:2,items:[]}):denied();
    });vi.stubGlobal('fetch',fetchMock);
    const [dashboard,notifications]=await Promise.all([api.dashboard(),api.notificationPage({page:1,pageSize:1})]);
    expect(dashboard.metrics.total).toBe(2);expect(notifications.total).toBe(2);
    expect(fetchMock.mock.calls.filter(([url])=>url.endsWith('/auth/refresh'))).toHaveLength(1);
  });
  it('announces expiration once and prevents sibling requests from reviving the old session',async()=>{
    const {api,subscribeSession}=await import('./api');const events=vi.fn();subscribeSession(events);
    vi.stubGlobal('fetch',vi.fn(async()=>denied()));
    const results=await Promise.allSettled([api.dashboard(),api.notificationPage({page:1,pageSize:1})]);
    expect(results.every(result=>result.status==='rejected')).toBe(true);
    expect(events.mock.calls.filter(([event])=>event.type==='expired')).toHaveLength(1);
    expect(window.sessionStorage.getItem('crypta-session-ended')).toBe('1');
    await expect(api.restore()).rejects.toMatchObject({code:'SESSION_ENDED'});
  });
  it('does not discard work on a refresh outage',async()=>{
    const {api,subscribeSession}=await import('./api');const events=vi.fn();subscribeSession(events);
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('/auth/refresh')?denied(503):denied()));
    await expect(api.dashboard()).rejects.toMatchObject({status:503});
    expect(events).not.toHaveBeenCalled();expect(window.sessionStorage.getItem('crypta-session-ended')).toBeNull();
  });
  it('rejects an old account response even if the transport ignores abort',async()=>{
    const {api}=await import('./api');const old=deferred<Response>();
    const fetchMock=vi.fn(async(url:string,options:RequestInit)=>{
      if(url.endsWith('/assets/old'))return old.promise;
      if(url.endsWith('/auth/login'))return ok({accessToken:'new-account',user:{...user,id:'other'}});
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer new-account');return ok({metrics:{total:42}});
    });vi.stubGlobal('fetch',fetchMock);
    const previous=api.assetDetail('old');const rejected=expect(previous).rejects.toMatchObject({name:'AbortError'});
    await api.login('other@example.test','fixture-password');old.resolve(ok({id:'old'}));await rejected;
    expect((await api.dashboard()).metrics.total).toBe(42);
  });
  it('logout cancels pending refresh and prevents F5 from restoring an unconfirmed logout',async()=>{
    const {api}=await import('./api');const old=deferred<Response>();
    const fetchMock=vi.fn(async(url:string)=>url.endsWith('/auth/refresh')?old.promise:ok({loggedOut:true}));vi.stubGlobal('fetch',fetchMock);
    const restore=api.restore();const rejected=expect(restore).rejects.toMatchObject({name:'AbortError'});
    await api.logout();old.resolve(ok({accessToken:'must-not-return',user}));await rejected;
    const calls=fetchMock.mock.calls.length;await expect(api.restore()).rejects.toMatchObject({code:'SESSION_ENDED'});expect(fetchMock).toHaveBeenCalledTimes(calls);
  });
  it('refreshes an expired logout token once, then clears that refresh token from client memory',async()=>{
    const {api}=await import('./api');const authorization:string[]=[];
    vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{
      if(url.endsWith('/auth/login'))return ok({accessToken:'expired',user});
      if(url.endsWith('/auth/refresh'))return ok({accessToken:'fresh',user});
      authorization.push(new Headers(options.headers).get('Authorization')??'');return authorization.length===1?denied():ok({loggedOut:true});
    }));await api.login('owner@example.test','fixture-password');await api.logout();
    expect(authorization).toEqual(['Bearer expired','Bearer fresh']);await expect(api.restore()).rejects.toMatchObject({code:'SESSION_ENDED'});
  });
  it('cancelling one page during a shared refresh does not cancel its sibling',async()=>{
    const {api}=await import('./api');const pending=deferred<Response>();const controller=new AbortController();
    vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>url.endsWith('/auth/refresh')?pending.promise:new Headers(options.headers).get('Authorization')?ok({total:3,items:[]}):denied()));
    const first=api.dashboard(controller.signal),second=api.notificationPage({page:1,pageSize:1});
    const rejected=expect(first).rejects.toMatchObject({name:'AbortError'});await Promise.resolve();await Promise.resolve();controller.abort();pending.resolve(ok({accessToken:'fresh',user}));
    await rejected;expect((await second).total).toBe(3);
  });
  it('password change ends the old client session and rejects its pending data',async()=>{
    const {api}=await import('./api');const previous=deferred<Response>();
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('/assets/old')?previous.promise:ok({changed:true})));
    const old=api.assetDetail('old');const rejected=expect(old).rejects.toMatchObject({name:'AbortError'});
    await api.changePassword('old-fixture','new-fixture');previous.resolve(ok({id:'old'}));await rejected;
    await expect(api.restore()).rejects.toMatchObject({code:'SESSION_ENDED'});
  });
  it('new permissions cancel old operations before retrying with the refreshed token',async()=>{
    const {api,subscribeSession}=await import('./api');const events=vi.fn();subscribeSession(events);let refreshed=false;
    const fetchMock=vi.fn(async(url:string)=>{
      if(url.endsWith('/auth/login'))return ok({accessToken:'previous-scope',user});
      if(url.endsWith('/auth/refresh')){refreshed=true;return ok({accessToken:'current-scope',user:{...user,departmentId:'new-department'}})}
      return refreshed?ok({metrics:{total:42}}):denied();
    });vi.stubGlobal('fetch',fetchMock);await api.login('owner@example.test','fixture-password');
    await expect(api.createRequest({reason:'Belongs to the previous scope'})).rejects.toMatchObject({name:'AbortError'});
    expect(fetchMock.mock.calls.filter(([url])=>url.endsWith('/requests'))).toHaveLength(1);
    expect(events).toHaveBeenCalledWith({type:'refreshed',user:{...user,departmentId:'new-department'}});
    expect((await api.dashboard()).metrics.total).toBe(42);expect(window.sessionStorage.getItem('crypta-session-ended')).toBeNull();
  });
  it('confirmed workspace switch cancels old requests but retains valid credentials',async()=>{
    const {api}=await import('./api');const pending=deferred<Response>();
    vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{
      if(url.endsWith('/auth/login'))return ok({accessToken:'valid-token',user});
      if(url.endsWith('/assets/old'))return pending.promise;
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer valid-token');return ok({metrics:{total:4}});
    }));await api.login('owner@example.test','fixture-password');const old=api.assetDetail('old');const rejected=expect(old).rejects.toMatchObject({name:'AbortError'});
    api.abandonWorkspaceRequests();pending.resolve(ok({id:'old'}));await rejected;expect((await api.dashboard()).metrics.total).toBe(4);
  });
});
