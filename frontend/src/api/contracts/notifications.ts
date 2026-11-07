export interface NotificationResponse {
  id:string; type:string; createdAt:string; readAt:string|null;
  assetId?:string|null; requestId?:string|null; assetCode?:string|null; description?:string|null;
}
export interface EmailIssueResponse {
  id:string; type:string; status:string; attemptCount:number; createdAt:string;
  claimedAt:string|null; failedAt:string|null; recipientEmail:string; recipientName:string;
}
