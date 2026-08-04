# Run Krishalaya on your MacBook — the complete beginner guide

This is a **follow-top-to-bottom** guide to install, run, and test the *entire* Krishalaya product on a
MacBook Pro. It assumes you are comfortable with a terminal and backend basics, but **new to Android/frontend
tooling** — so every step is spelled out, including the small things that usually break.

> **Golden rule:** do the files **in order**. Each one assumes the previous finished. Don't skip ahead.

| Step | File | What you'll do | Time |
|------|------|----------------|------|
| 1 | `01-install-macos.md` | Install Homebrew, Node 20, pnpm, Docker, Python, mobile tools | ~45 min (mostly downloads) |
| 2 | `02-infra-and-database.md` | Start Postgres/Redis/etc, create the DB, run migrations + seeds | ~15 min |
| 3 | `03-run-backend.md` | Run the API + wallet + worker + (optional) admin/realtime/AI | ~15 min |
| 4 | `04-run-web.md` | Run the 4 Next.js web apps | ~10 min |
| 5 | `05-run-mobile.md` | Run the React-Native (Expo) mobile app on your phone | ~15 min |
| 6 | `06-test-and-smoke.md` | Run the test suites + a real end-to-end login→listing flow | ~15 min |
| 8 | `08-make-the-demo-work.md` | App empty/broken as farmer +919900000101? Seed data, fund wallet, turn flags on | ~15 min |
| 7 | `07-troubleshooting.md` | Fixes for every common error (read when stuck) | as needed |

---

## What is in this product (the map)

Krishalaya is a **monorepo** (one git repo, many apps) managed by **pnpm workspaces** + **turbo**. There are
three kinds of things inside:

**A. Infrastructure (runs in Docker — you don't write code, you just start it):**
- **PostgreSQL 16** — the one database all backend services share (the source of truth).
- **Redis 7** — cache, rate-limits, OTP store, realtime message bus.
- **OpenSearch 2** — full-text search index (optional locally; the API falls back to Postgres if absent).
- **LocalStack** — fakes AWS S3 (media uploads) on your laptop (optional locally).

**B. Backend services (Node.js / NestJS, plus one Python service):**

> **Read this column carefully.** "Start locally?" means *do you need to launch this process for a local dev run* —
> it is **NOT** a build-status. **Every service below is fully built and production-grade.** ✅ = start it for the
> minimal run, 🟡 = start it when you need that feature, ⬜ = you can skip it locally (it only matters at scale or
> needs an external cluster). Nothing here is unfinished.

| Service | Folder | Port | Start locally? | What it does |
|---------|--------|------|----------------|--------------|
| **API** | `apps/api` | **3000** | ✅ YES (the core) | the main REST API every client calls |
| **wallet-service** | `apps/wallet-service` | **50051** (gRPC) | ✅ YES if you touch money | the ONLY process that moves money (double-entry ledger) |
| **worker** | `apps/worker` | (no port) | 🟡 start for timed jobs | runs scheduled jobs (expiries, reminders, payouts) |
| **admin-api** | `apps/admin-api` | **4001** | 🟡 start for web-admin | the "god-mode" ops API (separate from the tenant API) |
| **realtime-gateway** | `apps/realtime-gateway` | **8090** (WebSocket) | ⬜ start for live updates | live updates (bids/orders) over WebSocket; needs Redis |
| **ai-services** | `apps/ai-services` | **8000** (Python/FastAPI) | ⬜ start for AI features | price bands / photo grading / fraud signals |
| outbox-relay, stream-processor, analytics-pipeline, ivr-ussd-gateway, whatsapp-bot | `apps/*` | — | ⬜ skip locally | built, but need Kafka/ClickHouse/telephony — **skip for local dev** |

**C. Frontends (clients that call the API):**

| App | Folder | Port (we'll use) | What it is |
|-----|--------|------------------|------------|
| **web-storefront** | `apps/web-storefront` | **3001** | public marketplace website (Next.js) |
| **web-tenant** | `apps/web-tenant` | **3002** | seller / tenant-admin console (Next.js) |
| **web-partner** | `apps/web-partner` | **3003** | financial/logistics partner portal (Next.js) |
| **web-admin** | `apps/web-admin` | **3004** | platform god-mode console (Next.js → talks to admin-api:4001) |
| **mobile** | `apps/mobile` | **8081** (Metro) | the farmer/buyer/worker app (React Native + Expo) |

**D. Shared libraries** (`packages/*`: `sdk-js`, `tokens`, `i18n`, `contracts`, `ui`, `ui-native`, `config`,
`testing`) — the apps import these. You **build them once** and forget about them.

---

## The two ways to run it

You almost never need *everything* at once. Pick a lane:

- **Minimal lane (recommended first):** Postgres + Redis → API (3000) → web-storefront (3001) → mobile.
  This proves the whole stack end-to-end (browse, login, listings) without the optional services.
- **Full lane:** add wallet-service, worker, admin-api + web-admin, realtime-gateway, ai-services.
  Do this *after* the minimal lane works.

The guide builds the minimal lane first, then adds the rest as clearly-marked optional sections.

---

## Ports cheat-sheet (so nothing collides)

```
3000  apps/api               (REST API — the hub)
3001  web-storefront         (next dev -p 3001)
3002  web-tenant             (next dev -p 3002)
3003  web-partner            (next dev -p 3003)
3004  web-admin              (next dev -p 3004)
4001  admin-api              (god-mode API)
8000  ai-services            (Python FastAPI)
8081  mobile Metro bundler   (Expo)
8090  realtime-gateway       (WebSocket)
50051 wallet-service         (gRPC)
5432  Postgres   6379 Redis   9200 OpenSearch   4566 LocalStack
```

> ⚠️ **Next.js defaults to port 3000 — the same as the API.** That's why we run each web app on an explicit
> `-p 300x` port. The guide always shows the exact command. Don't run `next dev` without `-p`.

Now open **`01-install-macos.md`** and start.
