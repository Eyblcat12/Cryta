import 'reflect-metadata';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import { EmailTestService } from '../src/notifications/email-test.service';
import { EmailWorkerService } from '../src/notifications/email-worker.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { auditContext } from '../src/audit/audit-context';

const admin = { id: '11111111-1111-4111-8111-111111111111', tokenVersion: 1, roles: ['ADMIN'] } as unknown as AuthUser;
const recipient = 'private-recipient@example.test';
const correlationId = 'req_22222222-2222-4222-8222-222222222222';
type Options = { actor?: Record<string, unknown> | null; counts?: { actor_count: number; global_count: number }; transactionFault?: 'audit' | 'lock'; resultFault?: boolean };
function setup(options: Options = {}) {
  const release = vi.fn();
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('pg_advisory_xact_lock') && options.transactionFault === 'lock') throw Object.assign(new Error('lock timeout'), { code: '55P03' });
    if (sql.includes('FROM users u')) return { rows: options.actor === null ? [] : [{ status: 'ACTIVE', token_version: 1, is_active: true, is_admin: true, ...options.actor }] };
    if (sql.includes('global_count')) return { rows: [options.counts ?? { actor_count: 0, global_count: 0 }] };
    if (sql.includes('INSERT INTO audit_logs') && options.transactionFault === 'audit') throw new Error('intent audit unavailable');
    return { rows: [], rowCount: 1 };
  });
  const resultQuery = vi.fn(async () => { if (options.resultFault) throw new Error('result audit unavailable'); return { rows: [], rowCount: 1 }; });
  const sendTest = vi.fn(async () => {
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT'); expect(release).toHaveBeenCalledOnce();
    return { accepted: true };
  });
  const assertTestReady = vi.fn();
  const service = new EmailTestService({ connect: async () => ({ query, release }), query: resultQuery } as unknown as Pool,
    { assertTestReady, sendTest } as unknown as EmailWorkerService);
  return { service, query, resultQuery, release, sendTest, assertTestReady };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('audited rate-limited test email', () => {
  it('commits the shared reservation before SMTP and audits acceptance with correlation and a domain only', async () => {
    const { service, query, resultQuery, sendTest } = setup();
    const result = await auditContext.run({ correlationId }, () => service.send(admin, recipient));
    expect(result).toMatchObject({ sent: true, to: recipient, operationId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(sendTest).toHaveBeenCalledWith(recipient, result.operationId);
    const intent = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO audit_logs'));
    expect(JSON.parse(intent?.[1][2])).toEqual({ operationId: result.operationId, recipientDomain: 'example.test', correlationId });
    expect(resultQuery.mock.calls[0][1].slice(0, 4)).toEqual([admin.id, 'EMAIL_TEST_ACCEPTED', result.operationId, 'SUCCESS']);
    expect(JSON.stringify([intent, resultQuery.mock.calls])).not.toContain(recipient);
  });
  it.each([{ actor_count: 1, global_count: 1 }, { actor_count: 0, global_count: 5 }])('shares actor/global rate limits and sends nothing when the budget is exhausted', async counts => {
    const { service, query, sendTest, resultQuery } = setup({ counts });
    await expect(service.send(admin, recipient)).rejects.toMatchObject({ status: 429, response: { code: 'EMAIL_TEST_RATE_LIMITED' } });
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO audit_logs'))).toBe(false);
    expect(sendTest).not.toHaveBeenCalled(); expect(resultQuery).not.toHaveBeenCalled();
  });
  it.each([null, { status: 'INACTIVE' }, { token_version: 2 }, { is_admin: false }, { is_active: false }])('rechecks the current actor after waiting for the shared lock', async actor => {
    const { service, query, sendTest } = setup({ actor });
    await expect(service.send(admin, recipient)).rejects.toMatchObject({ status: 401, response: { code: 'SESSION_REVOKED' } });
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK'); expect(sendTest).not.toHaveBeenCalled();
  });
  it('rejects a non-Admin or invalid address before any database or SMTP call', async () => {
    const { service, query, sendTest, assertTestReady } = setup();
    await expect(service.send({ ...admin, roles: ['USER'] }, recipient)).rejects.toMatchObject({ status: 403 });
    await expect(service.send(admin, 'victim@example.test\r\nBcc: injected@example.test')).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled(); expect(sendTest).not.toHaveBeenCalled(); expect(assertTestReady).not.toHaveBeenCalled();
  });
  it('fails before reserving a budget if SMTP is disabled', async () => {
    const { service, query, assertTestReady, sendTest } = setup();
    assertTestReady.mockImplementation(() => { throw new ServiceUnavailableException({ code: 'SMTP_DISABLED' }); });
    await expect(service.send(admin, recipient)).rejects.toMatchObject({ status: 503, response: { code: 'SMTP_DISABLED' } });
    expect(query).not.toHaveBeenCalled(); expect(sendTest).not.toHaveBeenCalled();
  });
  it.each(['audit', 'lock'] as const)('never calls SMTP when reservation fails at %s', async transactionFault => {
    const { service, query, release, sendTest } = setup({ transactionFault });
    await expect(service.send(admin, recipient)).rejects.toThrow();
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK'); expect(release).toHaveBeenCalledOnce(); expect(sendTest).not.toHaveBeenCalled();
  });
  it.each([451, 550])('stores a sanitized explicit SMTP refusal %s without exposing its raw response', async responseCode => {
    const { service, resultQuery, sendTest } = setup();
    sendTest.mockRejectedValue(Object.assign(new Error('synthetic-private-smtp-secret'), { responseCode }));
    await expect(service.send(admin, recipient)).rejects.toMatchObject({ status: 503, response: { code: 'SMTP_TEST_REJECTED' } });
    expect(resultQuery.mock.calls[0][1][1]).toBe('EMAIL_TEST_REJECTED');
    expect(JSON.parse(resultQuery.mock.calls[0][1][4]).smtpStatus).toBe(responseCode);
    expect(JSON.stringify(resultQuery.mock.calls)).not.toContain('synthetic-private-smtp-secret'); expect(sendTest).toHaveBeenCalledOnce();
  });
  it('treats a timeout as uncertain and never retries SMTP', async () => {
    const { service, resultQuery, sendTest } = setup();
    sendTest.mockRejectedValue(new Error('synthetic-private-smtp-secret'));
    await expect(service.send(admin, recipient)).rejects.toMatchObject({ response: { code: 'SMTP_TEST_OUTCOME_UNKNOWN' } });
    expect(resultQuery.mock.calls[0][1][1]).toBe('EMAIL_TEST_OUTCOME_UNKNOWN'); expect(sendTest).toHaveBeenCalledOnce();
    expect(JSON.stringify(resultQuery.mock.calls)).not.toContain('synthetic-private-smtp-secret');
  });
  it('reports uncertain bookkeeping after SMTP acceptance and logs only operation/correlation', async () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { service, sendTest } = setup({ resultFault: true });
    await expect(auditContext.run({ correlationId }, () => service.send(admin, recipient))).rejects.toMatchObject({ response: { code: 'SMTP_TEST_ACKNOWLEDGEMENT_FAILED' } });
    expect(sendTest).toHaveBeenCalledOnce(); expect(log).toHaveBeenCalledWith({ event: 'email.test_acknowledgement_failed', operationId: expect.any(String), action: 'EMAIL_TEST_ACCEPTED', correlationId });
    expect(JSON.stringify(log.mock.calls)).not.toContain(recipient);
  });
});

describe('test email SMTP evidence and queue accounting', () => {
  it.each([
    [{ accepted: [recipient] }, true], [{ accepted: [{ address: recipient.toUpperCase() }] }, true],
    [{ accepted: [], rejected: [recipient] }, false],
  ])('checks the requested recipient and assigns a stable operation Message-ID', async (result, accepted) => {
    vi.stubEnv('SMTP_FROM', 'Crypta <notify@example.test>'); const sendMail = vi.fn().mockResolvedValue(result);
    const worker = new EmailWorkerService({} as Pool); Object.assign(worker, { transporter: { sendMail } });
    const operationId = '33333333-3333-4333-8333-333333333333';
    await expect(worker.sendTest(recipient, operationId)).resolves.toEqual({ accepted });
    expect(sendMail.mock.calls[0][0].messageId).toBe(`<email-test-${operationId}@example.test>`);
  });
  it.each([{}, { accepted: [] }, { accepted: ['someone-else@example.test'] }])('does not turn missing or unrelated acceptance evidence into success', async result => {
    vi.stubEnv('SMTP_FROM', 'Crypta <notify@example.test>');
    const worker = new EmailWorkerService({} as Pool); Object.assign(worker, { transporter: { sendMail: vi.fn().mockResolvedValue(result) } });
    await expect(worker.sendTest(recipient, 'operation')).rejects.toThrow('SMTP_TEST_RESULT_UNCONFIRMED');
  });
  it('uses only EMAIL records in operations queue totals', async () => {
    vi.stubEnv('SMTP_ENABLED', 'false');
    const worker = { lastPollAt: null, lastPollSucceeded: null, stale: true };
    const query = vi.fn().mockResolvedValue({ rows: [{ queue: { PENDING: 3 }, oldestDueSeconds: 301, worker }] });
    await expect(new NotificationsService({ query } as unknown as Pool).status()).resolves.toMatchObject({
      queue: { PENDING: 3 }, worker: { state: 'DISABLED' }, queueDelayed: false,
    });
    expect(query.mock.calls[0][0].text).toContain("WHERE channel='EMAIL'");
  });
});
