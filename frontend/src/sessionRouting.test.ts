import { describe, expect, it } from 'vitest';
import { safeSessionReturn,sessionDestination,sessionPermissions } from './sessionRouting';

describe('session route boundaries',()=>{
  it('keeps valid deep-link query and picks only a role granted by the server',()=>{
    expect(sessionDestination(['APPROVER','USER'],'/requests/new?type=RENEW&assetId=asset-300')).toEqual({role:'USER',path:'/requests/new?type=RENEW&assetId=asset-300'});
    expect(sessionDestination(['ADMIN','USER'],'/requests/new')).toEqual({role:'ADMIN',path:'/dashboard'});
    expect(sessionDestination(['ADMIN','APPROVER'],'/approvals?page=2')).toEqual({role:'ADMIN',path:'/dashboard'});
    expect(sessionDestination(['USER','ADMIN'],'/users?q=TLS&page=3')).toEqual({role:'ADMIN',path:'/users?q=TLS&page=3'});
    expect(sessionDestination(['USER'],'/users')).toEqual({role:'USER',path:'/dashboard'});
  });
  it.each(['https://example.test','//example.test','/\\example.test','/assets/%2fusers','/assets/%5cusers','/assets/..','/assets/%2e%2e','/assets/%252e%252e','/assets/%E0%A4','/login','/forbidden','/unknown','/dashboard#private',null,42])('rejects unsafe return path %s',value=>{
    expect(safeSessionReturn(value)).toBeNull();
  });
  it('ignores role/scope ordering, but notices account/department/password-gate changes',()=>{
    const user={id:'owner',roles:['ADMIN','USER'] as const,departmentId:'IT',approverDepartmentIds:['IT','HR'],mustChangePassword:false};
    const input={...user,roles:[...user.roles]};
    expect(sessionPermissions(input)).toBe(sessionPermissions({...input,roles:['USER','ADMIN'],approverDepartmentIds:['HR','IT']}));
    for(const next of [{...input,id:'other'},{...input,departmentId:'HR'},{...input,mustChangePassword:true},{...input,roles:['USER'] as const}])expect(sessionPermissions({...next,roles:[...next.roles]})).not.toBe(sessionPermissions(input));
  });
});
