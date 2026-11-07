import 'reflect-metadata';
import { describe,it,expect,vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import { PoliciesController } from '../src/policies/policies.controller';
const admin: AuthUser = { id: 'admin', displayName: 'Admin', email: 'admin@example.test', departmentId: 'dept', roles: ['ADMIN'], approverDepartmentIds: [], tokenVersion: 1, mustChangePassword: false };
const dto={expectedVersion:2,algorithm:'RSA',minimumKeySize:2048,maximumValidityDays:365,warningDays:[30,7,1]};
function setup(version=2){const query=vi.fn(async(sql:string)=>{if(sql.startsWith('SELECT id'))return{rowCount:1,rows:[{id:'policy',is_active:true}]};if(sql.startsWith('SELECT version'))return{rows:[{version}]};if(sql.startsWith('INSERT INTO policy_versions'))return{rows:[{id:'new-version',version:3}]};return{rows:[]}});const release=vi.fn();const controller=new PoliciesController({connect:vi.fn(async()=>({query,release}))} as unknown as Pool);return{controller,query,release}}
describe('policy version creation',()=>{
  it('rejects non-admin writers',async()=>{const{controller,query}=setup();await expect(controller.version({...admin, roles:['USER']},'policy',dto)).rejects.toMatchObject({response:{code:'ADMIN_REQUIRED'}});expect(query).not.toHaveBeenCalled()});
  it('rejects weak RSA configuration',async()=>{const{controller}=setup();await expect(controller.version(admin,'policy',{...dto,minimumKeySize:1024})).rejects.toMatchObject({response:{code:'POLICY_CONFIGURATION_INVALID'}})});
  it('rolls back a stale version without creating another',async()=>{const{controller,query,release}=setup(3);await expect(controller.version(admin,'policy',dto)).rejects.toMatchObject({response:{code:'VERSION_CONFLICT'}});expect(query).toHaveBeenCalledWith('ROLLBACK');expect(release).toHaveBeenCalled();expect(query.mock.calls.some(([sql])=>sql.startsWith('INSERT'))).toBe(false)});
  it('appends and audits a new version in one transaction',async()=>{const{controller,query}=setup();await expect(controller.version(admin,'policy',dto)).resolves.toMatchObject({version:3,policyId:'policy'});expect(query.mock.calls.some(([sql])=>sql.includes('INSERT INTO audit_logs'))).toBe(true);expect(query).toHaveBeenLastCalledWith('COMMIT')});
});
