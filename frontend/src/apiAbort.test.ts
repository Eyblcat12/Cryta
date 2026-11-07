import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('abandoned route requests', () => {
  it.each([
    ['assets', (signal:AbortSignal)=>api.assetPage({page:3,pageSize:25,eligible:true,ownedOnly:true},signal)],
    ['requests', (signal:AbortSignal)=>api.requestPage({page:2,pageSize:10,excludePending:true,createdByMe:true},signal)],
  ] as const)('cancels paged %s without dropping the server filter',async(name,load)=>{
    const controller=new AbortController();
    const fetchMock=vi.fn((_url:string,options:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
      options.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
    }));
    vi.stubGlobal('fetch',fetchMock);
    const pending=load(controller.signal);
    expect(fetchMock.mock.calls[0][0]).toContain(name==='assets'?'eligible=true':'excludePending=true');
    expect(fetchMock.mock.calls[0][0]).toContain(name==='assets'?'ownedOnly=true':'createdByMe=true');
    controller.abort();expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({name:'AbortError'});
  });
  it('passes AbortSignal to GET and preserves abort without a network-error toast', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = api.dashboard(controller.signal);
    expect(fetchMock).toHaveBeenCalledOnce();
    controller.abort();
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('still reports an actual offline GET as a recoverable API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(api.dashboard()).rejects.toMatchObject({ code: 'NETWORK_ERROR' } satisfies Partial<ApiError>);
  });
});
