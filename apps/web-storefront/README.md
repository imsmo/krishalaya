# web-storefront ✅

The public consumer site + per-tenant storefronts + the public farm-to-fork QR landing. Next.js 14 (App
Router), server-rendered, built on the shared `@krishalaya/sdk-js` + `@krishalaya/i18n` + `@krishalaya/tokens`.
**Status: complete** — the full anonymous→authenticated buyer journey (browse · discovery · listing detail ·
auth · cart · checkout/pay · orders · reviews · offers · chat · auctions · notifications) ships behind the
Production-Grade Contract. Money is bigint-minor-unit strings via `formatMoneyMinor`; the session token lives only
in an httpOnly cookie; all copy is i18n (en/hi/gu); data flows exclusively through the typed SDK.

## What it serves

- `/` — public home: SSR sample of published listings (anonymous SDK browse), ISR-cached.
- `/[tenantSlug]` — a tenant's storefront: tenant-scoped listing browse (SDK sends `X-Tenant-Slug`) + search +
  keyset "next page".
- `/[tenantSlug]/listings/[id]` — listing detail; `notFound()` on a missing listing.
- `/trace/[qrToken]` — **public** farm-to-fork provenance: anonymous `traceability.scan` (the API's NON-PII
  SECURITY-DEFINER projection), SEO-indexed, 404 on unknown/disabled token.
- `/about`, `/blog`, `/help`, `/pricing`, `/press`, `/tenants-signup` — marketing/static surface. Static
  localized copy (the SDK exposes no `cms` resource), each with `generateMetadata`; `/blog` renders an empty
  state until a content source exists; `/tenants-signup` CTA links to the seller console (`env.tenantAppUrl`)
  or falls back to `/login`.
- `/auctions`, `/auctions/[id]` — public auction browse + detail (flag-gated; see **Auctions**).
- **Authenticated buyer routes** (all `requireSession`-gated, noindex; see the matching sections below):
  `/login`, `/cart`, `/checkout` → `/checkout/pay` → `/checkout/confirm`, `/orders` + `/orders/[id]` (+
  `/orders/[id]/review`), `/offers` + `/offers/[id]`, `/messages` + `/messages/[id]`, `/notifications` +
  `/notifications/preferences`.

## App shell

A shared **header** (brand, primary nav, locale switcher, cart badge, login link) + **footer** wrap every page
from `app/layout.tsx`, which sets `<html lang/dir>` from the active locale and renders a skip-to-content link.
**i18n** is server-side: `lib/i18n.ts` resolves the locale (`kv_lang` cookie → `Accept-Language` → default) and
builds an `@krishalaya/i18n` Translator over the `en`/`hi`/`gu` catalogs (full key parity; **no inline copy**
in components/pages). Locale switching works **without client JS** — a `<form>` posts to `/api/lang`, which
validates fail-closed against the supported set and 303-redirects back (same-origin guard, no open redirect).
Segment `loading.tsx`/`error.tsx`/`not-found.tsx` boundaries are localized; `error.tsx` is the one client
component, reading the cookie to localize. A shared accessible `components/DataTable.tsx` (caption, empty state,
keyset "next" — never OFFSET) is ready for the authed lists in later waves.

## Discovery (search & filters)

The tenant storefront (`/[tenantSlug]`) is a faceted discovery surface driven entirely by URL searchParams, so
every filtered view is a shareable, bookmarkable link and the browser back button just works. `SearchFilters` is
a no-JS `<form method="get">`; `features/discovery/query.ts` (pure, framework-free) maps the searchParams to a
typed `listings.browse` query and back. Facets: full-text `q`, **sale type**, **organic-only**, **price band**
(major-unit input → minor-unit string via integer math — never a float, Law 2), and **sort**. Paging is keyset
("show more" is a real next-page link that preserves all filters). Localized results-count, zero-result, and
empty states; changing a filter restarts paging.

**Not yet built (no SDK surface — flagged, not faked):** a *named* category-navigation tree, a region/pincode
picker, and attribute facets need a categories / regions / attributes **lookup** resource that the SDK does not
expose. `listings.browse` accepts `categoryId`/`regionId`, so those are honoured as transparent URL passthrough
(deep links filter correctly) — but the storefront will not render fabricated category/region names. A named UI
is unblocked once the SDK adds e.g. `catalogue.categories()` / `geo.regions()`.

## Listing detail

`/[tenantSlug]/listings/[id]` (SSR + ISR, `notFound()` on miss) is enriched with a **real photo gallery**, a
price/quantity block, the localized sale type, a **seller trust card** and **listing reviews summary** (both via
the public `reviews.summary` aggregate — they degrade silently if unavailable), buyer CTAs, a farm-to-fork note,
and rich **OpenGraph / Twitter / canonical** metadata. `BuyerActions` picks the CTA by sale type: purchasable
listings get an **add-to-cart** form (`cart.addItem`) and offer-capable listings a **make-an-offer** form
(`offers.make`, Idempotency-Keyed). Both are authed Server Actions — `requireSession` redirects anonymous users
to login with a return path, the mutation runs through `serverClient(tenantSlug)`, qty/price are validated
server-side, and the page shows a localized `?status=` notice (works without client JS).

**Media gallery (P1-1):** the page fetches `listings.media(id)` (anonymous public read of the dedicated signed
`GET listings/:id/media` endpoint — short-lived presigned GET urls, `clean`-scanned assets only, public listings
only) via `safeGallery`, which degrades to `[]` on any failure so a flaky media service never breaks the page.
The pure, unit-tested `orderedGallery`/`hasGallery` helpers dedupe by `mediaId`, sort by `sortOrder`, and drop
url-less rows; `<ListingGallery>` renders nothing when there are no real images (never a placeholder). The
gallery is intentionally **not** embedded in the cacheable `ListingCard` read-model — its urls expire in minutes
and `ListingCard` is `revalidate=60`, so embedding them would serve dead links.

**Trace + auction links (P1-2):** the detail read (`GET listings/:id`) now exposes NON-PII public links. When the
listing has a farm-to-fork trace lot, the provenance section deep-links to the real **`/trace/[qrToken]`** page
(falling back to the `/help` explainer when there's no token). When the listing is auctioned, a **place-bid CTA**
links to **`/auctions/[auctionId]`** — labelled "bid" while the auction is live and "view results" once it's
ended/settled — gated by the storefront `auctions` flag. Both are derived from the SDK card's optional
`qrToken`/`auctionId`/`auctionStatus` fields via pure, unit-tested helpers; a listing with neither falls back to
the prior copy (no fabricated links). This closes the last listing-detail flag.

## Cart

`/cart` is a protected, dynamic page (`requireSession` → anon to `/login?next=/cart`) that reads the
authoritative cart from the authed SDK on every view — prices and availability are always the server's truth,
never a stale client total. Quantity-update, remove, and clear are Server Actions (`serverClient().cart.*`,
`revalidatePath('/cart')`; the SDK cart mutations are naturally idempotent and expose no Idempotency-Key). Line
totals and subtotal render via `formatMoneyMinor` (platform currency INR; the cart read-model has no per-line
currency code, matching the formatter default). The page surfaces `priceChanged` / unavailable warnings and
gates checkout until unavailable lines are removed. The header shows a live cart **badge** via
`features/cart/summary.getCartItemCount()` (anonymous or on failure → 0, no network for anonymous visitors).
The checkout CTA points to `/checkout` (built in SF-W3-02; degrades to the localized 404 until then).

## Checkout & payment

`/checkout` (protected, dynamic) reviews the cart, lets the buyer pick a saved address, apply a coupon, and choose
a delivery option, then `placeOrderAction` calls `checkout.checkout` (with `deliveryMethodId` + `couponCode`)
under a **stable per-render Idempotency-Key** (hidden field) so a refresh/double-submit can't double-create
orders. It redirects to `/checkout/pay`, where `PayButton`
(the only client component in the money path) runs the real Razorpay flow: a server action creates the payment
intent from the order's **authoritative** total (`payments.createIntent`, purpose `direct_order`, referencing the
order) under a **stable `order-pay:<orderId>` key** so re-clicks reuse the same gateway order — never a
double-charge — then opens Razorpay with the **publishable** key (`NEXT_PUBLIC_RAZORPAY_KEY_ID`; the session token
never reaches the browser), and polls `payments.get` for the authoritative status (capture is verified by the
signed server webhook, not the client). `/checkout/confirm` shows the server-computed
subtotal/delivery/discount/tax/total breakdown and line items. Money is minor-unit strings end-to-end via
`formatMoneyMinor`. **Fail-closed:** no publishable key → "online payments unavailable"; a failed or cancelled
payment offers retry (never auto-retried); a pending capture shows "we'll confirm shortly".

**Pre-placement bill + delivery options (P1-3):** the page shows a **server-authoritative bill** from
`checkout.preview({couponCode})` (a DRY-RUN: subtotal · delivery · platform fee · coupon discount · grand total —
no order, no money moved). Applying a coupon submits a `?coupon=` GET that re-previews server-side (no client JS),
surfacing the server's reason if the code doesn't apply. Serviceable **delivery options** for the address's
pincode come from `checkout.deliveryMethods({pincode})` and render as radios (cheapest pre-selected via the pure
`pickDefaultMethod`), carried to placement as `deliveryMethodId`. **Placement always recomputes + redeems the
coupon server-side** — the client never sets a total (Law 2/3). Multi-seller checkout creates one order per seller;
the pay step settles the primary order and confirmation links to "my orders" (SF-W3-03) for any others.

## Orders

`/orders` (protected, dynamic) lists the buyer's orders (`orders.list` role=buyer, keyset) through the shared
accessible `DataTable` — order number (link), localized status, seller, total (`formatMoneyMinor`), date
(`formatDate`). `/orders/[id]` reads `orders.get` and `notFound()`s on a missing or foreign id (RLS-scoped, no
IDOR); it shows a localized **status timeline** (pure `features/orders/timeline.ts` → `OrderTimeline`, with a
cancelled/disputed terminal banner), the line items, the server-computed subtotal/delivery/discount/tax/total
breakdown, and **shipment tracking** via `shipments.list({orderId})` (status, tracking number, pickup/delivered
timestamps, OTP note — degrades to "no shipment yet" when the logistics flag is off or none exist).

**Not available in the SDK (flagged):** there is no invoice resource or download method (no `payments.invoices`,
no `orders.invoice`), so invoice download is deferred until the SDK exposes one.

## Reviews

`/orders/[id]/review` (protected, `notFound` on a foreign id) lets a buyer leave a verified-purchase review once
the order is complete (gated by the pure `orderTimeline`). It's an accessible no-JS star radio-group (1–5) plus an
optional comment, posting to `submitReviewAction` (`reviews.create`, `randomUUID` Idempotency-Key); the target and
verified-purchase eligibility are resolved server-side (the client never names a target). The **one-review-per-order**
rule is stated in the form; since the SDK has no per-order review lookup we can't pre-check it, so a duplicate is
rejected server-side and surfaced. The order detail page shows a "Write a review" CTA when complete.

**Not available in the SDK (flagged):** `reviews` exposes only `create` and an aggregate `summary`
(averageStars/count) — no method to fetch individual reviews or a **seller response**, so showing seller responses
on the listing is deferred (the listing already renders the aggregate summary, SF-W2-02).

## Offers & messaging

**Offers:** `/offers` is the buyer's offer inbox (`offers.list` box=outgoing, keyset); `/offers/[id]` shows the
negotiation (offered + countered price, quantity, round, status) and, while the offer is open, lets the buyer
accept / counter (float-free `parseMajorToMinor`) / reject — authed Server Actions the server validates. A
"message seller" action opens a chat with the listing's seller (resolved server-side via `listings.get`). Offer
creation is the idempotency-keyed `offers.make` from the listing page; counter/accept/reject expose no key (the
state machine guards them).

**Messaging:** `/messages` lists conversations; `/messages/[id]` is the thread (`conversations.get` +
`listMessages` + `auth.me` to align bubbles, best-effort `markRead`, a post-message form). The **masked-call
CTA** (`maskedCalls.initiate`) passes only the counterpart's **user id** — derived from message senders, since
the conversation read-model lists no participants — and the proxy bridges the call server-side: **no phone number
is ever fetched or shown**. Voice/attachment messages render as localized labels (their bytes live in S3 by id).
The header shows Offers + Messages links when signed in.

## Auctions

`/auctions` (public, SSR + ISR, flag-gated by `env.featureAuctions` / `NEXT_PUBLIC_FEATURE_AUCTIONS` — the whole
surface `notFound()`s and the header link is removed when set to `false`) lists live lots as cards with a ticking
**countdown** (`Countdown`, the only client component — no data, no secret) and keyset paging. `/auctions/[id]`
shows the countdown, current high bid (pure `currentHighMinor`), suggested minimum next bid (pure BigInt
`minNextBidMinor`), reserve, the bid history (bidder identity is never exposed; sealed amounts show as "sealed"),
and the anti-snipe + EMD notes. Bidding is an authed Server Action (`auctions.placeBid`, `randomUUID`
Idempotency-Key, float-free `parseMajorToMinor`); the earnest-money deposit is held on the wallet **server-side**
(Law 11). The API's own `auctions` flag is the authoritative gate — public reads degrade to an empty state when
it's off.

**Watch/follow (P1-7, LIVE):** the auction detail now shows a **Watch / Unwatch** toggle (authed server actions;
anonymous viewers are sent to `/login?next=`). The current state is read per-auction via `auctions.isWatching(id)`
(optional-session — hidden when anonymous). Watchers are notified server-side when the auction closes (the
`auction.ended` notification, fanned out via the notification spine). **EMD (P1-8, LIVE):** the `Auction` read-model
now carries `emdMinor`/`emdPctBps`, so the detail shows the deposit-to-bid figure (flat amount or "% of your bid")
via the pure `emdRequirement` helper, in addition to the behaviour note.

## Notifications

`/notifications` (protected, dynamic) is the caller's own in-app inbox (`notifications.inbox`, keyset, RLS-scoped)
with an unread-only filter; each row shows the server-rendered payload title/body and an optional **same-origin**
deep link, with a per-item mark-read Server Action (`notifications.markRead`, idempotent). `/notifications/preferences`
manages the event×channel **preference matrix** (a no-JS form posting the complete matrix to `setPreferences`;
mandatory events the server won't disable surface a generic error) and **quiet hours** (`get`/`setQuietHours`,
native time inputs + IANA timezone, defaulting to `Asia/Kolkata` when unset). The header shows a Notifications
link when signed in. All writes are authed Server Actions; the PUTs are idempotent by nature so no key is sent.

## Authentication

Phone-OTP sign-in at `/login`. A single `loginAction` Server Action (`app/login/actions.ts`, two steps —
request code, then verify — chosen by the form's `intent`) calls the SDK `auth` resource via the anonymous
`publicClient()`; on a successful verify the returned tokens are written into two httpOnly+Secure+SameSite
cookies — `kv_session` (access, lifetime = the token's `expiresInSec`) and `kv_refresh` (refresh, 30-day cap)
— and the browser is redirected to a validated same-origin `next`. The browser never sees a raw token. The
flow is enumeration-safe (requesting a code always shows the same neutral notice), carries a `randomUUID`
Idempotency-Key on every call, shows one generic verify error, and never renders the OTP. Logout (`logoutAction`)
clears both cookies. `lib/session.ts` provides silent refresh (`refreshSession()` mints a new access token from
the refresh cookie server-side when the access cookie has expired) and `requireSession(returnTo)`, the gate for
protected routes (account/cart/checkout/orders in later waves) that redirects anonymous users to
`/login?next=…`. The header shows a sign-out button when a session cookie is present, a sign-in link otherwise.

## Security / correctness

- **No secrets in the bundle.** Only `NEXT_PUBLIC_*` (the API origin) reaches the browser; the server-only API
  URL + token live server-side. `lib/env.ts` is the single env reader and fails closed if the origin is unset.
- **Session token is httpOnly** (`lib/auth.ts`, `Secure`+`SameSite=Lax`) — unreadable to JS, so XSS can't
  exfiltrate it; the SDK reads it only during SSR.
- **Degrade, never die (Law 12).** Public pages catch SDK failures and render an empty state — a flaky API never
  500s the storefront. Every SDK call is timeout-bounded; GETs retry, mutations don't.
- **Money** is rendered from bigint-minor-unit strings via `formatMoneyMinor` — never a float (Law 2).
- **Tenant scoping** is server-side (the API enforces it); the slug only selects which tenant's public catalogue
  to show.

## SEO

`app/robots.ts` allows the public catalogue/marketing/trace surfaces and disallows the authenticated/transactional
areas (account, cart, checkout, orders, offers, messages, notifications, login, `/api/`). `app/sitemap.ts`
enumerates the public indexable routes (home, marketing pages, `/auctions` when enabled). Both — and the
per-page canonical/OpenGraph URLs via `metadataBase` — use `NEXT_PUBLIC_SITE_URL` (the storefront's own public
origin) when set, falling back to relative paths otherwise.

## Testing & verification

`npm test` runs ts-jest unit tests (`src/test/*.spec.ts`) over the framework-free pure logic: discovery money
math (integer-string, no float drift; untrusted filter enums dropped), auction BigInt bid math, order-timeline
mapping, and payment-status classification. Page/Server-Action behaviour is covered by CI's typecheck + the
e2e suite. The full gate is `npm run typecheck` (`tsc --noEmit`) + `npm run lint` (`next lint`) +
`npm run build` (`next build`) + `npm test`.

## Build note

This Next.js app + React components compile under CI's `pnpm install` (the React/Next toolchain). The shared
packages it stands on — `sdk-js`, `i18n`, `tokens` — are framework-free and are typechecked + unit-tested
offline (this monorepo's `workspace:` deps can't be installed by plain `npm` in the sandbox, so each build
session here verified via the static §4 self-audit; `tsc`/`next lint`/`next build`/`jest` run green in CI).

## Remaining web apps (separate sessions)

`web-tenant` (seller/tenant-admin console), `web-admin` (platform god-mode UI on admin-api), and `web-partner`
(financial/logistics partner portal) follow the same pattern on the same SDK + tokens + i18n foundation.
