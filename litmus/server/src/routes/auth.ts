import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../services/prisma';
import { signAccess, issueRefresh, rotateRefresh } from '../services/tokenService';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AppError } from '../utils/AppError';
import { ok, created } from '../utils/respond';
import { AuthUser } from '@litmus/shared';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '5'),
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again in a minute.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { username, password } = req.body as z.infer<typeof loginSchema>;
      const user = await prisma.user.findUnique({ where: { username } });
      if (!user || !(await bcrypt.compare(password, user.password))) {
        throw AppError.unauthorized('Invalid username or password');
      }

      const authUser: AuthUser = { id: user.id, username: user.username, role: user.role as 'ops' | 'admin' };
      const accessToken = signAccess(authUser);
      const refreshToken = await issueRefresh(user.id);

      created(res, { user: authUser, access_token: accessToken, refresh_token: refreshToken });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/refresh',
  validate(refreshSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refresh_token } = req.body as z.infer<typeof refreshSchema>;
      const result = await rotateRefresh(refresh_token);
      if (!result) throw AppError.unauthorized('Invalid or expired refresh token');
      ok(res, { user: result.user, access_token: result.accessToken, refresh_token: result.refreshToken });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/me', requireAuth, (req: Request, res: Response) => {
  ok(res, res.locals.user);
});

export default router;
