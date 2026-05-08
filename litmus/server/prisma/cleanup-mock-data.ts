/**
 * One-time cleanup script: removes the 3 seed/mock warehouses and all their
 * associated inventory. Safe to run multiple times (idempotent).
 *
 * Run with:
 *   npx ts-node --project tsconfig.json prisma/cleanup-mock-data.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MOCK_LOCATION_CODES = ['MUM-CW-01', 'HYD-DC-01', 'BLR-SF-01'];

async function main() {
  const mockWarehouses = await prisma.warehouse.findMany({
    where: { location_code: { in: MOCK_LOCATION_CODES } },
    include: {
      _count: { select: { pv_sessions: true, system_inventory: true } },
    },
  });

  if (!mockWarehouses.length) {
    console.log('No mock warehouses found — nothing to clean up.');
    return;
  }

  for (const wh of mockWarehouses) {
    console.log(`Found: ${wh.name} (${wh.location_code}) — ${wh._count.system_inventory} inventory rows, ${wh._count.pv_sessions} sessions`);
  }

  const mockIds = mockWarehouses.map((w) => w.id);

  // Delete inventory for mock warehouses
  const { count: invDeleted } = await prisma.systemInventoryCache.deleteMany({
    where: { warehouse_id: { in: mockIds } },
  });
  console.log(`Deleted ${invDeleted} inventory rows from mock warehouses`);

  // Delete mock warehouses (only if they have no real PV sessions)
  const withSessions = mockWarehouses.filter((w) => w._count.pv_sessions > 0);
  if (withSessions.length) {
    console.warn(`WARNING: ${withSessions.map((w) => w.location_code).join(', ')} have real PV sessions — skipping warehouse deletion for safety`);
  }

  const safeToDelete = mockWarehouses.filter((w) => w._count.pv_sessions === 0);
  if (safeToDelete.length) {
    await prisma.warehouse.deleteMany({
      where: { id: { in: safeToDelete.map((w) => w.id) } },
    });
    console.log(`Deleted ${safeToDelete.length} mock warehouse(s): ${safeToDelete.map((w) => w.location_code).join(', ')}`);
  }

  console.log('Cleanup complete.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
