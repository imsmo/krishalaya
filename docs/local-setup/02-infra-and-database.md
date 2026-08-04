# Step 2 — Infrastructure + Database

Now we'll: get the code installed, start the Docker services, create the database structure (migrations), give the
DB roles a login, and load the reference data (seeds). **Read the callouts — the DB-role part is where most people
get stuck, and this guide removes that trap.**

All commands run from the **repo root** unless stated. The repo root is the folder that contains
`package.json`, `docker-compose.yml`, and the `apps/` folder. Get there:
```bash
cd /Users/sanjayodedra/Documents/Personal/farmer/krishalaya
```

---

## 2.1 Install all workspace dependencies (once)

```bash
nvm use            # switches to Node 20 (reads .nvmrc)
pnpm install       # installs every app + package in the monorepo (takes a few minutes the first time)
```

**Build the shared packages once** so the apps can import them (`@krishalaya/sdk-js`, tokens, i18n, etc.):
```bash
pnpm build
```
> This runs `turbo build` across the repo. The first run is slow; later runs are cached and fast. If it fails on an
> *optional* app you don't care about (e.g. stream-processor needing Kafka types), that's fine — the core
> (`api`, `sdk-js`, web apps) is what matters. You can also build just what you need:
> `pnpm --filter @krishalaya/sdk-js --filter @krishalaya/tokens --filter @krishalaya/i18n build`.

---

## 2.2 Start the infrastructure (Postgres, Redis, OpenSearch, LocalStack)

The repo ships a ready `docker-compose.yml` at the root. Start it:
```bash
docker compose up -d
```
`-d` = run in the background. Check they're healthy:
```bash
docker compose ps
```
You should see `postgres`, `redis`, `opensearch`, `localstack` all "Up".

> **Minimal lane:** you only strictly need **postgres** and **redis**. If OpenSearch/LocalStack are heavy on your
> machine you can start just the two: `docker compose up -d postgres redis`. The API degrades gracefully without
> OpenSearch (falls back to Postgres search) and without S3 (media upload just won't have a real bucket).

**What this gives you (from `docker-compose.yml`):**
- Postgres 16 on **localhost:5432**, superuser **`postgres`**, password **`dev`**, database **`krishalaya`**.
- Redis 7 on **localhost:6379**.

**Verify Postgres is reachable** (needs the `psql` client from step 1.8; if you skipped it, skip this check):
```bash
psql "postgres://postgres:dev@localhost:5432/krishalaya" -c "select version();"
```

---

## 2.3 Set the migration connection + run migrations

Migrations create the ~250 tables, enums, functions, RLS policies, **and the application roles**. They run as the
database **owner** (here: the `postgres` superuser). Point the runner at it:

```bash
export MIGRATION_DATABASE_URL="postgres://postgres:dev@localhost:5432/krishalaya"
pnpm migrate
```

Watch it apply `0001 … 0048` in order. Confirm:
```bash
pnpm migrate:status      # shows applied vs pending — everything should be "applied"
```

> ℹ️ Migrations are **immutable + idempotent**: re-running does nothing if already applied. A failure rolls back
> fully (each migration is one transaction).

---

## 2.4 ⭐ Give the app roles a LOGIN (the step everyone misses)

The migrations created `kv_app`, `kv_wallet`, `kv_relay` as **`NOLOGIN`** roles — they have the right table
permissions but **cannot connect** yet (in production their passwords come from AWS Secrets Manager). On your
laptop you flip them to LOGIN with a dev password, **once**, after migrating:

```bash
psql "postgres://postgres:dev@localhost:5432/krishalaya" -f db/local/local-login-roles.sql
```
The script prints a table at the end — confirm `rolcanlogin = t` for all three:
```
 rolname  | rolcanlogin | rolbypassrls
----------+-------------+--------------
 kv_app   | t           | f
 kv_relay | t           | t
 kv_wallet| t           | f
```

> **Why three roles?** Security by separation (this is intentional, not accidental):
> - `kv_app` — the API/worker/web. Subject to Row-Level-Security; **cannot** read the money ledger.
> - `kv_wallet` — ONLY the wallet-service. The only role allowed to write ledger entries.
> - `kv_relay` — the outbox relay + ai-services audit log. A `BYPASSRLS` infra role for cross-tenant plumbing.
>
> If you ever see `password authentication failed for user "kv_app"` or `role "kv_app" is not permitted to log
> in`, you skipped this step — just run it now.

---

## 2.5 Load the seed data (reference + demo)

Seeds load master data the app needs to function (languages, currencies, roles+permissions, lookups, plans,
tax/charge rules, the crop catalogue, notification templates). They run as the owner too:

```bash
pnpm seed            # core + rules + catalogue (idempotent — safe to re-run)
pnpm seed:demo       # adds demo tenants/users/listings so you have something to look at
```

> `seed:demo` is blocked when `NODE_ENV=production` — on your laptop it's fine and gives you a working demo tenant
> + sample listings to browse immediately.

---

## 2.6 Verify the database is real

```bash
# count tables (expect ~250+)
psql "postgres://postgres:dev@localhost:5432/krishalaya" -c \
  "select count(*) as tables from information_schema.tables where table_schema='public';"

# confirm kv_app can actually connect now (this is the role the API uses)
psql "postgres://kv_app:dev@localhost:5432/krishalaya" -c "select current_user;"
```
If `current_user` prints `kv_app`, your database layer is done. ✅

---

## 2.7 Handy DB commands (for later)

```bash
pnpm migrate:status      # what's applied
pnpm db:partitions       # create future monthly partitions (run if a partitioned-table insert ever fails)
pnpm db:verify-rls       # prove tenant-isolation policies + that money tables aren't readable by kv_app
```

**If anything in this step failed, open `07-troubleshooting.md` → "Database" section.** Otherwise continue to
**`03-run-backend.md`**.
