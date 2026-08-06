# 🌾 KRISHALAYA — Local Demo Guidebook (MacBook Pro)
### The single source: run EVERYTHING on one laptop and give a live client demo
*Version 1.1 (no-Docker edition: native Postgres & Redis via Homebrew) · 2026-08-05 · Written for a non-technical operator. Follow top to bottom the first time; after that, Section 15 is your daily 5-minute restart.*

---

## 0. What you are about to run (the map)

Krishalaya is one product made of many pieces. On your laptop they all talk to each other through **one main API**. Every piece, its address once running, and who it's for:

| # | Piece | Address on your laptop | Who uses it in the demo |
|---|---|---|---|
| A | **Infrastructure** (Postgres DB, Redis, OpenSearch — all native via Homebrew) | background services | invisible plumbing |
| B | **Main API** | http://localhost:3000 | every app below |
| C | **Admin API** (god-mode plane) | http://localhost:4001 | web-admin only |
| D | **Marketing website** | http://localhost:8080 | the public internet face |
| E | **Storefront** (buyers) | http://localhost:3001 | customers buying produce |
| F | **Tenant console** (FPO/co-op HQ) | http://localhost:3002 | the FPO manager |
| G | **Admin console** (platform owner) | http://localhost:3003 | you, the founder |
| H | **Partner console** (banks/insurers) | http://localhost:3004 | financial partners |
| I | **Ops console** (field staff) | http://localhost:3006 | kiosk/warehouse/dairy staff |
| J | **Gov console** (scheme officers) | http://localhost:3007 | government officers |
| K | **Mobile app** (13 roles: farmer, buyer, vet, rider…) | Expo (phone or simulator) | farmers & field roles |
| L | *Optional:* AI services (advisory) | http://localhost:8000 | assistant features |

> **The honest limits (read once):** three things need real (free, test-mode) keys you haven't wired yet: **online payments** (Razorpay test keys), **eKYC** (sandbox key), and **real SMS** (DLT/Twilio). Everything else works fully. Logins still work WITHOUT SMS because in local mode the API hands you the OTP code directly (Section 5). Payment-gateway screens will honestly say the gateway is unavailable — wallet-less flows, COD-style orders and every register/console still demo perfectly.

---

## 1. One-time Mac setup (≈20 minutes, do once ever)

Open the **Terminal** app (press `⌘+Space`, type `Terminal`, press Enter). Type each command, press Enter, wait for it to finish.

**1.1 Install Homebrew** (the Mac software installer). Skip if `brew --version` prints a number.
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
Follow its prompts (it may ask for your Mac password — typing is invisible, that's normal). When done, run the 1–2 lines it prints under "Next steps".

**1.2 Install Postgres 16, Redis, and OpenSearch** (native — no Docker anywhere in this book):
```bash
brew install postgresql@16 redis opensearch
brew link --overwrite postgresql@16
```

**1.3 Install Node.js 20, pnpm, and git:**
```bash
brew install node@20 pnpm git
brew link --overwrite node@20
```

**1.4 Verify everything** — each line must print a version, not an error:
```bash
node -v        # should say v20.x
pnpm -v        # any 9.x or 10.x
psql --version # PostgreSQL 16.x
redis-cli --version
git --version
```

**1.5 For the mobile app** (do now or when you reach Section 13):
```bash
brew install watchman
```
And on your **phone**, install the free **"Expo Go"** app from the App Store / Play Store.

---

## 2. Get the code in place

If the `krishalaya` folder is already on this Mac (it is, if this is your working laptop), just note its location. Everything below assumes:
```bash
cd ~/Documents/Personal/farmer/krishalaya
```
*(Adjust the path if yours differs — this one folder is "the repo". Every command block in this book starts with a `cd` so you can never be in the wrong place.)*

**2.1 Install all app dependencies** (first time ≈5–10 min):
```bash
cd ~/Documents/Personal/farmer/krishalaya
pnpm install
```
✅ **Check:** ends without red `ERR` lines. Warnings in yellow are fine.

---

## 3. Start the infrastructure (native services — no Docker)

**3.1 Start Postgres, Redis and OpenSearch as background services** (they auto-start after reboots too):
```bash
brew services start postgresql@16
brew services start redis
brew services start opensearch
```
**3.2 Create the database** (first time only):
```bash
createdb krishalaya
```
*(If it says "already exists", that's fine.)*

**3.3 Verify all three are alive:**
```bash
brew services list                 # postgresql@16, redis, opensearch → "started"
psql -d krishalaya -c "SELECT 1;"  # prints a 1
redis-cli ping                     # prints PONG
curl -s http://localhost:9200 | head -3   # prints OpenSearch JSON (give it ~60s on first boot)
```
✅ **Check:** all four commands answer as noted.

> **About file uploads (photos/documents):** the cloud setup uses S3. Locally, without an S3 emulator, upload buttons will honestly fail while EVERYTHING else works — acceptable for most demos. Want uploads too? One optional extra: `brew install localstack && localstack start -d` (it emulates S3 on :4566) — but you can skip it entirely.

---

## 4. Configure the environment (.env files)

**4.1 Root file** (feeds the APIs):
```bash
cd ~/Documents/Personal/farmer/krishalaya
cp -n .env.example .env
```
Now open it in TextEdit:
```bash
open -e .env
```
Make these edits, then **save and close** (⌘S, ⌘W):

1. Set both database lines to your Mac's own Postgres user. First find your username:
   ```bash
   whoami
   ```
   Then set (replace `sanjayodedra` with whatever `whoami` printed — Homebrew Postgres has no password by default):
   ```
   MIGRATION_DATABASE_URL=postgres://sanjayodedra@localhost:5432/krishalaya
   DATABASE_URL=postgres://sanjayodedra@localhost:5432/krishalaya
   ```
   *(Local demo runs as your own superuser — fine on a laptop, never in production.)*
2. Add this line anywhere (THE demo key — makes the API hand you OTP codes on screen, since real SMS isn't wired):
   ```
   AUTH_EXPOSE_OTP=true
   ```
3. Leave `JWT_ACCESS_SECRET` etc. as their dev defaults — fine locally.

**4.2 Web app files** (tell each console where the API is). Copy-paste this whole block as one:
```bash
cd ~/Documents/Personal/farmer/krishalaya
for app in web-storefront web-tenant web-admin web-partner web-ops web-gov; do
  cp -n apps/$app/.env.example apps/$app/.env.local 2>/dev/null || true
done
grep -H "NEXT_PUBLIC_API_URL" apps/web-*/.env.local
```
✅ **Check:** every printed line says `http://localhost:3000`. (web-admin may also point at the Admin API `http://localhost:4001` — leave whatever its example set.)

---

## 5. Create the database (migrate + seed)

```bash
cd ~/Documents/Personal/farmer/krishalaya
pnpm migrate
pnpm seed
pnpm seed:demo
```
✅ **Check:** `pnpm migrate` walks through numbered files (0001…0071+) with no red errors; seeds finish clean. `seed:demo` loads the demo tenants (it refuses to run against any cloud DB — a safety feature).

**Verify with your own eyes:**
```bash
psql -d krishalaya -c "SELECT slug, display_name, status FROM tenants;"
```
✅ **Check:** a small table of demo tenants prints. **Note the first slug** (e.g. `demo-fpo`) — you'll use it at every login as the "Tenant".

---

## 6. Start the Main API — the heart (keep its Terminal tab open)

Every service gets **its own Terminal tab** (⌘T for a new tab). Tab 1:
```bash
cd ~/Documents/Personal/farmer/krishalaya/apps/api
pnpm start:dev
```
✅ **Check:** after ~15s you see **`Krishalaya API listening on :3000 (development)`**. Leave this tab running. (The outbox relay — the internal event mover — runs inside this process automatically: `RELAY_ENABLED=true`.)

**6.1 Prove login works end-to-end** (new tab, ⌘T):
```bash
curl -s -X POST http://localhost:3000/v1/auth/request-otp -H 'Content-Type: application/json' \
  -d '{"phone":"+919800000001"}'
```
✅ **Check:** the reply contains `"sent":true` **and `"devCode":"…"`** — that 6-digit devCode is your OTP. This is exactly how every login in this book works: enter a phone → the screen (or this curl) shows the code → type it in. *(No devCode? You forgot `AUTH_EXPOSE_OTP=true` in `.env` — add it and restart Tab 1.)*

---

## 7. Start the Admin API (Tab 2)

```bash
cd ~/Documents/Personal/farmer/krishalaya/apps/admin-api
pnpm dev
```
✅ **Check:** **`[admin-api] god-mode plane listening on :4001`**. Leave running. *(This plane serves ONLY web-admin: tenant approvals, platform reports, recon, cells — deliberately a separate, locked-down server.)*

---

## 8. Create your demo people (5 minutes, once)

The demo needs a cast. You'll create each by simply "logging in" once (first OTP login auto-creates the account), then granting console roles with two copy-paste commands.

**8.1 Create the accounts** — for each phone below, run the request-otp curl from Section 6.1, then verify:
```bash
curl -s -X POST http://localhost:3000/v1/auth/verify-otp -H 'Content-Type: application/json' \
  -d '{"phone":"+919800000001","code":"<devCode from previous reply>"}'
```
Do this once per phone (same two commands, new phone number):

| Phone | Will play the role of |
|---|---|
| +919800000001 | **Farmer / Pashupalak** (mobile app star) |
| +919800000002 | **Buyer** (storefront) |
| +919800000003 | **Tenant admin** (FPO manager, web-tenant) |
| +919800000004 | **Ops staff** (web-ops) |
| +919800000005 | **Gov officer** (web-gov) |
| +919800000006 | **Partner** (web-partner) |
| +919800000007 | **Vet** (mobile) |
| +919800000008 | **Delivery rider** (mobile) |

**8.2 Grant the console roles** (one paste — it maps each phone to the right seeded RBAC role in your demo tenant):
```bash
psql -d krishalaya <<'SQL'
WITH t AS (SELECT id FROM tenants ORDER BY created_at LIMIT 1),
map(phone, role_code) AS (VALUES
  ('+919800000003','tenant_admin'), ('+919800000004','tenant_admin'),
  ('+919800000005','tenant_admin'), ('+919800000006','tenant_admin'),
  ('+919800000007','vet'),          ('+919800000008','delivery_partner'),
  ('+919800000001','pashupalak'))
INSERT INTO user_tenant_roles (user_id, tenant_id, role_id)
SELECT u.id, t.id, r.id FROM map m
JOIN users u ON u.phone = m.phone
JOIN roles r ON r.code = m.role_code
CROSS JOIN t
ON CONFLICT DO NOTHING;
SQL
```
✅ **Check:** prints `INSERT 0 N` (N ≥ 1). *(Demo shortcut: tenant_admin carries the broad permission set, so one role unlocks tenant/ops/gov/partner consoles for their respective test users. Real deployments use the narrower seeded roles.)*
> If a table/column name differs on your build and the paste errors, tell your engineer/AI assistant: "grant roles per Section 8.2" — it's a one-line mapping fix, not a product problem.

---

## 9. Marketing website (Tab 3) — the public face

It's a finished static site — no build needed:
```bash
cd ~/Documents/Personal/farmer/krishalaya_website
python3 -m http.server 8080
```
Open **http://localhost:8080** in your browser.
✅ **Demo here:** Home → About → the vertical pages (dairy, livestock, schemes) → Trust/Privacy pages. This is what the world sees before login.

---

## 10. The six web consoles (Tabs 4–9)

Each console: **new Terminal tab → two lines → open the address → log in**. Login is identical everywhere: enter the demo **tenant slug** (from Section 5) if asked, the role's **phone**, then the **devCode** (shown right on the login screen in dev, or via the Section 6.1 curl).

### 10.1 Storefront — the buyer's shop · http://localhost:3001
```bash
cd ~/Documents/Personal/farmer/krishalaya/apps/web-storefront
pnpm dev
```
Log in as **+919800000002** (buyer).
✅ **Demo:** browse listings → open a product → add to cart → checkout (choose the non-gateway path; if a screen says the payment gateway is unavailable, say so proudly — it fails honest, never fakes) → Orders page shows the order → open its tracking timeline.

### 10.2 Tenant console — FPO headquarters · http://localhost:3002
```bash
cd ~/Documents/Personal/farmer/krishalaya/apps/web-tenant
pnpm dev
```
Log in as **+919800000003**.
✅ **Demo (the money-maker tour):** Dashboard → Farmers → Listings (approve one) → Orders → Logistics (shipments) → Dairy (MCC registry, rate cards) → Education studio (create a course module) → WhatsApp hub → Coupons → Requirements board → Branding (white-label colors — change one, refresh the storefront!).

### 10.3 Admin console — the platform owner · http://localhost:3003
```bash
cd ~/Documents/Personal/farmer/krishalaya/apps/web-admin
pnpm dev
```
Admin uses the **Admin API** (Tab 2) and its own owner login flow.
✅ **Demo:** Tenants list → approve/suspend controls → Platform reports (GMV, tenant growth, the NEW custom report builder) → Recon monitor → Catalogue registry (crops/units/attributes) → Cells & shards (the international-scale story).

### 10.4 Partner console — banks & insurers · http://localhost:3004
```bash
cd ~/Documents/Personal/farmer/krishalaya/apps/web-partner
pnpm dev
```
Log in as **+919800000006**.
✅ **Demo:** Insurer desk (products, policy book, claims w/ surveyor steps) → Lending desk (applications, the NEW servicing: DPD buckets, collections queue, KCC ledger, restructures) → Settlements → Notifications/consents rail.

### 10.5 Ops console — field staff · http://localhost:3006
```bash
cd ~/Documents/Personal/farmer/krishalaya/apps/web-ops
pnpm dev
```
Log in as **+919800000004**.
✅ **Demo:** Kiosk (create a walk-in farmer — the guided handoff) → Warehouse (storage booking → confirm → store → issue eNWR) → Equipment rentals (quote → renter OTP start → complete → settle) → Dairy POS (record a milk slip — the server prices it) → Insights.

### 10.6 Gov console — scheme officers · http://localhost:3007
```bash
cd ~/Documents/Personal/farmer/krishalaya/apps/web-gov
pnpm dev
```
Log in as **+919800000005**.
✅ **Demo:** Schemes queue → open an application → verify → approve → record a DBT credit → schedule a field visit → Registers (insurance/lending oversight) → run an audit-stamped export (show the receipt id — every export leaves a trail).

> **Shortcut for later demos:** instead of six tabs, one tab at the repo root with `pnpm dev` starts ALL apps at once via turbo. First time, do them one-by-one so you learn each check.

---

## 11. The mobile app — 13 roles in one app (Tab 10)

```bash
cd ~/Documents/Personal/farmer/krishalaya/apps/mobile
pnpm start
```
A QR code appears.
- **Easiest:** open **Expo Go** on your phone (same Wi-Fi as the Mac) and scan the QR.
- **Phone must reach your Mac's API:** in `apps/mobile` create/edit `.env` so the API URL uses your Mac's LAN IP, not localhost — find it with `ipconfig getifaddr en0`, then set e.g. `EXPO_PUBLIC_API_URL=http://192.168.1.23:3000` and restart `pnpm start`. *(iOS Simulator users can keep localhost: press `i` in this tab instead.)*

✅ **Demo script (the crowd-pleaser):**
1. Welcome → language picker (English/हिन्दी/ગુજરાતી — switch live!) → phone **+919800000001** → the OTP devCode shows on screen in dev → you're in as **Farmer**.
2. Farmer home: crop hub, mandi prices, weather, wallet, schemes (browse → eligibility → apply wizard).
3. **Role switcher** (profile): switch to **Pashupalak** → register an animal (Pashu Aadhaar) → vet directory → book a visit.
4. Log in as **+919800000007** (Vet): see the booking → accept → prescribe (drug pad!).
5. Back as farmer: confirm visit done → fee settles (wallet path).
6. **+919800000008** (Rider): Today's tasks → milestone buttons → deliver with buyer OTP + POD photo.
7. Show the rest of the 13-role picker: dairy farmer (milk diary/bills), store owner (batches & expiry), equipment owner (rental requests), MCC operator (counter slips).

---

## 12. Optional extras (only if you want the AI flourish)

**AI services** (advisory/assistant, Python FastAPI):
```bash
cd ~/Documents/Personal/farmer/krishalaya/apps/ai-services
python3 -m venv .venv && source .venv/bin/activate && pip install -e .
API_SHARED_SECRET=$(grep AI_SERVICES_SHARED_SECRET ~/Documents/Personal/farmer/krishalaya/.env | cut -d= -f2) uvicorn src.main:app --port 8000
```
Other background services (`realtime-gateway`, `stream-processor`, `analytics-pipeline`, `wallet-service`, `ivr-ussd-gateway`) are **NOT needed for the demo** — the main API covers the demo paths; these come alive at staging scale.

---

## 13. The 15-minute client demo script (suggested order)

1. **Website** (2 min): the public story. :8080
2. **Mobile farmer journey** (4 min): language switch → OTP login → schemes apply → pashupalak animal + vet booking. *(The emotional core — a farmer's phone.)*
3. **Ops kiosk + dairy POS** (2 min): "and for farmers WITHOUT phones, our staff…" :3006
4. **Tenant console** (3 min): "the FPO runs its whole business here" — approve listing, change branding, refresh storefront live. :3002
5. **Storefront order** (2 min): buyer checkout → order timeline. :3001
6. **Gov + Partner** (1.5 min): scheme approve + DBT; insurer book. :3007, :3004
7. **Admin close** (0.5 min): platform reports + cells map — "and this is how we go from one district to many countries." :3003

---

## 14. Troubleshooting (the five things that ever go wrong)

| Symptom | Fix |
|---|---|
| `psql: connection refused` / `PONG` missing | Services not started: `brew services start postgresql@16 redis opensearch`, then retry. |
| `port 3000 already in use` (any port) | `lsof -ti:3000 \| xargs kill -9` (swap the number), or you have an old tab running it — close that tab. |
| API tab shows DB connection errors | Rerun Section 3; check the `.env` DB lines use YOUR `whoami` username (Section 4.1). |
| Login screen never shows a devCode | `AUTH_EXPOSE_OTP=true` missing in root `.env` → add, restart the API tab. |
| A console shows "temporarily unavailable" sections | That's the honest-degrade design: usually the API tab crashed — check Tab 1, restart it. |
| Total confusion / want a clean slate | Section 15.3 nuclear reset. |

---

## 15. Daily start / stop / reset

**15.1 Every demo day (2 min):** infra usually already runs (brew services auto-start). Just: Tab 1 API, Tab 2 admin-api → `pnpm dev` per console you need (or one root `pnpm dev` for all) → website tab → mobile tab. If in doubt: `brew services list`.

**15.2 Stop everything:** press `Ctrl+C` in each Terminal tab. Infra can keep running (it's idle & harmless), or stop it too:
```bash
brew services stop postgresql@16 redis opensearch
```

**15.3 Nuclear reset (wipes local data, rebuilds a fresh demo world):**
```bash
dropdb krishalaya && createdb krishalaya
cd ~/Documents/Personal/farmer/krishalaya
pnpm migrate && pnpm seed && pnpm seed:demo
```
Then redo Section 8 (demo people).

---

## 16. What is NOT in this demo (say it confidently if asked)

- **Live payment capture / payouts** — wired for Razorpay test keys; screens fail honest until keys land ("we never fake money movement").
- **Real Aadhaar eKYC** — sandbox key pending; manual KYC document flow works fully.
- **Real SMS** — DLT registration pending; dev mode shows codes on screen.
- **12 gated backend modules** (remittance ledger, PFMS recon, MGNREGA works sync, delivery-run scheduler, partner API keys…) — each designed and documented in `Development_Program/PC54_BACKLOG.md`, awaiting their external provider or a reviewed migration.

Everything else you click in this book is real code, real database, real state machines — the same code that ships.

*— End of guidebook. जय किसान। 🌾*
