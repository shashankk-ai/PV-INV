import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { prisma } from '../services/prisma';
import { AppError } from '../utils/AppError';
import { ok, created } from '../utils/respond';
import { PackingType } from '@litmus/shared';

const router = Router({ mergeParams: true });

const PACKING_TYPES: [PackingType, ...PackingType[]] = [
  'drums', 'bags', 'bottles', 'cans', 'cartons', 'pallets', 'other',
];

const entryBaseSchema = z.object({
  rack_number:     z.string().min(1, 'Rack number is required'),
  item_name:       z.string().min(1, 'Item name is required'),
  item_key:        z.string().min(1, 'Item key is required'),
  batch_number:    z.string().min(3, 'Batch number must be at least 3 characters'),
  units:           z.number().int().positive('Units must be a positive integer'),
  packing_size:    z.number().int().positive('Packing size must be a positive integer'),
  uom:             z.string().min(1, 'UOM is required'),
  packing_type:    z.enum(PACKING_TYPES, { errorMap: () => ({ message: 'Invalid packing type' }) }),
  mfg_date:        z.string().refine((d) => !d || !isNaN(Date.parse(d)), 'Invalid manufacture date').optional().nullable(),
  expiry_date:     z.string().refine((d) => !d || !isNaN(Date.parse(d)), 'Invalid expiry date').optional().nullable(),
  packing_material_description: z.string().optional().nullable(),
  packing_remarks: z.string().optional().nullable(),
  idempotency_key: z.string().uuid().optional(),
});

const entrySchema = entryBaseSchema.refine(
  (d) => !d.expiry_date || !d.mfg_date || new Date(d.expiry_date) > new Date(d.mfg_date),
  { message: 'Expiry date must be after manufacture date', path: ['expiry_date'] }
);

type EntryInput = z.infer<typeof entryBaseSchema>;

// GET /api/sessions/:sessionId/entries
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessionId = req.params.sessionId;
    const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const limit = Math.min(100, parseInt(req.query.limit as string || '50', 10));

    const session = await prisma.pvSession.findUnique({ where: { id: sessionId } });
    if (!session) throw AppError.notFound('Session not found');

    const userId = res.locals.user.id;
    const role = res.locals.user.role;
    if (role !== 'admin' && session.user_id !== userId) throw AppError.forbidden();

    const where = { session_id: sessionId, deleted_at: null };
    const [entries, total] = await Promise.all([
      prisma.pvEntry.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          photos: { where: { deleted_at: null }, select: { id: true, url: true, thumb_url: true } },
          user: { select: { username: true } },
        },
      }),
      prisma.pvEntry.count({ where }),
    ]);

    res.json({
      data: entries,
      error: null,
      meta: { requestId: res.locals.requestId, timestamp: new Date().toISOString() },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/sessions/:sessionId/entries
router.post(
  '/',
  requireAuth,
  validate(entrySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = req.params.sessionId;
      const userId = res.locals.user.id;
      const body = req.body as EntryInput;

      const session = await prisma.pvSession.findUnique({
        where: { id: sessionId },
        include: { warehouse: true },
      });
      if (!session) throw AppError.notFound('Session not found');

      const role = res.locals.user.role;
      if (role !== 'admin' && session.user_id !== userId) throw AppError.forbidden();

      const mfgDate = body.mfg_date ? new Date(body.mfg_date) : null;
      const expDate = body.expiry_date ? new Date(body.expiry_date) : null;
      const totalQuantity = body.units * body.packing_size;

      // Duplicate detection: same item_key + rack_number in active sessions for same warehouse today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const dupCheck = await prisma.pvEntry.findFirst({
        where: {
          item_key: body.item_key,
          rack_number: body.rack_number,
          deleted_at: null,
          session: {
            warehouse_id: session.warehouse_id,
            started_at: { gte: todayStart },
          },
        },
      });

      const entryId = randomUUID();
      // pvEntryData must NOT include warehouse_id — that's not a PvEntry field
      const pvEntryData = {
        session_id: sessionId,
        rack_number: body.rack_number,
        item_name: body.item_name,
        item_key: body.item_key,
        batch_number: body.batch_number,
        units: body.units,
        packing_size: body.packing_size,
        uom: body.uom,
        packing_type: body.packing_type,
        total_quantity: totalQuantity,
        mfg_date: mfgDate,
        expiry_date: expDate,
        packing_material_description: body.packing_material_description ?? null,
        packing_remarks: body.packing_remarks ?? null,
        is_potential_duplicate: !!dupCheck,
        idempotency_key: body.idempotency_key ?? null,
        created_by: userId,
      };

      const [entry] = await prisma.$transaction([
        prisma.pvEntry.create({
          data: { id: entryId, ...pvEntryData },
          include: {
            photos: { select: { id: true, url: true, thumb_url: true } },
            user: { select: { username: true } },
          },
        }),
        prisma.scanAuditLog.create({
          data: {
            entry_id: entryId,
            session_id: sessionId,
            warehouse_id: session.warehouse_id,
            action: 'CREATE',
            actor_id: userId,
            actor_name: res.locals.user.username,
            snapshot: { ...pvEntryData, warehouse_id: session.warehouse_id } as object,
          },
        }),
      ]);

      created(res, entry);
    } catch (err) {
      // Idempotency: unique constraint on idempotency_key
      if ((err as { code?: string }).code === 'P2002') {
        const existing = await prisma.pvEntry.findFirst({
          where: { idempotency_key: (req.body as EntryInput).idempotency_key },
          include: {
            photos: { select: { id: true, url: true, thumb_url: true } },
            user: { select: { username: true } },
          },
        }).catch(() => null);
        if (existing) { created(res, existing); return; }
      }
      next(err);
    }
  }
);

// PUT /api/sessions/:sessionId/entries/:entryId
router.put(
  '/:entryId',
  requireAuth,
  validate(entryBaseSchema.partial()),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId, entryId } = req.params;
      const userId = res.locals.user.id;
      const role = res.locals.user.role;

      const entry = await prisma.pvEntry.findFirst({
        where: { id: entryId, session_id: sessionId, deleted_at: null },
      });
      if (!entry) throw AppError.notFound('Entry not found');
      if (role !== 'admin' && entry.created_by !== userId) throw AppError.forbidden();

      const body = req.body as Partial<EntryInput>;
      const units = body.units ?? entry.units;
      const packingSize = body.packing_size ?? entry.packing_size;

      const updateData = {
        ...(body.rack_number && { rack_number: body.rack_number }),
        ...(body.item_name && { item_name: body.item_name }),
        ...(body.item_key && { item_key: body.item_key }),
        ...(body.batch_number && { batch_number: body.batch_number }),
        ...(body.units !== undefined && { units: body.units }),
        ...(body.packing_size !== undefined && { packing_size: body.packing_size }),
        ...(body.uom && { uom: body.uom }),
        ...(body.packing_type && { packing_type: body.packing_type }),
        ...(body.mfg_date && { mfg_date: new Date(body.mfg_date) }),
        ...(body.expiry_date && { expiry_date: new Date(body.expiry_date) }),
        total_quantity: units * packingSize,
      };

      const session = await prisma.pvSession.findUnique({ where: { id: sessionId }, select: { warehouse_id: true } });

      const [updated] = await prisma.$transaction([
        prisma.pvEntry.update({
          where: { id: entryId },
          data: updateData,
          include: {
            photos: { select: { id: true, url: true, thumb_url: true } },
            user: { select: { username: true } },
          },
        }),
        prisma.scanAuditLog.create({
          data: {
            entry_id: entryId,
            session_id: sessionId,
            warehouse_id: session?.warehouse_id ?? '',
            action: 'UPDATE',
            actor_id: userId,
            actor_name: res.locals.user.username,
            snapshot: { before: entry, changes: updateData } as object,
          },
        }),
      ]);

      ok(res, updated);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/sessions/:sessionId/entries/:entryId (soft delete)
router.delete(
  '/:entryId',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId, entryId } = req.params;
      const userId = res.locals.user.id;
      const role = res.locals.user.role;

      const entry = await prisma.pvEntry.findFirst({
        where: { id: entryId, session_id: sessionId, deleted_at: null },
      });
      if (!entry) throw AppError.notFound('Entry not found');
      if (role !== 'admin' && entry.created_by !== userId) throw AppError.forbidden();

      const delSession = await prisma.pvSession.findUnique({ where: { id: sessionId }, select: { warehouse_id: true } });

      await prisma.$transaction([
        prisma.pvEntry.update({
          where: { id: entryId },
          data: { deleted_at: new Date() },
        }),
        prisma.scanAuditLog.create({
          data: {
            entry_id: entryId,
            session_id: sessionId,
            warehouse_id: delSession?.warehouse_id ?? '',
            action: 'DELETE',
            actor_id: userId,
            actor_name: res.locals.user.username,
            snapshot: entry as object,
          },
        }),
      ]);

      ok(res, { deleted: true });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
