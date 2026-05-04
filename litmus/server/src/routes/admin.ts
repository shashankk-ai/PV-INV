import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { prisma } from '../services/prisma';
import { ok, created } from '../utils/respond';
import { AppError } from '../utils/AppError';
import { sendWelcomeEmail } from '../services/emailService';

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
      inventoryAgg,
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
      prisma.systemInventoryCache.aggregate({
        _sum: { quantity: true, inventory_value: true },
      }),
    ]);

    ok(res, {
      sessions_today: sessionsToday,
      scans_today: scansToday,
      active_users: activeUserIds.length,
      unlisted_items: unlistedItems,
      total_entries: totalEntries,
      warehouses,
      total_system_qty: inventoryAgg._sum.quantity ?? 0,
      total_inventory_value: inventoryAgg._sum.inventory_value ?? 0,
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
        email: true,
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
      email: u.email,
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

const createUserSchema = z.object({
  username: z.string().min(3, 'Min 3 characters').max(32).regex(/^[a-z0-9_]+$/, 'Lowercase letters, numbers and _ only'),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(8, 'Min 8 characters'),
  role: z.enum(['ops', 'admin']),
});

const updateUserSchema = z.object({
  password: z.string().min(8, 'Min 8 characters').optional(),
  role: z.enum(['ops', 'admin']).optional(),
});

// POST /api/admin/users — create a new user
router.post('/users', requireAuth, requireAdmin, validate(createUserSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, email, password, role } = req.body as z.infer<typeof createUserSchema>;

    const [existingUsername, existingEmail] = await Promise.all([
      prisma.user.findUnique({ where: { username } }),
      prisma.user.findUnique({ where: { email } }),
    ]);
    if (existingUsername) throw AppError.conflict('Username already taken');
    if (existingEmail)   throw AppError.conflict('Email already registered');

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { username, email, password: hashed, role },
      select: { id: true, username: true, email: true, role: true, created_at: true },
    });

    // Send welcome email — non-blocking, failure doesn't affect response
    const appUrl = process.env.CLIENT_URL ?? 'http://localhost:5173';
    sendWelcomeEmail({ to: email, username, password, role, appUrl }).catch(() => {});

    created(res, user);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/users/:id — change password or role
router.patch('/users/:id', requireAuth, requireAdmin, validate(updateUserSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { password, role } = req.body as z.infer<typeof updateUserSchema>;

    const data: Record<string, unknown> = {};
    if (password) data.password = await bcrypt.hash(password, 12);
    if (role)     data.role = role;
    if (!Object.keys(data).length) throw AppError.badRequest('Nothing to update');

    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, username: true, role: true, created_at: true },
    });
    ok(res, user);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/users/:id — remove a user (cannot self-delete)
router.delete('/users/:id', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if ((res.locals.user as { id: string })?.id === id) {
      throw AppError.badRequest('Cannot delete your own account');
    }
    await prisma.user.delete({ where: { id } });
    ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
