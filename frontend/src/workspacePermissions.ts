import type { Asset,AuthUser,RequestItem } from './types';

// Mirrors existing server SoD/ownership checks for presentation; API remains authoritative.
export function canCreateRequests(user:Pick<AuthUser,'roles'>) {
  return !user.roles.includes('ADMIN');
}
export function canChangeAsset(user:Pick<AuthUser,'id'|'roles'>,asset:Asset) {
  return canCreateRequests(user)&&asset.ownerId===user.id&&['ACTIVE','EXPIRING_SOON'].includes(asset.status);
}
export function canDecideRequest(user:Pick<AuthUser,'id'|'roles'|'approverDepartmentIds'>,request:RequestItem) {
  return user.roles.includes('APPROVER')&&!user.roles.includes('ADMIN')
    &&!!request.creatorId&&request.creatorId!==user.id&&!!request.departmentId
    &&user.approverDepartmentIds.includes(request.departmentId)&&request.status==='PENDING'
    &&Number.isSafeInteger(request.version)&&Number(request.version)>0;
}
