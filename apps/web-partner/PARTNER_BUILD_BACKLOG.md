# web-partner — build backlog (financial / logistics partner portal)

**Status today.** `web-partner` is ✅ — **both partner verticals are fully built** on the shared platform API
(`@krishalaya/sdk-js`): the lending vertical (loan queue + decisions, products, lender registry, portfolio +
repayments) and the logistics vertical (fleet setup, zones/routes/cold-chain, the full shipment delivery lifecycle),
on a persona-aware shell with central i18n, silent-refresh session gate, root boundaries, and 7 unit-tested pure
modules (≈220 assertions). All PR-W0…W3 waves are ticked below. It serves **two external partner personas** that
authenticate against the SAME platform
API as tenants, but whose token carries **partner-scoped** permissions (`loan.manage`, `shipment.manage`, …) — the
API decides what they can see (only consented/assigned records), never the client. What exists and works today:

- **Routes:** `/login` (phone-OTP, two Server Actions → httpOnly tokens), `/dashboard` (lender pipeline KPIs rolled
  up from the review queue), `/loan-queue` (`GET fintech/loan-applications?box=review`, keyset), `/loan-queue/[id]`
  (application detail + lender-decision Server Actions: review / approve [amount + cooling-off] / reject / disburse
  [Idempotency-Key, Law 3]), `POST /api/session` (logout).
- **Data layer:** `lib/env.ts` (single reader, fail-closed, no secrets in bundle), `lib/api-client.ts`
  (`server-only`; wires the SDK with the partner's session token, read SSR-side only — anon client only for OTP),
  `lib/partner-auth.ts` (httpOnly `kvp_access`/`kvp_refresh` cookies, `requirePartner()`), `components/DataTable.tsx`,
  `styles/globals.css`, `public/robots.txt` (noindex).

**Honest gaps vs. the finished storefront/tenant/admin bar (these are the first things the waves fix):**
1. **No i18n / centralised copy** — every page has hardcoded English literals (`<h1>Partner overview</h1>` …);
   there is no `src/i18n` catalog nor a `lib/i18n` `Translator`. (Partners are external B2B businesses, so **en is
   primary**; `hi`/`gu` parity is *optional* — but copy must be centralised, never scattered literals.)
2. **No app shell** — there is no `Sidebar`/nav component; pages hand-roll links. Needs a **persona-aware** nav
   (a lender sees the **Lending** group; a logistics partner sees the **Fleet** group) that links **only to built
   routes**, derived from the partner's token permissions.
3. **Inline Server Actions + inline styles** — `/loan-queue/[id]` defines `review`/`approve`/… as inline
   `'use server'` closures and the dashboard uses `style={{…}}`. Mutations must move to `app/**/actions.ts`; all
   styling via `globals.css` token classes.
4. **No pure `features/**` modules, no tests** — the loan/shipment **state machines**, money math, and the
   persona/nav model must live in PURE, unit-tested `features/**` modules (mirroring the API state machines exactly).
5. **No `loading.tsx` / `error.tsx` / `not-found.tsx` boundaries.**
6. **One vertical, partly done** — only the **lender loan-queue** is surfaced. The rest of the **lending** vertical
   (loan products + partner profile, disbursed-loan **portfolio** + repayments) and the **entire logistics-partner
   vertical** (fleet setup, zones/routes/cold-chain, the shipment delivery lifecycle) have **no UI**.

Everything below is **frontend-only**: `apps/api` (✅) already exposes the endpoints these tasks consume — the
controllers are inventoried in §2. **No new backend.** This app talks to the platform API **only through the shared
SDK** (`@krishalaya/sdk-js`) wired in `lib/api-client.ts`; mirror the controller exactly, never invent a route. If
an endpoint a task needs genuinely doesn't exist in `apps/api`, **STOP and flag it** rather than faking it.
Hand me one `Yes next PR-Wx-yy …` at a time with the contract (§1) pasted, exactly like the storefront / tenant /
admin / mobile cadence.

> **⛔ BLOCKED — insurance (policies / claims).** The current README lists "claims queue, policies, claims" as
> not-yet-built. There is **no `insurance` module in `apps/api`** (verified: the only partner-facing verticals are
> `fintech` and `logistics`). Per the contract, do **NOT** build insurance/claims/policies surfaces against a
> non-existent API — they are out of scope for this portal until an insurance backend ships. If asked for them,
> STOP and flag the missing backend.

> **Realm reminder (partner scoping is SERVER-SIDE).** Every API call is re-authorised by the platform API for the
> partner's RBAC + RLS; a partner can only ever read records routed/assigned to them — the portal can never page
> into another partner's book. A `401` triggers the silent refresh (refresh cookie); a `403` degrades to a clear
> "insufficient permission" notice, never a crash, and never leaks another partner's or tenant's data. This portal
> NEVER holds a token readable by JS and NEVER widens scope client-side — it only *reflects* what the API allows.

---

## 1. THE PRODUCTION-GRADE CONTRACT — partner-portal variant (paste at the top of every command)

```
PRODUCTION-GRADE CONTRACT (web-partner) — obey for everything you build:
- This is the EXTERNAL B2B PARTNER portal (banks/NBFCs = lenders; 3PLs = logistics partners) on the shared platform
  API. Build production, not a demo. It is an AUTHENTICATED app — every page is noindex; there is no public surface.
- SHARED API VIA THE SDK ONLY: talk to the platform API ONLY through @krishalaya/sdk-js wired in lib/api-client.ts
  (partnerClient = session-scoped, server-side token; anonClient = OTP login only). NEVER hand-roll a second fetch
  client, NEVER call admin-api. The API re-enforces partner RBAC + RLS on EVERY call; the cookie is convenience,
  never the authority. A 403 degrades to a clear "insufficient permission / re-authenticate" notice, never a crash,
  and never leaks another partner's or tenant's data. Mirror the apps/api controller EXACTLY — never invent a
  path/verb. If the API lacks the endpoint, STOP and flag it (do NOT fake — e.g. there is NO insurance module).
- DATA ACCESS ONLY VIA api-client.ts. Server Components (reads) / Server Actions / Route Handlers (writes) call the
  SDK; the session token is read SERVER-SIDE ONLY (api-client is `server-only`). Browser code never holds the token.
- SECRETS: only NEXT_PUBLIC_* may reach the browser (lib/env.ts is the single reader, fail-closed). The session
  access + refresh tokens stay in httpOnly+Secure+SameSite=Lax cookies (lib/partner-auth.ts) — never readable by JS,
  never serialised into HTML/props/client JS.
- MONEY is rendered from bigint MINOR-UNIT STRINGS via formatMoneyMinor — never a float (Law 2). Any rupee input is
  converted to minor units with BigInt (e.g. ₹ → paise = BigInt(rupees) * 100n), never a float multiply; no
  toFixed/parseFloat/Number() on money. Ratios/counts that are money-derived are computed float-free.
- AUDIT/IDEMPOTENCY: money-moving or state-advancing mutations (loan approve/disburse, shipment deliver, …) are
  Server Actions / Route Handlers and pass an Idempotency-Key where the endpoint exposes one (Law 3); GETs may
  retry, mutations never auto-retry.
- DEGRADE, NEVER DIE (Law 12): every API call is timeout-bounded (SDK); pages catch failures and render an
  empty/error/insufficient-permission state — a flaky API never 500s the portal.
- LIFECYCLE: state transitions (loan-application review→approve/reject→disburse; shipment assign→…→deliver/fail/
  cancel) reflect the SERVER state machine — only legal actions for the current status are shown; a 409 degrades to
  a message. The pure features/** state machine mirrors the API and is unit-tested.
- ACCESSIBILITY + COPY: semantic HTML, labelled controls, keyboard-navigable; ALL copy via the central i18n catalog
  (en primary; hi/gu OPTIONAL for this external realm — but NO hardcoded literals); loading.tsx + error.tsx
  boundaries per fetching route segment + a root not-found; noindex metadata on every page; persona-aware nav links
  only to built routes.
- Before "done": `npm run typecheck` (tsc --noEmit, exit 0) + `npm run lint` (next lint) + `npm run build`
  (next build emits .next) + `npm test` green; self-audit against §4 below; PASTE the green output. Red = not done.
```

> Build-sandbox note (same caveat the storefront/tenant/admin recorded): this monorepo's `workspace:*` deps can't be
> installed by plain `npm` in the sandbox, so the gate that always runs here is the **static §4 self-audit** plus a
> **node-port unit test** of each pure module; `tsc --noEmit` + `next lint` + `next build` + `jest` run in CI's
> `pnpm` toolchain. State that explicitly in each session's verification.

---

## 2. PRE-FLIGHT — read before writing a line (every session)
1. `apps/web-partner/README.md` + the existing `src/` (lib/{env,api-client,partner-auth}.ts, the built login /
   dashboard / loan-queue pages, DataTable, globals.css), AND the finished `apps/web-tenant/src/` +
   `apps/web-storefront/src/` (Sidebar, lib/i18n.ts, i18n catalogs, Server-Action + loading/error boundary patterns,
   pure features/** + jest setup) — the gold-standard structure to mirror (this app uses the SDK, like tenant).
2. The platform-API surface you'll consume: `apps/api/src/modules/<module>/controllers/v1/*.controller.ts` (the
   exact `@Controller` path + verbs) and the module's DTOs/read-models for the response shapes. **Match the
   controller exactly; never guess a path or field.** The two partner-facing verticals + their controller roots:

   **Lending (financial partners — `fintech.*` permissions):**
   - `fintech/loan-applications` → `GET` (list; `?box=review` etc.), `GET :id`, `POST :id/review`,
     `POST :id/approve` (amountApprovedMinor + coolingOffHours), `POST :id/reject` (note), `POST :id/disburse`
     (Idempotency-Key) — all decision verbs require `FintechPermissions.Manage`.
   - `fintech/loans` → `GET` (disbursed book / portfolio), `GET :id`, `GET :id/repayments`,
     `POST :id/repay` (borrower-side `Borrow` perm — NOT a partner action; read-only here).
   - `fintech` → `GET partners`, `GET partners/:id` (the partner's own profile), `GET loan-products`,
     `GET loan-products/:id` (the products this partner offers).

   **Logistics (3PL partners — `shipment.manage` permission):**
   - `logistics/partners` → `GET`, `GET :id`, `POST`, `PATCH :id`, `POST :id/active` (own carrier profile).
   - `logistics/vehicles` → `GET`, `GET :id`, `POST`, `PATCH :id`, `POST :id/active` (fleet).
   - `logistics/pickup-slots` → `GET`, `GET :id`, `POST`, `PATCH :id`, `POST :id/active`.
   - `logistics/zones` → `GET`, `GET :id`, `POST`, `PATCH :id`, `POST :id/active`.
   - `logistics/routes` → `GET`, `GET :id`, `POST`, `PATCH :id`, `POST :id/active`.
   - `logistics/cold-chain/readings` → `POST readings`, `GET readings` (temperature log).
   - `shipments` → `GET` (assigned queue), `GET :id`, `POST :id/assign`, `POST :id/schedule-pickup`,
     `POST :id/picked-up`, `POST :id/in-transit`, `POST :id/at-hub`, `POST :id/out-for-delivery`,
     `POST :id/deliver`, `POST :id/fail`, `POST :id/cancel` (the delivery state machine).

   **NOT available — do not build (flag instead):** insurance / policies / claims (no `insurance` module exists).
3. `lib/{env,api-client,partner-auth}.ts` — use these; never read `process.env` outside `lib/env.ts`, never build a
   second SDK/fetch client, never attach the token outside `api-client`.
4. The i18n catalog (once PR-W0 lands) — add keys there, never inline literals.

---

## 3. WHAT TO BUILD — Next.js App Router conventions (mirror the finished tenant console)
- **Routes** in `src/app/**` stay THIN: a Server Component resolves data via the SDK (`partnerClient()`) and renders
  presentational components. All partner pages are dynamic (authed). Interactivity uses small `'use client'`
  components only where needed (e.g. a confirm dialog).
- **Mutations** are **Server Actions** / **Route Handlers** in `app/**/actions.ts` — the only place the session token
  is used for writes; they pass an Idempotency-Key where the endpoint exposes one, then `revalidatePath`/`redirect`
  on success, and map `SdkError` (409 illegal-transition / 403 forbidden / 401 expired / 404) to a clear localized
  message.
- **Cross-route logic** (loan + shipment **state machines**, money/SLA math, the persona-aware nav model) lives in
  `src/features/**` as PURE, unit-tested modules; shared UI in `src/components/**`. Every fetching route segment gets
  `loading.tsx` + `error.tsx`; the app gets a root `not-found.tsx`.
- **Auth + scope gating**: `requirePartner()` redirects unauthenticated partners to `/login`; the API enforces
  partner RBAC + RLS per call; the nav shows only the persona's built routes; a `401` triggers the silent refresh,
  a `403` surfaces an "insufficient permission" notice (reflecting, never widening scope).

---

## 4. SECURITY / QUALITY CHECKLIST (self-audit before "done")
- [ ] No secret reaches the browser bundle (only `NEXT_PUBLIC_*`; `api-client`/`partner-auth` are `server-only`; nothing server-only imported into a client component).
- [ ] Session tokens only in the httpOnly `kvp_access`/`kvp_refresh` cookies; never serialised into HTML/props/client JS; the token is read only inside `api-client`.
- [ ] Every authed mutation goes through a Server Action / Route Handler, passes an Idempotency-Key where the endpoint exposes one, and never auto-retries.
- [ ] Every page is `requirePartner`-gated + noindex; a missing/foreign id → `notFound()`; a `403` degrades to a clear "insufficient permission" notice (the API is the authority); a `401` silently refreshes.
- [ ] Money rendered via `formatMoneyMinor` (minor-unit strings); rupee input → minor units via `BigInt` (never a float; never `toFixed`/`parseFloat`/`Number()` on money).
- [ ] Pages degrade (try/catch → empty/error/forbidden state), never 500; SDK calls are timeout-bounded; GET-only retries.
- [ ] All copy via the central i18n catalog (en; hi/gu optional — but NO hardcoded literals); semantic + keyboard-accessible markup; localized loading/error boundaries; no inline `style={{}}` (token CSS classes only).
- [ ] Pure `features/**` modules unit-tested (state machines + money/SLA math + nav/persona model); `tsc --noEmit` + `next lint` + `next build` + `jest` green (paste output; note they run in CI's pnpm toolchain).

---

## 5. THE ONE-PER-SESSION PLAN
Pick the lowest-numbered unchecked task whose dependencies are met and send:

> `Yes next PR-W0-01 partner-foundation-refit but follow the web-partner Production-Grade Contract pasted below.` + the contract (§1).

After each task: green gate → I tick it ✅ here and refresh the `web-partner` cell in `apps/api/MODULE_STATUS.md`.
When the last box is ticked, `web-partner` flips to ✅.

---

## WAVE 0 — foundation
- [x] **PR-W0-01 · partner-foundation-refit** — bring web-partner up to the storefront/tenant/admin bar: central
  i18n catalog (`src/i18n/en.ts` + a server `Translator` in `lib/i18n.ts`, en-primary, NO hardcoded literals); a
  **persona-aware** `Sidebar` (features/nav nav-model derived from the partner's token permissions — Lending group
  for `loan.manage`, Fleet group for `shipment.manage` — linking ONLY to built routes, others rendered as non-link
  "(soon)"); root `loading.tsx`/`error.tsx`/`not-found.tsx` boundaries; jest setup; pull the existing inline
  loan-queue Server Actions into `app/loan-queue/actions.ts` and extract a PURE `features/lending/application.ts`
  (mirrors the loan-application state machine + the ₹→paise BigInt money math, unit-tested); rewrite
  login/dashboard/loan-queue onto the shell (remove inline `style={{}}` + literals). Self-audit §4 clean.

## WAVE 1 — lending vertical (financial partners)
- [x] **PR-W1-01 · loan-queue-and-decisions** — finish the loan pipeline on the new shell: `/loan-queue`
  (`GET fintech/loan-applications`, box/status filter chips + keyset) + `/loan-queue/[id]` detail with the four
  lender-decision Server Actions (review → approve [amountApprovedMinor via BigInt + coolingOffHours] → reject
  [note] → disburse [Idempotency-Key]) surfaced ONLY when legal for the current status (pure
  `features/lending/application.ts` state machine + builders, unit-tested). Money via `formatMoneyMinor`.
  409→illegal-transition / 403→forbidden / 404 mapped to localized notices.
- [x] **PR-W1-02 · loan-products-and-profile** — `/products` (`GET fintech/loan-products`, keyset + detail
  `:id`) showing the products this partner offers (rate/tenure/limits, money-safe) and `/profile` (`GET
  fintech/partners/:id`) the partner's own lender profile. Read-only. Pure formatting/validation helper + test.
- [x] **PR-W1-03 · portfolio-and-repayments** — `/portfolio` (`GET fintech/loans`, disbursed book, keyset) +
  `/portfolio/[id]` (`GET fintech/loans/:id` + `GET :id/repayments`) with the repayment schedule, paid/outstanding
  split, and overdue flagging — all money via `formatMoneyMinor`, float-free. Pure outstanding/overdue helper +
  test. (Borrower-side `:id/repay` is NOT a partner action — read-only here.)

## WAVE 2 — logistics vertical (3PL partners)
- [x] **PR-W2-01 · fleet-setup** — `/fleet` carrier profile (`logistics/partners` GET/:id + PATCH + active) +
  vehicles (`logistics/vehicles` GET/:id + create/PATCH/active) + pickup-slots (`logistics/pickup-slots` GET/:id +
  create/PATCH/active), CRUD via Server Actions. Pure validators (reg-plate/capacity, float-free) + test.
- [x] **PR-W2-02 · zones-and-routes** — `/zones` (`logistics/zones` CRUD + active) + `/routes` (`logistics/routes`
  CRUD + active) + a cold-chain readings view/record (`logistics/cold-chain/readings` GET/POST; temperatures are
  decimals rendered via float-free integer-math, NOT money). Pure helper + test.
- [x] **PR-W2-03 · shipments-ops** — `/shipments` (assigned queue `GET shipments`, status filter + keyset) +
  `/shipments/[id]` detail with the delivery lifecycle Server Actions (assign → schedule-pickup → picked-up →
  in-transit → at-hub → out-for-delivery → deliver / fail / cancel) surfaced ONLY when legal for the current status
  (pure `features/logistics/shipment.ts` state machine, unit-tested). 409/403/404 mapped to notices.

## WAVE 3 — quality & DoD
- [x] **PR-W3-01 · partner-test-and-polish** — unit tests for every pure `features/**` module (loan + shipment
  state machines, money/SLA math, the persona/nav model), a11y pass (landmarks/labels/keyboard, contrast),
  `loading.tsx`/`error.tsx` coverage on every fetching segment (+ root `not-found`), noindex on every route, the
  `401`-refresh and `403`-forbidden paths verified, and a final `tsc`/`lint`/`build`/`jest`-green sweep. Closes the
  portal DoD; flips `web-partner` to ✅.

---

## 6. PER-TASK COMPLETION RITUAL
1. `tsc --noEmit` + `next lint` (+ `next build` + `jest`) green (paste output; note they run in CI's pnpm toolchain;
   the always-on gate here is the static §4 self-audit + the node-port unit test of each pure module).
2. New routes/components/Server Actions follow the thin-route + SDK-only + httpOnly-session + scope-gated pattern;
   SDK calls mirror the apps/api controller exactly (never invent a path/verb; flag a missing endpoint).
3. i18n keys added (en; no hardcoded literals); money via `formatMoneyMinor` + BigInt minor-unit conversion; a11y +
   noindex metadata + loading/error boundaries in place; mutations carry an Idempotency-Key where the endpoint
   exposes one.
4. README "What it serves" updated; this backlog box ticked; `web-partner` cell in `MODULE_STATUS.md` refreshed.
5. Self-audit §4 clean. Only then is the task done.

*North star: every page is server-first, secret-free, partner-RBAC-respecting, money-safe (bigint minor units),
accessible, idempotent on writes, and degrades instead of dying — talking to the platform API ONLY through the
shared SDK with the partner's server-side session. Never widen scope client-side; never call admin-api; flag a
missing backend (e.g. insurance) instead of faking it.*
