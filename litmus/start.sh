#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# LITMUS — one-shot local dev startup
# Usage:  ./start.sh          (starts everything)
#         ./start.sh --reset  (drops + recreates DB then starts)
# ─────────────────────────────────────────────────────────────────────────────
set -e
RESET=false
[[ "${1:-}" == "--reset" ]] && RESET=true

LITMUS_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$LITMUS_DIR"

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${CYAN}▶ $*${NC}"; }
ok()    { echo -e "${GREEN}✓ $*${NC}"; }
warn()  { echo -e "${YELLOW}⚠ $*${NC}"; }
die()   { echo -e "${RED}✗ $*${NC}"; exit 1; }

# ── 1. Node ───────────────────────────────────────────────────────────────────
info "Checking Node.js..."
node -v &>/dev/null || die "Node.js not found. Install Node 18+ from https://nodejs.org"
NODE_MAJOR=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
(( NODE_MAJOR >= 18 )) || die "Node 18+ required (found v${NODE_MAJOR})"
ok "Node $(node -v)"

# ── 2. PostgreSQL ─────────────────────────────────────────────────────────────
info "Checking PostgreSQL..."
if ! command -v psql &>/dev/null; then
  die "PostgreSQL not found. Install: https://www.postgresql.org/download/"
fi
if ! pg_isready -q 2>/dev/null; then
  warn "PostgreSQL not running — attempting to start..."
  # macOS Homebrew
  if command -v brew &>/dev/null && brew list postgresql@16 &>/dev/null; then
    brew services start postgresql@16
  elif command -v brew &>/dev/null && brew list postgresql &>/dev/null; then
    brew services start postgresql
  # Ubuntu / Debian
  elif command -v pg_ctlcluster &>/dev/null; then
    PG_VER=$(pg_lsclusters -h | awk '{print $1}' | head -1)
    pg_ctlcluster "$PG_VER" main start
  elif command -v systemctl &>/dev/null; then
    sudo systemctl start postgresql
  else
    die "Cannot start PostgreSQL automatically. Please start it manually."
  fi
  sleep 3
  pg_isready -q || die "PostgreSQL still not responding"
fi
ok "PostgreSQL is running"

# ── 3. Redis ──────────────────────────────────────────────────────────────────
info "Checking Redis..."
if ! redis-cli ping &>/dev/null; then
  warn "Redis not running — attempting to start..."
  if command -v brew &>/dev/null && brew list redis &>/dev/null; then
    brew services start redis
  elif command -v systemctl &>/dev/null; then
    sudo systemctl start redis-server 2>/dev/null || sudo systemctl start redis 2>/dev/null
  elif command -v redis-server &>/dev/null; then
    redis-server --daemonize yes --logfile /tmp/redis-litmus.log
  else
    die "Redis not found. Install: https://redis.io/download"
  fi
  sleep 2
  redis-cli ping &>/dev/null || die "Redis still not responding"
fi
ok "Redis is running"

# ── 4. .env ───────────────────────────────────────────────────────────────────
ENV_FILE="$LITMUS_DIR/server/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  info "Creating server/.env from example..."
  cp "$LITMUS_DIR/server/.env.example" "$ENV_FILE" 2>/dev/null || \
  cat > "$ENV_FILE" <<'ENVEOF'
DATABASE_URL="postgresql://litmus:litmus_dev_pass@localhost:5432/litmus_db"
REDIS_URL="redis://localhost:6379"
JWT_ACCESS_SECRET="dev-access-secret-change-in-production-32c"
JWT_REFRESH_SECRET="dev-refresh-secret-change-in-production-32c"
JWT_ACCESS_EXPIRY="15m"
JWT_REFRESH_EXPIRY="7d"
PORT=3001
NODE_ENV=development
CLIENT_URL="http://localhost:5173"
STORAGE_BACKEND=local
SYNC_INTERVAL_MINUTES=30
OCR_ENABLED=false
LOGIN_RATE_LIMIT_MAX=100
LOGIN_RATE_LIMIT_WINDOW_MS=60000
ENVEOF
  ok "Created server/.env"
fi

# ── 5. Database ───────────────────────────────────────────────────────────────
info "Setting up database..."
DB_URL=$(grep DATABASE_URL "$ENV_FILE" | cut -d'"' -f2 | cut -d'=' -f2-)
DB_USER=$(echo "$DB_URL" | sed 's|postgresql://||' | cut -d':' -f1)
DB_PASS=$(echo "$DB_URL" | sed 's|postgresql://[^:]*:||' | cut -d'@' -f1)
DB_NAME=$(echo "$DB_URL" | rev | cut -d'/' -f1 | rev)

# Create role if missing
if ! psql -U postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" 2>/dev/null | grep -q 1; then
  psql -U postgres -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || \
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';" 2>/dev/null || true
fi

# Create database if missing
if ! psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null | grep -q 1; then
  psql -U postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || \
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;" 2>/dev/null || true
fi

if $RESET; then
  warn "--reset: dropping and recreating schema..."
  cd "$LITMUS_DIR/server" && npx prisma db push --force-reset --skip-generate
fi
ok "Database ready"

# ── 6. Install dependencies ───────────────────────────────────────────────────
if [[ ! -d "$LITMUS_DIR/node_modules" ]]; then
  info "Installing npm dependencies (first time — takes ~1 min)..."
  cd "$LITMUS_DIR" && npm install
fi

# ── 7. Prisma push + generate ─────────────────────────────────────────────────
info "Syncing Prisma schema..."
cd "$LITMUS_DIR/server"
npx prisma db push --skip-generate 2>&1 | grep -E "Your|All|The|Error" | head -5 || true
npx prisma generate 2>&1 | tail -2

# ── 8. Seed (skip if data exists) ─────────────────────────────────────────────
SEED_CHECK=$(cd "$LITMUS_DIR/server" && npx prisma db execute --stdin <<'SQL' 2>/dev/null
SELECT COUNT(*)::text FROM users;
SQL
)
if [[ "${SEED_CHECK:-0}" == "0" ]] || $RESET; then
  info "Seeding database..."
  cd "$LITMUS_DIR/server" && npx ts-node --project tsconfig.json prisma/seed.ts
fi

# ── 9. Launch ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  LITMUS is starting...${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${CYAN}App:${NC}    http://localhost:5173"
echo -e "  ${CYAN}API:${NC}    http://localhost:3001"
echo ""
echo -e "  ${YELLOW}Credentials:${NC}"
echo -e "    ops_user   / password123  (scanner)"
echo -e "    admin_user / password123  (admin)"
echo ""
echo -e "  Press ${BOLD}Ctrl+C${NC} to stop all services"
echo ""

cd "$LITMUS_DIR"
exec npm run dev
