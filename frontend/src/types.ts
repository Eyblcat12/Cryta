export type AssetStatus = 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'REVOKED' | 'SUPERSEDED';
export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface Asset {
  id: string;
  code: string;
  name: string;
  type: 'KEY' | 'CERTIFICATE';
  status: AssetStatus;
  algorithm: string;
  purpose: string;
  validFrom?: string;
  expiresAt: string;
  daysLeft: number;
  provider: string;
  fingerprint: string;
  ownerName?: string;
  departmentName?: string;
  policyCode?: string;
  policyVersionId?: string;
  version?: number;
}

export interface RequestItem {
  id: string;
  type: 'CREATE' | 'RENEW' | 'REVOKE';
  subject: string;
  status: RequestStatus;
  submittedAt: string;
  approver?: string;
  emergency?: boolean;
  creatorName?: string;
  departmentName?: string;
  targetAssetCode?: string;
  version?: number;
}

export type UserRole = 'USER' | 'APPROVER' | 'ADMIN';
export interface AuthUser { id:string; email:string; displayName:string; departmentId:string; roles:UserRole[]; approverDepartmentIds:string[]; mustChangePassword:boolean }
