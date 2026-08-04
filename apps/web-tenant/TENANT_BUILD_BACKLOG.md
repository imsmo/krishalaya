# apps/web-tenant — BUILD BACKLOG (what the 🟡 means, and the one-per-session plan)

**Status today.** `web-tenant` is 🟡 — a **thin vertical slice**, not a finished console. What exists and works:

- **Routes:** `/login` (phone-OTP, two Server Actions), `/dashboard` (server-gated, greets via `auth.me()`),
  `/listings` (`listings.browse`, keyset), `/orders` (generic `request()` escape hatch, `box=tenant`, keyset),
  `POST /api/session` (logout).
- **Data layer:** `lib/env.ts` (single reader, fail-closed, no secrets in bundle), `lib/api-client.ts`
  (`tenantClient()` authed + `anonClient()` for login), `lib/auth.ts` (httpOnly `kvt_access`/`kvt_refresh`
  cookies, `requireSession()`), `components/DataTable.tsx`, `styles/globals.css`, `public/robots.txt` (noindex).

**Honest gaps vs. the storefront's finished bar (these are the first things the waves fix):**
1. **No i18n at all** — every page has hardcoded English literals (`Listings`, `Orders`, `Next page →`, column
   headers). There is no `src/i18n` catalog. The storefront ships en/hi/gu with full key parity; the console must too.
2. **No silent refresh** — `lib/auth.requireSession()` is a sync presence check; there's no `refreshSession()`
   off the `kvt_refresh` cookie like the storefront's `lib/session.ts`.
3. **Escape-hatch reads** — `/orders` uses `tenantClient().request('GET','orders',{box:'tenant'})` instead of the
   typed `orders.list({ role: 'seller' })`. Prefer the typed resource; only use `request()` when the SDK truly
   lacks a method (and flag it).
4. **Inline styles** (`style={{ marginTop: 16 }}`) instead of token-driven CSS classes.
5. **No `loading.tsx`/`error.tsx`/`not-found.tsx` boundaries; no tests; no RBAC-aware nav.**
6. **Only read surfaces** — no seller mutations (create/publish listing, fulfil orders, respond to offers, run
   auctions, request payouts) and none of the long-tail console.

Everything below is **frontend-only**: the API (apps/api ✅, admin-api ✅) and the SDK (`@krishalaya/sdk-js` ✅)
already expose the endpoints + types these tasks consume. No new backend, no new SDK resource — **if a task needs
one, STOP and flag it** rather than reaching past the SDK. Each task is one build session per the Production-Grade
Contract below; **hand me one `Yes next TC-Wx-yy …` at a time** with the build guide pasted, exactly like the
storefront / apps-api / mobile cadence.

> **Likely SDK-gap surfaces (expect to FLAG, not fake).** `sdk-js` is consumer/seller-oriented. The
> vertical-operator and tenant-*config* surfaces the spec lists almost certainly have **no seller-side SDK
> method**: commission-rules editing, delivery-zones, branding, integrations, webhooks, billing-config, staff
> permissions matrix, languages, plus the operator verticals dairy-MCC / labour-as-employer-admin / schemes-as-
> assistant / ambassadors-admin / group-lots / auditor / ai-review-queue. Where the SDK lacks a tenant-admin
> method, the task STOPs and flags it (the surface is unblocked only when `sdk-js` or `admin-api`'s client adds
> it) — we never invent an endpoint or call past the typed SDK. The waves below deliberately scope to what the
> seller-facing SDK *does* expose.

---

## 1. THE PRODUCTION-GRADE CONTRACT — tenant-console variant (paste at the top of every command)

```
PRODUCTION-GRADE CONTRACT (web-tenant) — obey for everything you build:
- This is the SELLER / TENANT-ADMIN console for businesses running on the platform, under active attack. Build
  production, not a demo. It is an AUTHENTICATED app — every page is noindex; there is no public surface.
- Match the reference: the FINISHED apps/web-storefront (its lib/session, i18n, Server-Action + boundary
  patterns) and the existing apps/web-tenant lib (env/api-client/auth), plus @krishalaya/sdk-js + i18n + tokens.
  Mirror their layering and rigor.
- NO stubs, NO TODOs, NO placeholders. If a needed API/SDK method is missing, STOP and flag it —
  never fake data, never call the API past the typed SDK, never invent an endpoint. Nav links ONLY to built routes.
- DATA ACCESS ONLY VIA THE SDK. Server Components / Server Actions / Route Handlers use tenantClient()
  (authed, injects the httpOnly session) or anonClient() (login only). Browser code never holds a token. Prefer
  the typed resource; only use client.request() when the SDK genuinely lacks the method, and flag that gap.
- SECRETS: only NEXT_PUBLIC_* may reach the browser (lib/env.ts is the single reader, fail-closed). The session
  tokens stay in the httpOnly+Secure+SameSite cookies (lib/auth.ts) — never readable by JS.
- AUTH + RBAC: login/refresh/logout run in Route Handlers / Server Actions calling the SDK auth resource and
  writing/clearing the cookies. requireSession() gates every console page (redirect anonymous → /login?next=).
  The API re-enforces RBAC + tenant scoping on EVERY call — the cookie is convenience, never the authority
  (defence in depth, Law 1/4). The UI only reflects what the server allows; a 403 degrades to a clear message,
  never a crash, and never reveals another tenant's data (no IDOR — server-scoped).
- MONEY is rendered from bigint MINOR-UNIT STRINGS via formatMoneyMinor — never a float (Law 2).
- DEGRADE, NEVER DIE (Law 12): every SDK call is timeout-bounded; pages catch failures and render an empty/error
  state — a flaky API never 500s the console. GETs may retry; mutations never auto-retry.
- MUTATIONS pass the user's Idempotency-Key where the SDK exposes it (create/publish/transition/bid/payout), so a
  double-submit/refresh never double-acts. Lifecycle transitions reflect the server state machine (only legal
  actions shown).
- ACCESSIBILITY + i18n: semantic HTML, labelled controls, keyboard-navigable; all copy via @krishalaya/i18n
  (en/hi/gu, full key parity, NO hardcoded strings); loading.tsx + error.tsx boundaries per route segment;
  noindex metadata on every page (no SEO surface).
- Before "done": `npm run typecheck` (tsc --noEmit, exit 0) + `npm run lint` (next lint) + `npm run build`
  (next build emits .next) + `npm test` green; self-audit against §4 below; PASTE the green output. Red = not done.
```

> Build-sandbox note (same caveat the storefront recorded): this monorepo's `workspace:*` deps can't be installed
> by plain `npm` in the sandbox, so the gate that always runs here is the **static §4 self-audit**; `tsc --noEmit`
> + `next lint` + `next build` + `jest` run in CI's `pnpm` toolchain. State that explicitly in each session's
> verification, exactly as the storefront did.

---

## 2. PRE-FLIGHT — read before writing a line (every session)
1. `apps/web-tenant/README.md` + the existing pages/lib in `src/`, AND the finished `apps/web-storefront/src/`
   (lib/session.ts, i18n.ts, i18n catalogs, Server-Action + boundary patterns) — the gold-standard structure.
2. The SDK surface you'll consume: `packages/sdk-js/src/resources/<resource>.ts` + `…/types.ts` (method names,
   inputs, the `Page`/`Envelope` shapes, money-as-string). Seller-relevant resources: `listings` (create/publish/
   changePrice/startBoost/getOwn), `orders` (list role=seller + lifecycle transitions), `shipments`, `offers`
   (box=incoming + counter/accept/reject), `auctions` (create/approve/cancel/list/get/listBids), `payouts`,
   `bankAccounts`, `payments` (list), `kyc`, `reviews`, `tenancy` (plans/subscription), `notifications`, and the
   admin-ish `admin.ts` (RbacResource / DisputesResource / UsersResource). **Match the SDK exactly; never guess.**
3. `docs/spec/06_web_apps.md` (`web-tenant` section) — the intended route list (it's large; most config/operator
   routes are SDK-gap-flagged above).
4. `@krishalaya/i18n` keys (add new keys in en/hi/gu, never inline literals) + `@krishalaya/tokens`
   (design tokens / theme — never hardcode colours/spacing).
5. `lib/{env,api-client,auth}.ts` (+ the new `lib/session.ts` once W0 lands) — use these; never read `process.env`
   or build a fetch client elsewhere.

---

## 3. WHAT TO BUILD — Next.js App Router conventions (match the finished storefront)
- **Routes** live in `src/app/**` and stay THIN: a Server Component resolves data via the SDK and renders
  presentational components. Console pages are dynamic (authed). Interactivity uses small `'use client'`
  components only where needed (e.g. a confirm dialog, a price form).
- **Mutations** are **Server Actions** / **Route Handlers** (`app/**/route.ts`) — the only place the authed
  `tenantClient()` is invoked for writes; they pass the Idempotency-Key and `revalidatePath`/`redirect` on success.
- **Cross-route logic** (table configs, status maps, form schemas, money math) lives in `src/features/**` as
  PURE, unit-tested modules; shared UI in `src/components/**`. Every route segment that fetches gets
  `loading.tsx` + `error.tsx`; the app gets a root `not-found.tsx`.
- **Auth + RBAC gating**: `requireSession()` (async, with silent refresh after W0) redirects anonymous users; the
  server enforces role permissions, and the UI hides actions the caller can't perform (reflecting, never granting).

---

## 4. SECURITY / QUALITY CHECKLIST (self-audit before "done")
- [ ] No secret reaches the browser bundle (only `NEXT_PUBLIC_*`; nothing server-only imported into a client component).
- [ ] Session tokens only in the httpOnly cookies; never serialised into HTML/props/client JS.
- [ ] Every authed mutation goes through a Server Action / Route Handler with the session + Idempotency-Key (where exposed); no token in the client.
- [ ] Every page is `requireSession`-gated + noindex; a missing/foreign id → `notFound()` (server-scoped, no IDOR); a 403 degrades to a clear message.
- [ ] Money rendered via `formatMoneyMinor` from minor-unit strings (never a float; never `toFixed` on a number).
- [ ] Pages degrade (try/catch → empty/error state), never 500; SDK calls are timeout-bounded; GET-only retries.
- [ ] All copy via i18n (en/hi/gu full parity); semantic + keyboard-accessible markup; localized loading/error boundaries.
- [ ] `tsc --noEmit` + `next lint` + `next build` + `jest` green (paste output; note they run in CI's pnpm toolchain).

---

## 5. THE ONE-PER-SESSION PLAN
Pick the lowest-numbered unchecked task whose dependencies are met and send:

> `Yes next TC-W0-01 console-foundation-refit but follow the AI_AGENT_BUILD_GUIDE / the web-tenant Production-Grade Contract pasted below.` + the contract (§1).

After each task: green gate → I tick it ✅ here and refresh the `web-tenant` cell in `apps/api/MODULE_STATUS.md`.
When the last box is ticked, `web-tenant` flips to ✅.

### WAVE 0 — foundation refit (bring the slice to storefront-grade)
- [x] **TC-W0-01 · console-foundation-refit** — add `src/i18n/{en,hi,gu}.ts` + `lib/i18n.ts` (server Translator,
  `kvt_lang` cookie → Accept-Language → default); an RBAC-aware **app shell** (sidebar/topbar nav that links only
  to built routes, locale switcher, sign-out, staff name from `auth.me()`); `lib/session.ts` (async
  `refreshSession()` off `kvt_refresh` + async `requireSession(returnTo)` redirecting to `/login?next=`); root
  `loading.tsx`/`error.tsx`/`not-found.tsx`; and **rewrite the existing 4 pages** (login/dashboard/listings/orders)
  to the new bar — all copy via i18n, no inline styles, `/orders` switched to the typed `orders.list({role:'seller'})`
  (drop the `request()` escape hatch), money via `formatMoneyMinor`. jest + ts-jest config (mirror storefront).

### WAVE 1 — catalogue management (the seller's core)
- [x] **TC-W1-01 · listing-create-media** — `/listings/new`: create a draft listing (`listings.create`,
  Idempotency-Key) with the real **media upload** flow (`media.requestUpload` → PUT to the presigned URL →
  `media.confirmUpload`), attaching `mediaIds`. Validated form, money as minor-unit strings, fail-closed.
- [x] **TC-W1-02 · listing-manage** — `/listings/[id]`: owner detail (`listings.getOwn`) + **publish**
  (`listings.publish`), **change price** with optimistic concurrency (`listings.changePrice` + `expectedVersion`),
  and **start boost** (`listings.startBoost`) where the SDK exposes it; status/质 reflect the server state machine.

### WAVE 2 — order fulfilment & negotiation
- [x] **TC-W2-01 · order-fulfilment** — `/orders/[id]`: seller order detail (`orders.get`) with the **lifecycle
  transitions** (`confirm → packed → ready → delivered → complete`, plus `cancel`) as idempotent Server Actions
  reflecting the legal state machine, and **shipment** view/update via `shipments` (status, AWB, deliver+OTP where
  exposed). Line items + server-computed totals via `formatMoneyMinor`.
- [x] **TC-W2-02 · offers-incoming** — `/offers`: the seller's **incoming** offers (`offers.list({box:'incoming'})`,
  keyset) + `/offers/[id]` with **accept / counter (minor-unit) / reject** Server Actions (accept → server creates
  the order; link to it). Idempotency where exposed.

### WAVE 3 — money (payouts, settlements, wallet)
- [x] **TC-W3-01 · payouts-and-bank** — `/payouts`: the tenant's payout history (`payouts.list`, keyset) + a
  **request payout** Server Action (`payouts.request`, Idempotency-Key) to a tokenised bank account
  (`bankAccounts.list`/`add` — vault ref only, never raw account numbers). Money via `formatMoneyMinor`.
- [x] **TC-W3-02 · settlements-wallet** — `/wallet`: settlement/payment history (`payments.list`, keyset) +
  balance/summary where the SDK exposes it. (If a wallet-balance read isn't in the SDK, FLAG it and ship the
  payments ledger only.)

### WAVE 4 — engagement & oversight
- [x] **TC-W4-01 · auctions-manage** — `/auctions`: the tenant's auctions (`auctions.list`, keyset) + create
  (`auctions.create`, Idempotency-Key, minor-unit money) + `/auctions/[id]` (detail, bid history `listBids`,
  approve/cancel where the seller role allows). Flag-gated by the API `auctions` flag (degrade-empty when off).
- [x] **TC-W4-02 · disputes-and-reviews** — `/disputes`: the tenant's disputes via the SDK `admin.ts`
  `DisputesResource` (list + detail + the resolve/respond methods it exposes — STOP & flag any it doesn't); plus a
  **reviews** summary surface (`reviews.summary` for the seller's rating). Money via `formatMoneyMinor`.
- [x] **TC-W4-03 · notifications** — `/notifications`: the staff member's inbox (`notifications.inbox`, keyset,
  unread filter, mark-read) + `/notifications/preferences` (event×channel matrix + quiet hours), mirroring the
  storefront's notifications build.

### WAVE 5 — tenant administration
- [x] **TC-W5-01 · billing-plan** — `/billing`: the tenant's subscription + plan catalogue (`tenancy.currentSubscription`,
  `tenancy.plans`, `tenancy.listSubscriptions`) with **apply/change plan** (`tenancy.apply`, Idempotency-Key) and
  the usage/limits read-out. Money via `formatMoneyMinor`.
- [x] **TC-W5-02 · team-and-roles** — `/team`: tenant staff + role assignments via the SDK `admin.ts`
  `UsersResource` + `RbacResource` (list users, list roles, the assign/revoke methods they expose — STOP & flag
  any they don't). Reflects RBAC; the server authorises every change.
- [x] **TC-W5-03 · kyc-and-profile** — `/kyc`: the tenant's own KYC documents (`kyc.list` + `kyc.submit` with the
  media flow), statuses masked (never raw doc numbers); plus the seller profile basics the SDK exposes
  (`auth.me` / identity). (Tenant-config: branding/commission-rules/delivery-zones/integrations/webhooks are
  **SDK-gap-flagged** — see the callout; build only what the SDK exposes, flag the rest.)

### WAVE 6 — quality & DoD
- [x] **TC-W6-01 · tenant-test-and-polish** — unit tests for the pure logic (order-transition map, money math,
  RBAC-visibility helper), a11y pass (landmarks/labels/keyboard), `loading.tsx`/`error.tsx` coverage, noindex on
  every route, and a final `tsc`/`lint`/`build`/`jest`-green sweep. Closes the console DoD; flips `web-tenant` to ✅.
  **Done:** all 11 pure `features/**` modules are unit-tested (1:1 spec coverage — the RBAC-visibility/state-machine
  helpers `orders/lifecycle`, `listings/manage`, `offers/negotiation`, `auctions/manage`, `disputes/manage`,
  `billing/plan`, `team/form`, `profile/form` + money math `listings/form`, `payouts/form` + the `nav/safe-next`
  open-redirect guard). Every route segment that fetches has its own `loading.tsx` (20 pages ↔ 20 boundaries) over
  the root `loading.tsx`/`error.tsx`/`not-found.tsx`; **noindex** is enforced app-wide via the root layout's default
  `robots:{index:false,follow:false}` plus per-page `generateMetadata`. a11y: semantic landmarks (`<nav aria-label>`,
  `<main id=main>` + skip-link), labelled controls, keyboard-navigable forms, `role=status`/`role=alert` live regions.
  §4 self-audit green: i18n parity 468×en/hi/gu (no missing/extra/dupes), no token in any client bundle, no stray
  `process.env`, no inline styles, money only via `formatMoneyMinor`. `tsc`/`lint`/`build`/`jest` run in CI's pnpm
  toolchain (the sandbox can't install `workspace:*`); the always-on gate here is this static §4 sweep.

> **`web-tenant` is ✅** — the seller/tenant-admin console DoD is closed. The remaining tenant-*config* + vertical-
> operator surfaces (integrations, webhooks, billing-config, staff-permissions matrix; dairy-MCC /
> labour-employer-admin / schemes-assistant / ambassadors-admin / group-lots / auditor / ai-review-queue) stay
> **SDK-gap-flagged**: the seller-facing `sdk-js` exposes no method for them, so they are intentionally out of scope
> and unblocked only when the SDK (or admin-api client) adds them — never faked, never reached past the typed SDK.
>
> **P1-10 (resolved):** **commission-rules, delivery-zones, branding, languages** are no longer SDK-gap-flagged —
> the `sdk-js` `tenantConfig` resource now exposes them and `/settings` wires all four (Server Actions → the audited,
> RBAC-gated API; platform-default commission rows shown read-only; money stays server-authoritative). See
> `docs/production-backlog/P1-GA-completeness.md` → P1-10.
>
> **P1-11 (partial):** the **staff-permissions matrix** is no longer SDK-gap-flagged — `sdk-js` `rbac` now exposes
> `roles`/`permissions`/`assign`/`revoke`/`setOverride` and `/team/roles` wires the matrix (platform roles excluded
> from the picker, UNGRANTABLE perms hidden, escalation blocked client-side AND server-side; a server 403 surfaces as
> "escalation not allowed"). **integrations, webhooks, billing-config stay FLAGGED** — their tables exist
> (`0002_tenancy_billing.sql`) but the only controllers today are admin `providers-ops` + inbound `payment-webhooks`;
> tenant self-serve needs NEW `apps/api` modules (vault-ref credentials, HMAC-signed outbound delivery + retry,
> subscription-update endpoints), tracked as P1-11-followup-A/B/C in `docs/production-backlog/P1-GA-completeness.md`.

---

## 6. PER-TASK COMPLETION RITUAL
1. `tsc --noEmit` + `next lint` (+ `next build` + `jest`) green (paste output; note they run in CI's pnpm toolchain).
2. New routes/components/Server Actions follow the thin-route + SDK-only + httpOnly-session + RBAC-gated pattern.
3. i18n keys added (en/hi/gu, full parity); money via `formatMoneyMinor`; a11y + noindex metadata + loading/error boundaries in place.
4. README "What it serves" updated; this backlog box ticked; `web-tenant` cell in `MODULE_STATUS.md` refreshed.
5. Self-audit §4 clean. Only then is the task done.

*North star: every page is server-first, secret-free, RBAC-respecting, money-safe, accessible, and degrades
instead of dying — and reads exactly like the finished storefront pages + the SDK they stand on. Never reach past
the typed SDK; flag the gap instead.*
