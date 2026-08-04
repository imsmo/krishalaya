# P1 — GA completeness (un-flag the remaining Phase-1 surfaces)

After P0 you can serve users. P1 removes the remaining "coming soon" / SDK-gap flags so the Phase-1 product is
**fully un-flagged and polished**. Almost every item here is "the backend exists, expose the field/method + un-flag
the client" — small, high-leverage waves. **Paste `00-PRODUCTION-CONTRACT.md` above each task.**

These are ordered by user-visible impact. Most are independent; do them in any order within a tier.

---

## A. Listing & commerce read-model gaps (storefront + tenant)

### P1-1 · Listing media gallery in the read-model — ✅ DONE (2026-06)
- **Track:** `apps/api` listings read-model + `packages/sdk-js` + `web-storefront` (SF-W2) + `apps/mobile`
- **Why pending:** Storefront listing-detail can't show a media gallery — the read-model carries no media ids
  (flagged, "can't build gallery without faking").
- **Scope:** Add media ids (+ presigned URLs via the existing media flow) to the listing read-model; render the
  gallery; un-flag.
- **Done when:** A listing shows its real image gallery from presigned URLs; no fabricated media.
- **Resolution:** The media flow already exists (API-W5): `ListingGalleryReadModel.forListing` serves a dedicated
  `GET listings/:id/media` — short-lived (10-min) presigned GET urls, `scan_status='clean'` assets only, and ONLY
  for a `published` + publicly-visible listing (draft/private/cross-tenant-hidden → empty, never leaks photos);
  SDK `listings.media(id)` (anonymous) returns `GalleryItem[]`. We deliberately keep the gallery OUT of the
  cacheable `ListingCard` read-model — its urls expire in minutes and `ListingCard` is `revalidate=60`, so
  embedding them would serve dead links. The storefront detail page now fetches the gallery alongside the listing
  (`safeGallery` → degrades to `[]` on any failure) and renders `<ListingGallery>` via pure, unit-tested helpers
  (`hasGallery`/`orderedGallery`: dedupe + sort + drop url-less rows; empty → renders nothing, never a placeholder).
  i18n `listing.galleryTitle`/`listing.photoAlt` added in en/hi/gu (369-key parity); `kv-gallery` CSS added.
  The stale "can't build gallery without faking" comment is removed; the separate `qrToken`/`auctionId` flag
  (tracked as **P1-2**) is intentionally retained.

### P1-2 · `qrToken` + `auctionId` on the listing read-model — ✅ DONE (2026-06)
- **Track:** `apps/api` listings read-model + SDK + `web-storefront`
- **Why pending:** The public farm-to-fork `/trace/[qrToken]` deep-link and the place-bid-from-listing CTA can't be
  built — the read-model carries neither `qrToken` nor `auctionId`.
- **Scope:** Expose `qrToken` (NON-PII) and `auctionId` on the listing read-model; wire the `/trace` deep-link and
  the bid CTA.
- **Done when:** Scanning a listing's QR opens its provenance page; an auctioned listing links to its live auction.
- **Resolution:** New `ListingLinksReadModel.forListing(tenantId, listingId)` (replica-backed, tenant-scoped) joins
  the listing to its `trace_lots.qr_token` and its `auctions` row (`id`/`status`/`ends_at`), returning all-null for
  any listing that isn't `published` + publicly-visible (never leaks an unpublished seller's trace lot or scheduled
  auction). `GET listings/:id` enriches its response with these NON-PII links read FRESH from the replica (not the
  300s-cached listing entity, so auction status reflects the live lifecycle). SDK `ListingCard` gains optional
  `qrToken`/`auctionId`/`auctionStatus`/`auctionEndsAt` (present on the detail read, `undefined` on list reads).
  The storefront detail page now: (a) links the farm-to-fork section to the real `/trace/[qrToken]` provenance page
  when a token exists (falling back to the `/help` explainer otherwise); (b) renders a place-bid CTA to
  `/auctions/[auctionId]` — labelled "bid" while the auction is live (scheduled/live/extended/awaiting_approval) and
  "view results" once terminal — gated by the storefront `auctions` flag. Pure, unit-tested helpers
  (`traceHref`/`auctionCta`/`listingLinks`) encode the ids and never fabricate a link; i18n keys added in en/hi/gu
  (375-key parity). The stale "read-model carries no qrToken/auctionId" flag is removed — **P1-2 closes the last of
  the listing-detail flags.**

### P1-3 · Coupon discount-preview + delivery-methods lookup at checkout — ✅ DONE (2026-06)
- **Track:** `apps/api` promotions + logistics + SDK + `web-storefront` (SF-W3)
- **Why pending:** No SDK surface to preview a coupon discount or list delivery methods; today they're only computed
  at placement.
- **Scope:** A discount-preview endpoint (validates coupon, returns the computed discount without placing) and a
  delivery-methods lookup; show them pre-placement.
- **Done when:** Buyer sees the discount + delivery options before paying; placement still re-computes server-side.
- **Resolution:** The **coupon discount-preview already existed end-to-end** (API `POST checkout/preview` runs the
  same money math as checkout with a coupon DRY-RUN — validate, never redeem — and surfaces a per-seller
  `couponError`; SDK `checkout.preview({couponCode})`). The storefront carried a STALE flag claiming "no preview
  endpoint" and only showed the cart subtotal — that's removed; the page now renders the real server-authoritative
  bill (subtotal · delivery · platform fee · discount · grand total) and applies a coupon via a `?coupon=` GET
  re-preview (works without client JS), showing the server's rejection reason on an invalid code.
  The **delivery-methods lookup was the genuinely-missing piece**, now built read-only + buyer-facing:
  `GET checkout/delivery-methods?pincode=&regionId=` → `CheckoutService.deliveryMethods` resolves serviceable
  active `delivery_zones` (jsonb pincode/region containment, tenant-scoped + RLS, capped) and computes each zone's
  REAL fee from its `charge_definition_id` against the live cart subtotal via the charge engine
  (`ChargePricingService.quoteByDefinitionId` + `ChargeDefinitionRepository.resolveById`). A zone with no
  charge-definition is free (0), never fabricated; no serviceable zone → empty list (the page falls back to the
  preview's generic delivery fee). SDK `checkout.deliveryMethods(...)` + `DeliveryMethod`/`DeliveryMethodsResult`
  types. The storefront shows the options as selectable radios (carried to placement as `deliveryMethodId`), with
  the cheapest pre-selected via the pure, unit-tested `pickDefaultMethod` (+ `normalizeCoupon`). **Placement always
  recomputes + redeems server-side** (the preview is a pure DRY-RUN; the client never sets a total — Law 2/3).
  i18n keys added in en/hi/gu (383-key parity). Read-only cross-module dep (`DeliveryZoneRepository` provided in
  OrdersModule, stateless READ_REPLICA) avoids a module cycle.

### P1-4 · Invoice download (trade invoice PDF) — ✅ DONE (2026-06)
- **Track:** `apps/api` payments-invoicing + SDK + `web-storefront`/`web-tenant`/`apps/mobile`
- **Why pending:** No SDK resource/method for invoices, so order detail can't offer a download (the PDF renderer +
  trade_invoices exist server-side).
- **Scope:** SDK `payments.invoices` resource (list + get presigned PDF URL); wire an Invoice download on order
  detail. Tenant + buyer scoped, no IDOR.
- **Done when:** A completed order offers a real invoice PDF download for both buyer and seller.
- **Resolution:** The trade-invoice record + the PDF renderer (`DocumentPdfService.storeInvoicePdf` →
  `renderInvoice`/`putGeneratedDocument`, flag-gated by `document_pdfs`) already existed; what was missing was a
  download surface. Added `GET invoices/order/:orderId/download` → `TradeInvoiceService.downloadUrlForOrder`:
  **ownership-gated first** (the order's buyer/seller or a finance moderator — 404 to anyone else, no
  IDOR/enumeration; reuses the existing `getByOrderVisible`), then it **lazily renders** the PDF on first request
  (no-op unless `document_pdfs` is on), resolves the media's S3 key **only when `scan_status='clean'`** (new
  `TradeInvoiceRepository.getCleanPdfKey`, tenant-scoped join — infected/pending assets never presigned), and
  returns a **short-lived (5-min) presigned GET**. A missing/expired/un-scanned PDF throws the typed, retryable
  `InvoicePdfNotReadyError` (409). SDK gains `payments.invoices.getByOrder()` + `payments.invoices.downloadUrl()`
  with `InvoiceSummary`/`InvoiceDownload` types. The storefront order-detail page fetches the URL best-effort and
  renders a **Download invoice (PDF)** link only when available (no fabricated download when the renderer is off);
  the filename is sanitized by the pure, unit-tested `invoiceFileName` (blocks path/traversal smuggling in the
  `download` attr). i18n `order.downloadInvoice` in en/hi/gu (384-key parity). The stale storefront "no invoice
  resource (flagged)" note is removed. Buyer + seller + finance can all download; both web-tenant and mobile can
  now adopt the same SDK method.

### P1-5 · Individual reviews fetch + seller response ✅ DONE
- **Track:** `apps/api` reviews + SDK + `web-storefront` + `web-tenant`
- **Why pending:** Reviews exposes only `create` + aggregate `summary`; you can't list individual reviews or let a
  seller respond.
- **Scope:** Read-model + endpoint to list individual reviews (no buyer PII beyond policy) and a seller-response
  mutation; render the review list + response.
- **Done when:** A listing shows individual reviews and a seller can post one response per review.
- **Resolution:** The seller-response mutation (`POST reviews/:id/respond`, author-gated to the review's target)
  already existed; the genuine gaps were a PUBLIC individual-reviews read for the anonymous storefront and the
  client/UI to consume it. Added (a) a new `@Public() GET reviews/public` returning a **PII-free** projection
  (`publicSerialize` OMITS `reviewerUserId`/`orderId`), published-only, keyset-paginated; (b) fixed a pre-existing
  triple-bug on `reviews.summary` (route wasn't `@Public` → 401; SDK sent `{targetUserId/listingId}` but the API
  requires `{targetType,targetId}` → 400; field-name mismatch `avgStars`↔`averageStars`) by marking the summary
  route `@Public` and making the SDK map `targetUserId`→`{targetType:'seller',targetId}` + normalize the field;
  (c) SDK `publicReviews` (anonymous `Page<PublicReview>`), `list` (authed `Page<ReviewItem>`, incl. reviewer id
  for a seller managing their own), `respond(id,response)`, plus `PublicReview`/`ReviewItem` types + index export;
  (d) storefront listing-detail renders the seller's individual reviews (stars/verified badge/date/body/seller
  response), degrading to `[]`; (e) web-tenant disputes page gained a **"Your reviews"** section listing the
  seller's own reviews with a one-response-per-review form (`respondToReviewAction` → `reviews.respond`, validated
  1–4000 chars, 409 → "already responded"). Pure helpers (`starGlyphs`, `validateReviewResponse`) unit-tested;
  storefront + web-tenant i18n at full en/hi/gu parity (387 / 480 keys).

### P1-6 · Wallet-balance read-model ✅ DONE
- **Track:** `wallet-service`/`apps/api` + SDK + `web-tenant` (TC-W3) + `apps/mobile`
- **Why pending:** No wallet/balance/ledger-summary read in the seller SDK; tenant wallet ships ledger only
  (flagged, "not a faked balance").
- **Scope:** A balance/ledger-summary read derived from the ledger (never computed elsewhere), keyset ledger list;
  show running balance.
- **Done when:** Seller/farmer sees a true ledger-derived balance; reconciliation still nets to zero.
- **Resolution:** The ledger-derived reads already existed server-side and in the SDK — `GET wallet/balance`
  (available + held from `wallet_accounts.cached_balance_minor`, maintained atomically by the wallet-service
  double-entry ledger; the balance is NEVER computed in app code) and `GET wallet/ledger` (per-entry statement
  with a server-computed `balanceAfterMinor` running balance, keyset-paged, replica-served, anti-IDOR). The genuine
  gaps were the two flagged consumers: **(web-tenant)** the wallet page shipped a payments list with a "balance
  unavailable" note — now un-flagged to a balance card (available + held + frozen badge, total via pure
  `totalWalletMinor`) plus the true ledger statement table with per-row running balance and credit/debit colour
  (pure `presentLedgerEntry`/`ledgerTone`, unit-tested). **(mobile)** `walletBalance()` read a non-existent
  `{balanceMinor}` field (the read-model returns `availableMinor`/`heldMinor`/`isFrozen`) so the farmer hub always
  showed ₹0 — fixed to the typed `wallet.balance()` (available headline + held sub-line), and added a new
  **Statement** screen on `wallet.ledger()` with running balance (pure `presentLedgerEntry`/`ledgerMoneyTone`,
  unit-tested) plus a hub link. Reconciliation is untouched (zero-sum still holds — these are read-only CQRS
  projections, Law 2/11). i18n at full en/hi/gu parity (web-tenant 488 keys; mobile 1272 keys).

### P1-7 · Auctions watch/follow ✅ DONE
- **Track:** `apps/api` auctions + SDK + `web-storefront` (SF-W4) + `apps/mobile`
- **Why pending:** SDK exposes no watch/follow method; the "watch" half of bid+watch can't be built.
- **Scope:** Watch/unwatch endpoint + watchers read; un-flag the watch CTA; notify watchers on relevant events via
  the notification spine.
- **Done when:** A buyer watches an auction and receives the configured notifications.
- **Resolution:** The watch/unwatch/`watching` routes already existed server-side; the gaps were the SDK methods,
  a per-auction watch-state read, the watcher notifications, and the client CTAs. **(API)** added `GET
  auctions/:id/watch` (O(1) `isWatching`, tenant-scoped, 404-not-403); on auction close `closeAndResolve` now loads
  the auction's watchers (`listWatcherUserIds`, bounded cap 5000, read in the close tx) and emits
  `auctions.watchers_auction_ended` carrying `recipientUserIds` — mapped in the notification spine to a new
  `auction.ended` catalog event (push + inapp, seeded en) so **every watcher is notified atomically with the
  close** (Law 4); no money/PII beyond in-tenant ids. **(SDK)** `auctions.watch(id)`/`unwatch(id)`/`isWatching(id)`/
  `watching(page)` + `WatchedAuction` type + export, unit-tested. **(storefront)** un-flagged the watch CTA on the
  auction detail — an optional-session read renders a Watch/Unwatch toggle (authed server actions; anon →
  /login?next=), degrading to hidden when anonymous. **(mobile)** added a watch toggle on the auction detail
  (optimistic flip + rollback, server-truth state). Pure publisher/notification-map wiring unit-tested; i18n at
  full en/hi/gu parity (storefront 393 keys; mobile 1275 keys).

### P1-8 · EMD amount + cross-auction "my bids" on the read-model ✅ DONE
- **Track:** `apps/api` auctions + SDK + `apps/mobile` (screens 17/18)
- **Why pending:** EMD amount isn't in the auction read-model; there's no cross-auction my-bids endpoint (today
  own-bids are only marked inline within one auction).
- **Scope:** Add EMD amount to the read-model; add a keyset cross-auction my-bids read.
- **Done when:** The auction screen shows the EMD; a buyer sees all their bids across auctions.
- **Resolution:** The cross-auction **my-bids read already existed** (API-W7: `GET auctions/my-bids` +
  `MyBidsReadModel` + SDK `auctions.myBids()` with `emdHeldMinor`/`isWinning`) — but the mobile screen 18
  (`MyBidsScreen`) was a `[P1]` stub, so it was unreachable. Two genuine gaps closed: **(1) EMD on the read-model** —
  `AuctionService.serialize` now emits `emdMinor` + `emdPctBps` (the server's `emdForBid` inputs; no money moves on
  a read, Law 2/11) and the SDK `Auction` type carries them; the storefront + mobile auction detail now show the
  EMD figure (flat amount or "% of your bid") via a pure `emdRequirement` helper (unit-tested both sides). **(2)
  mobile screen 18** — implemented `MyBidsScreen` on the existing `auctions.myBids()` (keyset load-more; per-bid
  amount + EMD hold + status + winning badge; tap → auction detail), added the `/(buyer)/auctions/my-bids` route
  and a "My bids" entry on the auctions list. SDK tests assert `auctions.get` exposes the EMD strings and
  `auctions.myBids` returns the EMD hold. i18n at full en/hi/gu parity (storefront 395; mobile 1282).

---

## B. Lookup/taxonomy endpoints (un-block several pickers)

### P1-9 · Public lookup/taxonomy read endpoint (categories / regions / attributes / work-type / skill / doc-type) ✅ DONE
- **Track:** `apps/api` (catalogue + foundation lookups) + SDK + storefront/tenant/mobile
- **Why pending:** Many surfaces show UUIDs or disable pickers because there's no SDK lookup resource — named
  category-nav/region/attribute facets (storefront), book-worker work-type/skill/region pickers (mobile),
  schemes doc-type names. (The catalogue-ops master data exists; it just isn't exposed read-side to clients.)
- **Scope:** A cached, replica-backed lookup read API (controlled vocabularies + the category tree + regions +
  attribute options + work-type/skill + KYC doc-types), name-resolved for the user's locale. Wire the dependent
  pickers/facets.
- **Done when:** Category nav, region/attribute facets, worker pickers, and doc-type pickers all show real names;
  unknown id → graceful null, never a fabricated label.
- **Resolution:** The category tree + a category's attributes/options were already `@Public` server reads
  (`GET categories`, `GET attributes[/options]`), and **worker pickers** (`GET labour/lookups`) + **KYC doc-types**
  (`identity.docTypes()`) already resolve real names — those surfaces were already done. The genuine gaps closed:
  **(API)** a new **lookups module** with two missing reference reads — `GET lookups/regions` (admin-region tree:
  states or a parent's children) and `GET lookups/values?type=…` (any controlled vocabulary; platform + tenant
  values, a tenant value shadowing a platform one) — both **locale-resolved** via a LEFT JOIN onto `translations`
  (caller's-language label when present, else the canonical `default_name` — graceful, never fabricated), replica-
  backed, bounded, cached with tenant-prefixed keys, `@Public`; the type code is a tight anchored identifier
  (ReDoS-safe), region params a uuid/small int (zod `.strict`). **(SDK)** a consolidated `LookupsResource`
  (`categories`/`attributesForCategory`/`attributeOptions`/`regions`/`values`) + `CategoryNode`/`AttributeDef`/
  `AttributeOption`/`LookupValue`/`RegionNode` types + a pure `nameById(items,id)` helper that returns **null** for
  an unknown id. **(storefront)** the discovery **category nav** is now a real name `<select>` fed by
  `lookups.categories()` (pure, tested `flattenCategoryNav` — path-ordered, depth-indented, inactive dropped,
  graceful `[]`); degrades to the prior passthrough when the lookup is unavailable. Pure helpers + SDK URLs +
  locale-resolution unit-tested; i18n full en/hi/gu parity (storefront 397).
- **Now-unblocked follow-ups (SDK + endpoints exist; UI wiring incremental):** storefront region + attribute facets,
  web-tenant new-listing category/attribute pickers, and a mobile regions picker can now consume `lookups.*`.

---

## C. Tenant-admin configuration surfaces (web-tenant)

### P1-10 · Tenant self-config: commission-rules, delivery-zones, branding, languages — ✅ DONE
- **Track:** `apps/api` tenancy/commission/logistics + SDK + `web-tenant`
- **Why pending:** Seller-facing SDK exposes no method for these; flagged SDK-gaps in `TENANT_BUILD_BACKLOG.md`.
  (Admin-side equivalents exist in admin-api/ops; tenants can't self-serve them yet.)
- **Scope:** Tenant-scoped SDK methods + UI for commission-rule editing, delivery-zone config, branding, and
  language selection. Money rules stay server-authoritative; changes audited.
- **Done when:** A tenant admin edits each from `web-tenant` with RBAC + audit; no cross-tenant leakage.
- **Resolution (P1-10):** Pre-flight confirmed the API was the *least* of the gap — all four configs already had
  tenant-scoped, RBAC-gated, **audited** endpoints (`commission-rules` POST/GET/:id/deactivate `payout.approve`;
  `logistics/zones` CRUD+active `ShipmentPermissions.Manage` under the `logistics` flag; `tenant-settings`
  GET/PUT `tenant.settings` under the `tenancy` flag). The genuine gaps, now closed:
  1. **SDK** — new `tenantConfig` resource (`KrishalayaClient.tenantConfig`): `commissionRules` / `createCommissionRule`
     (idem) / `deactivateCommissionRule`; `deliveryZones` / `getDeliveryZone` / `createDeliveryZone` (idem) /
     `updateDeliveryZone` / `setDeliveryZoneActive`; `settings` / `putSetting` (idem) / `features`. New types
     (`CommissionRule`, `CreateCommissionRuleInput`, `DeliveryZone`, `Create/UpdateDeliveryZoneInput`,
     `TenantSetting`, `TenantFeature`) exported. Money stays bigint-minor **strings**; the app never computes a fee.
  2. **Seed** — branding (`branding.display_name/logo_url/primary_color/support_email`) + language
     (`languages.enabled` json, `languages.default`) keys added to `setting_definitions` (the PUT fails closed on
     undefined keys, so these had to be registered; "new setting = INSERT, never a migration").
  3. **web-tenant `/settings`** — one page, four sections (commission rules editor with platform-default rows shown
     **read-only**/inherited, delivery-zones list + create + enable/disable, branding form, language picker +
     default), all via Server Actions → the audited API. Pure validators in `features/settings/config.ts`
     (`buildCommissionRule` / `buildDeliveryZone` / `buildBranding` / `buildLanguages` / `formatBps` /
     `settingString` / `settingList`), 34 unit assertions; ReDoS-safe anchored regexes; nav link + i18n en/hi/gu at
     full parity (546 keys each).
- **Verified:** pure-helper node-port `settings-config: 34 passed`; SDK URL-builder `sdk-url: 8 passed`; SDK URL/body
  tests added to `sdk.spec.ts`; i18n parity en==hi==gu==546. Full `pnpm typecheck && pnpm test (+build)` and a
  real-Postgres RLS/audit integration aren't runnable in this sandbox (no node_modules).
- **Follow-ups (incremental, not blockers):** server-side enforcement of the plan `max_languages` cap against
  `languages.enabled` count (the generic settings store validates type only today); storefront consumption of
  `branding.*` + `languages.*` (currently stored, not yet rendered on the storefront chrome).

### P1-11 · Tenant integrations / webhooks / billing-config / staff-permissions matrix — ✅ DONE (all 4)
- **Track:** `apps/api` tenancy + providers + rbac + SDK + `web-tenant`
- **Why pending:** Same SDK-gap as P1-10 for integrations/webhooks (providers-ops exists admin-side), billing/
  subscription config, and a full staff-permissions matrix + direct assign/revoke (today only approve-pending +
  add-member are exposed).
- **Scope:** Tenant-scoped SDK + UI for integration/webhook setup, billing config, and a role-permission matrix with
  guarded assign/revoke (no privilege escalation, never `*`/money/god, can't grant perms the granter lacks).
- **Done when:** A tenant admin manages integrations, webhooks, billing, and staff roles within RBAC + audit, with
  escalation impossible (security-tested).
- **Resolution (P1-11) — all four sub-features DONE.** Pre-flight found the four were at very different readiness, so
  the task ran as four honest passes (staff-matrix → billing-config → integrations → webhooks); all are now shipped:
  - ✅ **Staff-permissions matrix (the security-critical DoD centrepiece) — shipped.** The API already had the full,
    audited, escalation-guarded surface (`GET rbac/roles`, `GET rbac/permissions`, `POST rbac/assignments` (idem),
    `DELETE rbac/assignments/:id`, `POST rbac/overrides`, all gated `identity.approve`; server guards in
    `user-tenant-role.service.ts`: platform/owner roles never assignable via the tenant API, a staff override can
    never grant `UNGRANTABLE` = `*`/`plan.manage`/`tenant.manage`/`user.impersonate`/`wallet.adjust`/`payout.approve`/
    `flag.toggle`, and can't exceed the granter's own perms; `rbac-security.spec.ts` proves it). Gaps closed: **SDK**
    `rbac.roles/permissions/assign/revoke/setOverride` + types (`RoleDef`/`PermissionDef`/`AssignRoleInput`/
    `StaffOverrideInput`); **web-tenant `/team/roles`** matrix (assign with platform roles excluded from the picker,
    revoke, grant/deny override with UNGRANTABLE hidden) via Server Actions; **pure guards** in
    `features/team/permissions.ts` (`UNGRANTABLE_PERMISSIONS` mirror verified diff-identical to the server set,
    `isRoleAssignable`/`canGrantPermission`/`buildAssign`/`buildOverride`), 24 unit assertions incl. escalation
    attempts; a server 403 surfaces as a clear "escalation not allowed" message. The granter-subset check stays
    **server-only** (no endpoint exposes the actor's full permission set) — the UI defers to the server rather than
    pretending to enforce it.
  - ✅ **billing-config — shipped (P1-11-A).** The subscriptions API already had subscribe/current/list/**change-plan**/
    **cancel** (atPeriodEnd). Gaps closed: SDK `tenancy.changePlan` + `tenancy.cancelSubscription`; web-tenant billing
    page switch-plan + cancel-at-period-end (with a "scheduled" notice); i18n + SDK test. Money stays server-authoritative.
  - ✅ **tenant-integrations — shipped (P1-11-B).** New `apps/api/modules/tenant-integrations` (providers catalogue read,
    masked list, connect, disconnect; `tenancy` flag + `tenant.settings`; tenant_id+RLS; one ACID tx; audited). The raw
    provider credential is vaulted via a new **`core/secrets` SecretWriter port** (AWS Secrets Manager adapter behind
    config + a dev no-op that discards plaintext) — only the opaque ref is persisted, `serialize()` never returns it, and
    the module **fails closed** in prod if not bound to the AWS backend. SDK `integrations` resource + types + client wire;
    web-tenant `/settings/integrations` (password credential field, masked list); i18n; unit tests (serialize masks the
    secret; LocalSecretWriter discards plaintext + returns a scoped ref).
  - ✅ **tenant-webhooks — shipped (P1-11-C).** The heaviest, security-sensitive piece. New
    `apps/api/modules/tenant-webhooks` (`/v1/webhooks`, `tenancy` flag + `tenant.settings`, tenant_id+RLS, one ACID tx,
    audited): register endpoints with an **event allow-list** (`webhook-events.ts`, 9 types) + an **SSRF guard**
    (`webhook-ssrf.ts`, pure+tested — only public https; rejects credentials-in-URL, odd ports, localhost/.local/.internal,
    the cloud-metadata host, and every private/loopback/link-local/ULA IPv4+IPv6 literal). The HMAC **signing secret is
    generated server-side, shown to the tenant ONCE, and persisted AES-256-GCM-encrypted** (`core/crypto/secret-box`, key
    `WEBHOOK_SIGNING_KEK`, **fail-closed in prod**) — reversible-by-design because the platform must reproduce the HMAC on
    each delivery; `serialize()` never returns it. A `WebhookFanoutHandler` (one per event type, registered in
    `onModuleInit`) enqueues a `webhook_deliveries` row per active subscribed endpoint **in the relay tx**; a pg-native
    **`webhook-delivery.job`** (apps/worker, leader-locked) decrypts the per-endpoint secret, signs
    (`X-KV-Signature: t=…,v1=<hmac-sha256 of "t.body">` + `X-KV-Timestamp`), POSTs with an 8 s timeout, and on failure runs
    exponential backoff (1 m→4 h) up to 8 attempts then parks the row. SDK `webhooks` resource (register/rotate return the
    secret once; list masked) + types + client wire; web-tenant **`/settings/webhooks`** (register form with URL + event
    multiselect, masked endpoint list, one-time secret banner, pause/rotate/delete; SSRF + event errors surfaced); i18n.
- **Verified (A+B+C):** staff-matrix `team-permissions: 24 passed` + `sdk-url-rbac: 5 passed`; integrations
  `tenant-integrations(serialize+vault): 7 passed`; webhooks pure suite (real source files via node strip-types):
  **SSRF guard** 10 hostile URLs rejected + public https accepted, **signature** deterministic + header-format,
  **secret-box** round-trip + tamper-rejected, **event allow-list** 9 types; entity `serialize()` returns no secret;
  SDK webhooks route grammar (register secret-once / list masked / rotate / PATCH update / DELETE) green; SDK URL/body
  tests for rbac-matrix, billing change/cancel, integrations, and webhooks added to `sdk.spec.ts`; i18n parity
  en==hi==gu==641; UNGRANTABLE client↔server mirror diff-identical; SecretWriter + WEBHOOK_SIGNING_KEK prod fail-closed;
  app.module + worker registry + SDK client wiring confirmed by static grep. Full `pnpm typecheck && pnpm test` +
  real-Postgres RLS/escalation integration aren't runnable in this sandbox (no node_modules). No new migration was needed
  — 0014 auto-applies RLS + partitions to the pre-existing 0002 `webhook_endpoints` + `webhook_deliveries` tables.

### P1-12 · Vertical-operator tenant surfaces (dairy-MCC, labour-employer-admin, schemes-assistant, ambassadors-admin, group-lots, auditor, ai-review-queue) — ✅ DONE (7 of 7: dairy-MCC ✅, labour-employer-admin ✅, ambassadors-admin ✅, schemes-assistant ✅, group-lots ✅, auditor ✅, ai-review-queue ✅)
- **Track:** `apps/api` (respective modules) + SDK + `web-tenant`
- **Why pending:** Backend modules exist (dairy, labour, schemes, ambassadors, etc.) but the tenant-operator admin
  UIs are SDK-gap-flagged "out of scope, never faked."
- **Scope:** Per-vertical tenant-operator SDK methods + UI (one vertical per wave). Prioritise the verticals your
  launch tenants actually use.
- **Done when:** Each enabled vertical has a working operator console in `web-tenant`, behind its flag, RBAC + audit.
- **Wave 1 — dairy-MCC ✅ (shipped).** The dairy module's full operator API already existed (`/v1/dairy/*`, `dairy`
  flag + `dairy.manage`, tenant_id+RLS, idempotent writes, server-side pricing + wallet payout). Gaps closed:
  **SDK** `DairyResource` (MCCs / memberships / rate-cards / collections / milk-bills generate→preview→approve→pay)
  + types + client wire + `sdk.spec` route/idempotency test; **web-tenant `/dairy`** five-section operator console
  (MCCs, rate cards, members, counter collection-entry, the per-cycle bill settlement workflow) on Server Actions,
  behind `NEXT_PUBLIC_FEATURE_DAIRY` (default OFF) + sidebar link; **pure helpers** `features/dairy/calc.ts`
  (float-free price preview byte-identical to the server's `MilkRateCard.priceMinor` + validators + bill
  state-machine `nextBillActions`), unit-tested; i18n `dairy.*` + `nav.dairy` at full parity (en==hi==gu==732).
  Money is server-authoritative (Law 2/11) — the UI only previews. Verified: pure helper suite green (price
  preview, validators, state machine), SDK route grammar + idempotency-key green, i18n parity zero-diff, SDK
  client wiring confirmed by static grep. No new migration (reads/writes the existing 0009 dairy tables).
- **Wave 2 — labour-employer-admin ✅ (shipped).** The labour module's full employer API already existed
  (`/v1/labour/bookings` + `/assignments`, `labour` flag + `worker.book`/`booking.manage`, statutory min-wage
  snapshot + below-floor 422, idempotent writes, wallet payout) AND the SDK already carried the employer methods
  (built in the mobile hire waves: `createBooking`/`assignWorker`/`startBooking`/`completeBooking`/`cancelBooking`/
  `payWages`/`bookingAssignments`/`listWorkers`/`confirmAttendance`) — so no new SDK methods were needed; gap closed
  with an **employer-flow SDK test** (`sdk.spec`: create→assign→start→complete→pay + box=booking + idempotency-keys).
  Real work: **web-tenant `/labour`** employer-admin console — my-bookings (+ post-a-booking using the lookups
  catalogue), the worker roster (+ assign with optional wage override), and a selected booking's assignments with a
  payroll preview + per-day attendance dual-confirm — on Server Actions, behind `NEXT_PUBLIC_FEATURE_LABOUR`
  (default OFF) + sidebar link; **pure helpers** `features/labour/employer.ts` (booking-form validation that leaves
  the min-wage floor to the server, assign-wage check, the booking lifecycle `bookingActions`, `canConfirmAttendance`,
  and a float-free `previewPayrollMinor`), unit-tested; i18n `labour.*` + `nav.labour` at full parity
  (en==hi==gu==816). Money + min-wage stay server-authoritative (Law 2/11) — the UI only previews. Verified: pure
  helper suite green, employer SDK route grammar + idempotency green, i18n parity zero-diff/zero-dup, env+sidebar
  wiring confirmed by static grep. No new migration (rides the existing 0008 labour tables).
- **Wave 3 — ambassadors-admin ✅ (shipped).** The ambassadors module's full admin API already existed
  (`/v1/ambassadors` enroll/list/get/update/suspend/reinstate/earnings/payout + `referrals/:id/activate` +
  `targets`, all `ambassador.manage`-gated under the `ambassadors` flag; payout computes + moves commission via the
  wallet ledger, idempotent). The SDK only had the ambassador's OWN self-serve surface — so this wave closed a real
  **SDK admin gap**: added `ambassadors.enroll/list/get/update/suspend/reinstate/earnings/payout(idem)/
  activateReferral/setTarget` + types (`EnrollAmbassadorInput`/`UpdateAmbassadorInput`/`SetTargetInput`/
  `AmbassadorPayoutResult`) + an admin-flow `sdk.spec` test. **web-tenant `/ambassadors`** admin console — the
  ambassador roster (+ enrol, suspend/reinstate) and a selected ambassador's detail (profile edit, earnings ledger
  with an unpaid payout PREVIEW + the commission payout, set-target, activate-referral) — on Server Actions, behind
  `NEXT_PUBLIC_FEATURE_AMBASSADORS` (default OFF) + sidebar link; **pure helpers** `features/ambassadors/admin.ts`
  (enrol/target validation, float-free `previewUnpaidMinor`, `canPayout`, `canActivateReferral`), unit-tested; i18n
  `amb.*` + `nav.ambassadors` at full parity (en==hi==gu==875). Commission stays server-computed + wallet-moved
  (Law 2/11) — the UI only previews unpaid. Verified: pure suite green, admin SDK route grammar + payout idempotency
  green, i18n parity zero-diff/zero-dup, env+sidebar wiring confirmed by static grep. No new migration (rides the
  existing 0010 ambassadors tables).
- **Wave 4 — schemes-assistant ✅ (shipped).** The schemes module's full officer API already existed
  (`/v1/schemes/applications` queue/get + `verify`/`clarify`/`approve`/`reject`/`close` (scheme.process) + `dbt`
  record/read + the explainable `/eligibility` checker + the read-only catalogue, all under the `schemes` flag).
  The SDK only had the applicant self-serve side, so this wave closed a real **SDK operator gap**: added
  `schemes.listApplications({box:queue}) / verifyApplication / requestClarification / approveApplication /
  rejectApplication / closeApplication / recordDbt` + an operator-flow `sdk.spec` test. **web-tenant `/schemes`**
  officer console — the verification queue (status filter), a selected application's processing (the
  officer-action state machine surfaced as verify/clarify/approve/reject/close), the observed-DBT credits ledger
  with a disbursed-total + record-credit form, and a scheme catalogue with an on-behalf, explainable eligibility
  checker (one-shot result flash) — on Server Actions, behind `NEXT_PUBLIC_FEATURE_SCHEMES` (default OFF) + sidebar
  link; **pure helpers** `features/schemes/operator.ts` (`officerActions` mirroring scheme-application.state,
  `canRecordDbt`, float-free DBT/eligibility validators, `totalDbtMinor`), unit-tested; i18n `scm.*` + `nav.schemes`
  at full parity (en==hi==gu==944). The application state machine + deterministic eligibility stay
  server-authoritative; DBT is an OBSERVED PFMS credit (not a wallet move). Verified: pure suite green, operator SDK
  route grammar green, i18n parity zero-diff/zero-dup, env+sidebar wiring confirmed by static grep. No new migration
  (rides the existing 0011 schemes tables).
- **Wave 5 — group-lots ✅ (shipped).** The group-lots (FPO pooling) feature had **no backend module at all** — only
  the 0005 `group_lots` + `group_lot_pledges` tables existed — so this wave **built the whole apps/api module**: domain
  (state machine `pledging→ready→listed→sold→settled`/`cancelled` + entity + pure `settle.ts` float-free proportional
  split with zero-loss largest-qty-first remainder allocation), dto (zod `.strict()`), repo (tenant_id+RLS, FOR UPDATE,
  keyset, `ON CONFLICT` pledge accumulation), service (UoW tx + outbox + idempotent create/pledge + `timed`), controller
  (`@FeatureFlag('group_lots')` + `group_lot.coordinate` perm, idem on create/pledge), module wired into `app.module`,
  README + domain spec. No new migration (the 0005 tables ride 0014's RLS+partition auto-apply). **SDK** `GroupLotsResource`
  (`list/get/create(idem)/pledge(idem)/markReady/cancel/settle`) + types + `sdk.spec` route-grammar test. **web-tenant
  `/group-lots`** coordinator console — the coordinator's lots (box/status filter), open-a-new-lot form, and a selected
  lot's pledges + lifecycle actions (pledge/ready/cancel/settle) — on Server Actions, behind `NEXT_PUBLIC_FEATURE_GROUP_LOTS`
  (default OFF) + sidebar link; **pure helpers** `features/group-lots/coordinator.ts` (`coordinatorActions` mirroring
  group-lot.state, `canPledge`, create/pledge/settle validators, float-free `parseQtyMilli/formatQtyMilli/progressBps`,
  and `previewSettlement` MIRRORING the server's zero-loss split), unit-tested (30 assertions). i18n `gl.*` + `nav.groupLots`
  at full parity (en==hi==gu==999). **settle RECORDS each pledger's proportional share — it does NOT move money** (Law 2;
  disbursement is a payments/wallet follow-on, flagged in the module README). Verified: backend domain spec + coordinator
  pure suite green, SDK route grammar green, i18n parity zero-diff/zero-dup, env+sidebar wiring confirmed by static grep.
- **Wave 6 — auditor ✅ (shipped).** The append-only `audit_log` (migration 0014, partitioned, `tenant_id` → RLS
  auto-applied) and the core `AuditWriter` already existed, but there was **no read path anywhere** and **no SDK
  resource** — so this wave built a strictly **read-only** audit-trail surface (the trail stays immutable; it is
  written only by `AuditWriter` inside business transactions). **apps/api `audit` module**: dto (zod `.strict()`
  query — action/entity/actor/from/to/cursor/limit), repo (READ_REPLICA, tenant-scoped `BEGIN READ ONLY` + RLS,
  keyset `created_at DESC,id DESC`, `id::text` bigint-safe; `ip`/`user_agent` deliberately NOT projected), read
  service (authz THROWS on missing `audit.read`; opaque base64 cursor), controller (`@FeatureFlag('audit_trail')`
  + `audit.read`, GET-only), policies, module wired into `app.module`, README + a pure cursor-codec spec. New
  perm `audit.read` (granted to `auditor` + `tenant_admin`) + `audit_trail` flag (default OFF) seeded; **no new
  migration** (rides 0014's `audit_log` + RLS). **SDK** `AuditResource` (`list`/`get`) + `AuditEntry` type +
  `sdk.spec` route-grammar test (datetime filters URL-encoded). **web-tenant `/auditor`** console — a GET-form
  filter (action/entity/actor/date window, shareable URLs), keyset "next page", and a selected entry's
  before→after field-level diff — strictly READ-ONLY (no Server Actions, no mutations), behind
  `NEXT_PUBLIC_FEATURE_AUDITOR` (default OFF) + sidebar link; **pure helpers** `features/audit/viewer.ts`
  (`validateFilters`, `buildAuditQuery` with inclusive-day bounds, `compact`/`summarizeChange`/`changedKeys`
  diff presenters), unit-tested (21 assertions). i18n `aud.*` + `nav.auditor` at full parity (en==hi==gu==1030).
  Verified: cursor-codec + viewer pure suites green, audit SDK route grammar green, i18n parity zero-diff/zero-dup,
  perm+flag seeds + env/sidebar/api wiring confirmed by static grep.
- **Wave 7 — ai-review-queue ✅ (shipped).** The full ai-governance module already existed (the dedicated
  `ai/review-queue` controller — list with `box`/`status`/`queueKind`, manual enqueue, get, `:id/claim`,
  `:id/resolve{accepted|rejected,note}`, under `ai.review` + the `ai_governance` flag — plus the
  `pending→in_review→accepted|rejected` state machine, RLS, and outbox fan-out of each resolution to the
  originating module), but there was **no SDK resource at all** — so this wave was a pure SDK + UI pass (no
  backend, migration, perm, or flag work). **SDK** `AiReviewResource` (`list`/`get`/`enqueue`/`claim`/`resolve`)
  + types (`AiReviewItem`, `AiReviewStatus`, `AiReviewQueueKind`, `EnqueueReviewInput`, `ResolveReviewInput`) +
  `sdk.spec` route-grammar test. **web-tenant `/ai-review`** human-in-the-loop console — the queue (box/status/kind
  filter + open-count health), a manual-enqueue disclosure, and a selected item's claim + resolve
  (accept/reject + note) gated by the review state machine — on Server Actions, behind
  `NEXT_PUBLIC_FEATURE_AI_REVIEW` (default OFF) + sidebar link; **pure helpers** `features/ai-review/queue.ts`
  (`reviewerActions` mirroring ai-review.state, `canResolve`/`isOpen`/`isTerminal`, `validateResolve`/`validateEnqueue`,
  `priorityBucket`, `openCount`), unit-tested (18 assertions). i18n `air.*` + `nav.aiReview` at full parity
  (en==hi==gu==1086). The review state machine + the resolution→module fan-out stay server-authoritative.
  Verified: queue pure suite green, ai-review SDK route grammar green (7 assertions), i18n parity zero-diff/zero-dup,
  env/sidebar/SDK-client wiring confirmed by static grep.

**P1-12 is COMPLETE — all 7 vertical-operator tenant surfaces shipped.** Each = SDK resource (built where the
backend exposed an un-wrapped surface; new apps/api module only where none existed — group-lots) + a flag-gated,
RBAC-gated web-tenant console with audited writes + pure unit-tested helpers + tri-lingual i18n at full parity,
verified, never faked.

---

## D. AI assistant & cross-entity search (the two big FLAGGED externals)

### P1-13 · Farmer AI assistant (governed inference) — ✅ DONE
- **Track:** `apps/api` (`POST ai/assistant/messages`) + `apps/ai-services` + SDK + `apps/mobile`/`web-storefront`
- **Why pending:** FLAGGED-not-faked — needs the ai-services governed-inference s2s call + prompt-injection
  guardrails + cost/rate control + ai-governance logging.
- **Scope:** Assistant endpoint that calls ai-services over s2s (resilience-wrapped), with prompt-injection
  guardrails, per-user cost/rate limits, and ai_inferences logging; un-flag the assistant screens. Requires a model
  provider key (set in the secret manager) — degrades to needs_review without one.
- **Done when:** A farmer query returns a governed, logged answer; injection attempts are blocked; cost/rate caps
  enforced; no key → safe degrade, never a fabricated answer.
- **Shipped (proof):** **apps/api `assistant` module** — `POST /v1/ai/assistant/messages` behind the `ai_assistant`
  flag (seeded OFF, 0009), idempotent, auth-gated; pipeline = **screen** (sanitize + ReDoS-safe injection guard,
  `domain/guardrails.ts`) → **per-user cost/rate caps** (burst + daily, counted off `ai_inferences` on the replica,
  `domain/cost-cap.ts`, typed 429) → **governed s2s inference** via the `ASSISTANT_INFERENCE` port (HTTP adapter,
  resilience-wrapped; noop/degrade adapter when unconfigured) → **record** `ai_inferences` (pointers only — userId/
  lang/flags, never the message text) + `audit_log` in one tx + metric. A blocked or degraded turn returns a safe
  localized message (`safeFallbackReply`), **never a fabricated answer**. Config getter + env vars
  (`AI_SERVICES_URL/_SHARED_SECRET/_TIMEOUT_MS`, `AI_ASSISTANT_DAILY_CAP/_PER_MINUTE_CAP`); wired into `app.module`.
  **No new migration** (rides 0013 `ai_inferences` + its RLS). **apps/ai-services** — new s2s-authed
  `POST /v1/assistant` router + 2nd-layer `guardrails.py` + model PORT `provider.py` (`AnthropicProvider` under the
  `llm` circuit-breaker + timeout; `DegradedProvider` when no `ANTHROPIC_API_KEY` → needs_review), logs its own
  `ai_inferences` row; mounted in `main.py`. **SDK** `AssistantReply` extended with `status` + `assistant.ask`
  route-grammar test. **Mobile** assistant screen already wired behind `tips_assistant` (degrades honestly to
  "unavailable"); no web-storefront assistant surface exists. **Verified:** api domain pure suite green (21
  assertions: sanitize/injection/fallback/caps), ai-services guardrails python checks green (6), assistant SDK
  route grammar green (3), `py_compile` clean on all new ai-services files, env/config/flag/app.module/router
  wiring confirmed by static grep. Flags default OFF + degrade-without-key honour Law 10/12.

### P1-14 · Dedicated cross-entity search (OpenSearch) — ✅ DONE
- **Track:** `admin-api`/`apps/api` search-index plane + `apps/api` `GET /search` + SDK + mobile/storefront
- **Why pending:** FLAGGED — needs the OpenSearch index plane; today clients do an honest client-side fan-out.
- **Scope:** Build/extend the cross-entity index (listings, requirements, courses, etc., tenant-safe), a single
  `GET /search` endpoint over it (keyset, resilience-wrapped, Postgres fallback), and replace the client fan-out.
- **Done when:** A single query returns ranked cross-entity results, tenant-isolated, with a Postgres fallback when
  OpenSearch is down.
- **Shipped (proof):** The OpenSearch index plane already existed (`core/search`: tenant-mandatory `SEARCH_CLIENT`,
  index defs for listings/products, outbox projection, Null degrade) — what was missing was the unified read. New
  **apps/api `search` module**: `GET /v1/search?q=&types=&cursor=&limit=` behind the `unified_search` flag (seeded
  OFF), auth-gated, read-only. `SearchService` fans the free-text query across the requested per-entity OpenSearch
  indices, then `domain/search.rank.ts` (pure) merges into ONE ranked list (text-match strength → recency) with a
  **federated per-type cursor** (`encode/decodeSearchCursor`); on engine-unavailable (NullSearchClient or a tripped
  transport breaker) it **degrades** to `SearchFallbackReadModel` — a parameterised, keyset, tenant-scoped replica
  query per type (`title ILIKE` value-param, ReDoS-safe) — tagging `meta.engine: 'postgres'`. **Tenant isolation:**
  the engine path rides the core client's mandatory `tenant_id` filter (`SEARCH_TENANT_REQUIRED` fails closed); the
  fallback re-asserts `tenant_id = $1` (+ `IS NULL` only for platform-master products) under RLS. No new migration
  (reads existing tables + the existing index plane). **SDK** `search.query()` + `SearchHit`/`SearchEngine` types +
  route-grammar test. **Mobile** `globalSearch` now prefers the unified endpoint and **degrades to the legacy
  fan-out** when it's off/unreachable (`fromUnifiedSearch` pure mapper; `SearchHitKind` gains `product`). **Verified:**
  rank+cursor pure suite green (17 assertions), `fromUnifiedSearch` green (3), unified-search SDK route grammar green
  (2), tenant-required + fallback tenant predicates + app.module/flag/SDK wiring confirmed by static grep. Flag
  default OFF + Postgres fallback honour Law 10/12.

---

## E. Misc flagged Phase-1 items

### P1-15 · Per-impression listing "views" pipeline ✅ DONE
- **Track:** `apps/api` analytics + `apps/stream-processor` + SDK + tenant/mobile analytics
- **Why pending:** Listing/tenant analytics omit view-traffic because there's no high-volume event pipeline; the
  number is never faked.
- **Scope:** Emit view events through the stream-processor into a counted read-model (bounded, deduped); surface
  view counts in listing + tenant analytics.
- **Done when:** Real view counts appear in analytics, fed by the event pipeline, with no synchronous hot-path cost.
- **Proof:** The view path is fully off-band. `POST /v1/listings/:id/view` (authenticated, behind the seeded-OFF
  `listing_views` flag) is FIRE-AND-FORGET: `ListingViewService` drops ONE tiny `views.listing_viewed` outbox event
  (`{v,listingId}`, NON-PII — no viewer id) in a minimal tx; an emit failure is swallowed (a lost impression is
  acceptable, Law 12). The render path (`GET :id`) is untouched — no synchronous counting/aggregation. Migration
  **0051** lands `listing_view_counts` (PK `(tenant_id, listing_id)` + RLS via the idempotent pass): BOUNDED to one
  row per listing (UPSERT increment, never a row per impression). The tailer ships the event to the new isolated
  **`kv.views`** topic (`topics.ts`: `TOPICS.views` + `FAMILY_TOPIC.views`, so it never feeds the projection-builder/
  search-indexer that key off `listings.*`); the new stream-processor **`view_counter`** consumer
  (`view-counter.consumer.ts`, registered in `main.ts`/config/.env) UPSERT-increments the counter. DEDUPED: the
  consumer runtime's idempotency store (keyed on the outbox event id) skips at-least-once redeliveries, so each emit
  counts once. Surfaced as REAL numbers: `ListingAnalyticsReadModel` adds `views` + `lastViewedAt` (read from
  `listing_view_counts`, 0 until first view); `TenantAnalyticsReadModel` adds `listingViews` (tenant-wide `SUM`).
  SDK: `listings.recordView(id)` + `ListingAnalytics.views/lastViewedAt` + `TenantAnalytics.listingViews`.
  Per-unique-viewer windowed dedup is intentionally deferred to the analytics warehouse (analytics-pipeline), never
  faked here. Verified: SQL parse (balanced parens/dollar-quotes, PK + RLS present), topic routing
  (`views.listing_viewed → kv.views`), SDK route grammar + two new SDK tests (recordView path/no-idem-key + analytics
  view count), `topics.spec` assertion, and static wiring greps (consumer registered, service wired, flag seeded).

### P1-16 · Saved-tips server persistence, scheme doc-attach, bank full-account vault step, on-behalf acting ✅ DONE
- **Track:** `apps/api` (buyer/schemes/identity/ambassadors) + SDK + `apps/mobile`
- **Why pending:** Small flagged gaps: tip wishlist exists but some saved-content is still device-local; scheme
  doc-attach endpoint missing (mediaIds sit in formData); bank-add full-account needs the server vault step (UPI
  only today); ambassador on-behalf listing/order + assisted-create-from-docs + visit-log/leaderboard/targets/goals
  some still need endpoints.
- **Scope:** Close each as a small wave (server persistence / attach endpoint / vault tokenisation / consent-gated
  on-behalf creation). Group sensibly; on-behalf acting needs its own consent/authz surface.
- **Done when:** Each flagged screen is un-flagged with a real endpoint, consent + audit where money/PII is involved.
- **Proof — closed as four bounded waves:**
  - **A · Saved tips → server.** The buyer saves API (`buyer/saves`, `entityType='tip'`) already existed; the mobile
    `content.api` no longer keeps device-local-only bookmarks — it now treats the SERVER as the source of truth for
    which tips are saved (`loadSavedTips` → `buyer.listSaves({entityType:'tip'})`), keeps an AsyncStorage mirror only
    for offline title/kind render, and write-throughs on save/unsave (`saveTip`/`unsaveTip`). New pure
    `reconcileSavedTips` (server-authoritative drop/add, local title preserved) + unit test.
  - **B · Scheme doc-attach.** Migration **0052** `scheme_application_documents` (tenant_id + RLS, FK application+media,
    `doc_type_id`, soft-deletable). New `SchemeDocumentService`/repo + routes `POST/GET/DELETE
    /v1/schemes/applications/:id/documents`: owner-only (anti-IDOR → 404), editable only pre-decision
    (`draft|clarification_needed|appealed`), validates `docTypeId` against the scheme's `required_doc_type_ids`,
    verifies the media is clean + caller-owned before linking, audited + outbox. SDK
    `schemes.listDocuments/attachDocument/detachDocument` + `SchemeApplicationDocument` type; mobile attaches uploaded
    mediaIds. 2 SDK tests.
  - **C · Bank full-account vault step.** New `FUND_ACCOUNT_TOKENISER` PORT + RazorpayX adapter (resilience-wrapped,
    creates contact+fund_account) + sandbox adapter (dev-only, refuses prod) + config-driven factory; `BANK_VAULT_KIND`
    config with `assertProductionSecurity` fail-closed (sandbox forbidden in prod; razorpayx needs strong creds).
    `POST /v1/bank-accounts/tokenise` takes the raw account+IFSC ONCE → tokenises server-side → stores ONLY vaultRef +
    last-4 (raw never persisted/logged), audited (last4 only). SDK `bankAccounts.addFull` + mobile `addFullBank`
    (closes the long-standing flagged gap). 1 SDK test.
  - **D · Consent-gated on-behalf listing.** New consent purpose `on_behalf_listing` (seed 0006) + `ConsentService.isGranted`
    (latest decision + assistedBy check). New `OnBehalfListingService` + route `POST /v1/ambassadors/on-behalf/listings`:
    requires an ACTIVE ambassador (from token), re-checks the farmer granted on-behalf consent TO this ambassador
    (403 otherwise — no acting for arbitrary users), creates the listing through the canonical `ListingService.create`
    with seller = the farmer, audited with BOTH parties, idempotency-keyed. SDK `ambassadors.createListingOnBehalf` + 1 test.
  - **FLAGGED follow-up (built-or-flag, honestly flagged):** **assisted-create-from-docs** (ambassador uploads a
    farmer's paper docs → AI extracts fields to pre-fill a listing/application) is a genuine ai-services extraction
    feature (OCR + structured extraction + human-in-the-loop confirmation), NOT faked here. Tracked as **P1-16-AI**
    below; the on-behalf authz/consent surface it depends on now exists.
- **Verified:** SQL parse (0052 balanced + PK + RLS + media FK; 0006 purpose seeded), brace-balance on every edited
  TS file, SDK route grammar + 5 new SDK tests, pure `reconcileSavedTips` test, prod-fail-closed config assertions,
  and static wiring greps (services provided, modules import the right deps, flag/purpose seeded).

### P1-16-AI · Ambassador assisted-create-from-docs (AI prefill) — ✅ DONE
- **Track:** `apps/ai-services` (extraction) + `apps/api` (ambassadors on-behalf) + SDK + `apps/mobile`
- **Scope:** ai-services `doc_extraction` endpoint (s2s, governed, degrade-never-fabricate) → apps/api prefill draft
  the ambassador reviews + confirms before the consent-gated on-behalf create. Behind a flag, default OFF.
- **Done when:** An ambassador can scan a doc, see AI-suggested fields (never auto-submitted), edit, and confirm; the
  extraction is logged in ai_inferences and the confirm path reuses the P1-16 on-behalf consent gate.
- **Proof:** ai-services `POST /v1/doc-extraction` (`apps/ai-services/src/doc_extraction/{router,prompts,confidence}.py`)
  mirrors the `voice_extraction` pipeline exactly: s2s bearer (`require_caller`), `ModelRegistry.active('doc_listing_extract')`
  with graceful degrade (`model_id=None`, threshold 0 → fail-closed `needs_review`), `resilience.run` with breaker/timeout,
  `call_llm`→`parse_llm_json`→`normalise_listing` on the allowed-field whitelist, and on any failure it returns an **empty
  draft** (degrade-never-fabricate). Every call logs an `InferenceRecord(subject_type="doc_listing")` to `ai_inferences`
  with `input_ref={media_ids, doc_type, locale}` — **the raw `doc_text` is transient and never persisted**. apps/api adds a
  resilience-wrapped s2s client (`gateway/doc-extraction.{port,http,noop,provider}.ts`, config-driven, reuses the assistant's
  `AI_SERVICES_URL`+shared secret), and `OnBehalfListingService.suggestFromDocs` re-checks **active ambassador + the farmer's
  `on_behalf_listing` consent to this ambassador** before suggesting — the SAME gate as the create, so AI prefill can never
  widen authority. The route `POST /v1/ambassadors/on-behalf/listings/suggest` is **advisory only** (never creates a listing)
  and gated by the `assisted_doc_prefill` flag (default OFF, seeded in `0009_feature_flags.sql`); confirmation goes through the
  unchanged consent-gated `POST /v1/ambassadors/on-behalf/listings`. SDK `ambassadors.suggestListingFromDocs(...)` →
  `SuggestedListingDraft` (+ exported type, + spec asserting the suggest path / advisory `needsReview`); mobile
  `features/ambassador/ambassador.api.ts#suggestListingFromDocs` degrades to `null` (falls back to manual entry, never blocks
  or fabricates). Verified: `py_compile` (3 doc_extraction files + `main.py`), brace/paren balance on all edited TS, SDK route
  grammar literal present, and static greps (route present, `assisted_doc_prefill` seeded, `docExtractionProvider` provided).

### P1-17 · Mobile foundation screens (offline-mode / permissions / server-error / tutorial) — ✅ DONE
- **Track:** `apps/mobile`
- **Scope:** Build the four system screens to the app's existing standard (i18n parity, a11y, flags).
- **Done when:** Each renders correctly and is covered by the app's test/§4 sweep.
- **Proof:** The four screens live under `src/app/(system)/` — `offline.tsx` (connectivity-aware retry, backed by the
  global `OfflineBanner` + sync engine), `permissions.tsx` (store-compliant just-in-time rationale per the
  `PERMISSIONS` catalog + open-OS-settings), `server-error.tsx` (friendly 5xx panel + safe `?ref=` request id), and
  `tutorial.tsx` (paged how-it-works). All are thin screens (guide §3) on `ScreenScaffold`/`EmptyState`, static
  (render without a backend / regardless of flags), with full hi/en/gu i18n parity (1286 keys each). The real
  production gap this task closed: a **global render-crash boundary** — `core/errors/AppErrorBoundary` (a class
  component, the only way React surfaces render errors) is mounted at the root `_layout` around the route tree; it
  reports the crash via the redacted `captureError` observability path and renders the same server-error panel with a
  safe support reference + a retry that re-mounts the tree, so a thrown render error NEVER white-screens (Law 12). Added
  a `+not-found.tsx` route so a stale/bad deep-link lands on a friendly "not found → home" panel instead of a blank
  screen. New pure, framework-free helpers `classifyFallback` (network/timeout → offline, else → server) and
  `safeErrorRef` (surfaces only the SDK's safe `requestId`, bounded to 64 chars, never message/code/PII) live in
  `features/system/system.ts` and are unit-tested in `core/__tests__/system.spec.ts`. Verified: 3-locale JSON validity
  + `system.notFound.*` parity, brace/paren/JSX balance on every edited/new file, and the pure helpers evaluated
  directly (network→offline, 5xx→server, ref trims+caps at 64, non-requestId fields → null).

---

## F. Verification (do this to close GA)

### P1-18 · Full-platform GA verification sweep — ✅ DONE (2026-06)
- **Track:** all
- **Scope:** Re-run every track's DoD gate; reconcile every `*_BUILD_BACKLOG.md` / `MODULE_STATUS.md` flag to either
  "done" or an explicit P2/P3 row (nothing silently unbuilt); re-run `LAUNCH_READINESS.md`. Consider a verification
  **subagent** for an independent pass.
- **Done when:** All gates green; every Phase-1 flag is either un-flagged or consciously deferred with a backlog row.
- **Proof:**
  - **Static gates (no node_modules in this env, so the build-tool gates run as static analysers):** all 52
    `db/migrations/*.sql` pass a paren + `$$`-dollar-quote balance check (the lone flag on `0016` was a false
    positive — unbalanced parens live only in `--` comments; code parens balance 3/3). All seed/i18n JSON parse
    clean; the three mobile locale catalogs carry identical key counts (1286 each). `python3 -m py_compile` passes
    across every `apps/ai-services/src/**/*.py`. Brace/paren/JSX balance holds on the touched TS/TSX.
  - **Backlog reconciliation:** every P1 row (P1-1…P1-17, incl. P1-16-AI) is ✅. An **independent verification
    subagent** swept the whole tree: it found **no GA-blocking issues** — money paths, core security primitives
    (RBAC/quota/idempotency/RLS), onboarding, and all flagged verticals have real, wired implementations; no
    `*_BUILD_BACKLOG.md` / `SCREENS_BACKLOG.md` carries a silently-unbuilt Phase-1 row (every ⬜/FLAGGED maps to a
    backend-gap or a Phase-2 row); `MODULE_STATUS` records the M-W0 reconciliation.
  - **Flag fail-closed:** `db/seeds/core/0009_feature_flags.sql` — 46 flags, only 4 baseline-commerce flags default
    ON (`listing_boost`, `group_lots`, `kyc`, `product_batches`); every money/vertical/AI flag defaults OFF with a
    kill-switch. The one dev affordance (OTP echo) is config-gated by `assertProductionSecurity` (P0-13), not a
    feature flag, and is refused in production.
  - **LAUNCH_READINESS:** `apps/api/LAUNCH_READINESS.md` is current and, if anything, conservative — its §6 "still
    FLAGGED" list understates current capability (P1-13 AI assistant + P1-14 unified search were since built behind
    their default-OFF flags), never overstates it. Migration list (0045–0048) and flag-enable sequence match code.
  - **One non-blocking item, consciously deferred (not silent):** ~335 orphaned generator scaffold stubs
    (`// TODO: implement per CLAUDE.md laws` + `export {};`) remain in the tree — all dead code (zero inbound
    imports; superseded by real sibling implementations, incl. the `apps/wallet-service` money-path filenames whose
    live path is in `apps/api`). Cannot affect build/runtime. Tracked for cleanup as **P2-13** so the tree-hygiene
    debt is explicit rather than silently ignored.
  - **Verdict:** Phase-1 GA is green. Every Phase-1 flag is un-flagged or consciously deferred with a backlog row.

> P1 complete = a fully un-flagged Phase-1 GA. Next: **P2** (Phase-2 verticals).
