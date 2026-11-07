import { describe,expect,it,vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import { DashboardService } from '../src/dashboard/dashboard.service';

const user:AuthUser={id:'owner',email:'owner@example.test',displayName:'Owner',departmentId:'dept-a',tokenVersion:1,roles:['USER'],approverDepartmentIds:[],mustChangePassword:false};
const aggregate={total:317,active:299,expiring:8,ended:10,live:307,within30:8,within180:100,after180:199};

describe('page dashboard and shell summary contracts',()=>{
  it('returns whole-owner aggregates and one scoped priority ID beyond a legacy first page',async()=>{
    const query=vi.fn(async(sql:string,_values?:unknown[])=>{
      if(sql.includes('ORDER BY expires_at'))return {rows:[{id:'asset-300',code:'ASSET-0300',expiresAt:'2026-10-05T00:00:00Z'}]};
      if(sql.includes('creator_id=$1')&&!sql.includes('generate_series'))return {rows:[{pending:7,processing:2,failed:0}]};
      if(sql.includes('COUNT(*)::int total'))return {rows:[aggregate]};
      return {rows:[]};
    });const service=new DashboardService({query} as unknown as Pool);
    const result=await service.get({...user,roles:['ADMIN','USER']},'USER');
    expect(result.role).toBe('USER');expect(result.metrics.total).toBe(317);
    expect(result).toMatchObject({lifecycle:{live:307,within30:8,within180:100,after180:199,priority:{id:'asset-300'}}});
    for(const [sql,values] of query.mock.calls){expect(values).toEqual(['owner']);expect(sql).not.toContain('LIMIT 250');expect(sql).not.toContain('FROM users')}
    const aggregateSql=query.mock.calls.find(([sql])=>sql.includes('COUNT(*)::int total'))![0];
    expect(aggregateSql).toContain('WHERE owner_id=$1');expect(aggregateSql).toContain("status IN('ACTIVE','EXPIRING_SOON') AND expires_at<=NOW()+INTERVAL '30 days'");
    expect(aggregateSql).toContain("expires_at>NOW()+INTERVAL '30 days' AND expires_at<=NOW()+INTERVAL '180 days'");
    expect(aggregateSql).toContain("expires_at>NOW()+INTERVAL '180 days'");
    const prioritySql=query.mock.calls.find(([sql])=>sql.includes('ORDER BY expires_at'))![0];expect(prioritySql).toContain("owner_id=$1 AND status='EXPIRING_SOON'");expect(prioritySql).not.toContain('private_key');
  });
  it('shell summary omits trend/composition/priority and uses the granted owner scope',async()=>{
    const query=vi.fn(async(sql:string,_values?:unknown[])=>({rows:[sql.includes('FROM crypto_assets')?aggregate:{pending:7}]}));
    const service=new DashboardService({query} as unknown as Pool);
    const result=await service.summary({...user,roles:['ADMIN','USER']},'USER');
    expect(result).toMatchObject({role:'USER',metrics:{total:317,pending:7}});expect(result).not.toHaveProperty('trend');expect(result).not.toHaveProperty('composition');expect(result).not.toHaveProperty('lifecycle');
    expect(query).toHaveBeenCalledTimes(2);for(const [sql,values] of query.mock.calls){expect(sql).not.toContain('generate_series');expect(values).toEqual(['owner'])}
  });
  it('approver counters use server department scope and decisions belonging to that approver',async()=>{
    const query=vi.fn(async(sql:string,_values?:unknown[])=>({rows:[sql.includes('FROM requests')?{pending:9,emergency:2,avg_wait_hours:'1.5'}:{approved:4,rejected:1}]}));
    const service=new DashboardService({query} as unknown as Pool);
    const result=await service.summary({...user,roles:['USER','APPROVER'],approverDepartmentIds:['dept-a','dept-b']},'APPROVER');
    expect(result).toMatchObject({role:'APPROVER',metrics:{pending:9,approved:4}});
    expect(query.mock.calls[0][0]).toContain('department_id=ANY($1::uuid[])');expect(query.mock.calls[0][1]).toEqual([['dept-a','dept-b']]);expect(query.mock.calls[1][1]).toEqual(['owner']);
  });
  it('rejects invalid or ungranted roles before querying the database',async()=>{
    const query=vi.fn();const service=new DashboardService({query} as unknown as Pool);
    for(const role of ['ADMIN','APPROVER']){await expect(service.summary(user,role)).rejects.toMatchObject({status:403});await expect(service.get(user,role)).rejects.toMatchObject({status:403})}
    for(const role of ['admin','', ['USER'],{role:'USER'}]){await expect(service.summary(user,role)).rejects.toMatchObject({status:400});await expect(service.get(user,role)).rejects.toMatchObject({status:400})}
    expect(query).not.toHaveBeenCalled();
  });
  it('retains the historical default role and only reads counters for an Admin summary',async()=>{
    const query=vi.fn(async(_sql:string)=>({rows:[{total_assets:1000,active_users:35}]}));
    const service=new DashboardService({query} as unknown as Pool);
    const result=await service.summary({...user,roles:['USER','APPROVER','ADMIN']});
    expect(result.role).toBe('ADMIN');expect(result.metrics.total_assets).toBe(1000);expect(query).toHaveBeenCalledTimes(1);expect(result).toHaveProperty('services');expect(result).not.toHaveProperty('trend');
    expect(query.mock.calls[0][0]).toContain("channel='EMAIL' AND delivery_status='FAILED'");
    expect(query.mock.calls[0][0]).toContain("channel='EMAIL' AND delivery_status='RECONCILIATION_REQUIRED'");
  });
});
