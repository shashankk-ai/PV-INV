# LITMUS — Physical Verification App

Scimplify's warehouse physical verification system. Ops teams scan inventory on mobile; admins reconcile against system data.

---

## Quick Start

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 18+ | https://nodejs.org |
| PostgreSQL | 14+ | https://www.postgresql.org/download |
| Redis | 6+ | https://redis.io/download |

### Run locally

```bash
# 1. Clone and enter
git clone https://github.com/shashankk-ai/pv-inv.git
cd pv-inv/litmus

# 2. Start everything (handles deps, DB setup, seed, and both servers)
./start.sh
```

Open **http://localhost:5173** in your browser.

| Account | Password | Access |
|---|---|---|
| `ops_user` | `password123` | Scanner (mobile) |
| `admin_user` | `password123` | Admin dashboard |

> **First run** installs npm packages — takes ~1 minute.  
> **Reset DB** run `./start.sh --reset`

---

## Manual startup (if start.sh doesn't work)

```bash
# Terminal 1 — backend
cd litmus/server
cp .env.example .env          # edit DATABASE_URL / REDIS_URL if needed
npx prisma db push
npx ts-node prisma/seed.ts
npm run dev

# Terminal 2 — frontend
cd litmus/client
npm run dev
```

---

## Project layout

```
litmus/
├── client/          React 18 + Vite + Tailwind PWA
├── server/          Express + TypeScript + Prisma
│   ├── prisma/      schema.prisma + seed.ts
│   └── src/
│       ├── routes/  auth, sessions, entries, admin, reconciliation,
│       │            dataUpload, items, photos, ocr
│       └── services/ ZohoAnalyticsClient, DataSyncService, redis, prisma
└── shared/          Zod schemas + TypeScript types
```

---

## Admin features

### Data tab — upload inventory baseline
1. Go to **Admin → Data**
2. Drop an `.xlsx` or `.csv` file
3. Review auto-detected column mapping (item key, name, qty, warehouse, UOM)
4. Confirm → file becomes the PV comparison baseline

Supported column names (detected automatically):

| Field | Recognised as |
|---|---|
| Item Key | `item_key`, `sku`, `code`, `item code`, `part no`, `material code` |
| Item Name | `item_name`, `name`, `description`, `chemical name`, `product name` |
| Warehouse | `warehouse`, `location`, `location code`, `site`, `plant` |
| Quantity | `quantity`, `qty`, `stock`, `available`, `on hand` |
| UOM | `uom`, `unit`, `unit of measure` |
| CAS No | `cas`, `cas number`, `cas no` |

### Team tab — user management
- View all users with today's session/scan counts
- **Add User** — set username, password, role (Ops / Admin)
- Delete users (cannot delete your own account)

### Truth Report
Go to **Admin → Overview → View Report** for any warehouse.  
Compares system quantities (from Zoho or uploaded file) against scanned quantities.  
Export as CSV or print as PDF.

---

## Zoho Analytics integration

Fill in `server/.env` to pull live data instead of mock:

```env
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REFRESH_TOKEN=      # generate once via api-console.zoho.in → Self Client
ZOHO_ORG_ID=
ZOHO_ITEMS_VIEW_ID=      # Zoho view with item_key, item_name, cas_number, uom_options
ZOHO_INVENTORY_VIEW_ID=  # Zoho view with warehouse_id, item_key, quantity, uom
ZOHO_ACCOUNTS_URL=https://accounts.zoho.in   # or .com for US/EU
ZOHO_API_BASE=https://analyticsapi.zoho.in/restapi/v2
```

Leave blank to use the built-in mock data or an uploaded file.

---

## Production deploy

```bash
docker compose -f docker-compose.prod.yml up -d
```

Requires Docker. Spins up PostgreSQL 16, Redis 7, the Node server, and nginx serving the built client.
