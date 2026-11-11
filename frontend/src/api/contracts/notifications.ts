export interface NotificationResponse {
  id:string; type:string; createdAt:string; readAt:string|null;
  assetId?:string|null; requestId?:string|null; assetCode?:string|null; description?:string|null;
}
export interface EmailIssueResponse {
  id:string; type:string; status:string; attemptCount:number; createdAt:string;
  claimedAt:string|null; failedAt:string|null; recipientEmail:string; recipientName:string;
}

export interface EmailQueueStatusResponse {
  queue: Partial<Record<'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'RECONCILIATION_REQUIRED', number>>;
  collectedAt: string;
  oldestDueSeconds: number | null;
  lastFailedAt: string | null;
  smtpEnabled: boolean;
  queueDelayed: boolean;
  worker: {
    state: 'DISABLED' | 'AWAITING' | 'STALE' | 'FAILED' | 'RECENT';
    lastPollAt: string | null;
    lastPollSucceeded: boolean | null;
  };
}

export interface EmailDeliveryDetail extends EmailIssueResponse {
  sentAt: string | null;
  smtpStatus: number | null;
  failure: 'OUTCOME_UNKNOWN' | 'SMTP_PERMANENT_REJECTION' | 'SMTP_TEMPORARY_REJECTION' | 'PREPARATION_FAILED' | 'VERIFIED_UNSENT' | null;
  messageIdPrefix: string;
  retry?: { evidenceReference: string; maxAttempts: number; delaySeconds: number } | null;
}

export type EmailRetry = { attemptCount: number; evidenceReference: string };

export type EmailReconciliation = {
  attemptCount: number;
  evidenceReference: string;
} & ({ outcome: 'UNSENT' } | { outcome: 'ACCEPTED'; acceptedAt: string });
