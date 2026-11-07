import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import { DepartmentsService } from '../src/departments/departments.service';
import { UsersService } from '../src/users/users.service';
const admin:AuthUser={id:'admin',email:'admin@example.test',displayName:'Admin',departmentId:'dep',tokenVersion:1,roles:['ADMIN'],approverDepartmentIds:[],mustChangePassword:false};
const current={id:'dep',code:'IT',name:'Technology',is_active:true,version:2};
function setup(options:{row?:typeof current;usage?:Record<string,number>;auditFails?:boolean}={}){
  const query=vi.fn(async(sql:string)=>{
    if(sql.includes('SELECT * FROM departments'))return{rows:[options.row??current],rowCount:1};
    if(sql.includes('AS "approverScopes"'))return{rows:[{users:0,approverScopes:0,openRequests:0,activeAssets:0,...options.usage}],rowCount:1};
    if(sql.includes('INSERT INTO audit_logs')&&options.auditFails)throw new Error('synthetic audit fault');
    return{rows:[{...current,version:3}],rowCount:1};
  });
  const release=vi.fn(),lockAdministration=vi.fn(async()=>{});
  return{service:new DepartmentsService({query,connect:async()=>({query,release})} as unknown as Pool,{lockAdministration} as unknown as UsersService),query,release,lockAdministration};
}
describe('department administration',()=>{
  it('denies a non-Admin before accessing the database',async()=>{
    const {service,query}=setup(),user={...admin,roles:['USER'] as AuthUser['roles']};
    await expect(service.list(user)).rejects.toMatchObject({status:403});await expect(service.save(user,'dep',{code:'IT',name:'Technology'})).rejects.toMatchObject({status:403});
    await expect(service.status(user,'dep',{active:false,version:2})).rejects.toMatchObject({status:403});expect(query).not.toHaveBeenCalled();
  });
  it('rejects outdated edits before overwriting data',async()=>{
    const {service,query,lockAdministration}=setup();
    await expect(service.save(admin,'dep',{code:'IT',name:'Changed',version:1})).rejects.toMatchObject({response:{code:'VERSION_CONFLICT'}});
    expect(lockAdministration).toHaveBeenCalledOnce();expect(query.mock.calls.some(([sql])=>/^(INSERT|UPDATE)\b/.test(sql))).toBe(false);expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it.each(['users','approverScopes','openRequests','activeAssets'])('blocks deactivation when %s remains',async field=>{
    const {service,query}=setup({usage:{[field]:1}});await expect(service.status(admin,'dep',{active:false,version:2})).rejects.toMatchObject({response:{code:'DEPARTMENT_IN_USE',details:{[field]:1}}});
    expect(query.mock.calls.some(([sql])=>sql.startsWith('UPDATE departments'))).toBe(false);expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('acknowledges a retried first save without another audit',async()=>{
    const {service,query}=setup({row:{...current,version:1}});expect(await service.save(admin,'dep',{code:'IT',name:'Technology'})).toMatchObject({version:1});
    expect(query.mock.calls.some(([sql])=>sql.includes('INSERT INTO audit_logs'))).toBe(false);expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it('rejects a whitespace-only name before starting a transaction',async()=>{
    const {service,query}=setup();await expect(service.save(admin,'dep',{code:'IT',name:'  '})).rejects.toMatchObject({status:400});expect(query).not.toHaveBeenCalled();
  });
  it('rolls back a status change when audit fails',async()=>{
    const {service,query,release}=setup({auditFails:true});await expect(service.status(admin,'dep',{active:false,version:2})).rejects.toThrow('synthetic audit fault');
    expect(query.mock.calls.some(([sql])=>sql.startsWith('UPDATE departments'))).toBe(true);expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');expect(release).toHaveBeenCalledOnce();
  });
});
