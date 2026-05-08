/**
 * One-time cleanup: removes seed/mock warehouses AND mock item keys that were
 * fan-out copied into real warehouses (e.g. WH025) before the upload fix.
 * Safe to run multiple times (idempotent).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MOCK_LOCATION_CODES = ['MUM-CW-01', 'HYD-DC-01', 'BLR-SF-01'];

const MOCK_ITEM_KEYS = [
  'SCI001','SCI002','SCI003','SCI004','SCI005','SCI006','SCI007','SCI008',
  'SCI009','SCI010','SCI011','SCI012','SCI013','SCI014','SCI015','SCI016',
  'SCI017','SCI018','SCI019','SCI020','SCI021','SCI022','SCI023','SCI024',
  'SCI025','SCI026','SCI027','SCI028','SCI029','SCI030',
];

async function main() {
  // ── 1. Delete mock warehouses and their inventory ──────────────────────────
  const mockWarehouses = await prisma.warehouse.findMany({
    where: { location_code: { in: MOCK_LOCATION_CODES } },
    include: { _count: { select: { pv_sessions: true, system_inventory: true } } },
  });

  if (mockWarehouses.length) {
    const mockIds = mockWarehouses.map((w) => w.id);
    const { count: invDeleted } = await prisma.systemInventoryCache.deleteMany({
      where: { warehouse_id: { in: mockIds } },
    });
    console.log(`Deleted ${invDeleted} inventory rows from mock warehouses`);

    const safeToDelete = mockWarehouses.filter((w) => w._count.pv_sessions === 0);
    if (safeToDelete.length) {
      await prisma.warehouse.deleteMany({ where: { id: { in: safeToDelete.map((w) => w.id) } } });
      console.log(`Deleted mock warehouses: ${safeToDelete.map((w) => w.location_code).join(', ')}`);
    }
  } else {
    console.log('No mock warehouses found (already cleaned).');
  }

  // ── 2. Delete mock item keys from ALL remaining warehouses (e.g. WH025) ───
  const { count: spillDeleted } = await prisma.systemInventoryCache.deleteMany({
    where: { item_key: { in: MOCK_ITEM_KEYS } },
  });
  if (spillDeleted > 0) {
    console.log(`Deleted ${spillDeleted} mock item rows that had spilled into real warehouses`);
  } else {
    console.log('No spilled mock items found in real warehouses.');
  }

  // ── 3. Delete pv_entries for mock item keys (prevents them surfacing in master reco) ──
  const { count: pvDeleted } = await prisma.pvEntry.deleteMany({
    where: { item_key: { in: MOCK_ITEM_KEYS } },
  });
  if (pvDeleted > 0) {
    console.log(`Deleted ${pvDeleted} PV entries for mock item keys`);
  } else {
    console.log('No PV entries found for mock item keys.');
  }

  console.log('Cleanup complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
