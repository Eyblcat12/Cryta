import type { RequestStatus } from '../../types';

export type RecoveryAction = 'RETRY' | 'CONFIRM' | 'ABANDON';
export type RecoveryFailure = 'UNSENT_TRANSIENT' | 'UNSENT_PERMANENT' | 'OUTCOME_UNKNOWN' | 'RESULT_RECORDED';
export type RecoveryStatus = RequestStatus | 'RETRY_SCHEDULED';

export interface ProviderIssue {
  id: string;
  type: 'CREATE' | 'RENEW' | 'REVOKE';
  status: RecoveryStatus;
  version: number;
  targetAssetId: string | null;
  attemptCount: number;
  retryCount: number;
  retryAfter: string | null;
  sentAt: string | null;
  receiptAt: string | null;
  updatedAt: string;
  failureClass: RecoveryFailure | null;
  errorCode: string | null;
  hasReceipt: boolean;
  availableActions: RecoveryAction[];
}

export interface ProviderIssueDetail extends ProviderIssue {
  history: Array<{
    id: number;
    action: string;
    actorType: 'USER' | 'SYSTEM';
    occurredAt: string;
    retryCount: number | null;
    delaySeconds: number | null;
    reason: string | null;
  }>;
}

export const recoveryAcknowledgment = { RETRY: 'APPROVED', CONFIRM: 'COMPLETED', ABANDON: 'FAILED' } as const;
