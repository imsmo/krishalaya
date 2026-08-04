# apps/api — endpoint backlog (the backend work that un-flags the clients)

**Why this file exists.** All five client apps are ✅ for their Phase-1 scope (`web-storefront`, `web-tenant`,
`web-admin`, `web-partner`, `apps/mobile`). But several client surfaces ship **"coming soon" / honest-degrade**
states because the **platform API endpoint they need does not exist yet**. Those were tracked per-client as
"flagged, not faked" (e.g. `apps/mobile/MOBILE_BUILD_BACKLOG.md` §6; the `SDK gap FLAGGED` notes in the
web-tenant / web-partner cells of `MODULE_STATUS.md`). This file is the **single backend backlog** that turns those
flags green.

**The order of operations for every flagged flow is BACKEND-FIRST:**
1. Build the endpoint here in `apps/api` (this file, one wave per session).
2. Add the typed resource/method to `@krishalaya/sdk-js`.
3. A tiny client "un-flag" session points the screen at the real endpoint and deletes the "coming soon"
   (mobile = a `M-Wx` row in `MOBILE_BUILD_BACKLOG.md` §6; web = a small follow-up in that app).

So nothing in this file is a client bug — it's net-new backend capability. Until a wave lands, the client behaviour
is **correct**: it degrades honestly and never fakes data.

> **Verified absent (this pass, grep over `apps/api/src/modules/**/controllers/v1`):** wallet balance/ledger HTTP
> read-model, KYC doc-type catalogue, device/push-token registration, farmer-facing AI assistant, DPDP
> export/delete, saved/wishlist + saved-search, public seller-profile, attendance/clock-in, ambassador
> leaderboard/targets, listing analytics, checkout totals-preview, pay-from-wallet, auctions cross-auction my-bids,
> worker-apply, tenant mobile analytics/broadcast. **Partially present (verify in pre-flight, don't duplicate):**
> `listings/controllers/v1/boosts.controller.ts` exists — API-W4 only adds the missing tier-price + wallet-debit route.

> **NOT in scope here.** Phase-2 role apps (dairy/vet/delivery/store/fintech/FPO — mobile §7) and the insurance
> module (web-partner BLOCKED) are separate scope decisions, not endpoint gaps. Don't build them from this file.

Hand me one `Yes next API-Wx …` at a time with the contract (§1) pasted, exactly like the client backlogs. These
are **post-GA fast-follows** — none blocks the current green status; pull each when that flow has a business reason.

---

## 1. THE PRODUCTION-GRADE CONTRACT — apps/api variant (paste at the top of every command)

```
PRODUCTION-GRADE CONTRACT (apps/api) — obey for everything you build. AI_AGENT_BUILD_GUIDE.md + CLAUDE.md 12 Laws
are supreme:
- This is large-scale multi-tenant SaaS for millions of users / billions of ops, under active attack. Production,
  never a demo. NestJS module pattern: domain (pure entities + state machines + errors/events) -> dto (zod .strict)
  -> repository (parameterised SQL, tenant-scoped) -> service -> controller (validate->authorize->delegate, no logic).
- SECURITY IS SERVER-SIDE & LAYERED: every endpoint behind AuthGuard + PermissionsGuard (@RequirePermissions) +
  the module's FeatureFlagGuard; RLS in the migration is the backstop (tenant_id + owner scoping). Never trust the
  caller's role/ids — re-resolve the subject from the token. A read returns ONLY rows the caller may see.
- MONEY is bigint MINOR UNITS in the DB (numeric/bigint columns) and in DTOs as minor-unit strings (Law 2). No
  float columns for money; compute splits/fees with integer math. Money MOVES only through the wallet-service
  double-entry ledger via the outbox/handler path (Law 11) — a controller NEVER mutates a balance directly.
- IDEMPOTENCY: every money-moving / state-advancing POST takes an Idempotency-Key (Law 3), persisted + de-duped.
  Cross-aggregate effects go through the transactional OUTBOX (no dual-write); consumers are idempotent.
- LIFECYCLE: state transitions go through the pure domain state machine (assertTransition -> 409 on illegal); the
  entity raises domain events; the outbox relays them. Mirror the existing module's shape EXACTLY.
- READ MODELS: list endpoints are KEYSET/cursor-paginated (never OFFSET), bounded limit, tenant-scoped. A read
  model exposes ONLY what the client needs (no over-exposure of PII / internal columns).
- MIGRATIONS: additive, reversible, numbered next in db/migrations; add RLS policies + indexes for every new table;
  seed lookups where the client needs names (no UUID-only surfaces the client must guess).
- DPDP / PII: never return raw Aadhaar/PAN/account numbers (masked only); tokenise bank refs at the gateway vault;
  PII export/delete is server-owned (the client only requests; the platform is the data controller).
- Before "done": `npm run build` (tsc, exit 0) + the unit/integration suite green + SQL parse-check; update the
  module README + MODULE_STATUS.md + this file + the SDK; PASTE green output. Red = not done.
```

> Build-sandbox note (same as every other backlog): `workspace:*` deps don't `npm install` in the offline sandbox,
> so the always-runnable gate is the **static audit + node-port unit test of each pure domain module + SQL
> parse-check**; `tsc`/`jest`/integration (real Postgres) run in CI. State that in each session's verification.

---

## 2. PRE-FLIGHT — read before writing a line (every session)
1. `AI_AGENT_BUILD_GUIDE.md` + `CLAUDE.md` (the 12 Laws) + the target module's existing
   `domain/ dto/ repository/ services/ controllers/ + *.entity.ts` — mirror its shape; never invent a new pattern.
2. **Confirm the gap is real**: grep the module's `controllers/v1/*.ts` for the route. If it already exists (e.g.
   `boosts.controller.ts`), only add the MISSING verb/field — do not duplicate.
3. The DB: `db/migrations/` (latest number + the RLS-in-migration pattern) + the relevant `0xxx_*.sql` schema for
   the tables you'll read/extend. Money columns are bigint minor units.
4. The consumer: the client row in §6 below names exactly which screen un-flags + which SDK method it expects —
   build the contract the client already assumes (it was wired flag-off), so the un-flag is a one-liner.

---

## 3. WHAT TO BUILD — per wave
A wave = the smallest backend slice that turns one client "coming soon" into a live feature: the migration (if a
new table/column is needed) + domain/dto/repo/service/controller + RLS + indexes + seeds + the SDK resource/method +
unit + integration test + docs. Reads are keyset; writes are idempotent + go through the outbox/ledger for money.

---

## 4. SECURITY / QUALITY CHECKLIST (self-audit before "done")
- [ ] Endpoint behind AuthGuard + PermissionsGuard (@RequirePermissions) + FeatureFlagGuard; RLS policy added in the migration.
- [ ] Subject re-resolved from the token (no IDOR); reads return only caller-visible rows; lists are keyset + bounded.
- [ ] Money is bigint minor units end-to-end; balances move ONLY via the wallet ledger + outbox (Law 11); no float money columns.
- [ ] Money-moving / state-advancing POSTs take an Idempotency-Key (Law 3); cross-aggregate effects via the transactional outbox.
- [ ] State transitions via the pure domain state machine (409 on illegal); events raised + relayed.
- [ ] No raw PII returned (Aadhaar/PAN/account masked); bank refs tokenised at the vault; DPDP flows server-owned.
- [ ] Migration additive + reversible + numbered; indexes for new query paths; lookups seeded (no UUID-only client surfaces).
- [ ] Pure domain unit-tested; `npm run build` + suite + SQL parse green (paste); README + MODULE_STATUS + this file + SDK updated.

---

## 5. THE ONE-PER-SESSION PLAN
Pick the lowest task whose deps are met and send `Yes next API-Wx …` + the §1 contract. After each: green gate ->
tick it here, refresh the module's `MODULE_STATUS.md` cell, add the SDK method, and (optionally, same or next
session) do the matching client un-flag (mobile `M-Wx` / web follow-up). Priority is **P1 first (money + trust),
then P2 (engagement), then P3 (nice-to-have)** — reorder freely to match business need.

---

## 6. WAVES — each un-flags the named client surface(s)

### P1 — money & trust (do first)
- [x] **API-W1 · wallet read-model ✅** — `GET wallet/v1/balance` (reconciled available+held, server-truth, bigint
  minor — reuses `WalletBalanceReadModel`) + `GET wallet/v1/ledger` (keyset, caller-scoped per-entry statement via
  new `WalletLedgerReadModel` joining `ledger_entries` → caller's `wallet_accounts` → `ledger_transactions`/`lookup_values`).
  Both ALWAYS the authenticated caller's own wallet (no `userId` param → zero IDOR); read-models fail closed; served
  from the replica; amounts as `::text` strings (Law 2); no money moved (Law 11). New `WalletController`
  (AuthGuard + PermissionsGuard; no feature flag — viewing your own balance is a core self-read). SDK:
  `client.wallet.balance()` / `.ledger()` + `WalletBalance` / `WalletLedgerEntry` types. No migration (reads
  existing 0006 tables). Cursor round-trips (unit-tested). *Un-flags:* mobile M-W1 (wallet balance / transactions(21)
  / earnings(58)); web-tenant `/wallet` running balance — **client un-flag pending** (point the screen at
  `wallet.balance()` / `.ledger()`, delete the "coming soon").
- [x] **API-W2 · KYC doc-types + bank vault tokenisation** — DONE: `GET kyc/doc-types` (reads the seeded
  `doc_type` lookup → `{id,code,name}` so clients show a name + submit a real `docTypeId`, never a UUID guess);
  read-replica + tenant-scoped, inherits the controller's AuthGuard + `kyc` flag, no PII, no subject id (zero IDOR).
  SDK: `kyc.docTypes()` + `KycDocType` type (exported from index). **Bank vault tokenisation was ALREADY built**
  (`bank_accounts.vault_ref` + masked `account_last4`/`ifsc`/`upi_id`/`holder_name`, `POST bank-accounts` taking a
  gateway `vaultRef` — raw number never sent/persisted; SDK `bankAccounts.add`) — not duplicated. **Aadhaar-eKYC
  start/OTP FLAGGED** — needs an external UIDAI/DigiLocker provider integration; not faked here (deferred to its own
  wave once a provider is contracted). *Un-flags:* mobile M-W2 (doc-types picker for KYC upload 173/174; bank-add 180
  already API-ready); web-tenant KYC submit doc-type select; web-partner KYC where shared.
- [x] **API-W6 · checkout totals-preview + pay-from-wallet** — DONE. `POST checkout/v1/preview`: read-only,
  server-computed per-seller + grand totals (subtotal + buyer charges + member benefits + coupon DRY-RUN via
  `coupons.validate`) from the active cart — NO order created, NO money moved, NO quota consumed; mirrors the
  checkout math exactly (float-free bigint, floored at 0); coupon applies to the primary seller only. `POST
  orders/v1/:id/pay-from-wallet`: idempotent (Law 3), amount = the order's SERVER total (never trusted from the
  client), buyer re-resolved from the loaded order (zero IDOR), only when status='payment_pending' (409 otherwise);
  money moves user-wallet → platform escrow via `PaymentService.captureOrderFromWalletInTx` (records a 'wallet'
  Payment in success + emits `payments.payment_succeeded` → the existing orders handler confirms the order async —
  one confirm path, no duplication; Law 11). Fails CLOSED on insufficient balance (`WALLET_INSUFFICIENT_BALANCE`).
  SDK: `checkout.preview()` + `orders.payFromWallet()` + `CheckoutPreview`/`CheckoutPreviewSeller`/`WalletPaymentResult`
  types (exported). No migration (reuses 0005 orders + 0006 wallet). *Un-flags:* mobile M-W5 (totals-preview,
  pay-from-wallet 130) + storefront/tenant checkout preview — **client un-flag pending**.

### P2 — engagement & ops
- [x] **API-W3 · device/push-token registration** — DONE. `POST notifications/v1/devices` (register the
  caller's Expo/FCM token; the EXACT path the mobile client already assumes) + `DELETE notifications/v1/devices`
  (revoke on logout). New migration 0045 `push_devices` — USER-scoped (no tenant_id/RLS, mirroring
  `notification_preferences`); `UNIQUE(token)` so a re-register UPSERTs (re-points the token at its latest owner +
  re-activates), and the repo ALWAYS filters by the caller's own user_id (no IDOR). Token treated as sensitive
  (never returned to others, never logged). Registration is naturally idempotent (unique-on-token) so no
  Idempotency-Key needed; revoke is idempotent + owner-scoped. Added `activeTokensForUser` read for the future
  send-side fan-out. Behind AuthGuard + PermissionsGuard + the `communication` flag (whole module). SDK:
  `notifications.registerDevice(platform, token)` + `notifications.revokeDevice(token)`. Pure `PushDevice.register`
  guard unit-tested (platform enum, token trim/empty/oversize). *Un-flags:* mobile M-W3 (`syncPushToken`) → real
  order/auction/wage push — **client un-flag pending**.
- [x] **API-W4 · listing boost price + analytics** — DONE. `GET listings/v1/boost-tiers`: the seeded
  `boost_tier` catalogue ({id, code, name, priceMinor, days} — price/days from `lookup_values.meta`, so the client
  shows real prices + submits a real tier id). `POST listings/v1/:id/boosts/pay-from-wallet`: server resolves the
  tier's AUTHORITATIVE price/days (client never sends money), debits buyer wallet → platform fees in one tx (Law 11,
  ledger type `listing_boost` seeded), records the boost + emits `listing.boost_started`; idempotent (Law 3); the
  core wallet ledger fails CLOSED on insufficient balance. `GET listings/v1/:id/analytics`: OWNER-ONLY (non-owner
  non-moderator → 404, anti-IDOR) seller engagement from REAL data — offers (listing_offers), price changes
  (listing_price_history), boosts purchased + active-boost endsAt (listing_boosts); replica-backed. **No fabricated
  "views"** — per-impression counting needs the high-volume event pipeline (a separate wave), so the read doesn't
  invent a number. The legacy `POST .../boosts` (pre-captured txnId) is unchanged. SDK: `listings.boostTiers()` /
  `.payBoostFromWallet()` / `.analytics()` + `BoostTier`/`BoostWalletPayResult`/`ListingAnalytics` types (exported).
  No migration (seed-only: ledger_txn_type `listing_boost`). *Un-flags:* mobile M-W4 (boost 114, analytics 115);
  web-tenant boost — **client un-flag pending**.
- [x] **API-W5 · buyer saves + public seller-profile + media URLs** — DONE. New `buyer` module:
  `POST/GET/DELETE buyer/v1/saves` (polymorphic favourites — listing/seller/product/worker/course; keyset list;
  idempotent add via the unique key) + `POST/GET/DELETE buyer/v1/saved-searches` (re-runnable filter sets). All
  OWNER-scoped (the caller's own userId, never a client id → no IDOR); on `saved_items`/`saved_searches` (0015) with
  RLS from 0020. `GET sellers/v1/:id/public` (listings module): SAFE public storefront only — display name, region,
  member-since, the PUBLISHED-review rating rollup, and active-listing count; **NO phone/email/KYC**; unknown/suspended
  seller → 404 (no enumeration). `GET listings/v1/:id/media`: signed photo gallery for a PUBLIC listing —
  `media_links`→`media_assets` CLEAN assets only, each turned into a short-lived presigned GET url via `OBJECT_STORE`;
  a draft/private listing yields an empty gallery (never leaks unpublished photos). SDK: `client.buyer.*` +
  `listings.sellerPublic()` / `listings.media()` + `SavedItem`/`SavedSearch`/`SellerPublicProfile`/`GalleryItem`
  types (exported). No migration (reuses 0015 saved_* + 0001 media_links/media_assets + 0020 RLS). *Un-flags:* mobile
  M-W5 (saved 126/127/128, seller-profile 100, detail gallery); storefront seller page + gallery — **client un-flag pending**.
- [x] **API-W7 · auctions my-bids + EMD amount** — DONE. `GET auctions/v1/my-bids`: the caller's OWN bids across
  ALL auctions, newest-first KEYSET (never OFFSET), ALWAYS filtered by the caller's bidder_user_id (owner-scoped, no
  IDOR). New `MyBidsReadModel` over a `bid.repository.listForBidder` join (bids→auctions) — each row carries the bid
  amount, the **EMD hold amount** (pure `emdHeldMinor`: `amount × emd_pct_bps / 10000` when bps configured, else the
  auction's fixed `emd_minor` — float-free integer math, Law 2), the auction status/ends, and an `isWinning` flag
  (winning_bid_id == bid.id). Replica-backed; route declared BEFORE `:id` so 'my-bids' isn't captured as an auction
  id; behind the `auctions` flag. SDK: `auctions.myBids()` + `MyBid` type (exported). No migration (reads existing
  0005 bids/auctions; EMD config already on the auction). EMD-compute unit-tested. *Un-flags:* mobile M-W7 (my-bids
  18, EMD amount) — **client un-flag pending**.
- [x] **API-W8 · labour apply + skills + attendance + lookups** — DONE. Four worker-side surfaces, backend-first,
  behind the `labour` flag. (1) **Worker self-apply** — `POST labour/bookings/:id/apply`: any authenticated worker
  volunteers for an OPEN booking. Migration 0046 adds an additive `applied` value to the `booking_status` enum (a
  separate migration, NOT used in its own tx — Postgres forbids that); `applied` is an INTEREST POOL excluded from
  `countActive` so applications never consume a booking slot. The caller's worker profile is re-resolved from the
  token (anti-IDOR), age-18 gated, deduped per booking; idempotent (Law 3). State machine: `applied → accepted |
  rejected | expired`. (2) **Self-declared skills** — `skillIds[]` on register/update-worker DTOs; `repo.setSkills`
  replaces the `worker_skills` set in-tx (unknown id → FK reject, never a silent drop); `myWorker()` now returns
  `skillIds`. (3) **Geo-fenced clock-in** — `POST labour/assignments/:id/attendance`: the device sends only its raw
  GPS fix; the server re-resolves the booking's farm coords and computes the great-circle distance itself (pure
  haversine `domain/geo.ts`), REFUSING a clock-in farther than `ATTENDANCE_FENCE_M = 100`m (422) — the client
  cannot forge proximity. Owner-scoped (the caller's accepted assignment), one row per assignment per day
  (backstopped by `attendance_records` UNIQUE), idempotent. attendance_records already had partitions + RLS from
  the 0014 auto-pass (it owns a tenant_id), so no new migration. (4) **Lookups** — `GET labour/lookups`: work-types
  (`lookup_values`), the skills tree, level-1 regions, and statutory skill-levels — real server ids + labels for
  client pickers (bounded reads). SDK: `labour.applyToBooking()`, `.clockIn()`, `.lookups()`, `skillIds` on
  worker prefs + `LabourAttendance`/`LabourLookups` types (exported). Pure unit tests: haversine fence math +
  `applied` transition + `apply` factory event. *Un-flags:* mobile M-W8 (apply 140, skills 37/137, attendance,
  taxonomy pickers) — **client un-flag pending**.
- [x] **API-W9 · ambassador assist + visit-log + leaderboard** — DONE. Migration 0047 adds `ambassador_visits`
  (geo field-visit log; visited party nullable for prospects) + `ambassador_targets` (per-period goal per metric;
  bigint minor for `earnings_minor`), both tenant-scoped with the RLS pass re-run. (1) **Assisted onboarding** —
  `POST ambassadors/assisted-onboarding`: an ACTIVE ambassador (re-resolved from the token, anti-IDOR) onboards a
  farmer on-behalf. Composes existing server-owned primitives (Law 11): identity `UserService.adminCreate`
  (idempotent-by-phone + `user.created_assisted` audit) + `ConsentService.grant` (DPDP, channel
  `ambassador_assisted`, `assistedBy`=ambassador) + a `signed_up` attribution referral. DPDP-gated (≥1 granted
  consent or 422) and idempotent on the caller's key (Law 3). The onboarding COMMISSION is NOT self-granted — it
  accrues only on the existing admin `referral.activate` gate. (2) **Visit log** — `POST/GET ambassadors/visits`:
  the caller-ambassador's own geo-stamped visits, keyset. (3) **Leaderboard** — `GET ambassadors/leaderboard`:
  tenant-scoped ranking by commission earned (bigint minor) over an optional window, with pure competition-rank
  ties (1,2,2,4). (4) **Targets** — `POST ambassadors/targets` (ambassador.manage sets) + `GET
  ambassadors/targets/me` (own). SDK: `ambassadors.assistedOnboard()` / `.logVisit()` / `.listVisits()` /
  `.leaderboard()` / `.myTargets()` + `AmbassadorVisit`/`AmbassadorTarget`/`LeaderboardEntry`/`AssistedOnboardingResult`
  types (exported). Pure unit tests: rank ties + visit factory + target invariants. *Un-flags:* mobile M-W9
  (assisted-create 89/90, visit-log 164, leaderboard 93/targets 169) — **client un-flag pending**.
- [x] **API-W10 · tenant mobile analytics + broadcast + settings** — DONE. (1) **Analytics** — `GET
  tenancy/analytics?from&to&currency`: the tenant's OWN dashboard (never cross-tenant — that god-mode plane is
  admin-api/platform-reports, Law 11), server-aggregated in float-free SQL (money SUM(...)::text bigint minor,
  Law 2) over a bounded window (`resolveWindow`: default 30d, clamped ≤366d, partition-pruned `orders`): GMV,
  orders, commission, platform-fee, refunded-orders, active-listings, open-disputes, payouts-paid, plus bounded
  top-5 products + top-5 sellers. View/impression "traffic" is OMITTED (needs the event pipeline — a later wave),
  never faked. tenant.settings perm. (2) **Broadcast** — `POST communication/broadcasts` (notification.manage,
  Idempotency-Key): records a `tenant_broadcasts` row 'queued' + emits ONE outbox event; the
  `BroadcastRequestedHandler` resolves the audience (all active members, or one role) in KEYSET PAGES (Law 8) and
  fans each page out through the EXISTING notification spine (per-user prefs + quiet hours + dedup), then marks the
  broadcast sent — no synchronous blast (Law 4). `GET communication/broadcasts` = history (keyset). Migration 0048
  (tenant_broadcasts + RLS re-run) seeds the `tenant.broadcast` event + push/inapp templates ({{title}}/{{body}}).
  (3) **Tenant-settings writes** — ALREADY present (`PUT tenant-settings`), not duplicated. SDK:
  `tenancy.analytics()` / `.broadcast()` / `.listBroadcasts()` + `TenantAnalytics`/`TenantBroadcast` types
  (exported). Pure unit tests: window resolution + broadcast state machine. *Un-flags:* mobile M-W10 (analytics
  84/150-152, broadcast 157); web-tenant inline charts + broadcast — **client un-flag pending**.

### P3 — nice-to-have / catalogue joins
- [x] **API-W11 · market commodity-name join + forecast** — DONE. The Mandi Pulse + price-history reads carried
  product/grade/region by UUID only; this adds the **catalogue name-join**. New `MarketNamesReadModel.resolve()`
  resolves a BOUNDED set of ids (only those present in the pulse/price page — never an unbounded scan) to
  `default_name` from the GLOBAL master tables (`products`, `attribute_options`, `admin_regions`) on the replica
  (CQRS, Law 12; tenant context applies so a tenant-private product still resolves under RLS, platform rows pass
  via tenant_id IS NULL). Pure helpers `distinctIds()` + `withNames()` attach `productName`/`gradeName`/`regionName`
  onto every row (unknown id → null, degrade-never-throw). Enriched: `GET market/pulse` (latest + band + ≤14
  history) AND `GET market/prices` (each page). No migration (read-join only). SDK: `MandiPrice`/`PricePrediction`
  (→ `MandiPulse`) gain optional `productName`/`gradeName`/`regionName`. Pure unit tests: distinct-collect + name
  merge. **Geocoded weather-forecast source FLAGGED** — needs an external (IMD/provider) integration not yet
  contracted; weather stays regional advisories (not faked). *Un-flags:* mobile M-W11 (mandi commodity/grade
  names) — **client un-flag pending**.
- [x] **API-W12 · farmer DPDP + change-phone + tip wishlist (AI + cross-entity search FLAGGED)** — DONE for the
  bounded, dependency-free surfaces. (1) **DPDP self-service** — `POST privacy/export-requests` (→ a 'portability'
  data_subject_request) + `POST privacy/deletion-requests` (→ 'erasure' with the statutory 90-day cooling-off set
  in the domain) + `GET privacy/requests` (the caller's own DSRs). Owner-scoped (subject = token userId, zero
  IDOR), idempotent (Law 3) AND deduped to one OPEN request per kind; the PLATFORM fulfils (compliance-ops in
  admin-api reads/works these) — the client only requests (Law 11). Each emits `identity.dsr_opened`. (2)
  **Change-phone** — `POST auth/change-phone/start` (OTPs the NEW number via the core OtpService; refuses a number
  already owned by another account) + `POST auth/change-phone/confirm` (verifies the OTP, then swaps the caller's
  OWN identity phone in one tx + emits `identity.phone_changed` with MASKED numbers only); start idempotent +
  per-user rate-limited, UNIQUE(phone) backstops a race. (3) **Tip wishlist** — added `'tip'` to the buyer
  saved-entity types, so `buyer.save({entityType:'tip', entityId})` (API-W5) now persists a tip wishlist (no new
  table). SDK paths already matched (privacy/assistant resources pre-wired in P-23). **FLAGGED, not faked:** the
  **farmer AI assistant** (`POST ai/assistant/messages`) needs the ai-services s2s governed-inference call +
  prompt-injection guardrails + cost/rate control + ai-governance logging — a substantial external subsystem
  (like Aadhaar-eKYC in W2); and a **dedicated cross-entity `GET search`** needs the OpenSearch index plane
  (admin-api/search-index), so the mobile keeps its honest client-side fan-out over existing reads. Pure unit
  tests: DSR cooling math + User.changePhone invariants + 'tip' type. No migration (reuses 0003 DSR/users + 0015
  saved_items). *Un-flags:* mobile M-W12 (DPDP 177/178/179, change-phone 176, saved tips) — **client un-flag
  pending**; AI(125) + global-search(183) remain flagged.

> Sequencing is advisory. Each wave is independent; none gates the others or the current green dots. The matching
> client un-flag (mobile `M-Wx`, web follow-up) is a small separate session once the SDK method lands.

---

## 7. PER-TASK COMPLETION RITUAL
1. `npm run build` (tsc exit 0) + unit/integration suite + SQL parse green (paste; note integration runs on CI's
   real Postgres; offline gate = pure-domain node-port + SQL parse).
2. Endpoint mirrors the module's existing pattern exactly (guards + flag + RLS + keyset + idempotency + outbox for
   money); the gap was confirmed absent in pre-flight (never duplicated).
3. SDK resource/method added in `@krishalaya/sdk-js` (typed) so the client un-flag is a one-liner.
4. Module README + `MODULE_STATUS.md` cell + this file's box updated; the matching client backlog row
   (`MOBILE_BUILD_BACKLOG.md` §6 / web app) noted as "unblocked — un-flag pending".
5. Self-audit §4 GREEN. Only then is the task done.

*North star: every endpoint is server-authoritative (RLS + RBAC + flag), money-safe (bigint minor units, ledger +
outbox, Law 11), idempotent, keyset-paginated, PII-minimal (DPDP), and mirrors the existing module pattern. Build
the contract the client already assumes so the "coming soon" flips to live in one small follow-up. Never fake a
read; never move money outside the ledger.*
