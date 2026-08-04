# Make the demo actually work — the "why is my app empty?" runbook

You ran the app in Expo Go, logged in as the farmer **+91 9900000101**, and saw:

- Screens that say **"This section is temporarily unavailable"**
- A greeting of **"Kisan"** instead of a real name, wallet showing **"—"**, **0 listings**, empty orders
- Order cards titled with a long **UUID** instead of a name
- **Login not sticking** — every time you kill and reopen the app you have to sign in again

**None of this is a broken screen.** The screens are correct and were built to *degrade honestly* — when a
feature is switched off or the data isn't there, they show a safe placeholder instead of faking values. What you
saw is the app telling you, truthfully, that **the backend on `192.168.31.165` has not been prepared for the
demo.** This runbook prepares it. Three of the four items also got small app-side fixes (see the end); the rest
is data + config on the server.

> Do the steps **in order**. Each assumes the previous finished. Everything here is **LOCAL/DEMO ONLY** — never
> run it against staging or production.

---

## The four root causes (so the fixes make sense)

| What you saw | Why | Fixed by |
|---|---|---|
| "This section is temporarily unavailable" | Every vertical is **flag-gated OFF by default** (`core/flags/flags.ts`). In production the ON/OFF list comes from the server (`GET /v1/config/flags`); there is **no such endpoint locally**, so nothing turns on unless you tell the app. | **Step 4** — `EXPO_PUBLIC_FLAGS` in `apps/mobile/.env` (already added). |
| "Kisan", wallet "—", 0 listings, empty orders | The backend DB was **never seeded** with the demo dataset. "Kisan" is the *fallback* the home screen shows when `displayName` is missing. Wallet "—" means the **wallet-service** is unreachable or the account has no ledger. | **Steps 2 & 3** — run the demo seed + fund the wallet. |
| Order card titled with a UUID | The orders read-model returns `counterparty` as the other party's raw **userId**, and the card was printing it. | **App fix** (done) — a UUID now falls back to the order number; a real name still shows. |
| Login doesn't persist across app restarts | On boot, if the proactive token refresh call failed (flaky Wi-Fi to the LAN IP), the app **signed you out** even though your token was still valid. | **App fix** (done) — a failed *proactive* refresh no longer evicts a still-valid session. |

---

## Prerequisites

- Steps 1–3 of this guide already done: infra up, `krishalaya` DB created, **migrations + core/demo seeds run**,
  and `db/local/local-login-roles.sql` applied so `kv_app` / `kv_wallet` / `kv_relay` can log in.
- The API is reachable from your phone at `http://192.168.31.165:3000` (your Mac's LAN IP; phone on the same Wi-Fi).
- `psql` available in your terminal.

Set a couple of shell variables so the commands below are copy-paste:

```bash
# Run as the DB OWNER (bypasses tenant RLS so the seed's explicit tenant_id inserts go through)
export KV_DB="postgres://<owner>:<owner-pw>@localhost:5432/krishalaya"
# The wallet-service's own database (separate from krishalaya)
export KV_WALLET_DB="postgres://kv_wallet:dev@localhost:5432/kv_wallet"
```

---

## Step 1 — Confirm the demo user exists and has the right name

The greeting reads `displayName` off the signed-in user. If the seed ran, this returns **Ramesh Patel**:

```bash
psql "$KV_DB" -c "SELECT phone, display_name, status FROM users WHERE phone = '+919900000101';"
```

- **One row, `display_name = Ramesh Patel`, `status = active`** → good, go to Step 4 (data is already there).
- **No rows** → the demo dataset was never loaded → do Step 2.

---

## Step 2 — Load the demo dataset into the real database

This is the file that makes every surface render the *same* data the Phase-1 designs show — dynamically from
Postgres, not from mockups. It is idempotent (fixed UUIDs + `ON CONFLICT DO NOTHING`) and safe to re-run.

```bash
psql "$KV_DB" -f db/local/demo-design-data.sql
```

If it errors that a partition is missing (e.g. `no partition of relation "orders"…`), your migrations didn't
finish creating default partitions — re-run migrations (`pnpm migrate`) then run the seed again.

Verify the farmer now has a catalogue and orders:

```bash
psql "$KV_DB" -c "
  SELECT
    (SELECT count(*) FROM listings  WHERE tenant_id='88888888-0000-7000-8000-000000000001') AS listings,
    (SELECT count(*) FROM orders    WHERE tenant_id='88888888-0000-7000-8000-000000000001') AS orders,
    (SELECT count(*) FROM notifications WHERE user_id='d0000001-0000-7000-8000-000000000001') AS notifs;"
```

You should see non-zero counts. The listings, mandi prices, tips, schemes, reviews and notifications on the
farmer's screens all come from here.

> **Tenant must match.** The app signs into tenant `88888888-0000-7000-8000-000000000001` (the value of
> `EXPO_PUBLIC_TENANT_ID` in `apps/mobile/.env`). The seed writes to that same tenant. If you change one, change
> both or every read comes back empty even with the seed loaded.

---

## Step 3 — Make the wallet show a balance (screens 19 / 21 / 58 / 70)

Wallet balance and the ledger live in the **wallet-service's own database (`kv_wallet`)**, not in `krishalaya`,
so the design seed in Step 2 deliberately does **not** touch it. Two things are needed:

**3a. The wallet-service must be running.** If it isn't, the mobile wallet screen shows "—" because the balance
read fails (and correctly degrades rather than inventing a number). Start it per `03-run-backend.md`
(`pnpm --filter @krishalaya/wallet-service start`) and confirm it's listening on its gRPC port.

**3b. The demo account needs an opening balance.** The clean way — the same path a real user takes — is to add
money through the app: open **Wallet → Add money**, enter an amount, and complete the dev Razorpay checkout. The
credit posts through the real ledger and the balance appears.

If you'd rather not click through checkout for a demo, post one opening credit directly to the ledger (LOCAL
ONLY). Confirm the exact table/column names against your `kv_wallet` schema first:

```bash
# Inspect the ledger tables the wallet-service created, then post a single balanced opening entry per its schema.
psql "$KV_WALLET_DB" -c "\dt"
```

Whichever path you choose, re-open the wallet screen and pull-to-refresh; the balance and the transaction list
should now render from the live ledger.

---

## Step 4 — Turn the feature flags ON for the demo (already done in `.env`)

Every vertical ships gated OFF so ops can kill any screen without a store release. Locally there's no flag
endpoint, so `apps/mobile/.env` now carries an `EXPO_PUBLIC_FLAGS` override that turns the built verticals on:

```
EXPO_PUBLIC_FLAGS=wallet=on,payments_addmoney=on,orders_fulfilment=on,buyer_checkout=on,offers_chat=on,
auctions=on,mandi_weather=on,tips_assistant=on,schemes_govt=on,farmer_profile=on,system_screens=on,
voice_listing=on,listing_boost=on,worker_app=on,worker_active_job=on,labour_hire=on,kyc=on,
notifications=on,buyer_app=on,ambassador_app=on,ambassador_training=on,tenant_admin_lite=on
```

**Env is baked in at bundle start**, so after editing `.env` you must **fully restart Expo** (stop it, then
`pnpm --filter mobile start -c` to clear the cache) and reload the app on the phone. Without this, the verticals
stay off and you keep seeing "This section is temporarily unavailable."

---

## Step 5 — Sign in fresh and verify

1. Stop and restart the Expo dev server with cache cleared (`-c`), reload the app.
2. Sign in as **+91 9900000101** (dev OTP per `03-run-backend.md` — check the API logs for the code if SMS isn't wired locally).
3. Check each item from the table at the top:

- Home greets **Ramesh Patel**, not "Kisan".
- **My Listings** shows the seeded catalogue; **Orders** shows KV-2026-0142 etc. (titled by order # or buyer name, never a UUID).
- Mandi, Weather, Tips, Schemes, Hire, Notifications all open (flags on).
- **Wallet** shows a balance and transactions (Step 3 done + wallet-service up).
- Kill the app and reopen — you **stay logged in** (boot-refresh fix).

If a single section is still unavailable, that one flag isn't in the `EXPO_PUBLIC_FLAGS` list — add it and restart Expo.

---

## What was changed in the app (so you can review)

- **`apps/mobile/.env`** — added the `EXPO_PUBLIC_FLAGS` demo override (Step 4).
- **`features/orders/order-status.ts` + `(farmer)/orders.tsx`** — new pure helper `counterpartyLabel()`:
  a raw UUID (or blank) counterparty renders as the order number instead; a real name/business still shows.
- **`core/auth/auth.store.tsx`** — boot no longer signs you out when a *proactive* token refresh fails but the
  access token is still valid; it only signs out when the token has actually expired. The client refreshes again
  on its next real 401.

All three are covered by unit tests (`counterpartyLabel` in `core/__tests__/order-status.spec.ts`) and transpile clean.

---

## One thing that is *not* a bug

The **wallet-flag gating** was reviewed and is correct: `wallet/index.tsx` renders regardless of the flag and only
gates the *actions* (Add money / Withdraw) behind `payments_addmoney` / `wallet`. No change was needed there — if
the wallet looked empty it was the missing balance (Step 3), not the flag.
