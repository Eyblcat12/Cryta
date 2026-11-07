export type AssetStatus = 'REGISTERED' | 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'REVOKED' | 'SUPERSEDED';
export type RequestStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'RECONCILIATION_REQUIRED';

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
  ownerId?: string;
  departmentId?: string;
  departmentName?: string;
  policyCode?: string;
  policyVersionId?: string;
  policyVersion?: number;
  version?: number;
}

export type RequestDecision = {
  decision: 'APPROVED' | 'REJECTED'; comment: string | null; approverId: string;
  approverName?: string | null; decidedAt: string;
};

export interface RequestItem {
  id: string;
  type: 'CREATE' | 'RENEW' | 'REVOKE';
  subject: string;
  status: RequestStatus;
  submittedAt: string;
  submitted?: boolean;
  cancellationReason?: string | null;
  approver?: string;
  decision?: RequestDecision | null;
  approval?: { levels: 2; approved: number; deadlineAt: string | null; firstApproverId: string | null };
  approvalHistory?: Array<RequestDecision & { level: 1 | 2 }>;
  emergency?: boolean;
  creatorName?: string;
  creatorId?: string;
  departmentId?: string;
  departmentName?: string;
  targetAssetCode?: string;
  version?: number;
}

export type UserRole = 'USER' | 'APPROVER' | 'ADMIN';
export interface AuthUser { id:string; email:string; displayName:string; departmentId:string; departmentName?:string; roles:UserRole[]; approverDepartmentIds:string[]; mustChangePassword:boolean; accountActionsEnabled?:boolean; mfaEnrolled?:boolean }
