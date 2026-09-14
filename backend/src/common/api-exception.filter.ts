import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { RequestWithId } from './request-context.middleware';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<RequestWithId>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw = exception instanceof HttpException ? exception.getResponse() : null;
    const payload = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
    const message = Array.isArray(payload.message)
      ? payload.message.join('; ')
      : typeof payload.message === 'string'
        ? payload.message
        : exception instanceof Error && status < 500
          ? exception.message
          : 'Đã xảy ra lỗi máy chủ.';

    const requestId = request.requestId ?? request.header('x-request-id') ?? `req_${randomUUID()}`;
    if (status >= 500) this.logger.error(`${request.method} ${request.originalUrl} [${requestId}]`, exception instanceof Error ? exception.stack : String(exception));
    response.status(status).json({
      error: {
        code: typeof payload.code === 'string' ? payload.code : `HTTP_${status}`,
        message,
        details: payload.details ?? [],
      },
      requestId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    });
  }
}
