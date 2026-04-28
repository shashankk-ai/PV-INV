import { Response } from 'express';
import { ApiResponse } from '@litmus/shared';

export function ok<T>(res: Response, data: T, statusCode = 200): void {
  const body: ApiResponse<T> = {
    data,
    error: null,
    meta: { requestId: res.locals.requestId ?? '', timestamp: new Date().toISOString() },
  };
  res.status(statusCode).json(body);
}

export function created<T>(res: Response, data: T): void {
  ok(res, data, 201);
}
