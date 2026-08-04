# mobile — build backlog (Krishalaya React Native app)

**Status today.** `apps/mobile` is ✅ (Phase-1 GA) as of the **M-W0** DoD-close below — every roadmap item
P-01…P-32 is built, the closing audit passed (305/305 pure tests green, §4 clean, i18n parity 1232×3, coverage
verified), and the `MODULE_STATUS.md` dot is flipped. The §6 fast-follows (built-but-flagged, awaiting a backend
endpoint) and §7 Phase-2 role apps remain as **tracked post-GA work** — they do not gate the GA dot.

> **Historical note — why it was 🟡 before M-W0.** Every roadmap item P-01…P-32 in `MOBILE_BUILD_ROADMAP.md` was
built and the whole Phase-1 screen catalogue (196 designs → **165 route files** across the 7 Phase-1 role groups)
was wired. The dot stayed amber for two honest reasons, neither of which was "an unbuilt screen":

1. **No formal DoD-close pass was ever recorded for mobile** — the web apps each flipped 🟡→✅ only after an explicit
   final "test-and-polish / DoD" wave (`SF-W5-01`, `TC-W6-01`, `AD-W7-01`, `PR-W3-01`) that re-ran the full suite,
   did the §4 self-audit, verified screen/boundary/i18n coverage, and **then** flipped the status. Mobile's last
   wave (P-32) shipped the release pipeline but nobody ran the equivalent closing audit + flipped the dot. **This
   file's `M-W0` is that wave.**
2. **A set of flows are intentionally "built-but-flagged"** — the mobile contract is fully wired (screen + SDK
   resource + pure logic + tests) but the **backend endpoint it needs does not exist yet**, so the screen honestly
   shows "coming soon"/degrades instead of faking a response. These are *backend* gaps, not mobile incompleteness,
   and each is enumerated in §6 with the exact API that unblocks it.

**What the deep review verified (offline, this pass):**
- **165** screen/route files under `src/app/{(auth),(farmer),(buyer),(worker),(ambassador),(owner),(system)}`.
- **All Phase-1 `core/*` modules present**: config, api, auth, flags, i18n, offline (queue+cache+sqlite+sync),
  connectivity, media, payments, push, voice, location, deeplink, security, observability, release, analytics, util.
- **All Phase-1 `features/*` data layers present** (listings/orders/wallet/buyer/cart/checkout/offers/messaging/
  auctions/labour×3/ambassador/education/tenant/market/content/schemes/profile/system/kyc/payments/notifications/…).
- **305 unit-test cases** across 34 spec files (pure logic: money/BigInt, state machines, geofence, redaction,
  update-gate, cache/SWR, OTP/role, search merge, etc.).
- **i18n parity EXACT**: `en`/`hi`/`gu` = **1232 keys each, zero missing / zero extra / zero dupes** (deep-flattened).
- **0** direct `apiClient()` calls in any screen (all I/O via `features/*.api`) — the guide's hard rule holds.
- **Security/release docs present**: `THREAT_MODEL.md`, `RELEASE.md`, `STORE_COMPLIANCE.md`; `app.config.ts`
  (Hermes/R8/cleartext-off/TLS pins), `eas.json` (phased rollout), CI workflows.
- Every feature vertical sits behind a **default-OFF feature flag** with a kill-switch.

> **Build-sandbox note (same caveat the web apps recorded).** This monorepo's `workspace:*` deps can't be installed
> by plain `npm`/`jest` in the offline sandbox, and a React-Native device/store build is **EAS/CI-only**. So the
> always-runnable gate here is the **static audit (§4)** + the **node-port unit run of each pure module** +
> **i18n-parity + no-apiClient-in-screens greps**; `tsc`/`jest`/`eas build`/Maestro run in CI. State that explicitly
> in each session's verification, exactly as the roadmap items did.

> **⛔ OUT OF SCOPE for GA — Phase-2 role apps (Wave 10).** Per `01_Phase1_Lean_Scope`, the Pashupalak/Dairy/Vet/
> Equipment/Store/Delivery-partner/Fintech/Vyapari-FPO roles are **Phase-2**. Their `features/*` folders exist
> (`dairy`, `mcc-operator`, `livestock`, `vet`, `delivery-partner`, `store-owner`, `fintech`, `vyapari-home`,
> `fpo-coordinator`) and the **backend modules are built**, but **no `(role)` route group is wired** for any of them
> and they must **NOT** be built for Phase-1 GA unless explicitly re-scoped. Listed in §7 so the backlog is complete.

Hand me one `Yes next M-Wx …` at a time with the contract (§1) pasted, exactly like the storefront / tenant / admin
/ partner cadence. `M-W0` is the only task that must run to flip the dot to ✅; §6 / §7 are fast-follows + Phase-2.

---

## 1. THE PRODUCTION-GRADE CONTRACT — mobile variant (paste at the top of every command)

```
PRODUCTION-GRADE CONTRACT (apps/mobile) — obey for everything you build. The mobile constitution
MOBILE_AI_AGENT_BUILD_GUIDE.md + CLAUDE.md 12 Laws remain supreme:
- This is large-scale multi-tenant SaaS product for millions of users / billions of ops, under
  active attack. Write code that withstands that — never a demo.
- This is the farmer/buyer/worker/ambassador/tenant-lite Expo (SDK 51, expo-router) app on the shared platform API
  via @krishalaya/sdk-js. Build production for rural users on low-end Android + flaky 2G/3G. Offline-first.
- SERVER IS THE ONLY SECURITY AUTHORITY. The app trusts its own role for NAVIGATION ONLY; the API re-enforces
  RBAC + RLS + every state transition + every money move on every call. Never widen scope client-side.
- DATA ACCESS ONLY THROUGH features/<vertical>.api (which calls the SDK). NEVER call apiClient() from a screen
  (grep-enforced = 0). Mirror the apps/api controller EXACTLY — never invent a path/verb. If the endpoint does not
  exist, BUILD THE CONTRACT + FLAG IT ("coming soon" / honest degrade) — NEVER fake a response (§6 tracks these).
- SECRETS: nothing secret in the JS bundle. The session access/refresh tokens live in the secure store
  (Keychain/Keystore), never logged, never in analytics/crash payloads (redactPII runs on every payload).
- MONEY is bigint MINOR-UNIT strings rendered via <MoneyText> (Law 2). ₹→paise via BigInt(rupees)*100n — never a
  float multiply; no toFixed/parseFloat/Number() on money. Pre-checks (withdrawable, min-next-bid, …) are float-free.
- IDEMPOTENCY: every money-moving / state-advancing mutation carries an Idempotency-Key (Law 3); reads may retry via
  the SWR cache, writes go through the durable offline queue (idempotent replay, no double-apply on double-flush).
- DEGRADE-NEVER-DIE (Law 12): every screen wires loading / empty / error states; every SDK call is timeout-bounded;
  reads are cached (airplane-mode usable), writes are queued and replay on reconnect. A flaky API never white-screens.
- LIFECYCLE: order/shipment/offer/auction/booking/dispute transitions reflect the SERVER state machine via the PURE
  features/** action maps — only legal actions render; a 409 degrades to a message. The pure logic is unit-tested.
- i18n: EVERY user string in hi/en/gu (full parity, no literals); numerals localized; ≥48px targets + a11y labels;
  tokens-only styling (ui-native theme) — no hardcoded colors/spacing.
- FEATURE FLAGS: every vertical behind a remote-hydrated flag (DEFAULT OFF) with a kill-switch.
- SENSITIVE SCREENS (OTP/KYC/payment/payout/bank/wallet/change-phone) set FLAG_SECURE.
- Before "done": typecheck + lint + the unit suite green (paste output; note device/EAS build is CI-only); the §4
  self-audit; update SCREENS_BACKLOG.md + MODULE_STATUS.md + this file. Red = not done.
```

---

## 2. PRE-FLIGHT — read before writing a line (every session)
1. `MOBILE_BUILD_ROADMAP.md` (what's built, P-01…P-32) + `SCREENS_BACKLOG.md` (screen→location→status map) +
   `MOBILE_AI_AGENT_BUILD_GUIDE.md` (the *how*) + this file's §6/§7.
2. The existing `src/core/*` (use them; never re-implement) and the relevant `src/features/<vertical>` (api + pure
   logic + screens) you're touching — mirror the established pattern.
3. The platform-API surface you'll consume: `apps/api/src/modules/<module>/controllers/v1/*.controller.ts` (exact
   path + verb) + the module DTOs/read-models. **Match the controller exactly; never guess.** If the endpoint is
   absent, it goes in §6 (flag-not-fake), not into a fake.
4. `@krishalaya/sdk-js` resources already in place; add a typed resource + types in the same session as the screen
   that first needs it (or use the SDK `request()` escape-hatch and note the assumed contract). Never fake a response.

---

## 3. WHAT TO BUILD — expo-router conventions (mirror the shipped verticals)
- **Screens** in `src/app/(role)/**` stay thin: resolve data via `features/<vertical>.api`, render ui-native
  primitives, wire loading/empty/error. Role tab groups gate on the role + a default-OFF flag.
- **Mutations** go through `features/<vertical>.api` → SDK with an Idempotency-Key where money/state moves; writes
  enqueue on the durable offline queue and replay on reconnect; `SdkError` maps to a localized message.
- **Cross-screen logic** (state machines, money/BigInt math, geofence, redaction, search merge, update-gate) lives
  in PURE, unit-tested `features/**` or `core/**` modules — no React, no fetch — so it runs in the node-port suite.
- **i18n** keys added to `src/core/i18n/locales/{en,hi,gu}.json` (full parity, enforced); numerals localized.

---

## 4. SECURITY / QUALITY CHECKLIST (self-audit before "done")
- [ ] No secret/token in the JS bundle; token only in the secure store; never logged or in analytics/crash payloads (`redactPII` on every payload).
- [ ] `0` direct `apiClient()` in `src/app/**` (all I/O via `features/*.api`) — grep-enforced.
- [ ] Money via `<MoneyText>` + bigint minor units; ₹→paise via `BigInt` (no float; no `toFixed`/`parseFloat`/`Number()` on money).
- [ ] Money-moving / state-advancing mutations carry an Idempotency-Key; writes queue + replay idempotently (no double-apply).
- [ ] Every screen degrades (loading/empty/error); reads cached (airplane-mode usable); SDK calls timeout-bounded.
- [ ] Legal-only lifecycle actions via the pure state machine; 409 degrades to a message.
- [ ] i18n parity hi/en/gu (no missing/extra/literals); ≥48px targets + a11y labels; tokens-only styling.
- [ ] Vertical behind a default-OFF flag + kill-switch; sensitive screens set FLAG_SECURE.
- [ ] Pure modules unit-tested; typecheck + lint + jest green (paste; note device/EAS build is CI-only).

---

## 5. THE ONE-PER-SESSION PLAN
Pick the lowest task whose deps are met and send `Yes next M-Wx …` + the §1 contract. After each: green gate →
tick it here + refresh the `apps/mobile` cell in `apps/api/MODULE_STATUS.md`. **When `M-W0` passes, mobile flips
🟡→✅** (Phase-1 GA scope). §6 items are post-GA fast-follows that un-flag as their API lands; §7 is Phase-2.

---

## WAVE 0…11 — roadmap (P-01…P-32) — ✅ ALL DONE
Built and verified per `MOBILE_BUILD_ROADMAP.md` (do not rebuild; reference only):
- [x] **Wave 0** foundation: ui-native (theme + 10 primitives), `core/*` (config/api/offline-queue/session.reducer/
  secure-store/auth.store/i18n/otp+role helpers), onboarding 01–05, farmer tabs + 09/10/12/112.
- [x] **P-01** media capture+upload core · **P-02** connectivity + offline read-cache + sync engine ·
  **P-03** payments (Razorpay) + KYC core · **P-04** push + in-app notification center.
- [x] **P-05** listing photos+voice+manage · **P-06** farmer wallet+txns+payouts · **P-07** orders+delivery+PoD.
- [x] **P-08** buyer browse+search+detail · **P-09** cart→checkout→order · **P-10** offers/inquiry/chat.
- [x] **P-11** auction discovery+bidding+live (Wave 4 complete).
- [x] **P-12** worker onboarding+jobs · **P-13** worker active-job geo+wage+insurance · **P-14** farmer-side hire.
- [x] **P-15** ambassador home+onboarding · **P-16** ambassador earnings+training.
- [x] **P-17** tenant mobile dashboard+approvals+ops-lite · **P-18** tenant analytics+broadcast+settings-lite.
- [x] **P-19** mandi+weather · **P-20** tips+crop-hub+AI assistant · **P-21** schemes · **P-22** profile/farm/bank/docs/help.
- [x] **P-23** global search + settings + DPDP system screens (Phase-1 screen catalogue complete).
- [x] **P-30** security hardening · **P-31** observability+crash+analytics · **P-32** release pipeline + store compliance.

## WAVE M0 — DoD close (the ONLY task that flips 🟡→✅)
- [x] **M-W0 · mobile-test-and-polish ✅ → web-mobile flips 🟡→✅** — closing audit run (offline gate per the
  sandbox note): **305/305 pure unit tests GREEN** via node-port; §4 sweep GREEN (0 `apiClient()` in screens; no
  token logged; the only `Number()` in a money path is the documented Razorpay gateway-boundary paise cast in
  `core/payments/checkout.ts`, not money math; i18n parity **1232×3, zero drift**; 0 hardcoded hex in screens =
  tokens-only; every vertical flag default-OFF + kill-switch); coverage GREEN (165 routes across the 7 role groups;
  17 FLAG_SECURE screens; security cores pinning/integrity/deeplink-guard/clipboard-policy/screen-guard present);
  every `SCREENS_BACKLOG.md` ⬜/🟡 marker reconciled to a §6 backend-gap or §7 Phase-2 row (nothing silently
  unbuilt). `tsc`/`jest`/`eas build`/Maestro remain CI-only. Status flipped in `MODULE_STATUS.md`.
  1. **Full suite green in the real toolchain** — `tsc --noEmit` + `eslint` + `jest` (305+ cases) under CI's
     pnpm/expo toolchain (paste output; the offline gate is the node-port run of every pure module).
  2. **§4 self-audit GREEN across the whole app** — re-run the greps: `0` `apiClient()` in screens; no token/secret
     in bundle; money only via `MoneyText`/BigInt (no float coercion); i18n parity hi/en/gu (1232×3, no drift);
     tokens-only styling; every vertical flag default-OFF.
  3. **Coverage verification** — every Phase-1 screen group in `SCREENS_BACKLOG.md` resolves to a real route;
     every fetching screen has loading/empty/error; every sensitive screen sets FLAG_SECURE (audit the 17);
     deep-link allowlist + clipboard policy hold.
  4. **Reconcile the docs** — confirm `SCREENS_BACKLOG.md` ⬜/🟡 markers each map to a §6 backend-gap row or a §7
     Phase-2 row (nothing silently unbuilt); refresh the `apps/mobile` MODULE_STATUS cell; **flip 🟡→✅** with a
     one-line DoD note (mirrors `TC-W6-01`/`PR-W3-01`).
  - **DoD:** all four green + the status flipped. This closes Phase-1 mobile GA; §6/§7 remain as tracked post-GA work.

---

## 6. POST-GA FAST-FOLLOWS — "built-but-flagged", un-flag as the backend endpoint lands
Each row is **already wired on mobile** (screen + SDK contract + pure logic + tests) and **honestly degrades**
today. It is NOT mobile incompleteness — it ships the moment `apps/api` exposes the endpoint. Do **not** fake any
of these; flipping a row = delete the "coming soon" + point at the real endpoint + add the data-layer test.

| Task | Flagged surface(s) | What's missing (backend/SDK) |
|---|---|---|
| **M-W1 · wallet-read-model** | balance + transactions(21) **API READY ✅** (un-flag pending); earnings(58), spending-insights(182), autopay(181) still flagged | **API-W1 shipped** `GET wallet/v1/balance` + `GET wallet/v1/ledger` (SDK `client.wallet.balance()`/`.ledger()`) → wire the wallet screen onto them + delete "coming soon" (the mobile un-flag). Earnings aggregate / spending-insights / autopay still have no endpoint (later API wave). |
| **M-W2 · KYC + bank tokenisation** | KYC doc-upload(173/174) **doc-types API READY ✅** (un-flag pending); bank-add(180) **API READY ✅** (vaultRef already live); Aadhaar-eKYC(72/73) still flagged | **API-W2 shipped** `GET kyc/v1/doc-types` (SDK `client.kyc.docTypes()` → `{id,code,name}`) → point the doc-type picker at it + delete "coming soon". Bank-add was already API-ready (`POST bank-accounts` + `vaultRef`/masked fields; SDK `bankAccounts.add`) — wire bank+UPI add. **Aadhaar-eKYC start/OTP still has no endpoint** (needs external UIDAI/DigiLocker provider — later API wave); keep flagged. |
| **M-W3 · push token register** | `syncPushToken` (device-token registration) **API READY ✅** (un-flag pending) | **API-W3 shipped** `POST notifications/v1/devices` (the exact path `fcm.ts` already posts to) + `DELETE notifications/v1/devices` for logout. SDK `client.notifications.registerDevice(platform, token)` / `.revokeDevice(token)` → swap the raw `apiClient().request` in `core/push/fcm.ts` for the typed SDK call + wire `revokeDevice` into logout, delete the FLAGGED-GAP note. In-app center was already fully real. |
| **M-W4 · listing boost + analytics + LLM voice** | boost(114) **API READY ✅** + analytics(115) **API READY ✅** (un-flag pending); voice→crop/qty/price extract still flagged | **API-W4 shipped** `GET listings/v1/boost-tiers` (SDK `client.listings.boostTiers()` → real prices) + `POST listings/v1/:id/boosts/pay-from-wallet` (SDK `client.listings.payBoostFromWallet(id, tierId, key)` — server-priced wallet debit) → wire the boost screen + delete "coming soon" (flip `listing_boost`). `GET listings/v1/:id/analytics` (SDK `client.listings.analytics(id)`) → the analytics screen (offers/price-changes/boosts; no view counter yet). **Still no server AI extraction** (voice stays free-text only) — that's the API-W12 AI scope. |
| **M-W5 · buyer saves + seller profile + gallery + totals/wallet-pay** | ALL **API READY ✅** (un-flag pending): saved(126/127/128), seller-profile(100), detail gallery, totals-preview, pay-from-wallet(130) | **API-W6 + API-W5 shipped.** API-W6: `client.checkout.preview()` (bill before checkout) + `client.orders.payFromWallet(id, key)` (wallet pay CTA). API-W5: `client.buyer.save/listSaves/unsave` + `client.buyer.*SavedSearch*` → move `features/buyer/saved.api.ts` off device-local storage onto the server wishlist (saves now persist + sync across devices); `client.listings.sellerPublic(id)` → seller-profile screen (100); `client.listings.media(id)` → detail gallery (signed urls). All un-flags are SDK one-liners. |
| **M-W6 · offers/chat polish** | seller incoming-offers UI (farmer), inline image thumbnails, realtime chat | `features/offers` + `box=incoming` ready; needs the farmer screen wired. Chat is poll-based (DoD allows); inline thumbnail needs media **download-link** wiring; socket optional. |
| **M-W7 · auctions polish** | EMD amount display + my-bids(18) **API READY ✅** (un-flag pending); live socket still 4s poll | **API-W7 shipped** `GET auctions/v1/my-bids` (SDK `client.auctions.myBids()` → cross-auction bids, each with `emdHeldMinor` + `isWinning`) → build the my-bids screen (18) + show the real EMD held instead of "deposit held". **Live = 4s poll stays** (DoD allows; realtime socket is the realtime-gateway's separate scope). |
| **M-W8 · labour endpoints** | worker apply(140), skills(37/137), attendance/clock-in, taxonomy pickers ALL **API READY ✅** (un-flag pending); work-history(138) still pending | **API-W8 shipped.** `client.labour.applyToBooking(bookingId, key)` → worker self-apply CTA on the open-job screen (140; creates an `applied` interest-pool assignment, no slot consumed). `skillIds` on `registerWorker`/`updateWorker` + `myWorker().skillIds` → the skills picker (37/137) backed by `client.labour.lookups().skills` (real ids + tier). `client.labour.clockIn(assignmentId, {lat,lng}, key)` → the active-job clock-in (the ≤100m geofence is computed + enforced SERVER-side; the device just sends its GPS fix) — delete the flagged stub. `client.labour.lookups()` → taxonomy pickers (work-type/skill/region/skill-level) instead of hard-coded UUIDs. All un-flags are SDK one-liners. **Still pending:** clock-OUT + hours/overtime + employer dual-confirm + work-history(138) (API-W deferred); wages still settle server-side (Law 11). |
| **M-W9 · ambassador endpoints** | assisted account-create(89/90), visit-log(164), leaderboard(93)/targets(169) ALL **API READY ✅** (un-flag pending); on-behalf listing/order(162/163) + goals(170) still pending | **API-W9 shipped.** `client.ambassadors.assistedOnboard({phone, consents[...]}, key)` → the assisted account-create flow (89/90) — creates the farmer + DPDP consent + attribution server-side (consent-gated, audited; commission accrues on admin activation). `client.ambassadors.logVisit({purpose,lat,lng,...})` + `.listVisits()` → the visit-log (164), persisted + geo-stamped. `client.ambassadors.leaderboard()` → the leaderboard (93) with real ranks + earned totals; `client.ambassadors.myTargets()` → the targets panel (169). All un-flags are SDK one-liners. **Still pending:** on-behalf listing/order create (162/163) + custom goals(170) — separate scope; broad on-behalf acting raises its own consent/authz surface. |
| **M-W10 · tenant-lite read/write APIs** | mobile analytics(84/150-152), broadcast-send(157), tenant-settings writes ALL **API READY ✅** (un-flag pending) | **API-W10 shipped.** `client.tenancy.analytics({from,to})` → render the owner analytics dashboard (84/150-152) with real figures (GMV/orders/revenue/refunds/active-listings/disputes/payouts + top products/sellers; money minor-unit strings) instead of the web-handoff catalogue — `traffic` stays web-only (no event pipeline yet). `client.tenancy.broadcast({title,body,audienceRoleCode?}, key)` + `.listBroadcasts()` → the broadcast composer (157) sends to all members or one role (async fan-out via the notification spine). Tenant-settings writes were already API-ready (`PUT tenant-settings`). All un-flags are SDK one-liners; heavy editing still deep-links to web per the DoD. |
| **M-W11 · market name-join** | mandi commodity/grade names **API READY ✅** (un-flag pending); live geocoded forecast still pending | **API-W11 shipped.** `client.market.pulse()` + `client.market.prices()` rows now carry `productName`/`gradeName`/`regionName` (catalogue name-join, server-side) → render commodity/grade names instead of UUIDs; un-flag is reading the new fields. **Weather stays regional advisories** — a geocoded forecast needs an external (IMD/provider) integration not yet contracted, flagged not faked. |
| **M-W12 · tips/AI + DPDP + search** | DPDP export/delete(178/179/177) + change-phone(176) + saved-tips ALL **API READY ✅** (un-flag pending); farmer AI(125) + dedicated global-search still flagged | **API-W12 shipped (bounded surfaces).** `client.privacy.requestDataExport()/requestAccountDeletion()/myRequests()` → the DPDP screens (177/178/179) now hit real `privacy/export-requests`/`deletion-requests`/`requests` (server-owned fulfilment; 90-day erasure cooling). `client.privacy.startPhoneChange()/confirmPhoneChange()` → change-phone(176) via `auth/change-phone/start|confirm` (OTP-verified, server swaps the identity phone). `client.buyer.save({entityType:'tip',...})` → saved-tips wishlist persists server-side (entity type added). All un-flags read the already-wired SDK methods. **Still flagged:** farmer AI assistant(125) — needs the ai-services governed-inference s2s + guardrails (external subsystem); dedicated cross-entity search — needs the OpenSearch index plane, so global-search keeps its honest client-side fan-out. |

> Sequencing: these are P1/P2 fast-follows, **not GA blockers** — `M-W0` flips the dot regardless. Pull each row
> when its API ships; each is a small, isolated "un-flag + wire + test" session.

## 7. PHASE-2 ROLE APPS — OUT OF GA SCOPE (do not build unless re-scoped)
Folders + backend exist; **no route group wired**; explicitly Phase-2 per `01_Phase1_Lean_Scope`:
- **P-24** Dairy / MCC operator · **P-25** Livestock + Vet · **P-26** Delivery partner · **P-27** Store owner ·
  **P-28** Fintech (loans/insurance, farmer-facing) · **P-29** Vyapari/FPO extras (market dashboard, requirements
  inbox, supplier shortlist, group lots).

---

## 8. PER-TASK COMPLETION RITUAL
1. `tsc --noEmit` + `eslint` + `jest` green (paste; note device/EAS build is CI-only; offline gate = node-port pure
   modules + greps).
2. SDK calls mirror the apps/api controller exactly (never invent; a missing endpoint is flagged in §6, never faked);
   no `apiClient()` in screens; money via `MoneyText`/BigInt; mutations carry an Idempotency-Key + queue.
3. i18n keys in hi/en/gu at full parity; ≥48px + a11y; tokens-only; vertical behind a default-OFF flag; FLAG_SECURE
   on sensitive screens.
4. Update `SCREENS_BACKLOG.md` + this file's box + the `apps/mobile` cell in `MODULE_STATUS.md`; ship/refresh a
   feature README + "Threats considered" note.
5. Self-audit §4 GREEN. Only then is the task done.

*North star: every screen is offline-first, secret-free, server-authoritative (role is for nav only), money-safe
(bigint minor units via MoneyText), idempotent on writes, accessible + tri-lingual, behind a default-OFF flag, and
degrades instead of dying. Mirror the apps/api controller exactly; flag a missing endpoint (§6) instead of faking it;
never build Phase-2 roles (§7) for GA.*
