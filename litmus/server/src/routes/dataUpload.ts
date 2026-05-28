import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import path from 'path';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { prisma } from '../services/prisma';
import { redis } from '../services/redis';
import { ok, created } from '../utils/respond';
import { AppError } from '../utils/AppError';
import { detectColumns, ColumnMap } from '../utils/columnMapper';
import { logger } from '../utils/logger';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) return cb(null, true);
    cb(new Error('Only .xlsx, .xls and .csv files are accepted'));
  },
});

const ITEMS_KEY = 'litmus:items';
const SYNC_TS_KEY = 'litmus:last_sync';
const ITEMS_TTL = 3600;

function parseFile(buffer: Buffer): Record<string, unknown>[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
}

interface MappedRecord {
  item_key: string;
  item_name: string;
  location_code: string | null;
  warehouse_name: string | null;
  quantity: number;
  inventory_value: number;
  uom: string;
  cas_number?: string;
  uom_options: string[];
}

function parseQty(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') return 0;
  if (typeof raw === 'number') return Math.round(raw);
  const cleaned = String(raw).replace(/,/g, '').replace(/[^\d.\-]/g, '').trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.round(n);
}

function applyMap(rows: Record<string, unknown>[], map: ColumnMap): MappedRecord[] {
  return rows
    .map((row): MappedRecord | null => {
      const item_key  = map.item_key  ? String(row[map.item_key]  ?? '').trim() : '';
      const item_name = map.item_name ? String(row[map.item_name] ?? '').trim() : '';
      if (!item_key || !item_name) return null;

      const rawQty = map.quantity ? row[map.quantity] : undefined;
      const quantity = parseQty(rawQty);

      const rawVal = map.inventory_value ? row[map.inventory_value] : undefined;
      const valStr = rawVal !== undefined && rawVal !== null ? String(rawVal).replace(/,/g, '').trim() : '';
      // Excel error cells (#N/A, #REF!, etc.) must be treated as 0
      const inventory_value = valStr === '' || valStr.startsWith('#') ? 0 : parseFloat(valStr) || 0;

      const uom = map.uom ? String(row[map.uom] ?? '').trim() || 'units' : 'units';

      const location_code  = map.location_code ? String(row[map.location_code] ?? '').trim() || null : null;
      const warehouse_name = map.warehouse      ? String(row[map.warehouse]      ?? '').trim() || null : null;

      const cas_number = map.cas_number ? String(row[map.cas_number] ?? '').trim() || undefined : undefined;

      const rawUomOpts = map.uom_options ? String(row[map.uom_options] ?? '').trim() : '';
      const uom_options = rawUomOpts
        ? rawUomOpts.split(/[,;|]/).map((s) => s.trim()).filter(Boolean)
        : [uom];

      return { item_key, item_name, location_code, warehouse_name, quantity, inventory_value, uom, cas_number, uom_options };
    })
    .filter((r): r is MappedRecord => r !== null);
}

// ─── POST /api/admin/data-uploads/preview ────────────────────────────────────
router.post(
  '/preview',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw AppError.badRequest('No file provided');
      const rows = parseFile(req.file.buffer);
      if (!rows.length) throw AppError.badRequest('File is empty or could not be parsed');

      const headers = Object.keys(rows[0]);
      const { columnMap, confidence, warnings } = detectColumns(headers, rows.slice(0, 10));

      ok(res, { headers, detected: columnMap, confidence, warnings, sample: rows.slice(0, 5), total_rows: rows.length });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/admin/data-uploads ────────────────────────────────────────────
router.post(
  '/',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw AppError.badRequest('No file provided');

      let columnMap: ColumnMap;
      if (req.body.column_map) {
        columnMap = JSON.parse(req.body.column_map) as ColumnMap;
      } else {
        const rows0 = parseFile(req.file.buffer);
        if (!rows0.length) throw AppError.badRequest('File is empty');
        columnMap = detectColumns(Object.keys(rows0[0]), rows0.slice(0, 10)).columnMap;
      }

      if (!columnMap.item_key || !columnMap.item_name) {
        throw AppError.badRequest('Cannot commit: item_key and item_name columns must be mapped');
      }

      const rows = parseFile(req.file.buffer);
      const records = applyMap(rows, columnMap);
      if (!records.length) throw AppError.badRequest('No valid rows found after applying column map');

      const uploader = res.locals.user as { id: string; username: string };

      // ── 1. Extract unique warehouses from the file ─────────────────────────
      const warehouseSet = new Map<string, string>(); // location_code → name
      for (const rec of records) {
        const code = rec.location_code ?? rec.warehouse_name;
        const name = rec.warehouse_name ?? rec.location_code;
        if (code && name) warehouseSet.set(code, name);
      }

      // Require warehouse selection when the file has no warehouse column.
      // Without it we cannot safely scope the inventory replacement.
      const fileHasWarehouseColumn = warehouseSet.size > 0;
      const explicitWarehouseId: string | undefined = req.body.warehouse_id || undefined;
      if (!fileHasWarehouseColumn && !explicitWarehouseId) {
        throw AppError.badRequest(
          'This file has no warehouse column. Select a warehouse before uploading.'
        );
      }

      // ── 2. Upsert warehouses discovered in the file ────────────────────────
      for (const [code, name] of warehouseSet) {
        await prisma.warehouse.upsert({
          where:  { location_code: code },
          update: { name },
          create: { name, location_code: code },
        });
      }

      // ── 3. Remove stale warehouses (no sessions, no inventory, not in file) ──
      if (warehouseSet.size > 0) {
        await prisma.warehouse.deleteMany({
          where: {
            location_code: { notIn: [...warehouseSet.keys()] },
            pv_sessions:      { none: {} },
            system_inventory: { none: {} },
          },
        });
      }

      // ── 4. Fresh warehouse lookup maps ─────────────────────────────────────
      const dbWarehouses = await prisma.warehouse.findMany();
      const whByCode = new Map(dbWarehouses.map((w) => [w.location_code.toLowerCase(), w]));
      const whByName = new Map(dbWarehouses.map((w) => [w.name.toLowerCase(), w]));

      const resolveWarehouse = (rec: MappedRecord) => {
        if (rec.location_code) return whByCode.get(rec.location_code.toLowerCase()) ?? null;
        if (rec.warehouse_name) return whByName.get(rec.warehouse_name.toLowerCase()) ?? null;
        return null;
      };

      // ── 5. Aggregate inventory rows ────────────────────────────────────────
      const aggregated = new Map<string, {
        item_key: string; item_name: string; warehouse_id: string;
        quantity: number; inventory_value: number; uom: string; uom_options: string[];
      }>();

      // No-warehouse-column files: scope to the explicitly selected warehouse only.
      const fallbackWh = explicitWarehouseId
        ? dbWarehouses.find((w) => w.id === explicitWarehouseId)
        : null;
      if (!fileHasWarehouseColumn && !fallbackWh) {
        throw AppError.badRequest('Selected warehouse not found.');
      }

      for (const rec of records) {
        const wh = resolveWarehouse(rec);
        const targets = wh ? [wh] : [fallbackWh!];
        for (const targetWh of targets) {
          const key = `${rec.item_key}::${targetWh.id}`;
          const existing = aggregated.get(key);
          if (existing) {
            existing.quantity += rec.quantity;
            existing.inventory_value += rec.inventory_value;
          } else {
            aggregated.set(key, {
              item_key: rec.item_key, item_name: rec.item_name,
              warehouse_id: targetWh.id, quantity: rec.quantity,
              inventory_value: rec.inventory_value, uom: rec.uom, uom_options: rec.uom_options,
            });
          }
        }
      }

      const inventoryRows = [...aggregated.values()];

      // Only replace inventory for the warehouses THIS upload touches.
      // Never touch other warehouses — parallel uploads must not interfere.
      const targetWarehouseIds = fileHasWarehouseColumn
        ? [...warehouseSet.keys()].map((c) => whByCode.get(c.toLowerCase())?.id).filter(Boolean) as string[]
        : [fallbackWh!.id];

      await prisma.$transaction([
        prisma.systemInventoryCache.deleteMany({ where: { warehouse_id: { in: targetWarehouseIds } } }),
        prisma.systemInventoryCache.createMany({ data: inventoryRows, skipDuplicates: true }),
      ]);
      const upserted = inventoryRows.length;

      // ── 6. Rebuild Redis items cache — scoped per warehouse ────────────────
      // Build per-warehouse item lists so scanners only see their warehouse's items.
      const itemsByWarehouse = new Map<string, typeof inventoryRows>();
      for (const row of inventoryRows) {
        if (!itemsByWarehouse.has(row.warehouse_id)) itemsByWarehouse.set(row.warehouse_id, []);
        itemsByWarehouse.get(row.warehouse_id)!.push(row);
      }
      for (const [whId, whRows] of itemsByWarehouse) {
        const whItems = Array.from(
          new Map(whRows.map((r) => [r.item_key, {
            item_key: r.item_key, item_name: r.item_name,
            cas_number: records.find((x) => x.item_key === r.item_key)?.cas_number ?? '',
            uom_options: r.uom_options,
          }])).values()
        );
        await redis.setex(`${ITEMS_KEY}:${whId}`, ITEMS_TTL, JSON.stringify(whItems));
      }
      await redis.set(SYNC_TS_KEY, Date.now().toString());

      // ── 7. Record the upload ───────────────────────────────────────────────
      const dataUpload = await prisma.dataUpload.create({
        data: {
          filename: req.file.originalname,
          original_filename: req.file.originalname,
          source: 'file',
          row_count: records.length,
          column_map: columnMap as object,
          uploaded_by: uploader.id,
          warehouse_id: fileHasWarehouseColumn ? null : fallbackWh!.id,
        },
        include: {
          uploader:  { select: { id: true, username: true } },
          warehouse: { select: { id: true, name: true, location_code: true } },
        },
      });

      logger.info({ rows: records.length, upserted, warehouses: targetWarehouseIds.length, uploadId: dataUpload.id }, 'DataUpload: committed');

      created(res, {
        upload: dataUpload,
        rows_parsed: records.length,
        records_upserted: upserted,
        warehouses_synced: targetWarehouseIds.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/admin/data-uploads ─────────────────────────────────────────────
router.get(
  '/',
  requireAuth,
  requireAdmin,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const uploads = await prisma.dataUpload.findMany({
        orderBy: { uploaded_at: 'desc' },
        take: 20,
        include: {
          uploader:  { select: { id: true, username: true } },
          warehouse: { select: { id: true, name: true, location_code: true } },
        },
      });
      ok(res, uploads);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
