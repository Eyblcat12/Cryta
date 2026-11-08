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
    const route: unknown = request.route?.path;
    const routeTemplate = typeof route === 'string' ? route : undefined;
    const code = typeof payload.code === 'string' ? payload.code : undefined;
    let message = 'Đã xảy ra lỗi máy chủ.';
    let details: unknown = [];
    // Nest converts parser SyntaxError and Express URIError to plain 400s before this filter.
    // Its unmatched 404 message also embeds the incoming target.
    if (parserStatus === 413) message = 'Dữ liệu yêu cầu vượt quá giới hạn cho phép.';
    else if (parserStatus === 415) message = 'Định dạng hoặc mã hóa yêu cầu không được hỗ trợ.';
    else if (parserStatus === 400 || (!routeTemplate && !code && status === 400)) message = 'Dữ liệu yêu cầu không hợp lệ.';
    else if (!routeTemplate && !code && status === 404) message = 'Không tìm thấy đường dẫn API.';
    else {
      if (Array.isArray(payload.message)) message = payload.message.join('; ');
      else if (typeof payload.message === 'string') message = payload.message;
      else if (exception instanceof Error && status < 500) message = exception.message;
      details = payload.details ?? [];
    }

    const requestId = request.requestId ?? `req_${randomUUID()}`;
    request.requestId = requestId;
    if (status >= 500) {
      this.logger.error({
        event: 'http.server_error',
        requestId,
        method: request.method,
        route: routeTemplate,
        status,
        durationMs: request.requestStartedAt === undefined
          ? undefined : Math.round(performance.now() - request.requestStartedAt),
      });
    }
    const send = () => response.status(status).json({
      error: { code: code ?? `HTTP_${status}`, message, details },
      requestId,
      timestamp: new Date().toISOString(),
      path: routeTemplate ?? '/',
    });
    if (this.failureAudit) return this.failureAudit.record(request, status).then(send);
    return send();
  }
}
