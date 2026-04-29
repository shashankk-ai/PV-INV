import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { dataSyncService } from '../services/DataSyncService';
import { ok } from '../utils/respond';
import { prisma } from '../services/prisma';

const router = Router();

router.get('/items', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const search = req.query.search as string | undefined;
    const start = Date.now();
    const items = await dataSyncService.getItems(search);
    const stale = await dataSyncService.isStale();
    if (stale) res.setHeader('X-Data-Stale', 'true');
    res.setHeader('X-Response-Time', `${Date.now() - start}ms`);
    ok(res, items);
  } catch (err) {
    next(err);
  }
});

router.get('/warehouses', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Serve from DB (has IDs needed for sessions) enriched with cache freshness
    const warehouses = await prisma.warehouse.findMany({
      orderBy: { name: 'asc' },
    });
    const stale = await dataSyncService.isStale();
    if (stale) res.setHeader('X-Data-Stale', 'true');
    ok(res, warehouses);
  } catch (err) {
    next(err);
  }
});

router.post('/sync/trigger', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Fire and don't wait — respond immediately
    dataSyncService.syncAll().catch((e) => console.error('Manual sync error', e));
    ok(res, { message: 'Sync triggered' });
  } catch (err) {
    next(err);
  }
});

export default router;
