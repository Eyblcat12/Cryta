import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
const metrics={total:317,active:299,expiring:8,pending:7};
const lifecycle={live:307,within30:8,within180:100,after180:199,priority:null};
const respond=(data:unknown)=>new Response(JSON.stringify({data}),{status:200});
beforeEach(()=>vi.resetModules());afterEach(()=>vi.unstubAllGlobals());

describe('dashboard read contracts',()=>{
  it('normalizes numeric aggregates for the historical no-role endpoint as well',async()=>{
    const fetchMock=vi.fn(async(_url:string)=>respond({role:'APPROVER',metrics:{avg_wait_hours:'2.5'},trend:[],composition:[]}));vi.stubGlobal('fetch',fetchMock);
    const {api}=await import('./api');expect((await api.dashboard()).metrics.avg_wait_hours).toBe(2.5);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/dashboard');
  });
  it('requests the selected role and normalizes PostgreSQL numeric counters',async()=>{
    const fetchMock=vi.fn(async(_url:string)=>respond({role:'APPROVER',metrics:{pending:7,emergency:2,avg_wait_hours:'2.5',approved:4,rejected:1}}));vi.stubGlobal('fetch',fetchMock);
    const {api}=await import('./api');expect((await api.dashboardSummary('APPROVER')).metrics.avg_wait_hours).toBe(2.5);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/dashboard/summary?role=APPROVER');
  });
  it('does not relabel Admin data as owner data when the role contract is wrong',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>respond({role:'ADMIN',metrics})));const {api}=await import('./api');
    await expect(api.dashboardSummary('USER')).rejects.toMatchObject({code:'INVALID_DASHBOARD'});
  });
  it.each([undefined,null,{...lifecycle,within30:null},{...lifecycle,after180:'broken'}])('rejects incomplete lifecycle data instead of displaying fabricated zero buckets: %j',async value=>{
    vi.stubGlobal('fetch',vi.fn(async()=>respond({role:'USER',metrics,trend:[],composition:[],lifecycle:value})));const {api}=await import('./api');
    await expect(api.dashboard(undefined,'USER')).rejects.toMatchObject({code:'INVALID_DASHBOARD'});
  });
  it('uses authoritative totals and maps a priority asset by ID',async()=>{
    const fetchMock=vi.fn(async(_url:string)=>respond({role:'USER',metrics,trend:[],composition:[],lifecycle:{...lifecycle,priority:{id:'asset-300',code:'ASSET-0300',purpose:'Ngoài trang đầu',type:'KEY',status:'EXPIRING_SOON',expiresAt:'2026-10-05T00:00:00Z'}}}));vi.stubGlobal('fetch',fetchMock);const {api}=await import('./api');
    const result=await api.dashboard(undefined,'USER');expect(result.metrics.total).toBe(317);expect(result.lifecycle?.priority).toMatchObject({id:'asset-300',name:'Ngoài trang đầu'});expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/dashboard?role=USER');
  });
  it('accepts verified empty counters without interpreting them as an error',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>respond({role:'USER',metrics:{total:0,active:0,expiring:0,pending:0},trend:[],composition:[],lifecycle:{live:0,within30:0,within180:0,after180:0,priority:null}})));const {api}=await import('./api');
    expect((await api.dashboard(undefined,'USER')).metrics.total).toBe(0);
  });
});
