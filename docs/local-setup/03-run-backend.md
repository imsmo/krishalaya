# Step 3 — Run the backend services

Each service reads a `.env` file in its own folder. We'll create those from the `.env.example` templates, but with
**exact values matched to the database + roles you set up in Step 2** (the templates have a couple of placeholder
mismatches — use the values below verbatim and you won't hit auth errors).

> Each service runs in **its own terminal tab/window** and stays running (it's a server). Open a new tab with
> `Cmd+T`. To stop a service, click its terminal and press `Ctrl+C`.

Common rule for all: run `nvm use` first in each new terminal (so it's Node 20).

---

## 3.1 The API (`apps/api`) — port 3000 — START THIS FIRST

Create `apps/api/.env` with these exact contents:
```bash
cat > apps/api/.env <<'EOF'
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://kv_app:dev@localhost:5432/krishalaya
DATABASE_POOL_MAX=20
SHARD_COUNT=1
JWT_ACCESS_SECRET=dev-secret-change-me-at-least-32-characters-long
JWT_ISSUER=krishalaya
JWT_AUDIENCE=krishalaya-app
REDIS_URL=redis://localhost:6379
# OPENSEARCH_URL=http://localhost:9200   # uncomment if you started OpenSearch
WALLET_GRPC_URL=localhost:50051
LOG_LEVEL=debug
EOF
```

Run it in dev mode (auto-reloads on code changes, no build needed):
```bash
nvm use
cd apps/api
pnpm start:dev
```
Wait for a line like `listening on :3000`. **Verify** in another terminal:
```bash
curl -s http://localhost:3000/health | jq .      # or /healthz — expect a 200 / {"status":"ok"}
curl -i http://localhost:3000/v1/listings         # 200 with data (public) — proves DB + RLS + seeds work
```

> If you see `password authentication failed for user "kv_app"` → you skipped Step 2.4 (role login). Run it.
> If you see `JWT_ACCESS_SECRET ... at least 32` → make the secret longer (the value above is already long enough).

**This is the core. With just Postgres + Redis + this API running, the minimal lane is alive.** You can now go run
the web storefront (Step 4) or mobile (Step 5). The services below are only needed for the full lane.

---

## 3.2 wallet-service (`apps/wallet-service`) — gRPC 50051 — needed for money flows

The API calls this over gRPC for anything touching money (wallet top-up, pay-from-wallet, payouts). Without it,
non-money features work fine, but money endpoints will error.

```bash
cat > apps/wallet-service/.env <<'EOF'
NODE_ENV=development
GRPC_PORT=50051
DATABASE_URL=postgres://kv_wallet:dev@localhost:5432/krishalaya
HOT_ACCOUNT_STRIPES=16
EOF
```
```bash
nvm use
cd apps/wallet-service
pnpm start:dev
```
**Verify:** the log says it's listening on `:50051`. (It's gRPC, not HTTP — `curl` won't help; the API connecting
to it on a money call is the real test. `grpcurl -plaintext localhost:50051 list` works if you installed grpcurl.)

> Note the **different DB user** (`kv_wallet`) — on purpose; it's the only role allowed to write the ledger.

---

## 3.3 worker (`apps/worker`) — no port — recommended

Runs the scheduled/background jobs (booking expiry, review prompts, payout batches, partition upkeep, etc.). The
API works without it, but timed behaviour won't fire.

```bash
cat > apps/worker/.env <<'EOF'
NODE_ENV=development
DATABASE_URL=postgres://kv_relay:dev@localhost:5432/krishalaya
REDIS_URL=redis://localhost:6379
EOF
```
> The worker runs the outbox relay + cross-tenant sweeps, so it uses the `kv_relay` (BYPASSRLS) role, not `kv_app`.
```bash
nvm use
cd apps/worker
pnpm dev
```
**Verify:** logs show it polling (e.g. "relay tick" / job scheduler started). No HTTP endpoint.

---

## 3.4 admin-api (`apps/admin-api`) — port 4001 — only for web-admin

The separate "god-mode" ops API. Only needed if you want to run **web-admin** (Step 4).
```bash
cat > apps/admin-api/.env <<'EOF'
NODE_ENV=development
ADMIN_PORT=4001
DATABASE_URL=postgres://kv_app:dev@localhost:5432/krishalaya
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=dev-secret-change-me-at-least-32-characters-long
JWT_ISSUER=krishalaya-admin
JWT_AUDIENCE=krishalaya-admin
EOF
```
```bash
nvm use
cd apps/admin-api
pnpm start:dev
```
**Verify:** `curl -s http://localhost:4001/health` (or `/healthz`) returns ok.

---

## 3.5 realtime-gateway (`apps/realtime-gateway`) — WebSocket 8090 — optional

Live bid/order updates over WebSocket. Needs Redis. **The `JWT_ACCESS_SECRET` and `JWT_ISSUER`/`JWT_AUDIENCE` must
match the API's exactly** (it verifies the same tokens).
```bash
cat > apps/realtime-gateway/.env <<'EOF'
NODE_ENV=development
REALTIME_PORT=8090
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=dev-secret-change-me-at-least-32-characters-long
JWT_ISSUER=krishalaya
JWT_AUDIENCE=krishalaya-app
RT_MAX_SUBSCRIPTIONS=50
RT_MAX_BUFFERED_BYTES=1000000
RT_MAX_QUEUED_MESSAGES=100
EOF
```
```bash
nvm use
cd apps/realtime-gateway
pnpm start:dev
```
**Verify:** `curl -s http://localhost:8090/healthz` returns ok. (Real WebSocket testing happens from the app.)

> For realtime to actually push events, the API/worker must publish them — that path is behind the `realtime_fanout`
> feature flag (off by default). Leave it off unless you're specifically testing realtime.

---

## 3.6 ai-services (`apps/ai-services`) — Python FastAPI 8000 — optional

Price bands / photo grading / fraud signals. This is **Python**, not Node. Set it up in its own folder:
```bash
cd apps/ai-services
python3.11 -m venv .venv               # create an isolated Python environment
source .venv/bin/activate              # activate it (your prompt shows (.venv))
pip install -e .                       # install from pyproject.toml (fastapi, uvicorn, ...)
```
Create its `.env`:
```bash
cat > .env <<'EOF'
APP_ENV=development
API_SHARED_SECRET=dev-shared-secret-at-least-32-characters-long-xx
INFERENCE_LOG_DB_URL=postgres://kv_relay:dev@localhost:5432/krishalaya
AI_HTTP_TIMEOUT_MS=8000
AI_REQUEST_MAX_BYTES=262144
EOF
```
Run it (FastAPI app is `src/main.py` → `app`):
```bash
set -a && source .env && set +a        # load .env into the shell
uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
```
**Verify:** `curl -s http://localhost:8000/healthz` (or open <http://localhost:8000/health>) returns ok.

> Model provider keys (`ANTHROPIC_API_KEY`, `GOOGLE_STT_KEY`) are intentionally left blank — those paths
> "degrade to needs_review" without keys, which is the correct, safe behaviour. The service still runs.
> When done: `deactivate` leaves the Python venv.

---

## 3.7 Which services do I actually need?

- **Just exploring / web + mobile:** API (3.1) only. ✅
- **Money flows (wallet, payouts, pay-from-wallet):** API + wallet-service (3.2).
- **Timed behaviour (expiries, reminders):** add worker (3.3).
- **web-admin console:** add admin-api (3.4).
- **Live updates / AI:** add realtime-gateway (3.5) / ai-services (3.6).
- **Skip entirely for local:** outbox-relay, stream-processor (needs Kafka), analytics-pipeline (needs
  ClickHouse), ivr-ussd-gateway, whatsapp-bot. These are Phase-2 / external-dependency services.

Backend up? Continue to **`04-run-web.md`**.
