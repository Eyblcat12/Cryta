import type { UserRole } from '../../types';
export interface UserResponse {
  id:string; email:string; displayName:string; status:'ACTIVE'|'INACTIVE'|'LOCKED';
  departmentId:string; departmentName:string; roles:UserRole[]; approverDepartmentIds:string[];
  lastLoginAt:string|null; createdAt:string; version?:number; invitationPending?:boolean;
}
export interface UserReferenceResponse {
  departments:Array<{id:string;code:string;name:string}>;
  roles:Array<{code:UserRole;name:string}>;
}
