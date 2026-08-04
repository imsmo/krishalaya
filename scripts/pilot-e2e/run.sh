#!/usr/bin/env bash
# scripts/pilot-e2e/run.sh
#
# ONE COMMAND to prove the Krishalaya pilot loop on a founder's own machine:
#   OTP login -> onboard farmer + buyer -> create + publish listing -> buyer orders (direct sale)
#   -> wallet credit/escrow -> payout (stub provider) -> notification recorded.
#
# Usage:
#   scripts/pilot-e2e/run.sh            # boot, seed, run the flow, tear everything down
#   scripts/pilot-e2e/run.sh --keep     # leave Postgres/Redis + the api running afterwards
#
# See scripts/pilot-e2e/README.md for prerequisites, expected output and troubleshooting.
set -euo pipefail

# ------------------------------------------------------------------------------------------------
# 0. resolve paths, parse flags
# ------------------------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

KEEP=0
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    *) echo "unknown flag: $arg (only --keep is supported)"; exit 2 ;;
  esac
done

COMPOSE_FILE="apps/api/docker-compose.dev.yml"   # postgres:16 (krishi_dev) + redis:7 — real, uncommented services.
# NOTE: the root docker-compose.yml's own postgres/redis blocks are commented out (opensearch +
# localstack only) — this script deliberately targets apps/api/docker-compose.dev.yml instead,
# which already has working postgres+redis service definitions. Not modified; just the file chosen.
API_LOG="/tmp/kv-pilot-e2e-api.log"
API_PID_FILE="/tmp/kv-pilot-e2e-api.pid"

PG_URL_OWNER="postgres://postgres:postgres@localhost:5432/krishi_dev"   # owner/superuser (bypasses RLS)
PG_URL_APP="postgres://kv_app:dev@localhost:5432/krishi_dev"            # least-privilege runtime role
PG_URL_RELAY="postgres://kv_relay:dev@localhost:5432/krishi_dev"        # BYPASSRLS relay role
REDIS_URL="redis://localhost:6379"

pass()  { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
info()  { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
warn()  { printf '\033[33m!! %s\033[0m\n' "$1"; }

API_STARTED=0
CLEANED_UP=0
cleanup() {
  if [ "$CLEANED_UP" = "1" ]; then return; fi
  CLEANED_UP=1
  if [ "$KEEP" = "1" ]; then
    warn "Skipping teardown (--keep). Postgres/Redis stay up; the api keeps running (PID $(cat "$API_PID_FILE" 2>/dev/null || echo '?'))."
    warn "Tear down manually later: kill \$(cat $API_PID_FILE); docker compose -f $COMPOSE_FILE down"
    return
  fi
  info "Tearing down (api process + docker compose)"
  if [ "$API_STARTED" = "1" ] && [ -f "$API_PID_FILE" ]; then
    kill "$(cat "$API_PID_FILE")" 2>/dev/null || true
    rm -f "$API_PID_FILE"
  fi
  docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ------------------------------------------------------------------------------------------------
# 1. prerequisite checks
# ------------------------------------------------------------------------------------------------
info "Checking prerequisites"
MISSING=0
for bin in docker node pnpm; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    fail "$bin not found on PATH"
    MISSING=1
  else
    pass "$bin found ($($bin --version 2>&1 | head -1))"
  fi
done
if ! docker compose version >/dev/null 2>&1; then
  fail "'docker compose' (v2 plugin) not available"
  MISSING=1
else
  pass "docker compose available"
fi
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node >=20 required (repo .nvmrc), found $(node --version)"
  MISSING=1
fi
if [ "$MISSING" = "1" ]; then
  echo
  echo "Install the missing tool(s) above and re-run."
  exit 1
fi

# ------------------------------------------------------------------------------------------------
# 2. boot Postgres + Redis (apps/api/docker-compose.dev.yml)
# ------------------------------------------------------------------------------------------------
info "Starting Postgres + Redis ($COMPOSE_FILE)"
docker compose -f "$COMPOSE_FILE" up -d

echo -n "  waiting for postgres to be healthy"
PG_READY=0
for i in $(seq 1 60); do
  if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
    echo " — ready"
    PG_READY=1
    break
  fi
  echo -n "."
  sleep 1
done
if [ "$PG_READY" != "1" ]; then
  echo
  fail "postgres never became ready — check: docker compose -f $COMPOSE_FILE logs postgres"
  exit 1
fi
pass "postgres up on localhost:5432 (krishi_dev)"
pass "redis up on localhost:6379"

# ------------------------------------------------------------------------------------------------
# 3. migrate -> give app roles a LOGIN -> seed (core + rules + catalogue; NOT --demo)
# ------------------------------------------------------------------------------------------------
info "Migrating schema"
MIGRATION_DATABASE_URL="$PG_URL_OWNER" pnpm migrate
pass "migrations applied"

info "Granting LOGIN to kv_app / kv_relay / kv_wallet (mirrors db/local/local-login-roles.sql; password 'dev', local-only)"
node "$SCRIPT_DIR/grant-login.mjs" "$PG_URL_OWNER"
pass "kv_app / kv_wallet / kv_relay have LOGIN"

info "Seeding core + rules + catalogue reference data (NOT --demo)"
MIGRATION_DATABASE_URL="$PG_URL_OWNER" DATABASE_URL="$PG_URL_APP" pnpm seed
pass "seed applied (core, rules, catalogue)"

# ------------------------------------------------------------------------------------------------
# 3b. FIXED in S1 (KV-BL-064): dotenv is now declared in apps/api/package.json — this block is a no-op after `pnpm install`. Kept as a safety net for stale node_modules:
#     but @krishalaya/api does not declare `dotenv` as a dependency (confirmed: not in
#     apps/api/package.json, not in the pnpm-lock.yaml importer for apps/api). With
#     shamefully-hoist=false (.npmrc), that import throws MODULE_NOT_FOUND at boot on a strict
#     pnpm install. This is a real, separate defect (flag it for the codebase, don't just paper
#     over it silently) — worked around here ONLY so this script runs today, by symlinking the
#     already-resolved dotenv package (other workspace apps depend on it) into apps/api's own
#     node_modules. No package.json is touched; this is an install-time link, not a source edit.
# ------------------------------------------------------------------------------------------------
if [ ! -e "apps/api/node_modules/dotenv" ]; then
  warn "apps/api is missing 'dotenv' (main.ts imports it, but @krishalaya/api doesn't declare it as a dependency)."
  warn "Working around it with a node_modules symlink so 'pnpm --filter api start:dev' doesn't crash on boot."
  DOTENV_SRC="$(find node_modules/.pnpm -maxdepth 1 -iname 'dotenv@*' 2>/dev/null | head -1)"
  if [ -n "$DOTENV_SRC" ]; then
    mkdir -p apps/api/node_modules
    ln -s "../../../$DOTENV_SRC/node_modules/dotenv" apps/api/node_modules/dotenv
    pass "linked apps/api/node_modules/dotenv -> $DOTENV_SRC/node_modules/dotenv"
  elif [ -e "apps/worker/node_modules/dotenv" ]; then
    mkdir -p apps/api/node_modules
    cp -RL apps/worker/node_modules/dotenv apps/api/node_modules/dotenv
    pass "copied dotenv from apps/worker/node_modules (fallback)"
  else
    fail "could not find a resolvable 'dotenv' anywhere in the workspace — run 'pnpm install' at the repo root first"
    exit 1
  fi
fi

# ------------------------------------------------------------------------------------------------
# 4. start the api in dev mode (background), wait for /v1/readyz
# ------------------------------------------------------------------------------------------------
info "Starting the api (ts-node src/main.ts — same as 'pnpm start:dev', background; log: $API_LOG)"
# Invoke apps/api's own ts-node binary directly (rather than `pnpm start:dev`) so the PID we capture
# IS the node process — a clean `kill` on teardown, no orphaned child left behind by a pnpm wrapper.
(
  cd apps/api
  DATABASE_URL="$PG_URL_APP" \
  NODE_ENV=development \
  PORT=3000 \
  JWT_ACCESS_SECRET="pilot-e2e-local-access-secret-min-32-chars" \
  JWT_REFRESH_SECRET="pilot-e2e-local-refresh-secret-min-32c" \
  AUTH_HASH_PEPPER="pilot-e2e-local-pepper-minimum-32-chars!" \
  AUTH_EXPOSE_OTP=true \
  REDIS_URL="$REDIS_URL" \
  SHARD_COUNT=1 \
  node_modules/.bin/ts-node src/main.ts >"$API_LOG" 2>&1 &
  echo $! >"$API_PID_FILE"
)
API_STARTED=1
API_PID="$(cat "$API_PID_FILE")"
echo "  api PID: $API_PID (log: $API_LOG)"

echo -n "  waiting for GET /v1/readyz"
READY=0
for i in $(seq 1 60); do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo
    fail "api process exited early — last 40 lines of $API_LOG:"
    tail -n 40 "$API_LOG" || true
    exit 1
  fi
  if curl -fsS "http://localhost:3000/v1/readyz" 2>/dev/null | grep -q '"status":"ready"'; then
    echo " — ready"
    READY=1
    break
  fi
  echo -n "."
  sleep 1
done
if [ "$READY" != "1" ]; then
  fail "api never became ready within 60s — last 40 lines of $API_LOG:"
  tail -n 40 "$API_LOG" || true
  exit 1
fi
pass "api listening on :3000, /v1/readyz reports ready"

# ------------------------------------------------------------------------------------------------
# 5. the loud S1 warning (per the S0 classification memo)
# ------------------------------------------------------------------------------------------------
cat <<'EOF'

################################################################################
#  WARNING — the outbox relay is NOT wired to run automatically.             #
#                                                                              #
#  apps/api/src/core/outbox/relay.poller.ts exports runRelay(), but nothing   #
#  in this repo calls it at runtime. apps/worker's outbox-gauge job only      #
#  MEASURES the backlog (see apps/worker/WORKER-RUNTIME.md, "Deferred:       #
#  domain-handler jobs"). Until S1 wires a permanent timer, payment_succeeded #
#  -> order confirmation, escrow release, and notification fan-out will NOT  #
#  happen on their own in this environment (dev, staging, or prod).          #
#                                                                              #
#  This E2E script works around it by invoking a manual one-shot relay tick  #
#  (scripts/pilot-e2e/relay-tick.mjs) between steps. That is a stand-in for  #
#  the local proof ONLY — S1 must make the outbox relay run continuously.    #
################################################################################

EOF

# ------------------------------------------------------------------------------------------------
# 6. run the flow
# ------------------------------------------------------------------------------------------------
info "Running the pilot flow (scripts/pilot-e2e/flow.mjs)"
set +e
DATABASE_ADMIN_URL="$PG_URL_RELAY" \
DATABASE_URL="$PG_URL_APP" \
MIGRATION_DATABASE_URL="$PG_URL_OWNER" \
PILOT_API_BASE="http://localhost:3000" \
node "$SCRIPT_DIR/flow.mjs"
FLOW_EXIT=$?
set -e

echo
if [ "$FLOW_EXIT" = "0" ]; then
  echo "================================================================"
  echo " PILOT E2E: PASS — the loop works end-to-end (with a manual relay tick)."
  echo "================================================================"
else
  echo "================================================================"
  echo " PILOT E2E: FAIL — see the step log above. api log: $API_LOG"
  echo "================================================================"
fi

exit "$FLOW_EXIT"
