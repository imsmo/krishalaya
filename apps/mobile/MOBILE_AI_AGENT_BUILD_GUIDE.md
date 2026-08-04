# MOBILE AI AGENT BUILD GUIDE — Krishalaya App (React Native / Expo)

**Paste the "Mobile Production-Grade Contract" (§1) at the top of EVERY mobile build command.**
This is the engineering constitution for the Krishalaya mobile app — the primary surface for **millions of
real, concurrent users** (farmers, buyers, workers, traders, ambassadors) issuing **billions of operations**,
on budget Android phones, on 2G/flaky networks, in 3 launch languages. Our ambition is to be the **world's
largest agri platform**, so assume from day one that well-funded global competitors and attackers are reverse-
engineering the APK, replaying our APIs, scraping our catalogue, and probing every input. Build for that —
every screen is production, never a demo.

> ### ⚠️ READ FIRST — "Must render (exact design content)" is a PARITY CHECKLIST, not data to hardcode
> Every screen spec lists exact strings/values. They split into two kinds and are built **differently**:
>
> 1. **UI chrome / labels** (e.g. "Today's Mandi Pulse", "per qtl", "Speak to Sell", nav items, section titles,
>    button text, units, the `*` required marker) → **static, via i18n keys (hi/en/gu)**. These are SUPPOSED to be
>    fixed — they don't change per user. That is not "demo data".
> 2. **Data values** (e.g. `₹2,840`, `₹12,450`, `Ramesh ji`, `28°C`, `3 Active`, a listing title, an order status,
>    a wallet balance) → **DYNAMIC, fetched from the DB via the SDK at runtime**. The numbers printed in the spec
>    are the values the **seed** produces for the demo farmer — they exist so you can **verify** the screen renders
>    correctly, NOT so you paste them in. A screen that hardcodes `₹2,840` or `"Ramesh ji"` is **REJECTED**.
>
> **Rule:** if a value would differ between two real users, two tenants, or two points in time, it MUST come from
> `features/<area>/<area>.api.ts` → SDK → API → DB (money via `MoneyText`/paise). It is NEVER a literal in the
> screen. Verify by logging in as the seeded farmer `+919900000101` (guide §13) and seeing the seed's data appear —
> if you change the DB row, the screen must change with zero code edits. That is the definition of "done" here.
> The end state of all 196 screens is a **live, DB-backed, multi-tenant production app** for millions of real users —
> never a static mock-up of the designs. (See §12.6 and §13. The exemplar `src/app/(farmer)/home.tsx` does exactly
> this: greeting, wallet balance, mandi pulse and tip all come from `features/farmer/dashboard.api`; a section that
> can't load its real data HIDES rather than showing a fake — Law 12.)

This guide is the mobile sibling of `AI_AGENT_BUILD_GUIDE.md` (backend). When the two overlap, both apply; the
**12 Laws in `CLAUDE.md` are supreme** (esp. Law 2 money=bigint-minor, Law 3 idempotency, Law 11 god-mode lives
only in admin-api — NEVER in the app, Law 12 degrade-never-die).

**Exemplars to match (already built — copy their structure & rigor):**
- Component library: `packages/ui-native/` (theme + primitives, tokens-only, ≥48px targets, a11y).
- App core: `apps/mobile/src/core/` — `config.ts` (fail-closed), `api/client.ts`, `api/offline-queue.ts`
  (durable, idempotent, tested), `auth/session.reducer.ts` (pure, tested), `auth/token-store.ts` (SecureStore),
  `auth/auth.store.tsx`, `i18n/`, `auth/otp.helpers.ts` + `role-switcher.ts` (pure, tested).
- A shipped vertical: `apps/mobile/src/app/(auth)/*` + `(farmer)/*` and `src/features/listings/listings.api.ts`.
- Screen catalog + backlog: `apps/mobile/SCREENS_BACKLOG.md` and `apps/mobile/screen-specs/` (per-screen specs).
- Designs: `../Phase-1 all screen design/` — pixel/UX source of truth. Tokens: `packages/tokens` + ui-native `theme`.
- **Design data (NEW — §13):** `docs/design-data/` — `SCREEN-DATA-CATALOG.{json,md}` (every screen's exact
  strings/values), `demo-dataset.json` (entity data), and `db/local/demo-design-data.sql` (loads it into Postgres).

---

## 1. THE MOBILE PRODUCTION-GRADE CONTRACT (paste at the top of every command)

```
MOBILE PRODUCTION-GRADE CONTRACT — obey for everything you build in apps/mobile + packages/ui-native:
- Hyperscale client for millions of concurrent users / billions of ops, on low-end Android & 2G,
  under active attack and reverse-engineering. Write code that withstands that — never a demo.
- DESIGN PARITY IS PASS/FAIL (§12): the screen must visually + behaviourally match its Phase-1 design
  (../Phase-1 all screen design/.../screens/NN-*.html) — full layout, every section, header, copy (hi vern +
  en), states, and flow. A bare/simplified screen that "works" but doesn't look like the design is REJECTED.
  Build from the screen's spec in apps/mobile/screen-specs/ + the design HTML, not from memory.
- Match the exemplars: packages/ui-native (components) and apps/mobile/src/core + the (auth)/(farmer)
  verticals (screens/data). Mirror their layering, naming, and rigor. NEVER deep-import; use the
  package/feature public surface.
- NO stubs, NO TODOs, NO placeholders, NO fake data, NO hardcoded screens. If a backend contract or
  dependency is missing, build the real call against the SDK or EXPLICITLY flag it — never invent ids,
  prices, or mock responses wired into the UI. Verify with the seeded demo data (log in as the seeded
  farmer +919900000101 in tenant demo-fpo — §13), not by hardcoding values into the screen.
- Bake in EVERY time: the server is the only authority (the app NEVER trusts its own role/permission
  for security — only for navigation); tokens only in encrypted secure storage (never AsyncStorage/logs);
  every mutation carries an Idempotency-Key (Law 3); money is ALWAYS bigint minor-unit strings via
  MoneyText/formatMoneyMinor — never a float/Number (Law 2); every network call is timeout-bounded with
  retry/backoff on GETs only; every screen DEGRADES, never crashes (Law 12) — empty/cached/inline-error,
  never a white screen or 500 bubble; i18n keys (hi/en/gu), never literals; ≥48px touch targets + a11y labels.
- Offline-first: reads serve from cache then revalidate; writes enqueue durably (OfflineQueue) and replay
  with the same idempotency key — the farmer never loses work in the field.
- Think adversarially for every screen/endpoint call: how does a hostile user/competitor abuse it from a
  patched APK or a script? Close it (see §4). Assume the client is fully untrusted; enforce on the server.
- Tests are MANDATORY: unit-test all non-trivial PURE logic (reducers, state machines, money math, parsers,
  queue, validators). Component/e2e where it earns its keep. Mock-only tests that prove nothing are rejected.
- Performance budgets are hard limits (see §5): cold start, bundle/APK size, list frame rate, memory.
- Before "done": run typecheck + unit tests + lint (and the RN build in CI); self-audit against §4–§8 and §12
  and the §9 checklist; PASTE the green output. Red = not done. If a scale/security trade-off is ambiguous,
  choose what a top global consumer app (think Google/Meta/Stripe scale) ships, and state the assumption.
```

---

## 2. PRE-FLIGHT — read before writing a line
1. `CLAUDE.md` — the **12 Laws**. Non-negotiable. (Law 11: god-mode/admin powers are NEVER in this app.)
2. `apps/mobile/README.md` + `apps/mobile/SCREENS_BACKLOG.md` + **the screen's spec in `apps/mobile/screen-specs/`**.
3. **The design itself** — open `../Phase-1 all screen design/Krishalaya_Design_System/screens/NN-*.html` AND
   its extracted content in `docs/design-data/SCREEN-DATA-CATALOG.md` (every label/value the screen must show).
4. The exemplar vertical IN FULL: `src/app/(farmer)/*` + `src/features/listings/listings.api.ts` (data-layer
   pattern: SDK call → degrade-never-die → offline-queue for writes → typed result).
5. `packages/ui-native/src/index.ts` + `theme.ts` — use these primitives/tokens; **never** hardcode a color,
   spacing, font, or a raw `<TextInput>`/`<Button>` when a primitive exists. Add a primitive if one is missing.
6. The matching backend contract: the SDK resource (`@krishalaya/sdk-js`) OR the API controller/DTO in
   `apps/api/src/modules/<domain>` so field names + idempotency + money types match EXACTLY. If the SDK lacks a
   typed method, use the SDK `request()` escape-hatch and note the assumed contract; if the endpoint itself is
   missing, flag it — never fake the response.
7. `apps/mobile/src/core/i18n/locales/{hi,en,gu}.json` — add keys for every new string in ALL three languages.

---

## 3. WHAT TO BUILD — structure (match the exemplars exactly)
Routing is **expo-router** (file-based) under `src/app`. Role groups are `(auth)`, `(farmer)`, `(buyer)`, …
Feature logic/data lives under `src/features/<area>/` and is imported by the screens — screens stay thin.

- `src/app/(role)/_layout.tsx` — the role's navigator (Tabs/Stack); **auth-gate** (Redirect if anonymous).
- `src/app/(role)/<screen>.tsx` — a screen: read params → call a feature hook/api → render ui-native components.
  No business logic, no direct `fetch`, no raw styling. Loading → `SkeletonCard`; empty/failure → `EmptyState`.
- `src/features/<area>/<area>.api.ts` — the data layer: typed functions over the SDK; **degrade-never-die**
  (catch → empty/cached); **writes go through the OfflineQueue** with an idempotency key; keyset pagination only.
- `src/features/<area>/<area>.store.ts` — local UI/feature state (pure reducer + hook) when needed; PURE core is
  unit-tested.
- `src/features/<area>/components/` — feature-specific composite components built ONLY from ui-native primitives.
- `src/core/*` — cross-cutting: `config`, `api` (client + offline-queue + interceptors), `auth`, `i18n`,
  `offline` (kv + sqlite + sync), `push`, `voice`, `location`, `analytics`, `util`. Never instantiate raw
  storage/fetch in a screen — use core.
- `packages/ui-native/src/components/*` — reusable, presentational, tokens-only, a11y, ≥48px.
- `__tests__/` colocated under `src/core/__tests__` (pure) and feature tests where logic warrants.
- Every feature folder gets a one-paragraph header comment: what it owns, which screens, which API.

If a string, color, or number is about to be hardcoded → STOP: it belongs in i18n, theme, or config.

---

## 4. SECURITY — the part global competitors attack first (mandatory)
**Golden rule: the mobile app is fully untrusted. Every security decision is enforced on the server; the app
only reflects it.** A patched/rooted APK can call any endpoint with any payload — design as if it will.

- **Secrets / tokens.** Access+refresh tokens ONLY in `expo-secure-store`, rotated on refresh, cleared on
  sign-out. NEVER AsyncStorage, JS globals, logs/analytics/crash reports. Only `EXPO_PUBLIC_*` config in the
  bundle. Fail closed at boot if config missing.
- **Transport.** HTTPS only; **TLS cert/public-key pinning** in production (backup pin + rotation); no cleartext.
- **Device integrity.** Root/jailbreak + Play Integrity / App Attest on sensitive flows (login, payments,
  payouts, KYC) — server-side signal, not a hard client block (degrade), raises server risk scoring.
- **Anti-tamper.** Release: Hermes bytecode, minify, ProGuard/R8 + resource shrink, native-string obfuscation,
  no dev menus, strip source maps from the artifact (upload privately to the crash service).
- **API abuse.** Every mutation sends an **Idempotency-Key** per user+action (Law 3). Server enforces
  per-user/-device/-IP rate limits + bot defenses; the app debounces, bounds lists, backs off on 429.
- **AuthN/OTP.** Phone-OTP is enumeration-safe (UI advances identically). Respect server resend cooldown +
  attempt caps; surface the server's throttle message; never reveal account existence.
- **AuthZ.** Role is for NAVIGATION only. The app NEVER grants a permission. Every protected action is authorized
  server-side; a 403 is a friendly "not allowed", never worked around.
- **IDOR / data minimization.** Never trust an id from a deep link/param without server re-check of
  ownership/tenant. Request only the fields a screen needs; never cache another user's/tenant's data.
- **Input validation.** Validate + normalize on the client for UX (phone E.164, pincode, IFSC, amounts as
  integer minor units) AND know the server re-validates (zod .strict). Guard regexes against ReDoS.
- **PII & privacy (DPDP).** Never store raw Aadhaar/PAN/bank in plaintext or logs; masked/last-4 only. Explicit
  consent (append-only), export/delete, retention. Redact PII from analytics/crash. **`FLAG_SECURE`** on
  KYC/payment/wallet screens.
- **Deep links / WebViews / clipboard.** Validate every route + param; never auto-execute from a link without
  auth + confirm. Avoid WebViews; if unavoidable, no file access, no native JS bridge, allowlist origins. Never
  put OTP/tokens on the clipboard.
- **Supply chain.** Pin deps; no unvetted native modules; `npm audit`/Snyk in CI.

Deliverable per feature: a short **"Threats considered"** note + regression tests for client-side invariants
(idempotency key present, token never logged, money never floated, degrade path renders).

---

## 5. SCALE & PERFORMANCE — budgets are hard limits
- **Cold start** < 2.5s to interactive on a 2 GB Android. Defer non-critical work; lazy-load heavy routes.
- **Bundle/APK** small (Hermes, tree-shaking, no unused native modules, compressed assets, vector icons).
- **Lists:** `FlatList`/`FlashList`, stable keys, windowing, `getItemLayout` where possible; **keyset pagination
  only** (never offset); no work in `renderItem`; never map a huge array into a ScrollView.
- **Rendering:** memoize hot paths; `StyleSheet.create` (no inline style objects); native-driver animations; 60fps.
- **Network:** one timeout-bounded client; GETs retry w/ backoff, mutations enqueue (never auto-retry); SWR cache
  with tenant-prefixed keys + invalidation on write; no N+1 per screen.
- **Offline-first:** SQLite read cache + durable write queue; usable with no signal; reconciles on reconnect.
- **Memory/data:** compress images before upload; cap caches; release listeners on unmount; respect data-saver.
- **Money:** bigint minor units end-to-end; format at the edge via `formatMoneyMinor`.

---

## 6. RESILIENCE & OBSERVABILITY (degrade, never die — Law 12)
- Wrap EVERY external dependency (API/SDK, push, location, STT, payments) with timeout + retry/backoff + fallback.
- Every screen wires three states: loading (`SkeletonCard`), empty/error (`EmptyState` + retry), data. A thrown
  render error is a defect (the global `AppErrorBoundary` is the last resort, not the plan).
- **Crash + error reporting** with PII/token redaction; private source maps. **Analytics** funnels (no PII),
  behind consent, offline-buffered. Correlation id propagated to the API.
- **Every feature behind a remote feature flag, default OFF, with a kill-switch** (Law 10). Forced-update +
  maintenance screens. Client SLOs for hot flows (login success, create-listing success, crash-free ≥ 99.5%).

---

## 7. ACCESSIBILITY, i18n & INCLUSIVITY
- **i18n:** hi/en/gu via `useTranslation()` keys — never a literal. Add all 3 for every key. Indic digits where
  the design uses them. RTL-safe layouts.
- **Low-literacy / a11y:** large type, high contrast (sunlight), ≥48px targets, voice-first (Speak-to-Sell),
  icons + text, `accessibilityLabel/Role/State` on every interactive element, screen-reader tested, OS font scaling.
- **Vernacular money/number/date** via `@krishalaya/i18n`. Never assume English locale.

---

## 8. MNC-GRADE DELIVERY PROTOCOL
- **PRs:** trunk-based/GitFlow, required review (CODEOWNERS), small PRs, conventional commits.
- **CI gates (green to merge):** `typecheck`, `lint`, `unit`, RN/Expo build, dep audit, bundle-size, e2e on the
  critical flow, the §9 checklist.
- **Release:** versioned + changelog; EAS profiles (dev/preview/production); staged rollout (1%→10%→100%) with
  crash gates; OTA (expo-updates) for JS fixes with flag discipline; documented rollback; forced-update floor.
- **Store compliance:** Play/App Store policy, minimal justified permissions (just-in-time + rationale),
  accurate data-safety labels, age rating.
- **Privacy/legal:** DPDP, consent, export/delete, retention; privacy policy in-app.
- **Docs:** every feature ships a README + "Threats considered" + updates `SCREENS_BACKLOG.md`, the screen-spec
  status, and `apps/api/MODULE_STATUS.md`.

---

## 9. DEFINITION OF DONE (with PROOF)
```bash
cd apps/mobile
npm run typecheck       # exit 0
npm run lint            # exit 0
npm run test            # all green (pure logic: reducers, queue, money, validators)
# packages/ui-native: npm run typecheck
# CI additionally: expo/EAS build, dependency audit, bundle-size, e2e on the critical flow
```
Then: wire the screen into expo-router, add i18n keys (hi/en/gu), put the feature behind a flag (default OFF),
write the feature README + "Threats considered", update `SCREENS_BACKLOG.md` + the screen-spec status +
`MODULE_STATUS.md`. **Plus the §12 design-parity check (screenshot vs design).** Paste the green output. Red = not
done. (A full device build runs in CI/EAS, not the offline sandbox — say so; the framework-free core is what's
unit-verified locally.)

---

## 10. REVIEW CHECKLIST (founder/CTO, before merge)
Structure & laws:
- [ ] Screens thin (read → feature api → ui-native render); no business logic, raw fetch, or raw styling.
- [ ] Built ONLY from ui-native + theme tokens; no hardcoded color/spacing/font; ≥48px targets + a11y labels.
- [ ] All strings are i18n keys present in hi/en/gu; vernacular number/money/date.

Recurring mobile bug-classes — grep the diff:
- [ ] **Money as number/float** (must be bigint minor strings + MoneyText).
- [ ] **Token/PII/secret** in AsyncStorage, logs, analytics, crash, or the bundle.
- [ ] **Mutation without Idempotency-Key**, or a GET that retries a write.
- [ ] **A screen that can throw/white-screen** (missing loading/empty/error) — Law 12.
- [ ] **Trusting client role/permission for security** instead of the server.
- [ ] **Offset pagination / unbounded list / work in renderItem**.
- [ ] **Literal user-facing strings / hardcoded design values**.
- [ ] **Deep-link/param used without server-side ownership re-check** (IDOR).

Design parity (§12):
- [ ] Every section/region in the design HTML is present (header, hero, cards, lists, CTAs, bottom nav).
- [ ] Bilingual copy (vern + en) matches; emoji/iconography matches; gold/green/earth palette per tokens.
- [ ] Loading/empty/error states designed (not blank); spacing/radius/shadow match the design system.

Security & scale (§4–§5): server-authority + graceful 403; pinning + secure storage + FLAG_SECURE; enumeration-
safe auth; timeout + degrade + kill-switch flag; perf budgets; offline cached reads + queued idempotent writes.

If any fail: *"This violates the Mobile Production-Grade Contract / DoD item X / §12 design-parity and diverges
from the exemplar at <file>. Fix and re-verify."*

---

## 11. PACE & SEQUENCING
- Build in `apps/mobile/screen-specs/00-INDEX.md` order — finish one role/feature vertical before the next; a
  screen's data dependencies (SDK method/endpoint) come first.
- Add a ui-native primitive or a core capability JUST BEFORE the first screen that needs it.
- **One feature vertical ≈ one session + review.** Never "build all roles at once." Tests green → behind a flag
  (OFF) → pilot cohort → smoke → phased rollout.

---

## 12. DESIGN-PARITY STANDARD (the new bar — why this guide was updated)
The Phase-1 verticals were built **functionally** but several screens render a **simplified/bare** version of the
design (e.g. `05 profile-setup` shows 2 fields where the design has a full form; `09 home` was missing the mandi
pulse / tip sections). That is NOT acceptable going forward. A screen is "done" only when it is a faithful
reproduction of its design.

**The parity bar (all must hold):**
1. **Every region of the design HTML exists** — header (avatar/greeting/weather/bell), hero/banner, all cards,
   lists, chips/filters, CTAs, helper text, and the bottom nav. Nothing dropped or collapsed.
2. **Copy matches** — the bilingual strings (Devanagari/Gujarati vern + English) and microcopy from
   `docs/design-data/SCREEN-DATA-CATALOG.md` for that screen, via i18n keys (hi/en/gu).
3. **Visual language matches** — green/gold/earth palette, radii, shadows, type scale — all from `ui-native/theme`
   (never ad-hoc). Emoji/icon set as the design uses.
4. **All states designed** — loading (skeleton that mirrors the layout), empty (designed EmptyState), error
   (inline retry). Never a blank body.
5. **Behaviour/flow matches** — the screen's actions go where the design's flow goes (e.g. profile-setup →
   role-appropriate home; create-listing voice/photo entry points wired).
6. **Data is real** — populated from the API/SDK (verify with the seeded farmer, §13), never hardcoded; degrade
   to designed empty/`—` when a datum is genuinely unavailable (Law 12), never a fake number.

**Workflow for each screen:** open the design HTML + its spec (`screen-specs/`) + its catalog content → list every
region → build/repair the screen + any missing ui-native primitive → wire real data → wire 3 states → i18n(3) →
self-audit §10 + this §12 → screenshot against the design.

---

## 13. DESIGN-DATA SOURCES & HOW TO VERIFY (use these, don't hardcode)
Built for exactly this rebuild — the single source of truth for content + demo data:
- **`docs/design-data/SCREEN-DATA-CATALOG.md` / `.json`** — every visible string/value of all 196 screens, keyed
  by `NN-name`. Use it to know exactly what a screen must show.
- **`docs/design-data/demo-dataset.json`** — the entity data (Ramesh, Sunita, listings, mandi prices, orders,
  auction, schemes, tips, notifications…) with stable IDs and money in paise (Law 2).
- **`db/local/demo-design-data.sql`** — loads that data into Postgres so the app serves it **live** from the API.
- **`apps/mobile/screen-specs/`** — the per-screen build spec (this work item).

**Verify a screen against real data (NOT by hardcoding):**
1. Ensure DB is seeded: `psql "$DATABASE_URL" -f db/local/demo-design-data.sql` (idempotent; mandi prices refresh
   to today). The mobile app's tenant (`EXPO_PUBLIC_TENANT_ID`) is already the demo tenant `demo-fpo`.
2. In the app, log in as the seeded farmer **`+919900000101`** (Ramesh Patel). Read the dev OTP from the
   `apps/api` terminal (the dev SMS sender logs it). His listings/orders/schemes populate the screens.
3. Global sections (mandi pulse, tips) require their server flags ON (`market_intel`, `education`) — enable per
   tenant; otherwise the endpoint 403s and the section correctly hides.

**Known data gaps to build the real path for (flag + degrade until then — never fake):**
- A **mandi pulse-list** read-model (top-N crops with commodity name + day-over-day change%) — the current
  `/v1/market/prices` is per-product and doesn't return the home-pulse shape.
- **Wallet balance/ledger** lives in the separate `wallet-service` DB (`kv_wallet`) — needs its own seed/endpoint.
- **Labour bookings / ambassador earnings** demo rows (FK-heavy) — extend the seed when building those verticals.

*North star: when in doubt, build it like the `(farmer)` vertical + `ui-native`, make it pixel-match the design,
assume a global competitor is reading the decompiled APK, and ship what a top-tier consumer app at
hundreds-of-millions of users would ship.*
```

