import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError';
import { AuthUser } from '@litmus/shared';

declare global {
  namespace Express {
    interface Locals {
      user: AuthUser;
      requestId: string;
    }
  }
}

function verifyAccess(token: string): AuthUser {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw AppError.internal('JWT secret not configured');
  try {
    return jwt.verify(token, secret) as AuthUser;
  } catch {
    throw AppError.unauthorized('Session expired. Sign in again.');
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(AppError.unauthorized());
    return;
  }
  try {
    res.locals.user = verifyAccess(header.slice(7));
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (res.locals.user.role !== 'admin') {
      next(AppError.forbidden());
      return;
    }
    next();
  });
}
