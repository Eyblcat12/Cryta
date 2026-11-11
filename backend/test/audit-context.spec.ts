import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import type { Pool } from 'pg';
import type { JwtService } from '@nestjs/jwt';
import { auditContext, auditMetadata } from '../src/audit/audit-context';
import { requestContext, type RequestWithId } from '../src/common/request-context.middleware';
import type { OperationsMetricsService } from '../src/operations/operations-metrics.service';
import { AuthService } from '../src/auth/auth.service';

describe('audit correlation isolation', () => {
  it('keeps concurrent middleware chains isolated and ignores caller supplied IDs', async () => {
    const middleware = requestContext({ observeHttp: vi.fn() } as unknown as OperationsMetricsService);
    const run = () => new Promise<string>((resolve, reject) => {
      const request = { headers: { 'x-request-id': 'caller-controlled' } } as unknown as RequestWithId;
      const response = { setHeader: vi.fn(), once: vi.fn() } as unknown as Response;
      middleware(request, response, () => {
        setImmediate(() => { try {
          expect(auditMetadata().correlationId).toBe(request.requestId);
          expect(request.requestId).toMatch(/^req_[0-9a-f-]{36}$/);
          expect(response.setHeader).toHaveBeenCalledWith('x-request-id', request.requestId);
          resolve(request.requestId);
        } catch (error) { reject(error); } });
      });
    });
    const ids = await Promise.all(Array.from({ length: 20 }, run));
    expect(new Set(ids).size).toBe(20);
    expect(auditMetadata()).toEqual({});
  });
  it('redacts nested sensitive keys while the trusted context overrides any metadata ID', () => {
    const metadata = auditContext.run({ correlationId: 'trusted' }, () => auditMetadata({
      correlationId: 'untrusted', nested: [{ password: 'fixture-secret', private_key: 'fixture-key', publicCode: 'kept' }],
    }));
    expect(metadata).toEqual({ correlationId: 'trusted', nested: [{ password: '[REDACTED]', private_key: '[REDACTED]', publicCode: 'kept' }] });
  });
  it('stores the HTTP correlation in transactional logout audit without the refresh secret', async () => {
    const query = vi.fn(async () => { await Promise.resolve(); return { rows: [], rowCount: 0 }; });
    const service = new AuthService({ connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool, {} as JwtService);
    await auditContext.run({ correlationId: 'req_test_transaction' }, () => service.logout('invalid-cookie-secret', '11111111-1111-4111-8111-111111111111'));
    const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO audit_logs'));
    expect(JSON.parse(insert?.[1][3])).toEqual({ correlationId: 'req_test_transaction' });
    expect(JSON.stringify(query.mock.calls)).not.toContain('invalid-cookie-secret');
    expect(auditMetadata()).toEqual({});
  });
});
