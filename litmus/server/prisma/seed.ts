import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const WAREHOUSES = [
  { name: 'Mumbai Central Warehouse', location_code: 'MUM-CW-01' },
  { name: 'Hyderabad Distribution Center', location_code: 'HYD-DC-01' },
  { name: 'Bengaluru Storage Facility', location_code: 'BLR-SF-01' },
];

const CHEMICALS = [
  { item_key: 'SCI001', item_name: 'Profenofos', uom_options: ['L', 'KG'] },
  { item_key: 'SCI002', item_name: 'Chlorpyrifos', uom_options: ['L', 'KG'] },
  { item_key: 'SCI003', item_name: 'Imidacloprid', uom_options: ['KG', 'G'] },
  { item_key: 'SCI004', item_name: 'Cypermethrin', uom_options: ['L', 'KG'] },
  { item_key: 'SCI005', item_name: 'Lambda-Cyhalothrin', uom_options: ['L', 'KG'] },
  { item_key: 'SCI006', item_name: 'Acephate', uom_options: ['KG', 'G'] },
  { item_key: 'SCI007', item_name: 'Fipronil', uom_options: ['KG', 'L'] },
  { item_key: 'SCI008', item_name: 'Thiamethoxam', uom_options: ['KG', 'G'] },
  { item_key: 'SCI009', item_name: 'Abamectin', uom_options: ['L', 'KG'] },
  { item_key: 'SCI010', item_name: 'Hexaconazole', uom_options: ['L', 'KG'] },
  { item_key: 'SCI011', item_name: 'Propiconazole', uom_options: ['L', 'KG'] },
  { item_key: 'SCI012', item_name: 'Tebuconazole', uom_options: ['L', 'KG'] },
  { item_key: 'SCI013', item_name: 'Mancozeb', uom_options: ['KG', 'G'] },
  { item_key: 'SCI014', item_name: 'Carbendazim', uom_options: ['KG', 'L'] },
  { item_key: 'SCI015', item_name: 'Difenoconazole', uom_options: ['L', 'KG'] },
  { item_key: 'SCI016', item_name: 'Metalaxyl', uom_options: ['KG', 'G'] },
  { item_key: 'SCI017', item_name: 'Azoxystrobin', uom_options: ['KG', 'L'] },
  { item_key: 'SCI018', item_name: 'Emamectin Benzoate', uom_options: ['KG', 'G'] },
  { item_key: 'SCI019', item_name: 'Spinosad', uom_options: ['L', 'KG'] },
  { item_key: 'SCI020', item_name: 'Indoxacarb', uom_options: ['KG', 'G'] },
  { item_key: 'SCI021', item_name: 'Novaluron', uom_options: ['L', 'KG'] },
  { item_key: 'SCI022', item_name: 'Buprofezin', uom_options: ['KG', 'G'] },
  { item_key: 'SCI023', item_name: 'Pyriproxyfen', uom_options: ['L', 'KG'] },
  { item_key: 'SCI024', item_name: 'Diafenthiuron', uom_options: ['KG', 'G'] },
  { item_key: 'SCI025', item_name: 'Spiromesifen', uom_options: ['L', 'KG'] },
  { item_key: 'SCI026', item_name: 'Trifloxystrobin', uom_options: ['KG', 'G'] },
  { item_key: 'SCI027', item_name: 'Kasugamycin', uom_options: ['L', 'KG'] },
  { item_key: 'SCI028', item_name: 'Validamycin', uom_options: ['L', 'KG'] },
  { item_key: 'SCI029', item_name: 'Cartap Hydrochloride', uom_options: ['KG', 'G'] },
  { item_key: 'SCI030', item_name: 'Glyphosate', uom_options: ['L', 'KG'] },
];

const randomQty = () => Math.floor(Math.random() * 4950) + 50;

async function main() {
  console.log('🌱 Seeding LITMUS database...');

  const warehouses = await Promise.all(
    WAREHOUSES.map((w) =>
      prisma.warehouse.upsert({
        where: { location_code: w.location_code },
        update: {},
        create: w,
      })
    )
  );
  console.log(`✅ ${warehouses.length} warehouses seeded`);

  const opsHash = await bcrypt.hash('password123', 12);
  const adminHash = await bcrypt.hash('password123', 12);

  await prisma.user.upsert({
    where: { username: 'ops_user' },
    update: {},
    create: { username: 'ops_user', password: opsHash, role: 'ops' },
  });
  await prisma.user.upsert({
    where: { username: 'admin_user' },
    update: {},
    create: { username: 'admin_user', password: adminHash, role: 'admin' },
  });
  console.log('✅ 2 users seeded (ops_user, admin_user) — password: password123');

  for (const warehouse of warehouses) {
    for (const chem of CHEMICALS) {
      await prisma.systemInventoryCache.upsert({
        where: { item_key_warehouse_id: { item_key: chem.item_key, warehouse_id: warehouse.id } },
        update: {},
        create: {
          item_key: chem.item_key,
          item_name: chem.item_name,
          warehouse_id: warehouse.id,
          quantity: randomQty(),
          uom: chem.uom_options[0],
          uom_options: chem.uom_options,
        },
      });
    }
  }
  console.log(`✅ ${CHEMICALS.length * warehouses.length} inventory cache records seeded`);
  console.log('🏁 Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
