import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export type RequestWithId = Request & { requestId: string };

export function requestContext(request: RequestWithId, response: Response, next: NextFunction) {
  const requestId = request.header('x-request-id')?.trim() || `req_${randomUUID()}`;
  request.requestId = requestId;
  response.setHeader('x-request-id', requestId);
  next();
}
