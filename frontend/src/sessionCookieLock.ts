const boundaryKey='crypta-session-boundary';
const lockName = 'crypta-session-cookie';
const lockStore = 'cookie';
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

function openCookieLockDatabase(): Promise<IDBDatabase | undefined> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest | undefined;
    try { request = window.indexedDB?.open('crypta-session-coordination', 1); }
    catch { resolve(undefined); return; }
    if (!request) { resolve(undefined); return; }
    const opening = request;
    let blocked = false;
    opening.onupgradeneeded = () => { opening.result.createObjectStore(lockStore); };
    opening.onerror = () => resolve(undefined);
    opening.onblocked = () => {
      blocked = true;
      reject(new DOMException('Session coordination is blocked', 'AbortError'));
    };
    opening.onsuccess = () => {
      const database = opening.result;
      if (blocked) { database.close(); return; }
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

function runInCookieTransaction<T>(database: IDBDatabase, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(lockStore, 'readwrite');
    const store = transaction.objectStore(lockStore);
    const controller = new AbortController();
    let result: Promise<T> | undefined;
    let finished = false;
    const markFinished = () => { finished = true; };
    transaction.onabort = () => {
      controller.abort();
      reject(transaction.error ?? new DOMException('Session coordination stopped', 'AbortError'));
    };
    transaction.oncomplete = () => {
      if (result) void result.then(resolve, reject);
      else reject(new DOMException('Session coordination stopped', 'AbortError'));
    };
    // A readwrite transaction serializes tabs on this empty store. Keep one read
    // pending until fetch installs the HttpOnly cookie. No record is written.
    const keepPending = () => {
      store.get(lockName).onsuccess = () => {
        if (!result) {
          result = operation(controller.signal);
          void result.then(markFinished, markFinished);
        }
        if (!finished) keepPending();
      };
    };
    keepPending();
  });
}

// Web Locks are preferred. Both mechanisms wait for the browser to install the
// rotated HttpOnly cookie before another tab can start a cookie operation.
export async function withSessionCookieLock<T>(current:()=>boolean,operation:(signal?: AbortSignal)=>Promise<T>):Promise<T>{
  const boundary=cookieBoundary();
  const assertCurrent=()=>{if(!current()||!cookieSessionBoundaryMatches(boundary))throw new DOMException('Session changed while waiting','AbortError')};
  const run=async(signal?: AbortSignal)=>{
    assertCurrent();
    const result=await operation(signal);
    assertCurrent();return result;
  };
  if (typeof window === 'undefined') return run();
  const locks = window.navigator?.locks;
  if (locks?.request) return locks.request(lockName, () => run());
  const database = await openCookieLockDatabase();
  if (!database) return run();
  try { return await runInCookieTransaction(database, run); }
  finally { database.close(); }
}
