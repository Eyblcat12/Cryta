import { describe,expect,it,vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import type { NotificationsService } from '../src/notifications/notifications.service';
import { AssetsService } from '../src/assets/assets.service';
import { RequestsService } from '../src/requests/requests.service';

const user:AuthUser={id:'me',email:'me@example.test',displayName:'Me',departmentId:'own-dept',tokenVersion:1,roles:['USER'],approverDepartmentIds:['scope'],mustChangePassword:false};
function pool(){const query=vi.fn(async(sql:string,_values?:unknown[])=>({rows:sql.includes('COUNT(*)')?[{total:317}]:[]}));return {query,servicePool:{query} as unknown as Pool}}
describe('personal projections and granted read scopes',()=>{
  it.each([['ADMIN','USER'],['APPROVER','USER']] as AuthUser['roles'][])('counts and pages only the authenticated owner for roles %j',async roles=>{
    const {query,servicePool}=pool();const service=new AssetsService(servicePool);
    expect(await service.list({...user,roles},{ownedOnly:'true',eligible:'true',page:'2',pageSize:'20',ownerId:'other'})).toMatchObject({total:317,page:2,pageSize:20});
    for(const [sql] of query.mock.calls){expect(sql).toContain("a.owner_id = $1 AND a.status IN ('ACTIVE','EXPIRING_SOON')");expect(sql).not.toContain('ANY(')}
    expect(query.mock.calls[0][1]).toEqual(['me','MOCK']);expect(query.mock.calls[1][1]).toEqual(['me','MOCK',20,20]);
  });
  it.each([['ADMIN','USER'],['APPROVER','USER']] as AuthUser['roles'][])('uses the authenticated creator and personal ordering for roles %j',async roles=>{
    const {query,servicePool}=pool();const service=new RequestsService(servicePool,{} as NotificationsService);
    await service.list({...user,roles},{createdByMe:'true',status:'PENDING',page:'2',pageSize:'10',creatorId:'other'});
    for(const [sql] of query.mock.calls)expect(sql).toContain('r.creator_id = $1 AND r.status = $2');
    expect(query.mock.calls[0][1]).toEqual(['me','PENDING']);expect(query.mock.calls[1][1]).toEqual(['me','PENDING',10,10]);
    expect(query.mock.calls[1][0]).toContain('ORDER BY r.submitted_at DESC, r.id DESC');
  });
  it('preserves granted scope when personal projection is absent or false; URL role cannot grant access',async()=>{
    const {query,servicePool}=pool();const assets=new AssetsService(servicePool);const requests=new RequestsService(servicePool,{} as NotificationsService);
    await assets.list({...user,roles:['ADMIN','USER']},{page:'1',ownedOnly:'false'});expect(query.mock.calls[0][1]).toEqual([]);
    query.mockClear();await assets.list({...user,roles:['APPROVER','USER']},{page:'1',role:'ADMIN'});expect(query.mock.calls[0][1]).toEqual([['scope']]);expect(query.mock.calls[0][0]).toContain('a.department_id = ANY($1::uuid[])');
    query.mockClear();await requests.list({...user,roles:['APPROVER','USER']},{page:'1',createdByMe:'false'});expect(query.mock.calls[0][1]).toEqual([['scope']]);expect(query.mock.calls[0][0]).toContain('r.department_id = ANY($1::uuid[])');
  });
  it('rejects malformed personal filters before database access',async()=>{
    const {query,servicePool}=pool();const assets=new AssetsService(servicePool);const requests=new RequestsService(servicePool,{} as NotificationsService);
    for(const value of ['yes','', ['true'] as unknown as string]){await expect(assets.list(user,{ownedOnly:value})).rejects.toMatchObject({status:400});await expect(requests.list(user,{createdByMe:value})).rejects.toMatchObject({status:400})}
    expect(query).not.toHaveBeenCalled();
  });
  it.each([
    {roles:['USER'],owner:'me',department:'outside',allowed:true},
    {roles:['USER'],owner:'other',department:'scope',allowed:false},
    {roles:['APPROVER','USER'],owner:'me',department:'outside',allowed:true},
    {roles:['APPROVER','USER'],owner:'other',department:'scope',allowed:true},
    {roles:['APPROVER','USER'],owner:'other',department:'outside',allowed:false},
  ])('checks asset object scope before exposing history: %j',async({roles,owner,department,allowed})=>{
    const query=vi.fn(async(sql:string)=>({rows:sql.includes('WHERE a.id = $1')?[{id:'asset',owner_id:owner,department_id:department}]:[]}));
    const service=new AssetsService({query} as unknown as Pool);const actor={...user,roles:roles as AuthUser['roles']};
    if(allowed){expect(await service.detail(actor,'asset')).toMatchObject({id:'asset',ownerId:owner})}
    else{await expect(service.history(actor,'asset',{page:'1'})).rejects.toMatchObject({status:403});expect(query).toHaveBeenCalledTimes(1)}
  });
  it('conceals an out-of-scope request and never reads its decision metadata',async()=>{
    const query=vi.fn(async()=>({rows:[{id:'outside',creator_id:'other',department_id:'outside',reason:'Private reason'}]}));
    const service=new RequestsService({query} as unknown as Pool,{} as NotificationsService);
    try{await service.detail({...user,roles:['APPROVER','USER']},'outside');throw new Error('Expected denial')}
    catch(error){expect(error).toMatchObject({status:404});expect(JSON.stringify(error)).not.toContain('Private reason')}
    expect(query).toHaveBeenCalledTimes(1);
  });
});
