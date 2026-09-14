export type RoleCode = 'USER' | 'APPROVER' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  departmentId: string;
  tokenVersion: number;
  roles: RoleCode[];
  approverDepartmentIds: string[];
  mustChangePassword: boolean;
}
