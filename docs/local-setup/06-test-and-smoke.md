# Step 6 — Test everything + a real end-to-end flow

Two kinds of "testing": (A) the **automated test suites** (prove the code is correct), and (B) a **manual smoke
flow** (prove the running stack actually works, with a real login → API call).

---

## 6.1 Automated tests — the whole repo

From the **repo root**:
```bash
nvm use
pnpm typecheck      # TypeScript compiles across every app/package (no type errors)
pnpm test           # runs each workspace's unit tests (turbo, cached)
pnpm lint           # eslint across the repo
```
- `typecheck` should end with no errors.
- `test` runs unit tests per workspace. Some optional services use `--passWithNoTests` (they have none yet) — that
  prints "No tests found" and **passes**, which is fine.

---

## 6.2 Automated tests — the API in depth (unit + integration + e2e)

The API has three test tiers. Unit tests need nothing; integration + e2e need a **real Postgres** (which you
already have from Docker).

```bash
cd apps/api

# 1) unit — pure logic, no DB. Fast.
pnpm test:unit

# 2) integration — runs against a real Postgres, proves tenant-isolation (RLS).
#    It loads migrations+seeds into a test DB. Point it at the superuser so it can create/reset that DB:
export DATABASE_ADMIN_URL="postgres://postgres:dev@localhost:5432/postgres"
export MIGRATION_DATABASE_URL="postgres://postgres:dev@localhost:5432/krishalaya"
pnpm test:integration
```
> Integration tests create + tear down their own test database/schema using the admin URL. If they error with
> "permission denied to create database", make sure `DATABASE_ADMIN_URL` points at the **`postgres`** superuser
> (as above), not `kv_app`.

The **db/scripts** have their own tests too (run from root): `pnpm db:test`.

---

## 6.3 The local OTP login (how to log in without real SMS)

No SMS provider runs locally, so the OTP is **not** texted — it's available two ways:

**Easiest — make the API return the OTP in the response.** Add this one line to `apps/api/.env` and restart the
API (`Ctrl+C` then `pnpm start:dev`):
```
AUTH_EXPOSE_OTP=true
```
Now `POST /v1/auth/otp` includes a `devCode` field in its JSON. **(Dev only — never set this in production.)**

**Or — read it from the logs.** The dev SMS sender logs `[dev SMS] <phone>: Krishalaya OTP: 123456 ...` in the
**API terminal** (because `LOG_LEVEL=debug`). Copy the 6-digit code from there.

---

## 6.4 Full smoke flow — login → token → authenticated call

This proves DB + roles + RLS + auth + JWT all work together. Run it in a terminal while the API (3.1) is up.
We use the **demo tenant** id `88888888-0000-7000-8000-000000000001` (created by `pnpm seed:demo`). The phone can
be any number — the verify step auto-registers a new user.

```bash
API=http://localhost:3000
PHONE='+919999000001'
TENANT='88888888-0000-7000-8000-000000000001'

# 1) request an OTP (with AUTH_EXPOSE_OTP=true the code comes back as devCode)
curl -s -X POST $API/v1/auth/otp -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"channel\":\"sms\"}" | jq .
# → note the "devCode", e.g. "123456"  (or read it from the API terminal logs)

# 2) verify the OTP → get access + refresh tokens (auto-registers the user on first login)
CODE=123456   # <-- paste the devCode from step 1
TOKENS=$(curl -s -X POST $API/v1/auth/verify -H 'content-type: application/json' \
  -d "{\"phone\":\"$PHONE\",\"code\":\"$CODE\",\"tenantId\":\"$TENANT\"}")
echo "$TOKENS" | jq .
ACCESS=$(echo "$TOKENS" | jq -r '.data.accessToken // .accessToken')

# 3) call an authenticated endpoint with the token
curl -s $API/v1/users/me -H "authorization: Bearer $ACCESS" | jq .
# → your own user profile (masked phone) = the whole auth chain works ✅

# 4) a public read (no token needed) — proves DB + seeds
curl -s $API/v1/listings | jq '.data | length'
```

If step 3 returns your user, **the platform is genuinely running end-to-end on your laptop.** 🎉

> Exact field names (`accessToken` vs `data.accessToken`) can vary — the `jq` above tries both. If unsure, just
> `echo "$TOKENS" | jq .` and copy the token by eye.

---

## 6.5 Smoke-test the clients

- **web-storefront** (<http://localhost:3001>): browse listings (no login needed).
- **web-tenant** (<http://localhost:3002>): go to `/login`, enter a phone, then the OTP from 6.3.
- **mobile**: open the app, do the same phone→OTP login.

---

## 6.6 What "green" looks like

| Check | Pass criteria |
|-------|---------------|
| `pnpm typecheck` | exits 0, no TS errors |
| `pnpm test` (root) | all workspaces pass (or "no tests" for optional ones) |
| `apps/api` `pnpm test:unit` | all green |
| `apps/api` `pnpm test:integration` | all green (RLS isolation proven) |
| Smoke flow 6.4 | step 3 returns your user profile |
| web-storefront | listings render at :3001 |

All green → you have the full product running and verified locally. See **`07-troubleshooting.md`** if any step
misbehaved.
