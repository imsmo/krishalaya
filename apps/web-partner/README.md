# web-partner

The financial / logistics **partner portal** — banks/NBFCs (lenders) process loan applications; 3PLs (logistics
partners) run deliveries. Next.js 14 (App Router), server-rendered, built on the shared `@krishalaya/sdk-js` +
`@krishalaya/i18n` + `@krishalaya/tokens`. Partner-scoped auth; never tenant data beyond consented/assigned
records. Never indexed. (No insurance backend exists yet, so policies/claims are out of scope — see
`PARTNER_BUILD_BACKLOG.md`.)

> **Status: ✅ complete** — both partner verticals are fully built on the shared SDK, matching the
> storefront/tenant/admin bar: a central i18n catalog (`src/i18n/en.ts` + server `Translator`, NO hardcoded
> literals); a **persona-aware** `Sidebar` (features/nav nav-model from the partner's token `perms` — **Lending**
> group for `loan.manage`, **Logistics** group for `logistics.manage`, both for `*`); a **silent-refresh session
> gate** (`lib/session.ts` — expired access cookie re-minted server-side from the refresh cookie, else redirect to
> `/login`); root `loading`/`error`/`not-found` boundaries; and 7 pure, unit-tested `features/**` modules (lending
> application + product + loan; logistics fleet + network + shipment state machines; the persona nav model — ≈220
> node-port assertions). Lending = loan-queue + decisions / products / lender registry / portfolio + repayments;
> Logistics = fleet setup / zones / routes / cold-chain / the full shipment delivery lifecycle. Every page is
> server-first, noindex, money-safe (bigint minor units via `formatMoneyMinor`), and degrades instead of dying. The
> wave-by-wave history (PR-W0…W3) is in `PARTNER_BUILD_BACKLOG.md`. (No insurance backend exists, so policies/claims
> stay out of scope.)

## What it serves (built this slice)

- `/login` — phone-OTP sign-in (Server Actions in `app/login/actions.ts`). On success the API tokens (carrying
  partner-scoped permissions like `loan.manage` / `logistics.manage`) are stored in httpOnly cookies.
- `/dashboard` — lender pipeline KPIs rolled up from the review queue (awaiting / approved / pending exposure).
- `/loan-queue` — applications routed to this partner (`fintech/loan-applications`), with **box chips** (Awaiting
  decision [`box=review`, default] / All applications [`box=all`]) + **status chips** (the loan state machine) +
  keyset paging, all preserved across pages by the pure `queueHref`/`buildListQuery` helper. (`box=mine` is
  applicant-only and not offered.) Status chips via the pure lending state helper.
- `/loan-queue/[id]` — application detail + **lender decision** Server Actions against the real endpoints:
  `review` → under_review, `approve` (amount + cooling-off window), `reject` (note), `disburse`
  (Idempotency-Key, Law 3) — each surfaced ONLY when legal for the current status (pure state machine). The
  API state machine + partner RBAC are the authority; the UI only reflects it.
- `/products` + `/products/[id]` — the lender's loan-product catalogue (`GET fintech/loan-products`, active-only
  toggle + optional `?partnerId` filter). Read-only: amount range via `formatMoneyMinor`, the interest APR rendered
  from integer **basis points** float-free (`formatAprBps`), tenure window via the pure helper.
- `/profile` + `/profile/[id]` — the platform **lender registry** (`GET fintech/partners`, partner-kind +
  active-only filters), the financial partners registered on the platform (bank / NBFC / MFI / insurer / AMC /
  gold-loan), with a link from a partner to the products they offer. Read-only.
- `/portfolio` + `/portfolio/[id]` — the lender's **disbursed-loan book** (`GET fintech/loans`, `box=all` — RLS
  scopes it to the partner), status chips + keyset. Detail shows principal / outstanding / **repaid** (BigInt
  `principal − outstanding`) + APR + dates, and the **repayment schedule** (`GET :id/repayments`) with per-row
  balance and **overdue** flagging (unsettled + past due, ISO-date compare). Read-only — borrower-side `:id/repay`
  is not a partner action. Money via `formatMoneyMinor`, float-free.
- `/fleet` (+ `/fleet/carriers/[id]`) — the 3PL **carrier registry** (`logistics/partners` GET/:id + create/PATCH +
  `:id/active`), active-only filter. Create/edit name + provider code + kind (3PL / tenant-fleet / rider).
- `/fleet/vehicles` (+ `/fleet/vehicles/[id]`) — the fleet's **vehicles** (`logistics/vehicles` GET/:id +
  create/PATCH + `:id/active`). `capacityKg` is a **weight** (positive whole kg, parsed float-free), NOT money;
  refrigerated flag for cold-chain.
- `/fleet/slots` (+ `/fleet/slots/[id]`) — the weekly **pickup slots** (`logistics/pickup-slots` GET/:id +
  create/PATCH + `:id/active`). Weekday + HH:MM window; `start < end` enforced by the pure builder (lexicographic
  compare on zero-padded times). All creates carry an Idempotency-Key (Law 3); validators live in
  `features/logistics/fleet.ts` (35 node-port assertions). Persona-gated by `logistics.manage`.
- `/zones` (+ `/zones/[id]`) — delivery **serviceability zones** (`logistics/zones` GET/:id + create/PATCH +
  `:id/active`, keyset + optional `?pincode` filter). Pincodes (6-digit) + region UUIDs entered as space/comma blobs,
  validated by the pure builder; optional charge-definition UUID.
- `/routes` (+ `/routes/[id]`) — **Village Run routes** (`logistics/routes` GET/:id + create/PATCH + `:id/active`,
  keyset + optional run-weekday filter). Nullable run-day, village region UUIDs, vehicle + consolidation-agent refs.
- `/cold-chain` — the reefer/vaccine **cold-chain log**. The API list is SUBJECT-SCOPED (`logistics/cold-chain/readings`
  needs `subjectType` + `subjectId`), so the page takes a subject scope, then shows that subject's readings (breach-only
  toggle) + a record form (`POST readings`, append-only — NO Idempotency-Key). Temperatures are physical decimals (°C)
  parsed float-free and rendered as plain strings — NOT money; the API recomputes `is_breach` from the allowed band.
  Validators live in `features/logistics/network.ts` (51 node-port assertions). All three persona-gated by `logistics.manage`.
- `/shipments` (+ `/shipments/[id]`) — the **shipment delivery lifecycle** (`GET shipments` assigned queue, `box=all|mine`
  + status filter + keyset; `GET shipments/:id`). The detail surfaces the lifecycle Server Actions — assign →
  schedule-pickup → picked-up → in-transit → at-hub → out-for-delivery → deliver / fail / cancel — ONLY when the pure
  state machine says the transition is legal; the API re-enforces it (a 409 degrades to a notice). Delivery is
  OTP-gated (`deliver` takes the buyer's 4–8 digit OTP + optional POD media). Charge / COD render via
  `formatMoneyMinor` from bigint-minor strings. State machine + payload builders live in `features/logistics/shipment.ts`
  (45 node-port assertions). Persona-gated by `logistics.manage`.
- `POST /api/session` — logout (clears the httpOnly cookies).

## Security / correctness

- **Partner scoping is server-side.** The API only ever returns applications routed to this partner (RLS +
  partner RBAC); the portal can't page into another lender's book.
- **Session tokens are httpOnly** (`partner-auth.ts`, `Secure` + `SameSite=Lax`) — unreadable to JS; the SDK
  reads the access token only during SSR. `requirePartner()` gates protected pages.
- **Money is bigint minor units (Law 2).** Displayed via `formatMoneyMinor` (no float); the approve form takes
  whole rupees and converts via `BigInt` to paise — never a float multiply. Mutations send an Idempotency-Key
  where the API requires one; GETs retry, mutations don't.
- **No secrets in the bundle** (`lib/env.ts`, single reader, fail-closed). **Never indexed.** **Degrade, never
  die (Law 12):** failures render an empty state / inline notice, never a 500.

## Build note

The Next.js app + React compile under CI's `pnpm install`. The shared packages (`sdk-js`, `i18n`, `tokens`) are
framework-free and typechecked + unit-tested offline. New TSX in this app is syntax-parsed clean offline with no
broken local imports.

## Not yet built (planned route map)

claims queue (+ detail), disbursals, policies, portfolio, SLA report, API credentials, and settings.
Intentionally out of scope for this vertical slice — nav never links to a route that doesn't exist, and no
placeholder/TODO pages are shipped (per the build guide).
