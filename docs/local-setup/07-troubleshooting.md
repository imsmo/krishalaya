# Step 7 — Troubleshooting (read when stuck)

Find your error message below. Each fix is safe to run.

---

## Database

**`password authentication failed for user "kv_app"`** or **`role "kv_app" is not permitted to log in`**
→ You skipped the role-login step. Run it:
```bash
psql "postgres://postgres:dev@localhost:5432/krishalaya" -f db/local/local-login-roles.sql
```

**`permission denied for table <something>`** (from the API)
→ The role grants come from migrations. Either migrations didn't fully apply, or you connected as the wrong user.
Confirm migrations are all applied (`pnpm migrate:status`) and that `apps/api/.env` uses
`postgres://kv_app:dev@localhost:5432/krishalaya` (not a stray DB name like `krishi_dev`).

**`database "krishalaya" does not exist`**
→ The Docker Postgres creates it from `POSTGRES_DB` in `docker-compose.yml`. Recreate cleanly:
```bash
docker compose down -v   # WARNING: -v wipes the DB volume (fine locally)
docker compose up -d postgres redis
```
Then re-do Step 2.3 (migrate) → 2.4 (roles) → 2.5 (seed).

**`relation "schema_migrations" ... already exists` / checksum mismatch**
→ You edited an already-applied migration (not allowed). For local, reset the DB (`docker compose down -v` →
up → migrate). Never edit applied migrations; add a new numbered one.

**A partitioned-table INSERT fails ("no partition of relation ... found")**
→ Create partition runway: `pnpm db:partitions`.

**`could not connect to server` / connection refused on 5432**
→ Docker isn't running or Postgres didn't start. `docker compose ps` — if postgres isn't "Up", `docker compose up
-d postgres` and check `docker compose logs postgres`.

---

## Node / pnpm / build

**`Cannot find module '@krishalaya/sdk-js'`** (or tokens/i18n/contracts)
→ The shared packages weren't built. From root: `pnpm install && pnpm build` (or build just the libs:
`pnpm --filter "@krishalaya/*" build`).

**`Unsupported engine` / wrong Node version**
→ `nvm use` (reads `.nvmrc` → Node 20). If `nvm` isn't found, re-do Step 1.3 (the `~/.zshrc` lines), then
`source ~/.zshrc`.

**`pnpm: command not found`**
→ `corepack enable && corepack prepare pnpm@9 --activate` (Step 1.4).

**You ran `npm install` by mistake**
→ Delete the bad install and use pnpm: `rm -rf node_modules package-lock.json && pnpm install`.

**`ts-node` errors / app won't start in dev**
→ Make sure you're in the app folder and ran `pnpm start:dev` (API) / `pnpm dev` (others), with `nvm use` first.

---

## Ports

**`EADDRINUSE: address already in use :::3000`** (or 3001/4001/8090/50051…)
→ Something's already on that port. Find and stop it:
```bash
lsof -i :3000           # see the PID using the port
kill -9 <PID>           # stop it
```
Most common cause: you ran a Next.js app without `-p` so it grabbed 3000 (the API's port). Always start web apps
with their `-p 300x` from Step 4.

---

## Auth / API

**`JWT_ACCESS_SECRET must be at least 32 characters`** (or similar fail-closed)
→ Use the long secret from Step 3.1 verbatim. The realtime-gateway's secret must **match the API's exactly**.

**OTP login: I don't get a code**
→ Local sends no SMS. Add `AUTH_EXPOSE_OTP=true` to `apps/api/.env` and restart the API to get `devCode` in the
response, or read `[dev SMS] ...` from the API terminal (Step 6.3).

**`/v1/...` returns 404 but `/health` works**
→ Check the API version prefix. Endpoints are versioned (`/v1/...`). If a module 404s, its **feature flag** may be
off — flags are DB-backed and default OFF for non-core modules. Core reads (listings, auth, users) are always on.

**Money endpoint errors / "wallet unavailable"**
→ Start the wallet-service (Step 3.2) on :50051 and confirm `WALLET_GRPC_URL=localhost:50051` in `apps/api/.env`.

---

## Web (Next.js)

**Page shows "failed to fetch" / network error**
→ The API (or admin-api for web-admin) isn't running, or the env URL is wrong. Confirm `apps/web-*/.env.local`
points at `http://localhost:3000` (or `:4001` for web-admin) and that service is up.

**First load is very slow**
→ Normal in `next dev` (on-demand compile). Subsequent loads are fast.

---

## Mobile (Expo)

**App stuck "Downloading…" / "Network response timed out"**
→ Phone can't reach the Metro bundler. Ensure Mac + phone are on the **same Wi-Fi**; if the network blocks it, use
`pnpm start --tunnel` (Step 5.4).

**App loads but every API call fails**
→ `EXPO_PUBLIC_API_URL` is wrong. It must be your **Mac's LAN IP** (`http://192.168.x.x:3000`), **not** `localhost`
(Step 5.1–5.2). On the **iOS Simulator** use `localhost`; on the **Android Emulator** use `10.0.2.2`.

**macOS firewall popup blocked the connection**
→ System Settings → Network → Firewall → allow incoming for `node`. Or temporarily turn the firewall off to test.

**`watchman` errors / file-watch limit**
→ `brew install watchman` (Step 1.7), then in `apps/mobile`: `watchman watch-del-all` and restart `pnpm start`.

---

## Docker

**Docker commands hang / "Cannot connect to the Docker daemon"**
→ Open the Docker Desktop app and wait for the whale icon to stop animating, then retry.

**Reset everything (clean slate)**
```bash
docker compose down -v        # stops + deletes the DB volume
docker compose up -d          # fresh containers
# then re-run Step 2.3 → 2.4 → 2.5
```

---

## ai-services (Python)

**`uvicorn: command not found`**
→ Activate the venv first: `cd apps/ai-services && source .venv/bin/activate`. If the venv is missing, redo
Step 3.6 (`python3.11 -m venv .venv` → `pip install -e .`).

**It boots but inference returns `needs_review`**
→ Expected without model API keys. That's the safe default (Law 12). Add provider keys to its `.env` only if you
need live inference.

---

## Still stuck?

1. Re-read the step's callouts — most issues are a skipped role-login (2.4), a wrong `.env` value, or a port clash.
2. Check the failing service's terminal — the error line usually names the exact missing thing.
3. The minimal lane (Postgres + Redis + API + web-storefront) is the smallest thing that should work — get *that*
   green first, then add services one at a time.
