# web-tenant

The seller / tenant-admin **console**. Next.js 14 (App Router), server-rendered, built on the shared
`@krishalaya/sdk-js` + `@krishalaya/i18n` + `@krishalaya/tokens`. Authenticated app — never indexed.

## What it serves (built this slice)

- **i18n everywhere** — `src/i18n/{en,hi,gu}.ts` catalogs (full key parity) + a server `Translator`
  (`lib/i18n.ts`) that resolves the active language from the `kvt_lang` cookie → `Accept-Language` → default.
  `POST /api/lang` (same-origin guarded) sets the cookie; `LocaleSwitcher` posts to it (works without JS).
- **App shell** — `layout.tsx` sets `<html lang/dir>`, a skip-link, and renders the `Sidebar` chrome only when a
  session cookie is present. The sidebar links **only to built routes**, shows the staff name from `auth.me()`
  (degrades), the locale switcher, and sign-out. Root `loading.tsx` / `error.tsx` / `not-found.tsx` boundaries
  (all localized; `error.tsx` reads the lang cookie client-side).
- `/login` — phone-OTP sign-in (two Server Actions: request → verify). Enumeration-safe; honours a same-origin
  `next`; on success the API tokens are stored in httpOnly cookies and the user lands in the console.
- `/dashboard` — `await requireSession()`-gated home; greets the staff member from `auth.me()` (degrades).
- `/listings` — the tenant's listings (SDK `listings.browse`), keyset "next page", money via `formatMoneyMinor`,
  with a **New listing** CTA.
- `/listings/new` — create a draft listing. Server-rendered, searchable product picker (`catalogue.browseProducts`,
  each `<option>` carries productId+categoryId+defaultUnit), validated form, money entered in major units and
  parsed **float-free** (`features/listings/form.ts`), `listings.create` via a Server Action with the form's
  stable Idempotency-Key. Photos use the real two-step media flow in the one client island (`MediaUploader`):
  sha256 + dims in the browser → `media.requestUpload` (Server Action) → **PUT bytes straight to the presigned S3
  URL** (never through our API, no token) → `media.confirmUpload` → confirmed `mediaIds` submitted with the form.
  Fail-closed: a failed upload is flagged + removable; the draft can still be created without photos.
- `/listings/[id]` — owner detail (`listings.getOwn`; a missing/foreign id → `notFound()`, the IDOR guard since the
  API is tenant-scoped). Surfaces only **legal** actions (`features/listings/manage.ts`, unit-tested, mirrors the
  API state machine): **publish** (`listings.publish`) when the status allows, and **change price** with
  **optimistic concurrency** (`listings.changePrice` + `expectedVersion`) — a raced version degrades to a "reload"
  conflict message rather than overwriting. Both are Server-Action forms (no client JS). **Boost is an SDK gap**
  (`listings.startBoost` needs a boost-tier lookup + a wallet-captured `paymentTxnId` the seller SDK doesn't
  expose — mobile deferred it too), so the control is omitted and noted as unavailable, never faked.
- `/orders` — the tenant's orders via the **typed** SDK `orders.list({ role: 'seller' })` (no `request()` escape
  hatch), keyset paging, money via `formatMoneyMinor`, dates via `formatDate`; order number links to detail.
- `/orders/[id]` — seller order detail (`orders.get`; missing/foreign id → `notFound()` = IDOR guard). Line items
  + server-computed totals (`formatMoneyMinor`), and the **lifecycle transitions** surfaced only when legal for
  the current status (`features/orders/lifecycle.ts`, unit-tested, mirrors the API state machine): confirm →
  packed → ready → delivered → complete, plus cancel — each an idempotent Server-Action (Idempotency-Key); a
  raced/illegal move (409) degrades to a message. **Shipment** section views status / AWB / delivered-at and, when
  a shipment needs proof-of-delivery, a deliver form (buyer **OTP** + optional PoD photo via the reusable
  `MediaUploader` single mode → `shipments.deliver`). AWB/carrier are read-only (the SDK exposes `deliver` but no
  create/assign/AWB setter — we never fake an editor for what the SDK can't write).
- `/offers` — the seller's **incoming** offers. Because the API scopes incoming offers per listing
  (`offers.list({box:'incoming'})` requires a `listingId`), the page is a **listing picker** (`listings.browse`)
  whose rows open `/offers?listingId=…`, the per-listing inbox (status, qty, effective price, round). This
  faithfully reflects the API contract — no faked cross-listing inbox.
- `/offers/[id]` — offer detail (`offers.get`; missing/foreign id → `notFound()` = IDOR guard). While the
  negotiation is live (`features/offers/negotiation.ts`, unit-tested): **accept** (server creates the order →
  links straight to `/orders/[convertedOrderId]`), **counter** (per-unit minor-unit price, float-free), and
  **reject** — Server-Action forms; a 409 (raced/illegal) degrades to a message. (The SDK exposes no
  Idempotency-Key on counter/accept/reject — only `offers.make` — so none is passed, as designed.)
- `/payouts` — the tenant's money-OUT surface. Loads payout history (`payouts.list`, keyset) + tokenised
  destinations (`bankAccounts.list`) in parallel, each degrading independently. **Request payout** Server Action
  (`payouts.request`, Idempotency-Key; amount in major units, parsed float-free → minor string) to a chosen
  destination, and **add destination** (`bankAccounts.add`, Idempotency-Key) by its **gateway vaultRef** + masked
  display fields — raw account numbers / VPAs are tokenised at the gateway out-of-band and **never entered here**.
  Pure validation in `features/payouts/form.ts` (unit-tested). Money via `formatMoneyMinor`.
- `/wallet` — wallet **balance + ledger statement** (P1-6). A balance card shows the reconciled available + held
  figure (`wallet.balance`, ledger-derived server-truth; total via pure `totalWalletMinor`, frozen badge), and the
  statement table is the true per-entry ledger (`wallet.ledger`, keyset) with a server-computed running balance
  (`balanceAfterMinor`) and credit/debit colour (pure `presentLedgerEntry`/`ledgerTone`, unit-tested). The client
  NEVER computes a balance (Law 2/11); each read degrades independently. Money via `formatMoneyMinor`.
- `/auctions` — the tenant's auctions (`auctions.list`, keyset) + **create** (listing picker + form →
  `auctions.create`, Idempotency-Key; money in major units parsed float-free, datetime-local → ISO, end after
  start) and `/auctions/[id]` (detail + bid history `listBids` — sealed amounts shown as "sealed" — + **approve**/
  **cancel** surfaced only when legal for the status via `features/auctions/manage.ts`, unit-tested). **Flag-gated**
  by `env.featureAuctions` (sidebar entry + pages hidden when off); the API's own `auctions` flag stays
  authoritative — if off, reads degrade to empty.
- `/disputes` — the tenant's disputes-moderation queue (`disputes.list` box=all, keyset) + the seller's review
  rating (`auth.me()` → `reviews.summary({ targetUserId })`), loaded in parallel + degrading independently. And
  `/disputes/[id]` (detail; missing/foreign id → `notFound()` = IDOR guard) with **take-under-review / escalate /
  resolve** surfaced only when legal (`features/disputes/manage.ts`, unit-tested) — resolve carries a decision
  (`refund_full`/`refund_partial`/`replacement`/`rejected`) + optional amount (float-free; refunds move money
  server-side). **SDK gap flagged:** there's no seller-side dispute *respond* method, so only the moderation
  actions are offered (noted, not faked). Needs `dispute.resolve` (re-checked server-side; not god-mode).
- `/notifications` — the staff member's own inbox (`notifications.inbox`, keyset; server-scoped — no IDOR) with an
  unread-only filter and per-item **mark-read** Server Action; payload title/body/deep-link are server-rendered
  (deep links honoured only when same-origin). `/notifications/preferences` — the event×channel opt-in matrix
  (full-replace `setPreferences`) + quiet hours (`setQuietHours`), both no-JS Server-Action forms. Mirrors the
  storefront's notifications build.
- `/billing` — the tenant's subscription + plan catalogue + usage. Loads `tenancy.currentSubscription` (+
  limits/usage), `tenancy.plans` (public+active), and `tenancy.listSubscriptions` (history) in parallel, each
  degrading independently. **Apply/change plan** is a Server-Action form (`tenancy.apply`, Idempotency-Key; a paid
  plan moves money server-side, Law 11). Usage/limits read-out merges the limits + usage maps
  (`features/billing/plan.ts`, unit-tested; missing cap → "unlimited"). Money via `formatMoneyMinor`.
- `/team` — the tenant's staff roster + role assignments (`rbac.assignments`; `?pending=1` shows the approval
  queue), **approve** a pending assignment (Server Action), and **admin-add a member** who can't self-register
  (`users.create`, Idempotency-Key). The UI reflects RBAC; the server authorises every change within the caller's
  own tenant. **SDK gap flagged:** no role catalogue read and no direct assign/revoke method — only approve-pending
  + add-member are offered (`features/team/form.ts`, unit-tested), not a faked assign/revoke matrix.
- `/kyc` — the signed-in staff member's own **profile & verification**. `auth.me()` shows the display name, roles +
  locale; an **edit-profile** Server Action (`users.updateMe` — server resolves the subject from the token, no IDOR)
  posts the PII-minimal, validated patch (name/email/dob/gender/language + optional avatar via the same two-step
  media flow as listings, here in single mode → `photoMediaId`). `kyc.list()` renders the caller's verification
  documents + statuses; **raw doc numbers are never shown** (only the server-masked `docNoMasked`), with a reject
  reason when present. Pure validation in `features/profile/form.ts` (unit-tested; blanks dropped, no-op rejected).
  **SDK gap flagged:** `kyc.submit` needs a `docTypeId` but the SDK exposes no doc-type catalogue to choose one
  (the mobile app flagged the same gap), so submission is noted as unavailable rather than faking a doc-type list.
- `POST /api/session` — logout (clears the httpOnly cookies).
- **Silent refresh** — `lib/session.ts` mints a new access token from the `kvt_refresh` cookie server-side (the
  refresh token never reaches the browser) when the access cookie has expired, before redirecting to login.

## Security / correctness

- **No secrets in the bundle.** Only `NEXT_PUBLIC_API_URL` reaches the browser; `lib/env.ts` is the single env
  reader and fails closed if the origin is unset.
- **Session tokens are httpOnly** (`lib/auth.ts`, `Secure` + `SameSite=Lax`) — unreadable to JS; the SDK reads
  the access token only during SSR. `requireSession()` gates protected pages; **the API re-enforces RBAC + tenant
  scoping on every call**, so the cookie is convenience, never the authority (defence in depth, Law 1/4).
- **Degrade, never die (Law 12).** Pages catch SDK failures and render an empty state — a flaky API never 500s
  the console. Every SDK call is timeout-bounded; GETs retry, mutations don't.
- **Money** is rendered from bigint-minor-unit strings via `formatMoneyMinor` — never a float (Law 2).

## Build note

This Next.js app + React components compile under CI's `pnpm install` (the React/Next toolchain). The shared
packages it stands on — `sdk-js`, `i18n`, `tokens` — are framework-free and are typechecked + unit-tested
offline (this monorepo's `workspace:` deps can't be installed by plain `npm` in the sandbox). The TSX in this
app is syntax-parsed clean offline and has no broken local imports. **Every pure module in `features/**` is
unit-tested** under `jest` + `ts-jest` (1:1 — `src/test/*.spec.ts` for the open-redirect guard, the money math
(`listings/form`, `payouts/form`), and every RBAC-visibility / state-machine helper (`orders/lifecycle`,
`listings/manage`, `offers/negotiation`, `auctions/manage`, `disputes/manage`, `billing/plan`, `team/form`,
`profile/form`); `npm test`). The always-on gate in the sandbox is the static §4 self-audit (i18n en/hi/gu key
parity, no token in any client bundle, no stray `process.env`, no inline styles, money only via `formatMoneyMinor`);
`tsc --noEmit` + `next lint` + `next build` run in CI's pnpm toolchain.

## Scope & SDK-gap-flagged surfaces

The seller / tenant-admin console DoD is **closed** (`web-tenant` ✅): every route above is server-first,
secret-free, RBAC-respecting, money-safe, accessible, localized (en/hi/gu), and degrades instead of dying.

What is **not** built is intentionally so: the tenant-*config* and vertical-operator surfaces the wider spec lists
have **no seller-facing method in `@krishalaya/sdk-js`**, so they are SDK-gap-flagged rather than faked —
commission-rules editing, delivery-zones, branding, integrations, webhooks, billing-config, the staff-permissions
matrix, languages; and the operator verticals dairy-MCC, labour-as-employer-admin, schemes-as-assistant,
ambassadors-admin, group-lots, auditor, and the AI-review queue. Each is unblocked only when the SDK (or the
admin-api client) exposes the method; until then the console never invents an endpoint or calls past the typed SDK,
and the nav links **only** to routes that exist (no placeholder/TODO pages, per the build guide).
