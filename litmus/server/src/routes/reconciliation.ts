import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { prisma } from '../services/prisma';
import { AppError } from '../utils/AppError';
import { ok } from '../utils/respond';
import { ReconciliationRow, ReconciliationStatus } from '@litmus/shared';

const router = Router();

function buildDateRange(dateParam?: string): { gte: Date; lt: Date } {
  const base = dateParam ? new Date(dateParam) : new Date();
  base.setHours(0, 0, 0, 0);
  const end = new Date(base);
  end.setDate(end.getDate() + 1);
  return { gte: base, lt: end };
}

function computeStatus(systemQty: number, litmusQty: number): ReconciliationStatus {
  if (systemQty === 0 && litmusQty > 0) return 'excess';
  if (systemQty > 0 && litmusQty === 0) return 'missing';
  if (litmusQty === systemQty) return 'matching';
  return litmusQty < systemQty ? 'short' : 'excess';
}

async function buildReport(warehouseId: string, dateRange: { gte: Date; lt: Date }): Promise<ReconciliationRow[]> {
  const [systemCache, sessions] = await Promise.all([
    prisma.systemInventoryCache.findMany({
      where: { warehouse_id: warehouseId },
      orderBy: { item_name: 'asc' },
    }),
    prisma.pvSession.findMany({
      where: {
        warehouse_id: warehouseId,
        started_at: { gte: dateRange.gte },
      },
      select: { id: true },
    }),
  ]);

  const sessionIds = sessions.map((s) => s.id);

  // Aggregate scanned quantities by item_key for the date's sessions
  const scannedAgg = sessionIds.length
    ? await prisma.pvEntry.groupBy({
        by: ['item_key', 'item_name'],
        where: {
          session_id: { in: sessionIds },
          deleted_at: null,
        },
        _sum: { total_quantity: true },
      })
    : [];

  const scannedMap = new Map<string, { quantity: number; item_name: string }>();
  for (const row of scannedAgg) {
    scannedMap.set(row.item_key, {
      quantity: row._sum.total_quantity ?? 0,
      item_name: row.item_name,
    });
  }

  // Build union of all item keys
  const allKeys = new Set<string>([
    ...systemCache.map((s) => s.item_key),
    ...scannedAgg.map((s) => s.item_key),
  ]);

  const systemMap = new Map(systemCache.map((s) => [s.item_key, s]));

  const rows: ReconciliationRow[] = [];
  for (const key of allKeys) {
    const sys = systemMap.get(key);
    const scanned = scannedMap.get(key);
    const systemQty = sys?.quantity ?? 0;
    const litmusQty = scanned?.quantity ?? 0;
    rows.push({
      item_key: key,
      item_name: sys?.item_name ?? scanned?.item_name ?? key,
      system_quantity: systemQty,
      litmus_quantity: litmusQty,
      variance: litmusQty - systemQty,
      status: computeStatus(systemQty, litmusQty),
    });
  }

  // Sort: missing/short first, then by item_name
  const order: Record<ReconciliationStatus, number> = { missing: 0, short: 1, excess: 2, matching: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.item_name.localeCompare(b.item_name));

  return rows;
}

// GET /api/reconciliation/:warehouseId?date=YYYY-MM-DD
router.get(
  '/:warehouseId',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { warehouseId } = req.params;
      const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
      if (!warehouse) throw AppError.notFound('Warehouse not found');

      const dateRange = buildDateRange(req.query.date as string | undefined);
      const rows = await buildReport(warehouseId, dateRange);

      const summary = {
        total: rows.length,
        matching: rows.filter((r) => r.status === 'matching').length,
        short: rows.filter((r) => r.status === 'short').length,
        excess: rows.filter((r) => r.status === 'excess').length,
        missing: rows.filter((r) => r.status === 'missing').length,
        accuracy_pct: rows.length
          ? Math.round((rows.filter((r) => r.status === 'matching').length / rows.length) * 100)
          : 100,
      };

      ok(res, { warehouse, date: dateRange.gte.toISOString().slice(0, 10), rows, summary });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/reconciliation/:warehouseId/export/csv?date=YYYY-MM-DD
router.get(
  '/:warehouseId/export/csv',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { warehouseId } = req.params;
      const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
      if (!warehouse) throw AppError.notFound('Warehouse not found');

      const dateRange = buildDateRange(req.query.date as string | undefined);
      const rows = await buildReport(warehouseId, dateRange);
      const dateStr = dateRange.gte.toISOString().slice(0, 10);

      const csvRows = [
        `LITMUS Truth Report — ${warehouse.name} — ${dateStr}`,
        '',
        'Item Key,Item Name,System Qty,Scanned Qty,Variance,Status',
        ...rows.map((r) =>
          [
            r.item_key,
            `"${r.item_name.replace(/"/g, '""')}"`,
            r.system_quantity,
            r.litmus_quantity,
            r.variance,
            r.status.toUpperCase(),
          ].join(',')
        ),
        '',
        `Generated by LITMUS on ${new Date().toISOString()}`,
      ];

      const csv = csvRows.join('\n');
      const filename = `litmus-truth-${warehouse.location_code}-${dateStr}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send('﻿' + csv); // BOM for Excel
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/reconciliation/:warehouseId/items/:itemKey/scans?date=YYYY-MM-DD
router.get(
  '/:warehouseId/items/:itemKey/scans',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { warehouseId, itemKey } = req.params;
      const dateRange = buildDateRange(req.query.date as string | undefined);

      const sessions = await prisma.pvSession.findMany({
        where: { warehouse_id: warehouseId, started_at: { gte: dateRange.gte } },
        select: { id: true },
      });
      const sessionIds = sessions.map((s) => s.id);

      const entries = sessionIds.length
        ? await prisma.pvEntry.findMany({
            where: { session_id: { in: sessionIds }, item_key: itemKey, deleted_at: null },
            orderBy: { created_at: 'asc' },
            include: { user: { select: { username: true } } },
          })
        : [];

      ok(res, {
        item_key: itemKey,
        item_name: entries[0]?.item_name ?? itemKey,
        total_pv_count: entries.reduce((s, e) => s + (e.total_quantity ?? 0), 0),
        scans: entries.map((e) => ({
          id: e.id,
          rack_number: e.rack_number,
          batch_number: e.batch_number,
          units: e.units,
          packing_size: e.packing_size,
          total_quantity: e.total_quantity,
          uom: e.uom,
          packing_type: e.packing_type,
          mfg_date: e.mfg_date?.toISOString().slice(0, 10) ?? null,
          expiry_date: e.expiry_date?.toISOString().slice(0, 10) ?? null,
          scanned_by: e.user.username,
          scanned_at: e.created_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
