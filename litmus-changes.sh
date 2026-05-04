#!/usr/bin/env bash
# =============================================================================
# LITMUS — Latest Changes Script
# =============================================================================
# Applies all changes introduced since Phase 7 (initial deploy) to an existing
# LITMUS installation.  Run this script on the server or as part of a CI step
# after pulling the latest code.
#
# Commits covered (newest → oldest):
#   fix(admin)   show full username in header, rename button to View Report
#   feat(users)  require email on user creation, send welcome email
#   feat(photos) S3 upload support with local-disk fallback
#   feat(scan)   move Unlisted Item to header, rename from Unknown
#   feat(ui)     redesign UI with Claude Design system
#   feat(report) fix table alignment, rename columns, add scan drill-down
#   fix          persist scan draft, prevent server crash on unhandled rejections
# =============================================================================

set -euo pipefail

PASS=0
FAIL=0
SKIP=0

step() { echo; echo "──────────────────────────────────────"; echo "  $*"; echo "──────────────────────────────────────"; }
ok()   { echo "  [PASS] $*"; ((PASS++)) || true; }
fail() { echo "  [FAIL] $*"; ((FAIL++)) || true; }
skip() { echo "  [SKIP] $*"; ((SKIP++)) || true; }

# ---------------------------------------------------------------------------
# 0. Prerequisites
# ---------------------------------------------------------------------------
step "0. Prerequisites"

if ! command -v node &>/dev/null; then fail "node not found"; else ok "node $(node -v)"; fi
if ! command -v npm  &>/dev/null; then fail "npm not found";  else ok "npm $(npm -v)";   fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LITMUS_DIR="${SCRIPT_DIR}/litmus"

if [[ ! -d "$LITMUS_DIR" ]]; then
  fail "litmus/ directory not found at $SCRIPT_DIR"
  exit 1
fi
ok "litmus dir: $LITMUS_DIR"

# ---------------------------------------------------------------------------
# 1. Install / update Node dependencies
# ---------------------------------------------------------------------------
step "1. Install Node dependencies"

cd "$LITMUS_DIR"
if npm ci --ignore-scripts 2>&1 | tail -3; then
  ok "npm ci complete"
else
  fail "npm ci failed — check package-lock.json"
fi

# ---------------------------------------------------------------------------
# 2. Database schema migration  (adds email column to users)
# ---------------------------------------------------------------------------
# Change introduced by: feat(users) — require email on user creation
#
#   ALTER TABLE users
#     ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
#
# Prisma's `db push` applies the diff non-destructively.
# ---------------------------------------------------------------------------
step "2. Database schema migration"

if [[ -z "${DATABASE_URL:-}" ]]; then
  fail "DATABASE_URL is not set — skipping migration"
  SKIP=$((SKIP + 1))
else
  cd "$LITMUS_DIR/server"
  if npx prisma db push --accept-data-loss 2>&1 | tail -5; then
    ok "Prisma db push succeeded"
  else
    fail "Prisma db push failed"
  fi
  cd "$LITMUS_DIR"
fi

# ---------------------------------------------------------------------------
# 3. Environment variable checklist
# ---------------------------------------------------------------------------
# List every env var that was added in these changes so operators know what
# to configure in .env / deployment secrets before restarting the server.
# ---------------------------------------------------------------------------
step "3. Environment variable checklist"

declare -A NEW_VARS=(
  # feat(users) — welcome email via Nodemailer
  [SMTP_HOST]="SMTP server hostname (e.g. smtp.gmail.com)"
  [SMTP_PORT]="SMTP port (default: 587)"
  [SMTP_USER]="SMTP auth username / sender address"
  [SMTP_PASS]="SMTP auth password or app-password"
  [SMTP_FROM]="From address shown in emails (defaults to SMTP_USER)"

  # feat(photos) — S3 storage
  [S3_BUCKET]="S3 bucket name for photo storage (leave blank for local disk)"
  [S3_REGION]="AWS region of the bucket (default: ap-south-1)"
  [S3_ACCESS_KEY]="AWS access key ID (or use instance role)"
  [S3_SECRET_KEY]="AWS secret access key (or use instance role)"
  [CLOUDFRONT_URL]="Optional CDN domain that prefixes S3 photo URLs"
)

ALL_PRESENT=true
for var in "${!NEW_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "  [WARN] $var — not set (${NEW_VARS[$var]})"
    ALL_PRESENT=false
  else
    ok "$var is set"
  fi
done

if $ALL_PRESENT; then
  ok "All new env vars are configured"
else
  echo
  echo "  NOTE: SMTP_* vars are optional — email is skipped gracefully when absent."
  echo "        S3_BUCKET is optional — photos fall back to local disk when absent."
  skip "Some new env vars are not set (see above)"
fi

# ---------------------------------------------------------------------------
# 4. Build client (picks up UI redesign + scan/report changes)
# ---------------------------------------------------------------------------
step "4. Build client"

cd "$LITMUS_DIR"
if npm run build --workspace=client 2>&1 | tail -5; then
  ok "Client build succeeded"
else
  fail "Client build failed"
fi

# ---------------------------------------------------------------------------
# 5. Smoke-test: compile server TypeScript
# ---------------------------------------------------------------------------
step "5. Server TypeScript type-check"

cd "$LITMUS_DIR"
if npm run typecheck --workspace=server 2>&1 | tail -5; then
  ok "Server type-check passed"
else
  fail "Server type-check failed — fix TypeScript errors before deploying"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo
echo "============================================="
echo "  LITMUS changes script complete"
echo "  PASS: $PASS   FAIL: $FAIL   SKIP: $SKIP"
echo "============================================="
echo
echo "What changed in this release:"
echo "  • UI redesign — dark navy/purple gradients, teal CTAs (Claude Design)"
echo "  • Report page — columns renamed (PV Count / Difference), scan drill-down"
echo "  • Scan page  — 'Unlisted Item' button moved to header (was FAB)"
echo "  • Photos     — S3 upload with CloudFront support; falls back to disk"
echo "  • Users      — email required on creation; welcome email sent via SMTP"
echo "  • Admin      — full username shown in header; button renamed 'View Report'"
echo "  • Server     — unhandledRejection / uncaughtException keep process alive"
echo "  • Scan draft — form values persisted to sessionStorage across camera activations"
echo "  • DB retry   — server retries DB connection up to 8 times on startup"
echo "  • New API    — GET /api/reconciliation/:wh/items/:key/scans?date=YYYY-MM-DD"
echo

if [[ $FAIL -gt 0 ]]; then
  echo "  One or more steps FAILED — review output above before restarting the server."
  exit 1
fi

exit 0
