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

async function buildReport(warehouseId: string, dateRange?: { gte: Date; lt: Date }): Promise<ReconciliationRow[]> {
  const [systemCache, scannedAgg] = await Promise.all([
    prisma.systemInventoryCache.findMany({
      where: { warehouse_id: warehouseId },
      orderBy: { item_name: 'asc' },
    }),
    prisma.pvEntry.groupBy({
      by: ['item_key'],
      where: {
        deleted_at: null,
        session: {
          warehouse_id: warehouseId,
          ...(dateRange ? { started_at: { gte: dateRange.gte, lt: dateRange.lt } } : {}),
        },
      },
      _sum: { total_quantity: true },
      _max: { item_name: true },
    }),
  ]);

  const scannedMap = new Map<string, { quantity: number; item_name: string }>();
  for (const row of scannedAgg) {
    scannedMap.set(row.item_key, {
      quantity: row._sum.total_quantity ?? 0,
      item_name: row._max.item_name ?? row.item_key,
    });
  }

  const allKeys = new Set<string>([
    ...systemCache.map((s) => s.item_key),
    ...scannedAgg.map((r) => r.item_key),
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
      const [rows, inventoryAgg] = await Promise.all([
        buildReport(warehouseId, dateRange),
        prisma.systemInventoryCache.aggregate({
          where: { warehouse_id: warehouseId },
          _sum: { quantity: true, inventory_value: true },
        }),
      ]);

      const summary = {
        total: rows.length,
        matching: rows.filter((r) => r.status === 'matching').length,
        short: rows.filter((r) => r.status === 'short').length,
        excess: rows.filter((r) => r.status === 'excess').length,
        missing: rows.filter((r) => r.status === 'missing').length,
        accuracy_pct: rows.length
          ? Math.round((rows.filter((r) => r.status === 'matching').length / rows.length) * 100)
          : 100,
        total_system_qty: inventoryAgg._sum.quantity ?? 0,
        total_inventory_value: inventoryAgg._sum.inventory_value ?? 0,
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

      const all = req.query.all === 'true';
      const dateRange = all ? undefined : buildDateRange(req.query.date as string | undefined);
      const rows = await buildReport(warehouseId, dateRange);
      const dateStr = all ? 'all-dates' : dateRange!.gte.toISOString().slice(0, 10);

      const csvRows = [
        `LITMUS Truth Report — ${warehouse.name} — ${all ? 'All Dates' : dateStr}`,
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
      res.setHeader('Cache-Control', 'no-store');
      res.send('﻿' + csv); // BOM for Excel
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/reconciliation/:warehouseId/scans?date=YYYY-MM-DD  — all PV entries for the warehouse
router.get(
  '/:warehouseId/scans',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { warehouseId } = req.params;
      const dateRange = buildDateRange(req.query.date as string | undefined);

      const entries = await prisma.pvEntry.findMany({
        where: {
          deleted_at: null,
          session: {
            warehouse_id: warehouseId,
            started_at: { gte: dateRange.gte, lt: dateRange.lt },
          },
        },
        orderBy: { created_at: 'asc' },
        include: { user: { select: { username: true } } },
      });

      ok(res, entries.map((e) => ({
        id: e.id,
        item_name: e.item_name,
        item_key: e.item_key,
        rack_number: e.rack_number,
        batch_number: e.batch_number,
        units: e.units,
        packing_size: e.packing_size,
        total_quantity: e.total_quantity,
        uom: e.uom,
        packing_type: e.packing_type,
        packing_material_description: e.packing_material_description ?? null,
        packing_remarks: e.packing_remarks ?? null,
        mfg_date: e.mfg_date?.toISOString().slice(0, 10) ?? null,
        expiry_date: e.expiry_date?.toISOString().slice(0, 10) ?? null,
        scanned_by: e.user.username,
        scanned_at: e.created_at,
        is_potential_duplicate: e.is_potential_duplicate,
      })));
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/reconciliation/:warehouseId/scans/export/csv?date=YYYY-MM-DD
router.get(
  '/:warehouseId/scans/export/csv',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { warehouseId } = req.params;
      const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
      if (!warehouse) throw AppError.notFound('Warehouse not found');

      const all = req.query.all === 'true';
      const dateRange = all ? undefined : buildDateRange(req.query.date as string | undefined);
      const dateStr = all ? 'all-dates' : dateRange!.gte.toISOString().slice(0, 10);

      const entries = await prisma.pvEntry.findMany({
        where: {
          deleted_at: null,
          session: {
            warehouse_id: warehouseId,
            ...(dateRange ? { started_at: { gte: dateRange.gte, lt: dateRange.lt } } : {}),
          },
        },
        orderBy: { created_at: 'asc' },
        include: { user: { select: { username: true } } },
      });

      const csvRows = [
        `LITMUS PV Scan Data — ${warehouse.name} — ${all ? 'All Dates' : dateStr}`,
        '',
        'Item Name,Item Key,Rack Number,Batch Number,Units,Pack Size,Total Qty,UOM,Packing Type,Packing Material Desc,Packing Remarks,Mfg Date,Expiry Date,Scanned By,Scanned At',
        ...entries.map((e) => [
          `"${e.item_name.replace(/"/g, '""')}"`,
          e.item_key,
          e.rack_number,
          e.batch_number,
          e.units,
          e.packing_size,
          e.total_quantity,
          e.uom,
          e.packing_type,
          `"${(e.packing_material_description ?? '').replace(/"/g, '""')}"`,
          `"${(e.packing_remarks ?? '').replace(/"/g, '""')}"`,
          e.mfg_date?.toISOString().slice(0, 10) ?? '',
          e.expiry_date?.toISOString().slice(0, 10) ?? '',
          e.user.username,
          e.created_at.toISOString(),
        ].join(',')),
        '',
        `Generated by LITMUS on ${new Date().toISOString()}`,
      ];

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="litmus-pv-${warehouse.location_code}-${dateStr}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send('﻿' + csvRows.join('\n'));
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

      const entries = await prisma.pvEntry.findMany({
        where: {
          deleted_at: null,
          item_key: itemKey,
          session: {
            warehouse_id: warehouseId,
            started_at: { gte: dateRange.gte, lt: dateRange.lt },
          },
        },
        orderBy: { created_at: 'asc' },
        include: { user: { select: { username: true } } },
      });

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
          packing_material_description: e.packing_material_description ?? null,
          packing_remarks: e.packing_remarks ?? null,
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
