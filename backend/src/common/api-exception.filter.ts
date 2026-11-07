import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { RequestWithId } from './request-context.middleware';
import type { HttpFailureAuditService } from '../audit/http-failure-audit.service';

const parserTypes = new Map<string, number>([
  ['entity.parse.failed', 400], ['request.aborted', 400], ['request.size.invalid', 400], ['querystring.parse.rangeError', 400],
  ['entity.too.large', 413], ['parameters.too.many', 413],
  ['charset.unsupported', 415], ['encoding.unsupported', 415],
]);

function parserHttpStatus(exception: unknown): number | undefined {
  if (!(exception instanceof Error)) return undefined;
  const error = exception as Error & { status?: unknown; statusCode?: unknown; expose?: unknown; type?: unknown; code?: unknown };
  if (error.expose !== true || error.status !== error.statusCode || typeof error.status !== 'number') return undefined;
  if (typeof error.type === 'string' && parserTypes.get(error.type) === error.status) return error.status;
  // body-parser wraps zlib errors in http-errors without replacing their Error prototype or adding a parser type.
  if (error.status === 400 && (error.code === 'Z_DATA_ERROR' || error.code === 'Z_BUF_ERROR')) return 400;
  return undefined;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  constructor(private readonly failureAudit?: HttpFailureAuditService) {}
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<RequestWithId>();
    const parserStatus = exception instanceof HttpException ? undefined : parserHttpStatus(exception);
    const status = exception instanceof HttpException ? exception.getStatus() : parserStatus ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : null;
    const payload = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
    const message = parserStatus !== undefined
      ? parserStatus === 413 ? 'Dữ liệu yêu cầu vượt quá giới hạn cho phép.'
        : parserStatus === 415 ? 'Định dạng hoặc mã hóa yêu cầu không được hỗ trợ.'
          : 'Dữ liệu yêu cầu không hợp lệ.'
      : Array.isArray(payload.message)
      ? payload.message.join('; ')
      : typeof payload.message === 'string'
        ? payload.message
        : exception instanceof Error && status < 500
          ? exception.message
          : 'Đã xảy ra lỗi máy chủ.';

    const requestId = request.requestId ?? `req_${randomUUID()}`;
    request.requestId = requestId;
    if (status >= 500) {
      const route: unknown = request.route?.path;
      this.logger.error({
        event: 'http.server_error',
        requestId,
        method: request.method,
        route: typeof route === 'string' ? route : undefined,
        status,
        durationMs: request.requestStartedAt === undefined
          ? undefined : Math.round(performance.now() - request.requestStartedAt),
      });
    }
    const send = () => response.status(status).json({
      error: {
        code: typeof payload.code === 'string' ? payload.code : `HTTP_${status}`,
        message,
        details: payload.details ?? [],
      },
      requestId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    });
    if (this.failureAudit) return this.failureAudit.record(request, status).then(send);
    return send();
  }
}
