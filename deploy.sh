#!/bin/bash
set -e

BRANCH="claude/point-to-litmus-pr-cEabO"
ENV_FILE="/opt/litmus/.env"
REPO="https://github.com/shashankk-ai/PV-INV.git"
APP_DIR="/home/ec2-user/PV-INV"
PRISMA="$APP_DIR/litmus/node_modules/.bin/prisma"
TSX="$APP_DIR/litmus/node_modules/.bin/tsx"

# ── 1. Clone or pull ──────────────────────────────────────
if [ -d "$APP_DIR/.git" ]; then
  echo "==> Pulling latest..."
  cd "$APP_DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git reset --hard FETCH_HEAD
else
  echo "==> Cloning..."
  git clone "$REPO" "$APP_DIR"
  cd "$APP_DIR"
  git checkout "$BRANCH"
fi

# ── 2. Install all workspace dependencies ─────────────────
echo "==> Installing dependencies..."
cd "$APP_DIR/litmus"
npm install

# ── 3. Prisma: push schema + generate client ──────────────
echo "==> Running Prisma migrations..."
sudo bash -c "
  set -a; source $ENV_FILE; set +a
  cd $APP_DIR/litmus/server
  $PRISMA db push --accept-data-loss
  $PRISMA generate
"

# ── 4. Clean up mock/seed data (safe — idempotent) ────────
echo "==> Removing mock seed data..."
sudo bash -c "
  set -a; source $ENV_FILE; set +a
  cd $APP_DIR/litmus/server
  $TSX prisma/cleanup-mock-data.ts
"

# ── 5. Build React client ─────────────────────────────────
echo "==> Building client..."
cd "$APP_DIR/litmus"
npm run build --workspace=client

# ── 6. Start or restart PM2 ───────────────────────────────
echo "==> Restarting server..."
if sudo bash -c "set -a; source $ENV_FILE; set +a; pm2 describe litmus-server" > /dev/null 2>&1; then
  sudo bash -c "set -a; source $ENV_FILE; set +a; pm2 restart litmus-server"
else
  sudo bash -c "set -a; source $ENV_FILE; set +a; pm2 start --name litmus-server 'npx tsx src/index.ts'"
fi
sudo pm2 save

echo ""
echo "✓ Deploy complete"
echo "  → Open in INCOGNITO to bypass PWA cache"
echo "  → Re-upload your WH025 inventory file to refresh system data"
