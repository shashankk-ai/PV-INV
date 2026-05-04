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

      const uom = map.uom ? String(row[map.uom] ?? '').trim() || 'units' : 'units';

      const location_code  = map.location_code ? String(row[map.location_code] ?? '').trim() || null : null;
      const warehouse_name = map.warehouse      ? String(row[map.warehouse]      ?? '').trim() || null : null;

      const cas_number = map.cas_number ? String(row[map.cas_number] ?? '').trim() || undefined : undefined;

      const rawUomOpts = map.uom_options ? String(row[map.uom_options] ?? '').trim() : '';
      const uom_options = rawUomOpts
        ? rawUomOpts.split(/[,;|]/).map((s) => s.trim()).filter(Boolean)
        : [uom];

      return { item_key, item_name, location_code, warehouse_name, quantity, uom, cas_number, uom_options };
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
      // Map: location_code → warehouse_name
      const warehouseSet = new Map<string, string>();
      for (const rec of records) {
        const code = rec.location_code ?? rec.warehouse_name;
        const name = rec.warehouse_name ?? rec.location_code;
        if (code && name) warehouseSet.set(code, name);
      }

      // ── 2. Upsert warehouses discovered in the file ────────────────────────
      for (const [code, name] of warehouseSet) {
        await prisma.warehouse.upsert({
          where:  { location_code: code },
          update: { name },
          create: { name, location_code: code },
        });
      }

      // ── 3. Remove stale mock warehouses (no sessions, no inventory, not in file) ──
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

      // ── 5. Bulk-replace system inventory ──────────────────────────────────
      // Build all records in memory, then delete + createMany in one transaction
      const inventoryRows: {
        item_key: string; item_name: string; warehouse_id: string;
        quantity: number; uom: string; uom_options: string[];
      }[] = [];

      for (const rec of records) {
        const wh = resolveWarehouse(rec);
        const targets = wh ? [wh] : dbWarehouses;
        for (const targetWh of targets) {
          inventoryRows.push({
            item_key: rec.item_key,
            item_name: rec.item_name,
            warehouse_id: targetWh.id,
            quantity: rec.quantity,
            uom: rec.uom,
            uom_options: rec.uom_options,
          });
        }
      }

      const warehouseIds = dbWarehouses.map((w) => w.id);
      await prisma.$transaction([
        prisma.systemInventoryCache.deleteMany({ where: { warehouse_id: { in: warehouseIds } } }),
        prisma.systemInventoryCache.createMany({ data: inventoryRows, skipDuplicates: true }),
      ]);
      const upserted = inventoryRows.length;

      // ── 6. Rebuild Redis items cache ───────────────────────────────────────
      const uniqueItems = Array.from(
        new Map(records.map((r) => [r.item_key, {
          item_key: r.item_key,
          item_name: r.item_name,
          cas_number: r.cas_number ?? '',
          uom_options: r.uom_options,
        }])).values()
      );
      await redis.setex(ITEMS_KEY, ITEMS_TTL, JSON.stringify(uniqueItems));
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
        },
        include: { uploader: { select: { id: true, username: true } } },
      });

      logger.info({ rows: records.length, upserted, warehouses: warehouseSet.size, uploadId: dataUpload.id }, 'DataUpload: committed');

      created(res, {
        upload: dataUpload,
        rows_parsed: records.length,
        records_upserted: upserted,
        warehouses_synced: warehouseSet.size,
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
        include: { uploader: { select: { id: true, username: true } } },
      });
      ok(res, uploads);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
