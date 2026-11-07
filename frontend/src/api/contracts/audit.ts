export interface AuditResponse {
  id:string; action:string; entityId:string|null; occurredAt:string; actorName:string; outcome:string;
}
