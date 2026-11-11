import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { OperationsMetricsService } from '../operations/operations-metrics.service';
import { auditContext } from '../audit/audit-context';

export type RequestWithId = Request & { requestId: string; requestStartedAt?: number };
const monitoringRoutes = new Set([
  '/api/v1/health', '/api/v1/health/live', '/api/v1/health/ready',
  '/api/v1/operations/metrics', '/api/v1/operations/signals',
]);

export function requestContext(metrics: OperationsMetricsService) {
  return (request: RequestWithId, response: Response, next: NextFunction) => {
    const requestId = `req_${randomUUID()}`;
    const startedAt = performance.now();
    request.requestId = requestId;
    request.requestStartedAt = startedAt;
    response.setHeader('x-request-id', requestId);
    response.once('finish', () => {
      if (!monitoringRoutes.has(request.route?.path)) metrics.observeHttp(response.statusCode, startedAt);
    });
    auditContext.run({ correlationId: requestId }, next);
  };
}
