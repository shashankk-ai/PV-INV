import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { prisma } from '../services/prisma';
import { AppError } from '../utils/AppError';
import { ok, created } from '../utils/respond';

const router = Router();

// POST /api/sessions
const createSessionSchema = z.object({
  warehouse_id: z.string().uuid('Invalid warehouse ID'),
});

router.post(
  '/',
  requireAuth,
  validate(createSessionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { warehouse_id } = req.body as z.infer<typeof createSessionSchema>;
      const userId = res.locals.user.id;

      const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouse_id } });
      if (!warehouse) throw AppError.notFound('Warehouse not found');

      const session = await prisma.pvSession.create({
        data: { warehouse_id, user_id: userId },
        include: { warehouse: { select: { id: true, name: true, location_code: true } } },
      });

      created(res, session);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/sessions
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = res.locals.user.id;
    const role = res.locals.user.role;
    const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const limit = Math.min(50, parseInt(req.query.limit as string || '20', 10));

    const where = role === 'admin' ? {} : { user_id: userId };
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

// GET /api/sessions/:id
router.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const session = await prisma.pvSession.findUnique({
      where: { id: req.params.id },
      include: {
        warehouse: { select: { id: true, name: true, location_code: true } },
        user: { select: { id: true, username: true } },
        _count: { select: { entries: { where: { deleted_at: null } } } },
      },
    });
    if (!session) throw AppError.notFound('Session not found');

    const userId = res.locals.user.id;
    const role = res.locals.user.role;
    if (role !== 'admin' && session.user_id !== userId) throw AppError.forbidden();

    ok(res, session);
  } catch (err) {
    next(err);
  }
});

export default router;
