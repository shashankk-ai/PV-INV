import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { prisma } from '../services/prisma';
import { ok } from '../utils/respond';

const router = Router();

// GET /api/admin/stats
router.get('/stats', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [
      sessionsToday,
      scansToday,
      activeUserIds,
      unlistedItems,
      totalEntries,
      warehouses,
    ] = await Promise.all([
      prisma.pvSession.count({ where: { started_at: { gte: todayStart } } }),
      prisma.pvEntry.count({ where: { created_at: { gte: todayStart }, deleted_at: null } }),
      prisma.pvSession.findMany({
        where: { started_at: { gte: todayStart } },
        select: { user_id: true },
        distinct: ['user_id'],
      }),
      prisma.unlistedItem.count({ where: { created_at: { gte: todayStart } } }),
      prisma.pvEntry.count({ where: { deleted_at: null } }),
      prisma.warehouse.count(),
    ]);

    ok(res, {
      sessions_today: sessionsToday,
      scans_today: scansToday,
      active_users: activeUserIds.length,
      unlisted_items: unlistedItems,
      total_entries: totalEntries,
      warehouses,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/sessions — all sessions across all users
router.get('/sessions', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const limit = Math.min(100, parseInt(req.query.limit as string || '30', 10));
    const warehouseId = req.query.warehouse_id as string | undefined;

    const where = warehouseId ? { warehouse_id: warehouseId } : {};

    const [sessions, total] = await Promise.all([
      prisma.pvSession.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { started_at: 'desc' },
        include: {
          warehouse: { select: { id: true, name: true, location_code: true } },
          user: { select: { id: true, username: true } },
          _count: { select: { entries: { where: { deleted_at: null } } } },
        },
      }),
      prisma.pvSession.count({ where }),
    ]);

    res.json({
      data: sessions,
      error: null,
      meta: { requestId: res.locals.requestId, timestamp: new Date().toISOString() },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/users — user list with today's activity
router.get('/users', requireAuth, requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        created_at: true,
        pv_sessions: {
          where: { started_at: { gte: todayStart } },
          select: { id: true, started_at: true },
        },
        pv_entries: {
          where: { created_at: { gte: todayStart }, deleted_at: null },
          select: { id: true },
        },
      },
      orderBy: { username: 'asc' },
    });

    const result = users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      created_at: u.created_at,
      sessions_today: u.pv_sessions.length,
      scans_today: u.pv_entries.length,
    }));

    ok(res, result);
  } catch (err) {
    next(err);
  }
});

export default router;
