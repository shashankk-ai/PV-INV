import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { prisma } from '../services/prisma';
import { ok, created } from '../utils/respond';
import { PackingType } from '@litmus/shared';

const router = Router();

const PACKING_TYPES: [PackingType, ...PackingType[]] = [
  'drums', 'bags', 'bottles', 'cans', 'cartons', 'pallets', 'other',
];

const unlistedSchema = z.object({
  session_id:  z.string().uuid(),
  item_name:   z.string().min(1, 'Item name is required'),
  description: z.string().optional(),
  quantity:    z.number().int().positive(),
  uom:         z.string().min(1),
  packing_type: z.enum(PACKING_TYPES),
  notes:       z.string().optional(),
});

router.post(
  '/',
  requireAuth,
  validate(unlistedSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as z.infer<typeof unlistedSchema>;
      const userId = res.locals.user.id;

      const item = await prisma.unlistedItem.create({
        data: {
          session_id:  body.session_id,
          item_name:   body.item_name,
          description: body.description ?? null,
          quantity:    body.quantity,
          uom:         body.uom,
          packing_type: body.packing_type,
          notes:       body.notes ?? null,
          created_by:  userId,
        },
      });
      created(res, item);
    } catch (err) {
      next(err);
    }
  }
);

router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.query.session_id as string | undefined;
    const where = sessionId ? { session_id: sessionId } : {};
    const items = await prisma.unlistedItem.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
    ok(res, items);
  } catch (err) {
    next(err);
  }
});

export default router;
