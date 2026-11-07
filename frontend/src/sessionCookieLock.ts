const boundaryKey='crypta-session-boundary';
let memoryBoundary='';
function cookieBoundary(){
  if(typeof window==='undefined')return memoryBoundary;
  try{return window.localStorage?.getItem(boundaryKey)??memoryBoundary}catch{return memoryBoundary}
}
export function announceCookieSessionBoundary(){
  // This is only an opaque revision, with no account, credential or session ID.
  memoryBoundary=`${Date.now()}:${Math.random().toString(36).slice(2)}`;
  try{window.localStorage?.setItem(boundaryKey,memoryBoundary)}catch{/* Per-tab boundaries still work when storage is unavailable. */}
  return memoryBoundary;
}
export function cookieSessionBoundaryMatches(boundary:string){return cookieBoundary()===boundary}
export function currentCookieSessionBoundary(){return cookieBoundary()}
export function subscribeCookieSessionBoundary(listener:()=>void){
  if(typeof window==='undefined'||!window.addEventListener)return()=>{};
  const receive=(event:StorageEvent)=>{
    // A queued older storage event must not sign out a newer explicit login.
    if(event.key!==boundaryKey||!event.newValue||event.newValue===memoryBoundary||event.newValue!==cookieBoundary())return;
    memoryBoundary=event.newValue;listener();
  };
  window.addEventListener('storage',receive);
  return()=>window.removeEventListener('storage',receive);
}

// Web Locks are shared by tabs on the same origin. A rotated HttpOnly cookie is
// installed by fetch before this lock is released; no token needs to be shared.
// Browsers without Web Locks retain the API module's per-tab refresh dedupe.
export async function withSessionCookieLock<T>(current:()=>boolean,operation:()=>Promise<T>):Promise<T>{
  const boundary=cookieBoundary();
  const assertCurrent=()=>{if(!current()||!cookieSessionBoundaryMatches(boundary))throw new DOMException('Session changed while waiting','AbortError')};
  const run=async()=>{
    assertCurrent();
    const result=await operation();
    assertCurrent();return result;
  };
  const locks=typeof window==='undefined'?undefined:window.navigator?.locks;
  if(!locks?.request)return run();
  return locks.request('crypta-session-cookie',run);
}
