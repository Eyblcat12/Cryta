import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { HttpFailureAuditService } from '../src/audit/http-failure-audit.service';
import type { RequestWithId } from '../src/common/request-context.middleware';

const correlationId = 'req_11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const secret = 'synthetic-private-secret';
function request(overrides: Record<string, unknown> = {}) {
  return { requestId: correlationId, method: 'POST', route: { path: '/api/v1/requests/:id/decision' },
    originalUrl: `/api/v1/requests/${secret}/decision?token=${secret}`, body: { password: secret },
    headers: { authorization: `Bearer ${secret}` }, user: { id: actorId }, ...overrides } as unknown as RequestWithId;
}
function setup() {
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }), end = vi.fn();
  return { query, end, service: new HttpFailureAuditService({ query, end } as unknown as Pool) };
}
afterEach(() => vi.restoreAllMocks());

describe('durable HTTP rejection audit', () => {
  it('records a verified actor and safe route template without body, headers, raw URL or object ID', async () => {
    const { service, query } = setup();
    await service.record(request(), 409);
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][1]).toEqual([actorId, 'USER', 'HTTP_REQUEST_DENIED',
      '/api/v1/requests/:id/decision', 'DENIED', JSON.stringify({ correlationId, method: 'POST', route: '/api/v1/requests/:id/decision', httpStatus: 409 })]);
    expect(JSON.stringify(query.mock.calls)).not.toContain(secret);
  });
  it('does not infer the login actor from submitted credentials or caller headers', async () => {
    const { service, query } = setup();
    await service.record(request({ user: undefined, route: { path: '/api/v1/auth/login' }, body: { userId: actorId, email: secret, password: secret } }), 401);
    expect(query.mock.calls[0][1].slice(0, 3)).toEqual([null, 'SYSTEM', 'HTTP_REQUEST_DENIED']);
    expect(JSON.stringify(query.mock.calls)).not.toContain(actorId);
    expect(JSON.stringify(query.mock.calls)).not.toContain(secret);
  });
  it('records server failures independently of a domain transaction', async () => {
    const { service, query } = setup();
    await service.record(request(), 500);
    expect(query.mock.calls[0][1][2]).toBe('HTTP_REQUEST_FAILED');
    expect(query.mock.calls[0][1][4]).toBe('FAILED');
  });
  it('logs only safe correlation fields if durable storage is unavailable', async () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { service, query } = setup(); query.mockRejectedValue(new Error(`postgres://${secret}`));
    await expect(service.record(request(), 503)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith({ event: 'audit.http_failure_not_persisted', correlationId,
      method: 'POST', route: '/api/v1/requests/:id/decision', httpStatus: 503 });
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });
  it.each([
    [{ route: { path: `/api/v1/${secret}` } }, 500], [{ route: undefined }, 404],
    [{ route: { path: '/api/v1/health/ready' }, method: 'GET' }, 503],
    [{ requestId: secret }, 500], [{ method: 'OPTIONS' }, 403], [{}, 200], [{}, 600],
  ])('ignores unknown/probe routes, unsupported methods, invalid IDs and non-failures', async (overrides, status) => {
    const { service, query } = setup(); await service.record(request(overrides), status); expect(query).not.toHaveBeenCalled();
  });
  it('covers denied audit reads and closes its own pool on shutdown', async () => {
    const { service, query, end } = setup();
    await service.record(request({ method: 'GET', route: { path: '/api/v1/audit-logs' } }), 403);
    expect(query).toHaveBeenCalledOnce(); await service.onApplicationShutdown(); expect(end).toHaveBeenCalledOnce();
  });
});
