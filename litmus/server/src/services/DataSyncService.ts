import cron from 'node-cron';
import { prisma } from './prisma';
import { redis } from './redis';
import { zohoClient } from './ZohoAnalyticsClient';
import { logger } from '../utils/logger';
import { ZohoChemical } from '@litmus/shared';

const ITEMS_KEY = 'litmus:items';
const WAREHOUSES_KEY = 'litmus:warehouses';
const SYNC_TS_KEY = 'litmus:last_sync';
const ITEMS_TTL = 3600; // 1 hour

export class DataSyncService {
  private syncIntervalMinutes: number;
  private cronJob: cron.ScheduledTask | null = null;

  constructor() {
    this.syncIntervalMinutes = parseInt(process.env.SYNC_INTERVAL_MINUTES || '30', 10);
  }

  async syncAll(): Promise<void> {
    logger.info('DataSyncService: starting sync');
    try {
      const [items, warehouses] = await Promise.all([
        zohoClient.fetchItems(),
        zohoClient.fetchWarehouses(),
      ]);

      // Cache items in Redis
      await redis.setex(ITEMS_KEY, ITEMS_TTL, JSON.stringify(items));

      // Cache warehouses in Redis
      await redis.setex(WAREHOUSES_KEY, ITEMS_TTL, JSON.stringify(warehouses));

      // Stamp sync time
      await redis.set(SYNC_TS_KEY, Date.now().toString());

      // Upsert warehouses in DB
      for (const wh of warehouses) {
        await prisma.warehouse.upsert({
          where: { location_code: wh.location_code },
          update: { name: wh.warehouse_name },
          create: { name: wh.warehouse_name, location_code: wh.location_code },
        });
      }

      // Sync inventory per warehouse
      const dbWarehouses = await prisma.warehouse.findMany();
      for (const dbWh of dbWarehouses) {
        const inventory = await zohoClient.fetchSystemInventory(dbWh.id);
        for (const rec of inventory) {
          const chem = (items as ZohoChemical[]).find((c) => c.item_key === rec.item_key);
          await prisma.systemInventoryCache.upsert({
            where: { item_key_warehouse_id: { item_key: rec.item_key, warehouse_id: dbWh.id } },
            update: { quantity: rec.quantity, uom: rec.uom, synced_at: new Date() },
            create: {
              item_key: rec.item_key,
              item_name: chem?.item_name ?? rec.item_key,
              warehouse_id: dbWh.id,
              quantity: rec.quantity,
              uom: rec.uom,
              uom_options: chem?.uom_options ?? [rec.uom],
            },
          });
        }
      }

      logger.info({ items: items.length, warehouses: warehouses.length }, 'DataSyncService: sync complete');
    } catch (err) {
      logger.error({ err }, 'DataSyncService: sync failed — serving stale cache');
    }
  }

  startCron(): void {
    const expr = `*/${this.syncIntervalMinutes} * * * *`;
    this.cronJob = cron.schedule(expr, () => {
      this.syncAll().catch((e) => logger.error(e, 'Cron sync error'));
    });
    logger.info({ interval: this.syncIntervalMinutes }, 'DataSyncService: cron started');
  }

  stop(): void {
    this.cronJob?.stop();
  }

  async isStale(): Promise<boolean> {
    const ts = await redis.get(SYNC_TS_KEY);
    if (!ts) return true;
    const age = Date.now() - parseInt(ts, 10);
    return age > this.syncIntervalMinutes * 2 * 60 * 1000;
  }

  async getItems(search?: string): Promise<ZohoChemical[]> {
    // Try Redis (Zoho) first
    let zohoItems: ZohoChemical[] = [];
    const raw = await redis.get(ITEMS_KEY);
    if (raw) {
      zohoItems = JSON.parse(raw) as ZohoChemical[];
    } else {
      try {
        await this.syncAll();
        const fresh = await redis.get(ITEMS_KEY);
        if (fresh) zohoItems = JSON.parse(fresh) as ZohoChemical[];
      } catch {
        // Zoho unavailable — fall through to DB
      }
    }

    // Always merge with items from uploaded inventory (SystemInventoryCache)
    // so CSV-uploaded items appear as suggestions even when Zoho is down/unconfigured
    const dbItems = await this.getItemsFromDB();

    // Merge: Zoho items take priority; DB fills in anything not in Zoho
    const merged = new Map<string, ZohoChemical>();
    for (const item of dbItems) merged.set(item.item_key, item);
    for (const item of zohoItems) merged.set(item.item_key, item); // overwrite with Zoho data

    return this.filterItems([...merged.values()], search);
  }

  private async getItemsFromDB(): Promise<ZohoChemical[]> {
    const rows = await prisma.systemInventoryCache.findMany({
      select: { item_key: true, item_name: true, uom_options: true },
      orderBy: { item_name: 'asc' },
    });
    // Deduplicate by item_key (same item can exist across multiple warehouses)
    const seen = new Set<string>();
    const unique: ZohoChemical[] = [];
    for (const row of rows) {
      if (!seen.has(row.item_key)) {
        seen.add(row.item_key);
        unique.push({ item_key: row.item_key, item_name: row.item_name, uom_options: row.uom_options });
      }
    }
    return unique;
  }

  private filterItems(items: ZohoChemical[], search?: string): ZohoChemical[] {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) => i.item_name.toLowerCase().includes(q) || i.item_key.toLowerCase().includes(q)
    );
  }

  async getTotalItemCount(): Promise<number> {
    const raw = await redis.get(ITEMS_KEY);
    if (raw) {
      const zohoCount = (JSON.parse(raw) as ZohoChemical[]).length;
      if (zohoCount > 0) return zohoCount;
    }
    return prisma.systemInventoryCache
      .groupBy({ by: ['item_key'] })
      .then((rows) => rows.length)
      .catch(() => 0);
  }

  async getWarehouses(): Promise<unknown[]> {
    const raw = await redis.get(WAREHOUSES_KEY);
    if (!raw) {
      await this.syncAll();
      const fresh = await redis.get(WAREHOUSES_KEY);
      return fresh ? JSON.parse(fresh) : [];
    }
    return JSON.parse(raw);
  }
}

export const dataSyncService = new DataSyncService();
