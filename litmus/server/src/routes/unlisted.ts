import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { prisma } from '../services/prisma';
import { ok, created } from '../utils/respond';
import { PackingType } from '@litmus/shared';

const router = Router();

const PACKING_TYPES: [PackingType, ...PackingType[]] = [
  'drums', 'bags', 'bottles', 'cans', 'cartons', 'pallets', 'other',
];

const unlistedSchema = z.object({
  session_id:   z.string().uuid(),
  warehouse_id: z.string().optional(),
  item_name:    z.string().min(1, 'Item name is required'),
  description:  z.string().optional(),
  units:        z.number().int().positive().default(1),
  packing_size: z.number().int().positive().default(1),
  uom:          z.string().min(1),
  packing_type: z.enum(PACKING_TYPES),
  notes:        z.string().optional(),
});

router.post(
  '/',
  requireAuth,
  validate(unlistedSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as z.infer<typeof unlistedSchema>;
      const userId = res.locals.user.id;

      // Resolve warehouse_id from session if not provided
      let warehouseId = body.warehouse_id ?? '';
      if (!warehouseId && body.session_id) {
        const session = await prisma.pvSession.findUnique({
          where: { id: body.session_id },
          select: { warehouse_id: true },
        });
        warehouseId = session?.warehouse_id ?? '';
      }

      const totalQty = body.units * body.packing_size;

      const item = await prisma.unlistedItem.create({
        data: {
          session_id:   body.session_id,
          warehouse_id: warehouseId,
          item_name:    body.item_name,
          description:  body.description ?? null,
          units:        body.units,
          packing_size: body.packing_size,
          quantity:     totalQty,
          uom:          body.uom,
          packing_type: body.packing_type,
          notes:        body.notes ?? null,
          created_by:   userId,
        },
      });
      created(res, item);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/unlisted-items?warehouse_id=X&date=YYYY-MM-DD  (admin)
// GET /api/unlisted-items?session_id=X  (any authenticated)
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { session_id, warehouse_id, date } = req.query as Record<string, string | undefined>;

    let where: Record<string, unknown> = {};

    if (session_id) {
      where = { session_id };
    } else if (warehouse_id) {
      if (date) {
        // Filter by sessions started on that date
        const base = new Date(date);
        base.setHours(0, 0, 0, 0);
        const end = new Date(base);
        end.setDate(end.getDate() + 1);

        const sessions = await prisma.pvSession.findMany({
          where: { warehouse_id, started_at: { gte: base, lt: end } },
          select: { id: true },
        });
        const sessionIds = sessions.map((s) => s.id);

        // Also support the denormalized warehouse_id column directly
        where = sessionIds.length
          ? { OR: [{ warehouse_id }, { session_id: { in: sessionIds } }] }
          : { warehouse_id };
      } else {
        where = { warehouse_id };
      }
    }

    const items = await prisma.unlistedItem.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: { user: { select: { username: true } } },
    });

    ok(res, items.map((i) => ({
      id: i.id,
      session_id: i.session_id,
      item_name: i.item_name,
      description: i.description,
      units: i.units,
      packing_size: i.packing_size,
      quantity: i.quantity,
      uom: i.uom,
      packing_type: i.packing_type,
      notes: i.notes,
      recorded_by: i.user.username,
      created_at: i.created_at,
    })));
  } catch (err) {
    next(err);
  }
});

// GET /api/unlisted-items/export/csv?warehouse_id=X&date=YYYY-MM-DD
router.get('/export/csv', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { warehouse_id, date, all } = req.query as Record<string, string | undefined>;
    if (!warehouse_id) { res.status(400).json({ error: 'warehouse_id required' }); return; }

    const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouse_id } });
    if (!warehouse) { res.status(404).json({ error: 'Not found' }); return; }

    let where: Record<string, unknown> = { warehouse_id };
    let dateStr = 'all-dates';

    if (all !== 'true' && date) {
      dateStr = date;
      const base = new Date(date);
      base.setHours(0, 0, 0, 0);
      const end = new Date(base);
      end.setDate(end.getDate() + 1);

      const sessions = await prisma.pvSession.findMany({
        where: { warehouse_id, started_at: { gte: base, lt: end } },
        select: { id: true },
      });
      const sessionIds = sessions.map((s) => s.id);
      where = sessionIds.length
        ? { OR: [{ warehouse_id }, { session_id: { in: sessionIds } }] }
        : { warehouse_id };
    }

    const items = await prisma.unlistedItem.findMany({
      where,
      orderBy: { created_at: 'asc' },
      include: { user: { select: { username: true } } },
    });

    const csvRows = [
      `LITMUS Unlisted Items — ${warehouse.name} — ${all === 'true' ? 'All Dates' : dateStr}`,
      '',
      'Item Name,Description,Units,Pack Size,Total Qty,UOM,Packing Type,Notes,Recorded By,Recorded At',
      ...items.map((i) => [
        `"${i.item_name.replace(/"/g, '""')}"`,
        `"${(i.description ?? '').replace(/"/g, '""')}"`,
        i.units,
        i.packing_size,
        i.quantity,
        i.uom,
        i.packing_type,
        `"${(i.notes ?? '').replace(/"/g, '""')}"`,
        i.user.username,
        i.created_at.toISOString(),
      ].join(',')),
      '',
      `Generated by LITMUS on ${new Date().toISOString()}`,
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="litmus-unlisted-${warehouse.location_code}-${dateStr}.csv"`);
    res.send('﻿' + csvRows.join('\n'));
  } catch (err) {
    next(err);
  }
});

export default router;
