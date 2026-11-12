import { AsyncLocalStorage } from 'node:async_hooks';
import { redactAuditMetadata } from './audit-redaction';

export const auditContext = new AsyncLocalStorage<{ correlationId: string }>();

export function auditMetadata(value: unknown = {}): Record<string, unknown> {
  const redacted = redactAuditMetadata(value);
  const metadata = redacted && typeof redacted === 'object' && !Array.isArray(redacted) ? redacted : {};
  const correlationId = auditContext.getStore()?.correlationId;
  return { ...metadata, ...(correlationId && { correlationId }) };
}
