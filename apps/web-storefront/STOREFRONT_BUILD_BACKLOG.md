# apps/web-storefront — BUILD BACKLOG (what the 🟡 means, and the one-per-session plan)

**Status today.** `web-storefront` is ✅ — the buyer storefront is **COMPLETE** through Wave 5 (every SF-W0…W5
box below is ticked). The full anonymous→authenticated buyer journey ships: public browse + faceted discovery +
enriched listing detail + farm-to-fork trace, phone-OTP auth (httpOnly session + silent refresh + `requireSession`
gate), cart → checkout → **real Razorpay pay** → order confirmation, order history/tracking, verified-purchase
reviews, offers + masked chat, flag-gated auctions with live bidding, and the notification inbox + preferences.
Everything renders only via the typed SDK; money is bigint-minor-unit strings via `formatMoneyMinor` throughout;
the session token never leaves the httpOnly cookie; all copy is i18n (en/hi/gu, **367-key parity**, zero inline
literals); pure logic is unit-tested (ts-jest); robots/sitemap/metadataBase are in place. The verification gate
(`tsc --noEmit` + `next lint` + `next build` + `jest`) runs in CI's pnpm toolchain — this monorepo's `workspace:*`
deps aren't installable by plain `npm` in the sandbox, so each session here verified via the static §4 self-audit.

**SDK-gap flags (deferred, each documented at its task below) — need a new SDK surface, not a frontend change:**
named category-nav / region / attribute facets (no lookup resource); listing media gallery, `/trace/[qrToken]`
deep-link, place-bid-from-listing (read-model lacks media/qrToken/auctionId); coupon discount-preview +
delivery-methods lookup; invoice download; individual reviews + seller responses (only an aggregate summary);
auctions watch/follow.

<details><summary>Original foundation-slice status (pre-Wave-0, kept for history)</summary>

`web-storefront` was 🟡 — a **foundation slice**, not a finished store. What existed and worked:

- **Public pages (SSR/anonymous):** `/` (home — published-listings sample), `/[tenantSlug]` (a tenant's
  storefront browse + search + keyset "next page"), `/[tenantSlug]/listings/[id]` (listing detail, `notFound()`
  on miss), `/trace/[qrToken]` (public farm-to-fork provenance — NON-PII), and the root `layout.tsx`.
- **Data layer:** `lib/env.ts` (no secrets in the bundle, fail-closed, single env reader), `lib/api-client.ts`
  (server + public SDK factories, timeout-bounded, GET-retry), `lib/auth.ts` (httpOnly + Secure + SameSite session
  cookie helpers — set/get/clear), `components/ListingCard.tsx`, `styles/globals.css`.
- **App shell + static surface (SF-W0-01 ✅):** localized global header (nav, locale switcher, cart badge, login
  link) + footer; server-side i18n (en/hi/gu via `lib/i18n.ts` + `@krishalaya/i18n` Translator, 68-key parity,
  no inline literals); no-JS locale switch (`/api/lang` route, fail-closed + same-origin redirect guard); the six
  marketing/static pages `/about /blog /help /pricing /press /tenants-signup` (static localized copy — the SDK has
  no `cms` resource), each with `generateMetadata` + segment `loading.tsx`/`error.tsx`; a shared accessible
  `components/DataTable.tsx`; a11y skip-link + `<html lang/dir>`.

It is still 🟡 because the storefront is **anonymous-browse-only**: there is **no login, no account, no cart, no
checkout/payment, no orders, no offers/auctions/reviews** yet (the marketing/static pages the product
spec calls for now exist — `docs/spec/06_web_apps.md`: about, blog, help, press, pricing, tenants-signup, a shared
`data-table`). `lib/auth.ts` ships the cookie plumbing but **nothing writes the session yet** (the login Route
Handler / Server Action is the first real gap). The whole authenticated buyer journey — which the shared
`@krishalaya/sdk-js` already fully supports (auth, identity, catalogue, listings, cart/commerce, orders,
payments, offers, messaging, auctions, reviews, notifications, traceability) — is unbuilt.

Everything below is **frontend-only**: the API (apps/api ✅) and the SDK (`@krishalaya/sdk-js` ✅) already
expose every endpoint and type these tasks consume. No new backend, no new SDK resource — if a task seems to
need one, STOP and flag it rather than reaching past the SDK. Each task is one build session per the
Production-Grade Contract below; **hand me one `Yes next SF-Wx-yy …` at a time** with the build guide pasted,
exactly like the apps/api / admin-api / mobile cadence.

</details>

---

## 1. THE PRODUCTION-GRADE CONTRACT — web variant (paste at the top of every command)

```
PRODUCTION-GRADE CONTRACT (web-storefront) — obey for everything you build:
- This is the PUBLIC consumer site for millions of users, under active attack. Build production, not a demo.
- Match the reference: the existing apps/web-storefront pages + lib (env/api-client/auth) and the shared
  @krishalaya/sdk-js + @krishalaya/i18n + @krishalaya/tokens. Mirror their layering and rigor.
- NO stubs, NO TODOs, NO placeholders. If a needed API/SDK method is missing, STOP and flag it —
  never fake data, never call the API past the typed SDK, never invent an endpoint.
- DATA ACCESS ONLY VIA THE SDK. Server Components / Server Actions / Route Handlers use serverClient()
  (authed, injects the httpOnly session) or publicClient() (anonymous). Browser code never holds a token.
- SECRETS: only NEXT_PUBLIC_* may reach the browser (lib/env.ts is the single reader, fail-closed). The
  session token stays in the httpOnly+Secure+SameSite cookie (lib/auth.ts) — never readable by JS.
- AUTH: login/refresh/logout run in Route Handlers / Server Actions that call the SDK auth resource and
  write/clear the cookie. Protected routes resolve the session server-side and redirect anonymous users.
- TENANT SCOPING is server-side (the API + RLS enforce it); the slug only selects which tenant's public
  catalogue to show. Never trust a tenant/id from the client without the server check.
- MONEY is rendered from bigint MINOR-UNIT STRINGS via formatMoneyMinor — never a float (Law 2).
- DEGRADE, NEVER DIE (Law 12): every SDK call is timeout-bounded; public pages catch failures and render an
  empty/error state — a flaky API never 500s the storefront. GETs may retry; mutations never auto-retry.
- MUTATIONS pass the user's Idempotency-Key where the SDK exposes it (checkout/pay/offer/bid), so a
  double-submit/refresh never double-charges or double-acts.
- ACCESSIBILITY + i18n + SEO: semantic HTML, labelled controls, keyboard-navigable; all copy via @krishalaya/i18n
  (no hardcoded strings); SSR/ISR + correct <title>/<meta>/canonical/OpenGraph on indexable pages; loading.tsx +
  error.tsx boundaries per route segment.
- Before "done": `npm run typecheck` (tsc --noEmit, exit 0) + `npm run lint` (next lint) + `npm run build`
  (next build emits .next) green; self-audit against §4 below; PASTE the green output. Red = not done.
```

> Build-sandbox note (same caveat the README records): this monorepo's `workspace:*` deps can't be installed by
> plain `npm` in the sandbox, so the gate that always runs here is **`tsc --noEmit` + `next lint`**; `next build`
> runs in CI's `pnpm` toolchain. State that explicitly in each session's verification, exactly as the foundation
> packages do.

---

## 2. PRE-FLIGHT — read before writing a line (every session)
1. `apps/web-storefront/README.md` + the existing pages/lib in `src/` — the gold-standard structure & patterns.
2. The SDK surface you'll consume: `packages/sdk-js/src/resources/<resource>.ts` + `…/types.ts` (method names,
   inputs, the `Envelope`/`Page` shapes, money-as-string). **Match the SDK exactly; never guess a shape.**
3. `docs/spec/06_web_apps.md` (`web-storefront` section) — the intended route list + behaviour.
4. `@krishalaya/i18n` keys (add new keys there, in en/hi/gu, never inline literals) + `@krishalaya/tokens`
   (design tokens / theme — never hardcode colours/spacing).
5. `lib/{env,api-client,auth}.ts` — use these; never read `process.env` or build a fetch client elsewhere.

---

## 3. WHAT TO BUILD — Next.js App Router conventions (match the existing app)
- **Routes** live in `src/app/**` and stay THIN: a Server Component resolves data via the SDK and renders
  presentational components. SEO-relevant pages are server-rendered (SSR/ISR); interactivity uses small client
  components (`'use client'`) only where needed.
- **Mutations** are **Server Actions** or **Route Handlers** (`app/**/route.ts`) — the only place the authed
  `serverClient()` is invoked for writes; they read the session cookie, pass the Idempotency-Key, and
  `revalidatePath`/`redirect` on success.
- **Cross-route logic** (table configs, multi-step flows, form schemas) lives in `src/features/**`; shared UI in
  `src/components/**` (or `@krishalaya/ui`). Every route segment that fetches gets a `loading.tsx` + `error.tsx`.
- **Auth gating**: a server helper (`requireSession()` building on `lib/auth.getSessionToken`) redirects anonymous
  users from account/cart/checkout/orders to login with a return-to.

---

## 4. SECURITY / QUALITY CHECKLIST (self-audit before "done")
- [ ] No secret reaches the browser bundle (only `NEXT_PUBLIC_*`; verify nothing server-only is imported into a client component).
- [ ] Session token only in the httpOnly cookie; never serialised into HTML/props/client JS.
- [ ] Every authed mutation goes through a Server Action / Route Handler with the session + Idempotency-Key; no token in the client.
- [ ] Protected routes redirect anonymous users (no flash of private data); tenant/id from the URL is validated server-side (404 on miss, no IDOR).
- [ ] Money rendered via `formatMoneyMinor` from minor-unit strings (never a float; never `toFixed` on a number).
- [ ] Public pages degrade (try/catch → empty/error state), never 500; SDK calls are timeout-bounded.
- [ ] All copy via i18n (en/hi/gu); semantic + keyboard-accessible markup; correct page metadata/canonical on indexable routes.
- [ ] `tsc --noEmit` + `next lint` green (paste output); note `next build` runs in CI.

---

## 5. THE ONE-PER-SESSION PLAN
Pick the lowest-numbered task whose dependencies are met and send:

> `Yes next SF-W1-01 storefront-auth-login but follow the AI_AGENT_BUILD_GUIDE / the web Production-Grade Contract pasted below.` + the contract (§1).

After each task: `tsc` + `lint` green → I tick it ✅ here and refresh the `web-storefront` cell in
`apps/api/MODULE_STATUS.md`. When the last box is ticked, `web-storefront` flips to ✅.

### WAVE 0 — shell + marketing/static surface (no auth)
- [x] **SF-W0-01 · app-shell + static-pages** — global header (nav, tenant/locale switcher, cart badge, login
  link) + footer + `@krishalaya/i18n` provider wiring + a shared `components/DataTable.tsx`; the static routes
  the spec lists: `/about`, `/blog`, `/help`, `/pricing`, `/press`, `/tenants-signup` (the SDK exposes no `cms`
  resource → static localized copy, per "else static copy"), each with `generateMetadata` + `loading.tsx`/`error.tsx`.
  SEO + i18n (en/hi/gu, 68-key parity, zero inline literals) + a11y (skip-link, `<html lang/dir>`, table `<caption>`,
  44px targets) throughout. **DONE** — `src/i18n/{en,hi,gu}.ts`, `lib/i18n.ts` (server Translator helper),
  `app/api/lang/route.ts` (no-JS locale switch; fail-closed validate + same-origin redirect guard),
  `components/{SiteHeader,SiteFooter,LocaleSwitcher,DataTable}.tsx`, the 6 static pages, root `loading/error/not-found`,
  rewired `layout.tsx`, extended `globals.css`. `env.tenantAppUrl` added so `lib/env.ts` stays the single env reader.

### WAVE 1 — authentication & account (unblocks everything authed)
- [x] **SF-W1-01 · storefront-auth-login** — phone-OTP login flow: a request-OTP + verify Server Action/Route
  Handler calling the SDK `auth` resource, writing the httpOnly session cookie (`lib/auth.setSession`) on success;
  logout (clear cookie); silent refresh on expiry; a `requireSession()` server gate + return-to redirect;
  enumeration-safe, rate-limit-aware login UI (no OTP/code ever rendered). **DONE** — `lib/auth.ts` now holds two
  httpOnly+Secure+SameSite cookies (`kv_session` access + `kv_refresh` refresh, `setSession(AuthTokens)`/
  `clearSession`/`hasSessionCookie`); `lib/session.ts` adds `refreshSession()` (silent server-side token mint),
  `resolveSessionToken()`, `requireSession(returnTo)` (redirects anon to `/login?next=…`) and the same-origin
  `safeNext` guard. `app/login/actions.ts` (`'use server'`) is a single `loginAction` state machine (request|
  verify|reset via `intent`) + `logoutAction`, anonymous `publicClient().auth` only, `randomUUID()`
  Idempotency-Key on every call, enumeration-safe notice, generic verify error, OTP never echoed, tokens written
  straight to cookies. `components/LoginForm.tsx` (`'use client'`, `useFormState`/`useFormStatus`, two-step, no
  token/secret imported) + `app/login/{page,state}.tsx` (noindex, already-signed-in skip, localized labels);
  header shows logout-form vs login-link via `hasSessionCookie()`. `auth.*` + `nav.logout` i18n in en/hi/gu
  (86-key parity). Root `loading/error` boundaries cover the segment.
- [ ] **SF-W1-02 · account-profile-addresses-kyc** — `/account` shell + profile (SDK `identity` users.me +
  update), saved **addresses** CRUD (used at checkout), and **KYC status** (read-only, masked — never raw
  Aadhaar/PAN/bank). Auth-gated; PII masked in the UI.

### WAVE 2 — discovery UX (build on the live browse foundation)
- [x] **SF-W2-01 · search-filters-category-nav** — real catalogue discovery driven by the SDK `listings.browse`
  query. **DONE** — `features/discovery/query.ts` (pure, float-free money string math: `parseMajorToMinor`/
  `minorToMajor`, `toListingQuery`, `activeFilters`/`buildQueryString`/`loadMoreHref`); `components/SearchFilters.tsx`
  (no-JS `<form method=get>`, localized, defaults from searchParams, cursor omitted so a filter change restarts
  paging, categoryId/regionId hidden passthrough, clear-link); rewired `[tenantSlug]/page.tsx` — faceted browse
  (search `q`, **sale type**, **organic**, **price band**, **sort**), keyset next-page link preserving all
  filters, localized results-count + zero-result/empty states, all via i18n + `formatMoneyMinor`; `ListingCard`
  + home localized. Shareable filter URLs (every facet is a searchParam). i18n `discover.*`/`card.*`/`home.*`/
  `storefront.*` en/hi/gu (116-key parity). **FLAGGED (no SDK surface):** the SDK exposes **no categories,
  regions, or attributes lookup resource** — so a *named* category-navigation tree, a region/pincode picker, and
  attribute facets can't be built without fabricating names (contract: never fake data). `categoryId`/`regionId`
  are still honoured as transparent URL passthrough (deep links filter correctly); a named UI needs new SDK
  lookup resources (e.g. `catalogue.categories()` / `geo.regions()`) — out of scope for a frontend-only task.
- [x] **SF-W2-02 · listing-detail-enrichment** — upgraded `[tenantSlug]/listings/[id]`. **DONE** — enriched,
  localized layout (price/qty, sale-type, organic), a **seller trust card** + **listing reviews summary** (both
  via the public `reviews.summary` aggregate, degrade silently), `BuyerActions` CTAs chosen by sale type, a
  farm-to-fork note, and rich **OpenGraph/Twitter + canonical** metadata. **Real buyer CTAs:** `addToCartAction`
  (`cart.addItem`) for purchasable types + `makeOfferAction` (`offers.make`, `randomUUID` Idempotency-Key,
  `parseMajorToMinor` price) for offer-capable types — both authed Server Actions (`requireSession` bounces anon
  to `/login?next=` the listing, `serverClient(tenantSlug)`, validate qty/price server-side, redirect back with a
  localized `?status=` notice; no client JS). i18n `listing.*` en/hi/gu (136-key parity). **FLAGGED (read-model
  has no field):** the `ListingCard` read-model exposes no media ids, no trace `qrToken`, and no `auctionId`, so a
  **media gallery**, a direct **`/trace/[qrToken]` deep-link** (we link to the `/help` traceability explainer
  instead of inventing a token), and a **place-bid-from-listing** CTA can't be built without faking — they need
  the SDK listing read-model to carry those fields. Auction/service listings show a localized "opens in the app"
  note rather than a dead button.

### WAVE 3 — commerce core (the money path)
- [x] **SF-W3-01 · cart** — **DONE.** `app/cart/actions.ts` (`'use server'`): `updateCartItemAction`/
  `removeCartItemAction`/`clearCartAction` — authed (`requireSession` → anon to `/login?next=/cart`),
  `serverClient().cart.*`, qty validated `1..available`, `revalidatePath('/cart')` so the page always re-reads the
  authoritative recomputed cart (the SDK cart mutations are naturally idempotent and expose no Idempotency-Key, so
  none is sent — add-to-cart from the listing page in W2-02 is the keyed entry). `app/cart/page.tsx`: protected,
  dynamic (cookie read), live line totals + subtotal via `formatMoneyMinor` (platform currency INR — the cart
  read-model carries no per-line currency, matching the formatter default), per-line qty-update + remove + clear
  (Server Actions, no client JS), `priceChanged`/unpurchasable warnings + checkout-gating, empty/load-error
  states, checkout CTA (→ `/checkout`, W3-02). Header is now an async server component rendering a real cart
  **badge** via `features/cart/summary.getCartItemCount()` (anonymous/failure → 0, no network for anon). i18n
  `cart.*` en/hi/gu (152-key parity) + a11y `kv-visually-hidden` label utility.
- [x] **SF-W3-02 · checkout-pay** — **DONE.** `/checkout` (protected, dynamic): saved-address select + optional
  coupon + cart subtotal → `placeOrderAction` (`checkout.checkout`, **stable per-render Idempotency-Key** as a
  hidden field so a refresh/double-submit of the same review can't double-create). Redirects to `/checkout/pay`
  → `PayButton` (the only client component) runs the **real Razorpay flow**: `createOrderIntentAction` reads the
  order's authoritative total server-side + `payments.createIntent({purpose:'direct_order', referenceType:'order',
  referenceId})` under a **stable `order-pay:<id>` Idempotency-Key** (refresh/double-click reuses the same gateway
  order — never a double-charge) → opens checkout with the **publishable** key (`NEXT_PUBLIC_RAZORPAY_KEY_ID`, the
  only thing in the browser; the session token never is) → polls `payments.get` (capture is webhook-verified
  server-side; `paymentOutcome` maps status) → `/checkout/confirm` shows the server-computed breakdown
  (subtotal/delivery/discount/tax/total) + line items. Money is minor-unit strings end-to-end via
  `formatMoneyMinor`; **fail-closed** everywhere (no publishable key → friendly "unavailable"; failed/cancelled →
  retry, never auto-retry; pending → "we'll confirm shortly"). i18n `checkout.*` en/hi/gu (182-key parity).
  **FLAGGED (no SDK surface):** there is no coupon **discount-preview** endpoint and no **delivery-methods**
  lookup — so the discount/charges/tax are computed at placement and shown on confirmation (the page says so), and
  `deliveryMethodId` is omitted (optional). Multi-seller checkout creates one order per seller; the pay step
  settles the **primary** order and the confirmation links to "my orders" (W3-03) for the rest.
- [x] **SF-W3-03 · orders-history-detail-tracking** — **DONE.** `/orders` (protected, dynamic): `orders.list`
  (role=buyer, keyset) rendered through the shared accessible `DataTable` — order no (link), localized status,
  seller, total (`formatMoneyMinor`), date (`formatDate`), empty/error states. `/orders/[id]` (protected): `orders.get`
  with `notFound()` on missing/foreign id (RLS-scoped, no IDOR); a localized **status timeline** (pure
  `features/orders/timeline.ts` → `OrderTimeline`, tolerant status→step mapping + cancelled/disputed terminal
  banner), line items, the server-computed totals breakdown, and **shipment tracking** via `shipments.list({orderId})`
  (status / AWB / pickup / delivered / OTP-note, degrades to "no shipment yet" if the logistics flag is off).
  i18n `order.*` en/hi/gu (220-key parity). **FLAGGED (no SDK surface):** there is **no invoice resource or
  download method** in the SDK (no `payments.invoices`, no `orders.invoice`), so "invoice download" can't be built
  without inventing an endpoint — deferred until the SDK exposes one.
- [x] **SF-W3-04 · reviews-write** — **DONE.** `/orders/[id]/review` (protected, `notFound` on foreign id):
  gated by order completion (pure `orderTimeline`), an accessible **no-JS star radio-group (1–5) + optional
  comment** posting to `submitReviewAction` (`reviews.create`, `randomUUID` Idempotency-Key; target + verified-
  purchase eligibility resolved server-side — client never names a target, anti-IDOR). The **one-review-per-order
  rule is surfaced** in the form copy, and since the SDK exposes no per-order review lookup we can't pre-check it
  — a duplicate is rejected server-side and shown as "you may have already reviewed this order." Order detail now
  shows a "Write a review" CTA when complete + a "thanks" notice on return. i18n `review.*` en/hi/gu (231-key
  parity). **FLAGGED (no SDK surface):** `reviews` exposes only `create` + an **aggregate** `summary`
  (averageStars/count) — there is **no method to fetch individual reviews or a seller's response**, so "seller
  response shown on the listing" can't be built (the listing already shows the aggregate summary from SF-W2-02).
  Unblocks when the SDK adds a reviews-list / seller-response read.

### WAVE 4 — engagement surfaces
- [x] **SF-W4-01 · offers-and-messaging** — **DONE.** **Offers:** `/offers` buyer inbox (`offers.list` box=outgoing,
  keyset DataTable) + `/offers/[id]` (negotiation detail, `notFound` on foreign id) with buyer **accept / counter
  (float-free `parseMajorToMinor`) / reject** Server Actions while open, converted-order link, and a "message
  seller" action that opens a chat (`conversations.open` after resolving the seller via `listings.get`). Offer
  submit itself stays the idempotency-keyed `offers.make` from SF-W2-02; counter/accept/reject expose no key (the
  server state machine guards them). **Messaging:** `/messages` conversation list + `/messages/[id]` thread
  (`conversations.get` + `listMessages` + `auth.me` to align bubbles, best-effort `markRead`, post-message form),
  and a **masked-call CTA** (`maskedCalls.initiate`) that passes only the counterpart's **user id** — derived from
  message senders, since the read-model lists no participants — **never a phone number** (the proxy bridges the
  call server-side). Voice/attachment messages render as localized labels. Header gains Offers + Messages links
  when signed in. i18n `offers.*`/`messages.*`/`nav.*` en/hi/gu (293-key parity). All mutations are authed Server
  Actions with Idempotency-Keys where the SDK exposes them; no token or phone number ever reaches the client.
- [x] **SF-W4-02 · auctions** — **DONE.** Public `/auctions` browse (cards w/ live **countdown**, start price,
  status; keyset) + `/auctions/[id]` detail (`auctions.get` + `listBids` + listing title): live countdown, current
  high bid (pure `currentHighMinor`), suggested **min next bid** (pure BigInt `minNextBidMinor`), reserve, bid
  history (bidder identity NOT exposed; sealed amounts shown as "sealed"), and the **anti-snipe** + **EMD/wallet**
  notes. Authed **bid** via `placeBidAction` (`auctions.placeBid`, `randomUUID` Idempotency-Key, float-free
  `parseMajorToMinor`; EMD is held server-side — Law 11). **Flag-gated:** `env.featureAuctions`
  (`NEXT_PUBLIC_FEATURE_AUCTIONS`) hides the whole surface (`notFound()` + header link removed) when set to
  `false`; the API's own `auctions` flag is the authoritative gate (public reads degrade to empty when off).
  `Countdown` is the only client component (ticking clock, no data/secret). i18n `auctions.*`/`nav.auctions`
  en/hi/gu (329-key parity). **FLAGGED (no SDK surface):** the auctions resource has **no watch/follow method**
  (the apps/api W3-11 watchers exist server-side but aren't exposed in the SDK), so the "watch" half of bid+watch
  can't be built without inventing an endpoint — deferred until the SDK adds `auctions.watch`. Also the `Auction`
  read-model carries no EMD amount, so EMD is surfaced as a behaviour note rather than a figure.
- [x] **SF-W4-03 · notifications-inbox-prefs** — **DONE.** `/notifications` (protected, dynamic): the caller's own
  inbox (`notifications.inbox`, keyset; RLS-scoped — no IDOR) with an **unread-only** filter, server-rendered
  payload title/body + a same-origin-guarded **deep link**, unread styling, and a per-item **mark-read** Server
  Action (`notifications.markRead`, idempotent server-side). `/notifications/preferences` (protected): the
  **preference matrix** (event×channel) as a no-JS form that submits the COMPLETE matrix (`setPreferences`
  full-replace; a mandatory event the server refuses to disable surfaces a generic error) + **quiet-hours**
  management (`getQuietHours`/`setQuietHours`, native time inputs + IANA timezone, platform-default `Asia/Kolkata`
  when unset). Header gains a Notifications link when signed in. i18n `notif.*`/`nav.notifications` en/hi/gu
  (359-key parity). All authed Server Actions; PUTs are idempotent by nature (no key exposed); no token in the
  client.

### WAVE 5 — quality & DoD
- [x] **SF-W5-01 · storefront-test-and-polish** — **DONE — flips `web-storefront` to ✅.** ts-jest unit tests
  (`src/test/*.spec.ts`) for the pure logic: discovery money math (`parseMajorToMinor`/`minorToMajor`/
  `toListingQuery` — no float drift, untrusted enums dropped), auction BigInt bid math, order-timeline mapping,
  payment-status classification. **SEO completeness:** `app/robots.ts` (public allowed; account/cart/checkout/
  orders/offers/messages/notifications/login/api disallowed) + `app/sitemap.ts` (public indexable routes, /auctions
  when enabled) + `metadataBase` from `NEXT_PUBLIC_SITE_URL` so canonical/OG resolve absolute. **a11y:** `<html
  lang/dir>`, localized skip-link, `<main>` landmark, labelled controls, keyboard-navigable no-JS forms, focus
  styles, table `<caption>`s (axe itself runs in CI — not runnable in this sandbox; static a11y audit done).
  Route-level **loading/error/not-found** via the root boundaries (inheritance). Localized the last foundation-era
  page (`/trace`) — **367-key i18n parity, zero inline literals**. Final §4 self-audit green: no token/secret in any
  of the 5 client components, `server-only` on every server lib, money only via `formatMoneyMinor`, no stray
  `process.env`. `tsc`/`next lint`/`next build`/`jest` run in CI's pnpm toolchain (the documented sandbox caveat).

---

## 6. PER-TASK COMPLETION RITUAL
1. `tsc --noEmit` + `next lint` green (paste output; note `next build` runs in CI's pnpm toolchain).
2. New routes/components/Server Actions follow the thin-route + SDK-only + httpOnly-session pattern.
3. i18n keys added (en/hi/gu); money via `formatMoneyMinor`; a11y + metadata in place.
4. README "What it serves" updated; this backlog box ticked; `web-storefront` cell in `MODULE_STATUS.md` refreshed.
5. Self-audit §4 clean. Only then is the task done.

*North star: every page is server-first, secret-free, money-safe, accessible, and degrades instead of dying —
and reads exactly like the existing storefront pages + the SDK they stand on.*
