# 00 — My local runbook (own Postgres, env pre-filled)

This is the **fast path for THIS machine**. All `.env` files are already created for you (see the list at the
bottom). It differs from `02`/`03` in one way: you use **your own local Postgres** (`sanjayodedra`) as the DB owner
instead of the docker `postgres:dev`. The app still connects as the least-privilege `kv_app` role (RLS-enforced).

Run everything from the repo root:
```bash
cd /Users/sanjayodedra/Documents/Personal/farmer/krishalaya
```

---

## 0. One-time prerequisites (your machine)

```bash
# Your local Postgres must be running and your role must be a superuser (or have CREATEROLE+CREATEDB),
# because migrations create the kv_app / kv_wallet / kv_relay roles + RLS policies.
psql "postgres://sanjayodedra:Postgres%404958@localhost:5432/postgres" -c "select rolsuper from pg_roles where rolname=current_user;"
#   rolsuper = t  → good.   (If 'f', grant: ALTER ROLE sanjayodedra SUPERUSER;  as a superuser.)

# Create the database (skip if it already exists):
createdb -U sanjayodedra krishiverse 2>/dev/null || \
  psql "postgres://sanjayodedra:Postgres%404958@localhost:5432/postgres" -c "CREATE DATABASE krishiverse;"

# Redis must be running on localhost:6379 (Homebrew: `brew services start redis`, or `docker compose up -d redis`).
redis-cli ping   # → PONG
```

> ⚠️ The `@` in your password MUST be written as `%40` inside any connection URL (it already is, everywhere here).

---

## 1. Build the shared packages (once)

The apps import `@krishalaya/sdk-js`, `tokens`, `i18n` — build them first. Dev mode (`start:dev`) needs no other build.
```bash
nvm use
pnpm --filter @krishalaya/sdk-js --filter @krishalaya/tokens --filter @krishalaya/i18n build
# (Optional, slower) build everything: pnpm build
```

---

## 2. Migrate → give roles a login → seed

```bash
# (a) migrations run as the OWNER (your superuser). This is already in root .env as MIGRATION_DATABASE_URL,
#     but export it explicitly so the runner picks it up:
export MIGRATION_DATABASE_URL="postgres://sanjayodedra:Postgres%404958@localhost:5432/krishiverse"
pnpm migrate
pnpm migrate:status        # everything should be "applied" (0001 … 0048)

# (b) give the app roles a LOGIN (password 'dev' — matches every app .env). Run as your owner:
psql "postgres://sanjayodedra:Postgres%404958@localhost:5432/krishiverse" -f db/local/local-login-roles.sql
#   confirm rolcanlogin = t for kv_app, kv_relay, kv_wallet

# (c) seed reference + demo data:
pnpm seed
pnpm seed:demo
```

**Verify the DB layer:**
```bash
psql "postgres://kv_app:dev@localhost:5432/krishiverse" -c "select current_user;"   # → kv_app  ✅
```

---

## 3. Run the services (each in its own terminal tab; `nvm use` first)

| Need | Service | Command | Verify |
|---|---|---|---|
| **core** | API | `cd apps/api && pnpm start:dev` | `curl localhost:3000/health` → ok; `curl localhost:3000/v1/listings` → data |
| money | wallet-service | `cd apps/wallet-service && pnpm start:dev` | log: listening `:50051` |
| timed jobs | worker | `cd apps/worker && pnpm dev` | log: relay/scheduler ticking |
| web-admin only | admin-api | `cd apps/admin-api && pnpm start:dev` | `curl localhost:4001/health` |
| live updates | realtime-gateway | `cd apps/realtime-gateway && pnpm start:dev` | `curl localhost:8090/healthz` |
| AI (Python) | ai-services | see `03-run-backend.md §3.6` (venv + uvicorn :8000) | `curl localhost:8000/healthz` |

**Minimal lane = just the API.** That alone proves DB + RLS + seeds end-to-end.

Web apps (each `pnpm dev` in its folder): web-storefront :3001-ish, web-tenant, web-admin (needs admin-api), web-partner.
Mobile: `cd apps/mobile && pnpm start` (Expo). On a physical phone, edit `apps/mobile/.env` → replace `localhost`
with your Mac's LAN IP.

---

## 4. What was pre-filled for you

Created (gitignored — your secrets stay local):
`.env` (root), `apps/api/.env`, `apps/wallet-service/.env`, `apps/worker/.env`, `apps/admin-api/.env`,
`apps/realtime-gateway/.env`, `apps/ai-services/.env`, `apps/web-{storefront,tenant,admin,partner}/.env.local`,
`apps/mobile/.env`.

- DB owner (migrations/seeds): `sanjayodedra` / `Postgres@4958` (encoded `%40`), database `krishiverse`.
- Apps connect as `kv_app` / `kv_wallet` / `kv_relay`, password `dev` (set in step 2b).
- `JWT_ACCESS_SECRET` and the ai-services `AI_SERVICES_SHARED_SECRET` are strong random dev values, shared across the
  services that must agree (API ↔ realtime-gateway ↔ ai-services).
- Redis `redis://localhost:6379`. OpenSearch optional (API falls back to Postgres search if it's not running).
- **SMTP (your Gmail)** is saved in root `.env` but **no code consumes it yet** — email isn't a wired channel in
  Phase-1. It's there for when it lands. (OTP in dev prints to the API log; no SMS/email provider needed to log in.)
- External provider keys (Razorpay/MSG91/Anthropic/etc.) are left blank/test — those paths **degrade safely**
  (e.g. OTP via server log, payments need real test keys to round-trip). Add real keys only for the flows you test.

---

## 5. If something fails

- `password authentication failed for user "kv_app"` or `role "kv_app" is not permitted to log in` → you skipped
  **step 2b** (`local-login-roles.sql`). Run it.
- `database "krishiverse" does not exist` → step 0 (create it).
- `permission denied to create role` during migrate → your `sanjayodedra` isn't a superuser; see step 0.
- `JWT_ACCESS_SECRET ... at least 32` → won't happen (the generated value is long), but if you edit it, keep ≥32 chars.
- Anything else → `docs/local-setup/07-troubleshooting.md`.
