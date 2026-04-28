import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { ApiResponse } from '@litmus/shared';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = res.locals.requestId ?? '';
  const timestamp = new Date().toISOString();

  if (err instanceof AppError) {
    const body: ApiResponse = {
      data: null,
      error: { code: err.code, message: err.message, details: err.details },
      meta: { requestId, timestamp },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join('.');
      if (!details[key]) details[key] = [];
      details[key].push(issue.message);
    }
    const body: ApiResponse = {
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'Check your input', details },
      meta: { requestId, timestamp },
    };
    res.status(400).json(body);
    return;
  }

  logger.error({ err, requestId }, 'Unhandled error');
  const body: ApiResponse = {
    data: null,
    error: { code: 'SERVER_ERROR', message: 'Something went wrong. Try again.' },
    meta: { requestId, timestamp },
  };
  res.status(500).json(body);
}
