import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

const user={id:'owner',roles:['USER'],email:'owner@example.test',displayName:'Owner',departmentId:'IT',approverDepartmentIds:[],mustChangePassword:false};
const ok=(data:unknown)=>new Response(JSON.stringify({data}),{status:200});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done});return{promise,resolve}}
let local:Map<string,string>;
let receiveStorage:((event:StorageEvent)=>void)|undefined;
function serialLocks(){
  let tail:Promise<unknown>=Promise.resolve();
  const request=vi.fn((_name:string,run:()=>unknown)=>{const pending=tail.then(run);tail=pending.catch(()=>undefined);return pending});
  vi.stubGlobal('navigator',{locks:{request}});return request;
}
beforeEach(()=>{
  vi.resetModules();local=new Map();receiveStorage=undefined;const session=new Map<string,string>();
  vi.stubGlobal('window',{
    get navigator(){return navigator},
    localStorage:{getItem:(key:string)=>local.get(key)??null,setItem:(key:string,value:string)=>local.set(key,value)},
    sessionStorage:{getItem:(key:string)=>session.get(key)??null,setItem:(key:string,value:string)=>session.set(key,value),removeItem:(key:string)=>session.delete(key)},
    addEventListener:(_name:string,listener:(event:StorageEvent)=>void)=>{receiveStorage=listener},removeEventListener:vi.fn(),
  });
});
afterEach(()=>vi.unstubAllGlobals());

describe('shared refresh cookie coordination',()=>{
  it('two tabs rotate the latest cookie sequentially rather than replaying the first cookie',async()=>{
    serialLocks();const gate=deferred<void>();let cookie=0;const observed:number[]=[];
    const {withSessionCookieLock}=await import('./sessionCookieLock');
    const first=withSessionCookieLock(()=>true,async()=>{observed.push(cookie);await gate.promise;cookie++;return'first'});
    const second=withSessionCookieLock(()=>true,async()=>{observed.push(cookie);cookie++;return'second'});
    await Promise.resolve();expect(observed).toEqual([0]);gate.resolve();
    expect(await Promise.all([first,second])).toEqual(['first','second']);expect(observed).toEqual([0,1]);
  });
  it('logout abandons a refresh waiting behind another tab before it sends HTTP',async()=>{
    const locks=serialLocks(),held=deferred<void>();const blocker=locks('crypta-session-cookie',()=>held.promise);
    const {api}=await import('./api');const fetchMock=vi.fn(async(_url:string)=>ok({loggedOut:true}));vi.stubGlobal('fetch',fetchMock);
    const restoring=api.restore();const rejected=expect(restoring).rejects.toMatchObject({name:'AbortError'});
    const loggingOut=api.logout();expect(fetchMock).not.toHaveBeenCalled();held.resolve();await blocker;await rejected;await loggingOut;
    expect(fetchMock.mock.calls.map(call=>call[0])).toEqual(['/api/v1/auth/logout']);
    await expect(api.restore()).rejects.toMatchObject({code:'SESSION_ENDED'});
  });
  it('a queued old logout cannot revoke the shared cookie after another account starts login',async()=>{
    const locks=serialLocks();const {api}=await import('./api');
    const fetchMock=vi.fn(async(_url:string)=>ok({accessToken:'owner-token',user}));vi.stubGlobal('fetch',fetchMock);await api.login(user.email,'fixture-password');
    const held=deferred<void>(),blocker=locks('crypta-session-cookie',()=>held.promise);
    const loggingOut=api.logout();const rejected=expect(loggingOut).rejects.toMatchObject({name:'AbortError'});
    // The other tab writes its opaque revision before its login waits for the lock.
    local.set('crypta-session-boundary','another-account-intent');held.resolve();await blocker;await rejected;
    expect(fetchMock.mock.calls.map(call=>call[0])).toEqual(['/api/v1/auth/login']);
  });
  it('a sibling account boundary clears the old session and rejects a late response',async()=>{
    serialLocks();const {api,subscribeSession}=await import('./api');const events=vi.fn();subscribeSession(events);
    const old=deferred<Response>();vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('/auth/login')?ok({accessToken:'owner-token',user}):old.promise));
    await api.login(user.email,'fixture-password');const loading=api.assetDetail('old');const rejected=expect(loading).rejects.toMatchObject({name:'AbortError'});
    local.set('crypta-session-boundary','sibling-logout');receiveStorage?.({key:'crypta-session-boundary',newValue:'sibling-logout'} as StorageEvent);
    old.resolve(ok({id:'old'}));await rejected;expect(events).toHaveBeenCalledWith({type:'expired'});
    await expect(api.restore()).rejects.toMatchObject({code:'SESSION_ENDED'});
  });
  it('an expired-token logout rotates once without nested locking or restoring the user',async()=>{
    serialLocks();const {api,subscribeSession}=await import('./api');const events=vi.fn();subscribeSession(events);let logoutCalls=0;
    const authorization:string[]=[];
    const fetchMock=vi.fn(async(url:string,options:RequestInit)=>{
      if(url.endsWith('/auth/login'))return ok({accessToken:'expired',user});
      if(url.endsWith('/auth/refresh'))return ok({accessToken:'temporary-logout',user});
      authorization.push(new Headers(options.headers).get('Authorization')??'');
      return ++logoutCalls===1?new Response(JSON.stringify({error:{code:'TOKEN_INVALID'}}),{status:401}):ok({loggedOut:true});
    });vi.stubGlobal('fetch',fetchMock);await api.login(user.email,'fixture-password');await api.logout();
    expect(authorization).toEqual(['Bearer expired','Bearer temporary-logout']);expect(events).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([url])=>url.endsWith('/auth/refresh'))).toHaveLength(1);
    await expect(api.restore()).rejects.toMatchObject({code:'SESSION_ENDED'});
  });
  it('ignores an older sibling event delivered after a newer explicit login',async()=>{
    serialLocks();local.set('crypta-session-boundary','older-sibling-event');
    const {api,subscribeSession}=await import('./api');const events=vi.fn();subscribeSession(events);
    vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{
      if(url.endsWith('/auth/login'))return ok({accessToken:'new-login',user});
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer new-login');return ok({metrics:{total:8}});
    }));await api.login(user.email,'fixture-password');
    receiveStorage?.({key:'crypta-session-boundary',newValue:'older-sibling-event'} as StorageEvent);
    expect((await api.dashboard()).metrics.total).toBe(8);expect(events).not.toHaveBeenCalled();
  });
  it('a delayed sibling event cannot refresh another account cookie from an old 401',async()=>{
    serialLocks();const {api}=await import('./api');const old=deferred<Response>();
    const fetchMock=vi.fn(async(url:string)=>url.endsWith('/auth/login')?ok({accessToken:'old-account',user}):old.promise);vi.stubGlobal('fetch',fetchMock);
    await api.login(user.email,'fixture-password');const loading=api.dashboard();const rejected=expect(loading).rejects.toMatchObject({name:'AbortError'});
    local.set('crypta-session-boundary','new-account-cookie');
    // Deliberately hold back the storage event while the old protected GET returns.
    old.resolve(new Response(JSON.stringify({error:{code:'TOKEN_INVALID'}}),{status:401}));await rejected;
    expect(fetchMock.mock.calls.filter(([url])=>url.endsWith('/auth/refresh'))).toHaveLength(0);
    receiveStorage?.({key:'crypta-session-boundary',newValue:'new-account-cookie'} as StorageEvent);
    await expect(api.restore()).rejects.toMatchObject({code:'SESSION_ENDED'});
  });
  it('keeps per-tab dedupe when Web Locks are unavailable',async()=>{
    vi.stubGlobal('navigator',{});const {api}=await import('./api');
    const fetchMock=vi.fn(async()=>ok({accessToken:'fresh',user}));vi.stubGlobal('fetch',fetchMock);
    const restored=await Promise.all([api.restore(),api.restore()]);expect(restored).toEqual([user,user]);expect(fetchMock).toHaveBeenCalledOnce();
  });
});
