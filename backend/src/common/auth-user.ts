export type RoleCode = 'USER' | 'APPROVER' | 'ADMIN';

export interface AuthUser {
  accountActionsEnabled?: boolean;
  mfaRequired?: boolean;
  mfaEnrolled?: boolean;
  id: string;
  email: string;
  displayName: string;
  departmentId: string;
  departmentName?: string;
  tokenVersion: number;
  roles: RoleCode[];
  approverDepartmentIds: string[];
  mustChangePassword: boolean;
}
