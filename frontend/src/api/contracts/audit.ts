export interface AuditResponse {
  id:string; action:string; entityId:string|null; occurredAt:string; actorName:string; outcome:string;
}

export type AuditFilters = Partial<Record<'search' | 'outcome' | 'actor' | 'action' | 'entity' | 'correlationId' | 'from' | 'to', string>>;

export interface AuditDetail extends AuditResponse {
  entityType: string;
  requestId: string | null;
  correlationId?: string;
  changes: Array<{ field: string; before?: string; after: string }>;
  related: { kind: 'USER' | 'ASSET'; id: string } | null;
}
