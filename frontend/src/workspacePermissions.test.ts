import { describe,expect,it } from 'vitest';
import { canOpenView } from './routes';
import { canChangeAsset,canCreateRequests,canDecideRequest } from './workspacePermissions';
import type { Asset,AuthUser,RequestItem } from './types';
const user:AuthUser={id:'me',email:'me@example.test',displayName:'Me',departmentId:'own-dept',roles:['USER','APPROVER'],approverDepartmentIds:['scope'],mustChangePassword:false};
const asset={ownerId:'me',status:'ACTIVE'} as Asset;
const request={creatorId:'other',departmentId:'scope',status:'PENDING',version:7} as RequestItem;
describe('server-authorized workspace actions',()=>{
  it('never restores creation or approval through a display-role switch for an Admin',()=>{
    const admin={...user,roles:['ADMIN','USER','APPROVER'] as AuthUser['roles']};
    expect(canCreateRequests(admin)).toBe(false);expect(canChangeAsset(admin,asset)).toBe(false);expect(canDecideRequest(admin,request)).toBe(false);
    expect(canOpenView('USER','request-new',admin.roles)).toBe(false);expect(canOpenView('APPROVER','approvals',admin.roles)).toBe(false);
    expect(canOpenView('USER','assets',admin.roles)).toBe(true);
  });
  it('only permits owner renewal/revocation for a live asset with confirmed ownership',()=>{
    expect(canChangeAsset(user,asset)).toBe(true);
    for(const value of [{...asset,ownerId:'other'},{...asset,ownerId:undefined},{...asset,status:'REVOKED' as const},{...asset,status:'SUPERSEDED' as const}])expect(canChangeAsset(user,value)).toBe(false);
  });
  it('requires a different creator, a granted department and pending state for a decision',()=>{
    expect(canDecideRequest(user,request)).toBe(true);
    for(const value of [{...request,creatorId:'me'},{...request,creatorId:undefined},{...request,departmentId:'outside'},{...request,departmentId:undefined},{...request,status:'COMPLETED' as const}])expect(canDecideRequest(user,value)).toBe(false);
    expect(canDecideRequest({...user,roles:['USER']},request)).toBe(false);
    expect(canDecideRequest(user,{...request,version:undefined})).toBe(false);
    expect(canDecideRequest(user,{...request,version:0})).toBe(false);
  });
  it('cannot display an ungranted role even for a shared route',()=>{
    expect(canOpenView('ADMIN','dashboard',['USER'])).toBe(false);
  });
});
