import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, Logger, type ArgumentsHost } from '@nestjs/common';
import createError from 'http-errors';
import { gunzipSync } from 'node:zlib';
import { ApiExceptionFilter } from '../src/common/api-exception.filter';
import type { HttpFailureAuditService } from '../src/audit/http-failure-audit.service';

function present(exception: unknown, requestOverrides: Record<string, unknown> = {}) {
  let status = 0;
  let payload: Record<string, unknown> = {};
  const response = { status(value: number) { status = value; return this; }, json(value: Record<string, unknown>) { payload = value; } };
  const request = {
    requestId: 'req_parser_test', header: () => undefined, method: 'POST',
    originalUrl: '/api/v1/parser-test', ...requestOverrides,
  };
  const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }) } as unknown as ArgumentsHost;
  new ApiExceptionFilter().catch(exception, host);
  return { status, payload };
}

describe('API exception status and safe parser messages', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  const secret = 'private-request-secret-do-not-echo';
  it('waits for the independent failure audit before sending the rejection response', async () => {
    let finishAudit!: () => void;
    const record = vi.fn(() => new Promise<void>(resolve => { finishAudit = resolve; }));
    const json = vi.fn(), response = { status: vi.fn().mockReturnThis(), json };
    const request = { method: 'POST', originalUrl: '/api/v1/requests', route: { path: '/api/v1/requests' } };
    const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }) } as unknown as ArgumentsHost;
    const completed = new ApiExceptionFilter({ record } as unknown as HttpFailureAuditService).catch(new ConflictException('Version conflict'), host);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ requestId: expect.stringMatching(/^req_[0-9a-f-]{36}$/) }), 409);
    expect(json).not.toHaveBeenCalled();
    finishAudit(); await completed;
    expect(response.status).toHaveBeenCalledWith(409); expect(json).toHaveBeenCalledOnce();
  });
  function parserError(status: number, type: string) {
    return createError(status, `Parser detail ${secret}`, { type, body: secret, details: [secret] });
  }

  it('returns 400 for an actual malformed gzip error wrapped the same way as body-parser', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    let decoderError!: Error;
    try { gunzipSync(Buffer.from([0x1f, 0x8b, 0x08, 0xff])); } catch (error) { decoderError = error as Error; }
    expect(decoderError).toBeInstanceOf(Error);
    const error = createError(400, createError(400, decoderError), { body: secret, details: [secret] });
    const result = present(error);
    expect(result.status).toBe(400);
    expect(result.payload).toMatchObject({ error: { code: 'HTTP_400', message: 'Dữ liệu yêu cầu không hợp lệ.', details: [] }, requestId: 'req_parser_test' });
    expect(JSON.stringify(result.payload)).not.toContain(secret);
    expect(JSON.stringify(result.payload)).not.toContain(decoderError.stack);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'request.aborted', 'Dữ liệu yêu cầu không hợp lệ.'],
    [400, 'request.size.invalid', 'Dữ liệu yêu cầu không hợp lệ.'],
    [400, 'entity.parse.failed', 'Dữ liệu yêu cầu không hợp lệ.'],
    [413, 'entity.too.large', 'Dữ liệu yêu cầu vượt quá giới hạn cho phép.'],
    [413, 'parameters.too.many', 'Dữ liệu yêu cầu vượt quá giới hạn cho phép.'],
    [415, 'charset.unsupported', 'Định dạng hoặc mã hóa yêu cầu không được hỗ trợ.'],
    [415, 'encoding.unsupported', 'Định dạng hoặc mã hóa yêu cầu không được hỗ trợ.'],
  ] as const)('preserves parser status %s for %s without exposing message/body/details', (status, type, message) => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const result = present(parserError(status, type));
    expect(result.status).toBe(status);
    expect(result.payload).toMatchObject({ error: { code: `HTTP_${status}`, message, details: [] } });
    expect(JSON.stringify(result.payload)).not.toContain(secret);
    expect(JSON.stringify(result.payload)).not.toContain('Parser detail');
  });

  it('keeps the established Nest exception status, business code and validation details', () => {
    const result = present(new ConflictException({ code: 'VERSION_CONFLICT', message: 'Yêu cầu đã thay đổi.', details: [{ field: 'version' }] }));
    expect(result.status).toBe(409);
    expect(result.payload).toMatchObject({ error: { code: 'VERSION_CONFLICT', message: 'Yêu cầu đã thay đổi.', details: [{ field: 'version' }] } });
  });

  it('correlates a server failure without logging the raw URL or exception', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const result = present(new Error(`Driver detail ${secret}`), {
      originalUrl: `/api/v1/assets/${secret}?token=${secret}`,
      route: { path: '/api/v1/assets/:id' },
      requestStartedAt: performance.now() - 10,
    });
    expect(result.status).toBe(500);
    expect(log).toHaveBeenCalledWith({
      event: 'http.server_error',
      requestId: result.payload.requestId,
      method: 'POST',
      route: '/api/v1/assets/:id',
      status: 500,
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });

  it.each([
    { status: 400, statusCode: 400, expose: true, type: 'entity.parse.failed', message: secret },
    Object.assign(new Error(secret), { status: 400, statusCode: 400, expose: true }),
    createError(401, secret),
    createError(500, secret, { type: 'entity.too.large' }),
    createError(400, secret, { type: 'entity.too.large' }),
    Object.assign(new Error(secret), { status: 400, statusCode: 413, expose: true, type: 'entity.too.large' }),
    new Error(secret),
  ])('keeps unknown or inconsistent external errors at 500 without echoing error fields', (error) => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const result = present(error);
    expect(result.status).toBe(500);
    expect(result.payload).toMatchObject({ error: { code: 'HTTP_500', message: 'Đã xảy ra lỗi máy chủ.', details: [] } });
    expect(JSON.stringify(result.payload)).not.toContain(secret);
  });
});
