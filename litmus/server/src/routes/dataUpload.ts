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

// Store in memory — files are typically < 5MB
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

/** Parse buffer → array of raw row objects. Works for XLSX and CSV. */
function parseFile(buffer: Buffer, filename: string): Record<string, unknown>[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
}

/** Apply a ColumnMap to raw rows → canonical records. */
function applyMap(
  rows: Record<string, unknown>[],
  map: ColumnMap,
  warehouseIdOverride?: string,
): {
  item_key: string;
  item_name: string;
  warehouse_identifier: string | null;
  quantity: number;
  uom: string;
  cas_number?: string;
  uom_options: string[];
}[] {
  return rows
    .map((row) => {
      const item_key  = map.item_key  ? String(row[map.item_key] ?? '').trim()  : '';
      const item_name = map.item_name ? String(row[map.item_name] ?? '').trim() : '';
      if (!item_key || !item_name) return null;

      const rawQty = map.quantity ? row[map.quantity] : undefined;
      const quantity = rawQty !== undefined && rawQty !== '' ? Math.round(Number(rawQty)) : 0;

      const uom = map.uom ? String(row[map.uom] ?? '').trim() || 'units' : 'units';

      const warehouse_identifier =
        warehouseIdOverride ??
        (map.warehouse ? String(row[map.warehouse] ?? '').trim() || null : null);

      const cas_number = map.cas_number ? String(row[map.cas_number] ?? '').trim() || undefined : undefined;

      const rawUomOpts = map.uom_options ? String(row[map.uom_options] ?? '').trim() : '';
      const uom_options = rawUomOpts ? rawUomOpts.split(/[,;|]/).map((s) => s.trim()).filter(Boolean) : [uom];

      return { item_key, item_name, warehouse_identifier, quantity, uom, cas_number, uom_options };
    })
    .filter(Boolean) as ReturnType<typeof applyMap>;
}

// ─── POST /api/admin/data-upload/preview ─────────────────────────────────────
// Returns headers + detected mapping without committing anything.
router.post(
  '/preview',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw AppError.badRequest('No file provided');
      const rows = parseFile(req.file.buffer, req.file.originalname);
      if (!rows.length) throw AppError.badRequest('File is empty or could not be parsed');

      const headers = Object.keys(rows[0]);
      const { columnMap, confidence, warnings } = detectColumns(headers);

      ok(res, {
        headers,
        detected: columnMap,
        confidence,
        warnings,
        sample: rows.slice(0, 5),
        total_rows: rows.length,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/admin/data-upload ──────────────────────────────────────────────
// Commit: parse, apply column map, upsert DB, refresh Redis item cache.
router.post(
  '/',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) throw AppError.badRequest('No file provided');

      // Optional: caller may send a custom column map (JSON string) after preview
      let columnMap: ColumnMap;
      if (req.body.column_map) {
        columnMap = JSON.parse(req.body.column_map) as ColumnMap;
      } else {
        const rows0 = parseFile(req.file.buffer, req.file.originalname);
        if (!rows0.length) throw AppError.badRequest('File is empty');
        const headers = Object.keys(rows0[0]);
        columnMap = detectColumns(headers).columnMap;
      }

      if (!columnMap.item_key || !columnMap.item_name) {
        throw AppError.badRequest('Cannot commit: item_key and item_name columns must be mapped');
      }

      const rows = parseFile(req.file.buffer, req.file.originalname);
      const warehouseIdOverride = req.body.warehouse_id as string | undefined;
      const records = applyMap(rows, columnMap, warehouseIdOverride);

      if (!records.length) throw AppError.badRequest('No valid rows found after applying column map');

      const uploader = res.locals.user as { id: string; username: string };

      // Resolve warehouses from DB
      const dbWarehouses = await prisma.warehouse.findMany();
      const whByCode = new Map(dbWarehouses.map((w) => [w.location_code.toLowerCase(), w]));
      const whByName = new Map(dbWarehouses.map((w) => [w.name.toLowerCase(), w]));
      const whById   = new Map(dbWarehouses.map((w) => [w.id, w]));

      const resolveWarehouse = (identifier: string | null) => {
        if (!identifier) return null;
        const lo = identifier.toLowerCase();
        return whByCode.get(lo) ?? whByName.get(lo) ?? whById.get(identifier) ?? null;
      };

      // Upsert system_inventory_cache
      let upserted = 0;
      for (const rec of records) {
        const wh = resolveWarehouse(rec.warehouse_identifier);

        if (rec.warehouse_identifier && !wh) {
          logger.warn({ identifier: rec.warehouse_identifier }, 'DataUpload: unknown warehouse, skipping row');
          continue;
        }

        const targetWarehouses = wh ? [wh] : dbWarehouses;
        for (const targetWh of targetWarehouses) {
          await prisma.systemInventoryCache.upsert({
            where: { item_key_warehouse_id: { item_key: rec.item_key, warehouse_id: targetWh.id } },
            update: {
              item_name: rec.item_name,
              quantity: rec.quantity,
              uom: rec.uom,
              uom_options: rec.uom_options,
              synced_at: new Date(),
            },
            create: {
              item_key: rec.item_key,
              item_name: rec.item_name,
              warehouse_id: targetWh.id,
              quantity: rec.quantity,
              uom: rec.uom,
              uom_options: rec.uom_options,
            },
          });
          upserted++;
        }
      }

      // Rebuild items cache in Redis (deduplicated by item_key)
      const uniqueItems = Array.from(
        new Map(
          records.map((r) => [r.item_key, {
            item_key: r.item_key,
            item_name: r.item_name,
            cas_number: r.cas_number ?? '',
            uom_options: r.uom_options,
          }])
        ).values()
      );
      await redis.setex(ITEMS_KEY, ITEMS_TTL, JSON.stringify(uniqueItems));
      await redis.set(SYNC_TS_KEY, Date.now().toString());

      // Record the upload
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

      logger.info(
        { rows: records.length, upserted, uploadId: dataUpload.id },
        'DataUpload: committed'
      );

      created(res, { upload: dataUpload, rows_parsed: records.length, records_upserted: upserted });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/admin/data-uploads ──────────────────────────────────────────────
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
