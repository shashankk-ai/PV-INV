import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { prisma } from '../services/prisma';
import { AppError } from '../utils/AppError';
import { ok } from '../utils/respond';
import { ReconciliationRow, ReconciliationStatus, MasterRecoRow } from '@litmus/shared';

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

// GET /api/reconciliation/:warehouseId?date=YYYY-MM-DD  (or ?all=true for all-time)
router.get(
  '/:warehouseId',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { warehouseId } = req.params;
      const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
      if (!warehouse) throw AppError.notFound('Warehouse not found');

      const all = req.query.all === 'true';
      const dateRange = all ? undefined : buildDateRange(req.query.date as string | undefined);
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

      const dateLabel = all ? 'all' : (dateRange!.gte.toISOString().slice(0, 10));
      ok(res, { warehouse, date: dateLabel, rows, summary });
    } catch (err) {
      next(err);
    }
  }
);

// ── Shared helper: builds master reco rows for a warehouse + date range ───────
async function buildMasterReport(warehouseId: string, dateRange?: { gte: Date; lt: Date }): Promise<MasterRecoRow[]> {
  const [systemCache, pvAgg] = await Promise.all([
    prisma.systemInventoryCache.findMany({ where: { warehouse_id: warehouseId } }),
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
    }),
  ]);

  const pvMap = new Map<string, number>();
  for (const row of pvAgg) pvMap.set(row.item_key, row._sum.total_quantity ?? 0);
  const systemMap = new Map(systemCache.map((s) => [s.item_key, s]));
  const allKeys = new Set<string>([...systemCache.map((s) => s.item_key), ...pvAgg.map((r) => r.item_key)]);

  const rows: MasterRecoRow[] = [];
  for (const key of allKeys) {
    const sys = systemMap.get(key);
    const system_qty = sys?.quantity ?? 0;
    const system_value = sys?.inventory_value ?? 0;
    const avg_cost = system_qty > 0 ? system_value / system_qty : 0;
    const pv_qty = pvMap.get(key) ?? 0;
    const pv_value = Math.round(avg_cost * pv_qty * 100) / 100;
    rows.push({
      item_key: key, item_name: sys?.item_name ?? key,
      system_qty, system_value, avg_cost: Math.round(avg_cost * 100) / 100,
      pv_qty, pv_value,
      value_diff: Math.round((pv_value - system_value) * 100) / 100,
      qty_diff: pv_qty - system_qty,
      status: computeStatus(system_qty, pv_qty),
    });
  }

  const order: Record<ReconciliationStatus, number> = { missing: 0, short: 1, excess: 2, matching: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.item_name.localeCompare(b.item_name));
  return rows;
}

// GET /api/reconciliation/:warehouseId/master?date=YYYY-MM-DD  (or ?all=true)
router.get(
  '/:warehouseId/master',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { warehouseId } = req.params;
      const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
      if (!warehouse) throw AppError.notFound('Warehouse not found');

      const all = req.query.all === 'true';
      const dateRange = all ? undefined : buildDateRange(req.query.date as string | undefined);
      const rows = await buildMasterReport(warehouseId, dateRange);

      const summary = {
        total: rows.length,
        matching: rows.filter((r) => r.status === 'matching').length,
        short: rows.filter((r) => r.status === 'short').length,
        excess: rows.filter((r) => r.status === 'excess').length,
        missing: rows.filter((r) => r.status === 'missing').length,
        total_system_value: Math.round(rows.reduce((s, r) => s + r.system_value, 0) * 100) / 100,
        total_pv_value: Math.round(rows.reduce((s, r) => s + r.pv_value, 0) * 100) / 100,
        total_value_diff: Math.round(rows.reduce((s, r) => s + r.value_diff, 0) * 100) / 100,
      };

      ok(res, { warehouse, rows, summary });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/reconciliation/:warehouseId/master/export/csv?date=YYYY-MM-DD
router.get(
  '/:warehouseId/master/export/csv',
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
      const rows = await buildMasterReport(warehouseId, dateRange);

      // q() quotes text fields; numeric columns use plain toFixed(2) — no locale
      // formatting — so Excel can parse and sum them correctly.
      const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const n = (v: number) => v.toFixed(2);
      const csvRows = [
        q(`LITMUS Master Reconciliation — ${warehouse.name} — ${all ? 'All Dates' : dateStr}`),
        '',
        'Item Key,Item Name,System QT,System Value,Avg Cost,PV QT,PV Value,Value Difference,QT Difference,Status',
        ...rows.map((r) => [
          q(r.item_key), q(r.item_name),
          r.system_qty, n(r.system_value), n(r.avg_cost),
          r.pv_qty, n(r.pv_value), n(r.value_diff),
          r.qty_diff, q(r.status.toUpperCase()),
        ].join(',')),
        '',
        q(`Generated by LITMUS on ${new Date().toISOString()}`),
      ];

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="litmus-master-${warehouse.location_code}-${dateStr}.csv"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send('﻿' + csvRows.join('\r\n'));
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

      const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csvRows = [
        q(`LITMUS Truth Report — ${warehouse.name} — ${all ? 'All Dates' : dateStr}`),
        '',
        'Item Key,Item Name,System Qty,Scanned Qty,Variance,Status',
        ...rows.map((r) =>
          [
            q(r.item_key), q(r.item_name),
            q(r.system_quantity), q(r.litmus_quantity),
            q(r.variance), q(r.status.toUpperCase()),
          ].join(',')
        ),
        '',
        q(`Generated by LITMUS on ${new Date().toISOString()}`),
      ];

      const csv = csvRows.join('\r\n');
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

// GET /api/reconciliation/:warehouseId/items/:itemKey/scans?date=YYYY-MM-DD  (or ?all=true)
router.get(
  '/:warehouseId/items/:itemKey/scans',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { warehouseId, itemKey } = req.params;
      const all = req.query.all === 'true';
      const dateRange = all ? undefined : buildDateRange(req.query.date as string | undefined);

      const entries = await prisma.pvEntry.findMany({
        where: {
          deleted_at: null,
          item_key: itemKey,
          session: {
            warehouse_id: warehouseId,
            ...(dateRange ? { started_at: { gte: dateRange.gte, lt: dateRange.lt } } : {}),
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
