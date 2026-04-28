import { Router, Request, Response } from 'express';
import { prisma } from '../services/prisma';
import { redis } from '../services/redis';
import { requireAdmin } from '../middleware/auth';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const startedAt = (globalThis as Record<string, unknown>).__litmus_start as number | undefined;
  const uptime = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : process.uptime();

  let dbStatus = 'connected';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = 'disconnected';
  }

  let cacheStatus = 'connected';
  try {
    await redis.ping();
  } catch {
    cacheStatus = 'disconnected';
  }

  res.json({
    status: 'ok',
    app: 'litmus',
    version: '1.0.0',
    uptime,
    db: dbStatus,
    cache: cacheStatus,
  });
});

router.get('/metrics', requireAdmin, async (_req: Request, res: Response) => {
  const [userCount, sessionCount, entryCount] = await Promise.all([
    prisma.user.count(),
    prisma.pvSession.count(),
    prisma.pvEntry.count({ where: { deleted_at: null } }),
  ]);
  res.json({ users: userCount, sessions: sessionCount, entries: entryCount });
});

export default router;
