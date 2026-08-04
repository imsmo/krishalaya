# Krishalaya Mobile — Flagged Contract-Gaps Report

**Purpose.** Every mobile screen was built to design parity, but a number of screens show fewer fields (or a
"coming soon" / omitted row / generic label) than the Phase-1 mock because the **backend contract does not yet
expose the data**. Per Law 12 + guide §13 the app **degrades honestly and never fabricates** — each gap is marked
in the source with a `§13 (NOT faked):` header comment. This report collates all of them so backend can close them
before GA.

**How to read it.** Each gap lists: the missing contract, the screens affected, what the app does today (the honest
degrade), and the concrete backend work to close it. Priority:

- **P0 — launch-critical**: money correctness, KYC, or a core flow that is materially incomplete without it.
- **P1 — GA completeness**: real feature value; app is usable without it but the mock isn't fully realised.
- **WEB — intentional handoff**: heavy analytics/ops deliberately kept server/web-console-side; the mobile screen
  shows a "manage on web" note by design, not a defect.

Nothing here is a mobile-side bug — all screens transpile, pass pure tests, and are at i18n parity. These are
**backend/SDK deliverables**.

---

## P0 — launch-critical

### P0-1 · Messaging conversation-summary read-model — ✅ DONE
- **Was missing:** a conversation-summary shape — counterparty name/role, last-message preview + timestamp, unread
  count; plus an archive flag and a **restore** mutation.
- **Screens:** `(system)/messages` (191), `(system)/message-archive` (192), `(buyer)/chat/[id]`.
- **Shipped:** migration `0055_conversation_archive.sql` adds per-participant `is_archived`/`archived_at` +
  index. `ConversationRepository.listSummariesForUser` returns `{lastMessage*, unreadCount, counterpartyName,
  counterpartyRole, isArchived}` (LATERAL last-message + correlated unread on `last_read_at`, keyset on created_at);
  `setArchived` toggles the caller's flag. `ConversationService.listSummaries` + `setArchive`;
  `GET /v1/conversations?archived=` returns summaries, `POST /v1/conversations/{id}/archive|restore`.
  SDK `Conversation` type + `list({archived})` + `archive()/restore()`. Mobile: messages inbox shows real
  counterparty name / preview / unread badge + header "· N new"; archive screen lists the real archived set with a
  per-row Restore. Pure helpers `conversationPreview` + `unreadTotal` (unit-tested). Verified: SQL balanced,
  backend+SDK transpile clean, mobile 35 pure tests pass, i18n parity 4354×3.

### P0-2 · Labour PII + booking read-model (worker ↔ employer) — ✅ DONE (core; 2 sub-items flagged)
- **Was missing:** the labour pool/booking reads were PII-minimised — no worker name/rating/job-count and no
  worker consent to reveal them; the booking read had no employer name / start-time-of-day / special-instructions.
- **Delivered (migration `0056_labour_booking_details.sql`):**
  - `labour_bookings.start_time` (time) + `notes` (varchar 300); create-booking contract now carries `startTime`
    (HH:MM regex) + `notes` (≤300). `serializeBooking` + booking READ paths expose `startTime`, `notes`, and
    `employerName` (correlated `users.full_name`, tenant-safe; reader is the employer or an assigned worker).
  - `worker_profiles.discoverable` (boolean, default **false** = privacy-by-default/DPDP). Worker opts in via
    `PATCH labour/workers/me { discoverable }` → `WorkerProfile.updateDiscoverability` (emits WorkerUpdated).
  - **Consent-gated employer marketplace read** (`listCards`/`getCard`): a SQL `CASE WHEN discoverable` guard
    populates `displayName` (joined name), `ratingAvg`, `bookingsCompleted` ONLY for opted-in workers; everyone
    else is an anonymous availability card (region/travel/age-verified). The employer browse (`GET labour/workers`,
    `GET labour/workers/:id`) now returns these cards. SDK `WorkerCard` type + `listWorkers`/`getWorker` retyped.
  - **Mobile:** screens 25 + 42 show the real name/rating/jobs when consented, else the anonymised handle; the
    worker edit screen (136) gained a Privacy consent toggle (`workerEdit.discoverable*`, i18n parity 4357×3).
  - **Verified:** SQL parens balanced; 14 backend/SDK/mobile files transpile clean; i18n parity holds.
- **Still flagged (§13, separate subsystems):** (a) **payout UTR/txn** on the assignment read — belongs to the
  payouts subsystem (not wired to the labour assignment read yet); (b) **worker photo URL** — needs the media
  presign subsystem (worker_profiles has no photo media id). Neither is faked in the UI (glyph avatar, no UTR).
  Note: labour is skill/task-based — "crop title/quantity" is an order concept, not a labour-booking field.

### P0-3 · Wallet earnings + statement export — ✅ DONE
- **Was missing:** (a) a per-crop earnings breakdown (server aggregated by period/type only); (b) a statement-export
  endpoint (PDF/CSV of the ledger). The "Download statement" affordance was a coming-soon note.
- **Delivered (no migration — reads existing `order_items` + double-entry ledger):**
  - **`groupBy=crop` on earnings** (`WalletInsightsReadModel.cropBuckets`): each wallet CREDIT that settled an order
    is attributed to its `order_items.title_snapshot` (the frozen product title the buyer saw — never fabricated),
    the net credit apportioned across lines by gross share. **FLOAT-FREE** (integer bigint division in Postgres).
    Scoped by `orders.seller_user_id = caller` (anti-IDOR; ids are globally-unique uuids). Degrades to `[]` (Law 12).
    Surfaced on `GET /v1/wallet/earnings?groupBy=crop` → `byCrop[]`; the earnings screen (58) renders a real "By crop"
    card (removed the coming-soon note).
  - **`GET /v1/wallet/statement?format=csv|pdf`**: bounded-window ledger (oldest-first, hard-capped 5k rows) →
    CSV (RFC-4180-quoted) or PDF (via the existing `renderTextPdf`), returned inline as
    `{ filename, contentType, encoding, content }` (utf8 for csv / base64 for pdf). Money stays bigint minor units,
    formatted float-free. New pure module `wallet-statement.ts` (`formatMinorPlain`/`csvField`/`toCsv`/
    `statementPdfLines`) with **7 passing unit tests**. SDK `wallet.statement()` + `WalletStatementFile` type;
    mobile `exportWalletStatement()` writes the file (expo-file-system) and hands it to the OS share sheet — the
    earnings screen's "Download" button is now real (i18n `earnings.byCrop`/`report.failed`/`saved`/`shareMsg` ×3).
  - **Verified:** all 8 backend/SDK/mobile files transpile clean; 7 pure tests pass; i18n parity 4361×3.

### P0-4 · Autopay / UPI-mandate execution + saved-instrument display — ✅ DONE
- **Was missing:** the autopay/UPI-mandate **execution** path was flagged OFF, and there was no contract for the saved
  UPI handle / linked-bank display shown in the mock.
- **Screens:** `(farmer)/wallet/autopay` (181), `(farmer)/wallet/upi` (180), `(buyer)/payment` (130).
- **Built (P0-4):**
  - **Backend** — migration `0057_upi_mandate_executions.sql` (executions table + `uq_mandate_exec_idem` unique
    idempotency index + `autopay_collection` ledger_txn_type via NOT-EXISTS + RLS). Domain `Mandate.assertCollectable`
    guard (active + ≤ per-debit cap, emits `payments.mandate_executed`) + errors `MandateNotActive` /
    `MandateAmountExceedsCap` / `MandateExecutionDisabled`. `MandateGateway` port + deterministic `SandboxMandateGateway`
    (NON-prod). `MandateExecutionRepository` (insert-pending / findByIdem-FOR-UPDATE / markCollected / markFailed) +
    `MandateExecutionService.confirm()` (pending→active) and `execute()` — flag `autopay_execution` fail-closed, mandate
    locked FOR UPDATE, idempotency short-circuit, gateway.collect, then the ONLY money move via `WalletPort.post`
    (platform(gateway) −amount / userMain +amount, txnType `autopay_collection`, idempotent) → outbox Executed + audit.
    Controller: `POST wallet/autopay/:id/confirm`, `POST wallet/autopay/:id/execute` (Idempotency-Key required),
    `GET wallet/autopay/:id/executions`, and `GET wallet/instruments` (masked UPI handles from live mandates + bank
    last-4/IFSC + real `verified` flag). Nothing sensitive is ever returned; raw VPA/account never stored.
  - **SDK** — `autopay.confirm/execute/executions` + `wallet.instruments()` + types `MandateExecution` /
    `SavedInstruments`.
  - **Mobile** — `wallet.api` confirm/execute/executions + `walletInstruments()` (degrade-never-die); `wallet/upi.tsx`
    now renders the design's **VERIFIED** badge from the real `verified` flag (previously an honest §13 omission).
- **Flag posture:** `autopay_execution` seeded **OFF** (fail-closed) — stays off until a live UPI-AutoPay PSP + webhook
  are wired; setup/list/cancel + the instruments read work regardless.
- **Verified:** all 17 backend/SDK/mobile files transpile clean; migration 0057 SQL paren/keyword-balanced; 8 pure
  domain tests pass (`assertCollectable`); full API unit suite green **1103/1103** (also repaired a stale P1-16-C
  prod-security fixture that was missing `BANK_VAULT_KIND`/`RAZORPAYX_*`); i18n parity **4362×3**.

### P0-5 · Business-KYC field contract (buyer) — ✅ DONE
- **Was missing:** there was **no business-KYC field contract** — the buyer KYC screen had no GST/PAN/business-type
  fields to submit to.
- **Screens:** `(buyer)/kyc` (133).
- **Built (P0-5):**
  - **Backend** — migration `0058_business_kyc_profiles.sql` (business_type CHECK vocab + legal_name + gstin_masked /
    pan_masked + doc_media_ids[] + `kyc_status` + reviewer columns; `uq_business_kyc_user` one-live-per-(tenant,user);
    RLS). Pure `business-kyc.rules.ts` — GSTIN/PAN shape validators, `maskGstin`/`maskPan` (raw never stored), and a
    `gstinPanConsistent` guard (the GSTIN embeds the PAN). DTO `submit-business-kyc.dto.ts` (zod `.strict()`, PAN
    mandatory, GSTIN optional). `BusinessKycRepository` (upsert = re-submit → 'pending', getForUser, review). 
    `BusinessKycService.submit()` (validate → mask → upsert → audit MASKED-only) + `status()` + admin `review()`.
    Controller routes on the existing `kyc` flag: `POST kyc/business`, `GET kyc/business`, `POST kyc/business/:id/review`
    (identity.approve). Wired into IdentityModule.
  - **SDK** — `kyc.submitBusiness` / `businessStatus` / `reviewBusiness` + types `BusinessType` / `BusinessKycStatus`.
  - **Mobile** — `(buyer)/kyc.tsx` now has real business-type chips + PAN + GSTIN inputs (client pre-validation via the
    pure `canSubmitBusinessKyc`/`isValidGstin`/`isValidPan`), submits through `submitBusinessKyc`, and reads back a
    status pill + masked PAN/GSTIN-on-file (the §13 "no contract" omission is closed). Raw GSTIN/PAN sent once; never
    stored or logged raw (server masks — DPDP §4).
- **Verified:** all 12 backend/SDK/mobile files transpile clean; migration 0058 SQL paren/keyword-balanced; 11 pure
  rule tests pass; full API unit suite green **1113/1113**; i18n parity **4385×3**.

### P0-6 · Account-deletion endpoint (DPDP) — ✅ DONE
- **Was flagged missing**, but the tenant-facing route already shipped in API-W12 — the "assumed/not live" comments
  were stale. `POST /v1/privacy/deletion-requests` (identity `PrivacyController` → `PrivacyService`, NOT compliance-ops):
  records an erasure request with a statutory 90-day cooling-off, one-open-per-kind dedup, idempotency (Law 3), and an
  outbox event for the server-owned fulfilment plane; the app never deletes locally (Law 11).
- **Screens:** `(system)/account-delete` (177).
- **Closed (P0-6):**
  - **Backend** — threaded the screen's "why leaving" `reason` through `PrivacyService.requestDeletion` into the
    `identity.dsr_opened` outbox payload (length-capped; NOT stored on the DSR row — it's CRM/analytics, not a DPDP field).
  - **SDK** — `PrivacyRequest.coolingEndsAt` added; header comment de-staled (deletion/export/status are LIVE).
  - **Mobile** — `system.api` gains `myPrivacyRequests()` + `openDeletionRequest()`; `account-delete.tsx` reads the live
    status and, when an erasure request is already open, surfaces a **cooling-off banner** (with the end date) and
    disables re-submit (idempotent anyway). Stale "ASSUMED/not live" notes corrected to reflect the live endpoint.
- **Verified:** 6 backend/SDK/mobile files transpile clean; identity unit suite green **62/62**; i18n parity **4389×3**.

### P0-7 · Saved listings / sellers / searches — ✅ DONE
- **Was:** no server endpoints for saved-listings/saved-sellers/saved-searches; mobile persisted them on-device only, so saves didn't sync across devices.
- **Screens:** `(buyer)/saved` (126/127/128).
- **Resolved:** the buyer CRUD already shipped server-side (module `buyer`: `POST/GET/DELETE buyer/saves` for listing/seller/… entity types + `POST/GET/DELETE buyer/saved-searches`, all caller-scoped → no IDOR, idempotent add/remove) and in the SDK (`BuyerResource.save/listSaves/unsave/createSavedSearch/listSavedSearches/deleteSavedSearch`). The only real gap was the mobile data layer never calling them. `features/buyer/saved.api.ts` is now **server-backed**: the server owns membership (saves sync across devices), while the on-device AsyncStorage mirror is kept as an **offline cache** — reads reconcile against the server and DEGRADE to the last-known local snapshot when offline; writes update the mirror optimistically then best-effort sync. For saved listings the mirror holds the `ListingCard` snapshot (server stores only the id) so rows render offline; §13: a listing saved on another device with no local snapshot is omitted rather than fabricated. Recent-searches stay a purely local device-UX affordance. Un-flagged (was "FLAGGED BACKEND GAP").
- **Verified:** `saved.api.ts` transpiles + typechecks clean (`tsc --noEmit`); screen consumers (`saved.tsx`, `search.tsx`, `seller/[id].tsx`, `listings/[id].tsx`) unchanged (identical signatures/return types); no new i18n keys (parity unaffected).

---

## P1 — GA completeness

### P1-1 · Orders: live tracking + per-step timestamps — ✅ DONE (ETA §13-honest)
- **Was:** order parties couldn't read their shipment/timeline at all (the logistics shipment read is
  manager/rider-only), and the rich per-transition timestamps in `order_events` + `shipment_events` (with lat/lng)
  were never exposed — so the track screen showed almost no times and a decorative map.
- **Screens:** `(buyer)/orders/track` (131), `(farmer)/orders/[id]` (23), `(buyer)/orders` (15/22).
- **Resolved:**
  - **API** — new party-scoped `GET orders/:id/tracking` (`OrderTrackingReadModel`, orders module): authorises the
    caller as the order's buyer/seller/moderator (reuses `OrderRepository.getVisible` → not-yours ⇒ not-found),
    then returns the REAL stamped timelines: `orderEvents` (every order-status transition + timestamp) and the
    shipment summary + `shipmentEvents` (status/location timeline, lat/lng when present). Tenant_id in every query
    + RLS via the replica GUC; read-only cross-table projection (same pattern as the existing DeliveryZoneRepository
    read in this module).
  - **API** — new `POST shipments/:id/location` (logistics): the assigned rider (or manager) posts a `{lat,lng,note?}`
    GPS ping → appends a `shipment_events` row at the current status (no state change). Makes the lat/lng feed real
    end-to-end. No new migration (columns already in 0007).
  - **SDK** — `orders.tracking(id)` + `OrderTracking`/`OrderEventPoint`/`ShipmentEventPoint`/`TrackingShipment`
    types; `shipments.postLocation(id, {lat,lng,note})`.
  - **Mobile** — `getOrderTracking` (SWR-cached, degrades to null); `track.tsx` (131) now drives its 7-step timeline
    from the stamped feed (real payment/seller/ready/out-for-delivery/delivered/completed times via
    `trackTimestampsFromEvents`), falls back to the order+shipment-derived times offline, and shows an honest
    "Updated <time>" from the latest location ping. **§13:** no ETA field exists in any contract → ETA still shows
    "—" (never fabricated); no reverse-geocoded place name — only the ping timestamp is surfaced.
- **Verified:** pure helpers unit-tested (`track.spec.ts`, 7/7 green incl. new event-timeline + last-location cases);
  all changed API/SDK/mobile files transpile clean; SDK source typechecks + dist rebuilt; mobile `tsc --noEmit`
  clean for the changed files; i18n parity **4390×3** (added `track.lastUpdate`).

### P1-2 · Orders: seller decision + received-list context — ✅ DONE (distance §13-honest)
- **Was:** the received-orders list read-model had no crop title / quantity (card showed only the counterparty), and
  the decision screen §13-omitted every buyer trust signal (business-type / lifetime-order-count).
- **Screens:** `(farmer)/orders/decision` (57), `(farmer)/orders/received` (56).
- **Resolved:**
  - **API** — `OrderTimelineReadModel.list` now enriches each row with the PRIMARY line item (crop title + qty) +
    `itemCount`, via one bounded, partition-pruned batch read (`OrderRepository.primaryItemsFor`, scoped to the
    page's partition window). New seller-scoped `GET orders/:id/buyer-summary` (`OrderBuyerSummaryReadModel`):
    returns the buyer's tenant order counts (total + completed) + their VERIFIED business-KYC type — coarse,
    non-PII trust signals; caller must be the order's seller/moderator (buyer → not-found). RLS + tenant_id on
    every query; raw GSTIN/PAN never touched (only the business-type category).
  - **SDK** — `OrderListItem.primaryItem`/`itemCount`; `orders.buyerSummary(id)` + `OrderBuyerSummary` type.
  - **Mobile** — received (56) card leads with the real crop + "500 kg · +2 more" (counterparty secondary);
    decision (57) shows a verified business-type chip + a real completed-orders trust cell (`orderBuyerSummary`,
    degrades to null). **§13:** buyer distance / payment-rate / years-on-platform have no honest contract → still
    "—", never fabricated; distance would need both parties' geo, which the order doesn't carry.
- **Verified:** pure helpers unit-tested (`order-status.spec.ts` 36/36 incl. new `moreItemsCount`/`businessTypeKey`);
  all changed API/SDK/mobile files transpile clean; SDK dist rebuilt; mobile `tsc --noEmit` clean for changed files;
  i18n parity **4401×3** (added `ordersPlaced` + 9 `bizType.*` + `moreItems`).

### P1-3 · Mandi / market read-model — ✅ DONE
- **Was missing:** commodity **category** on the price read-model; **day-over-day change**; transport-cost
  estimate to the best yard; alert **triggered-today/this-week counts**.
- **Screens:** `(farmer)/mandi/index` (52), `mandi/[id]` (53), `mandi/history` (111), `mandi/alerts` (110).
- **Closed:**
  - **Category** — `MarketNamesReadModel` now resolves `products.category_id → categories.default_name`; `withNames`
    attaches `categoryId`/`categoryName` onto every price/pulse row (flows to `MandiPrice`/`MandiPulse` via SDK).
    Screen 53 shows a category chip; screen 52's chips are now built from the REAL distinct categories and filter live.
  - **Day-over-day Δ%** — pure float-free `dayOverDayChange(history)` (BigInt, bps) on `MandiPulseReadModel`,
    surfaced as `MandiPulse.change`; mobile `bpsToPct` formats it (screen 53 already shows real Δ from history).
  - **Alert triggered today/this-week** — new migration **0059 `price_alert_triggers`** (append-only, RLS), written
    IN the ingest crossing loop (Law 4, alongside the `PriceAlertTriggered` outbox event); `PriceAlertRepository.
    triggerCounts` + `PriceAlertService.activity` + `GET market/alerts/activity` → SDK `market.alertActivity()` →
    screen 110 stats show real numbers (degrade to "—" only on read failure).
  - **§13 (still honest):** transport-cost estimate to the best yard is OMITTED (no per-user geo anchor + no
    logistics rate-card contract) — screen 53 shows real distance, never a fabricated cost.
- **Verify:** SQL parens balanced (0059); API tsc clean (changed non-spec); SDK dist rebuilt (adds
  `MandiPulseChange`/`AlertActivity` + backfills `Forecast*` exports); mobile tsc clean on all changed files
  (made `sortedDesc` generic to fix the pre-existing HistoryRow-union slack); **27/27** pure tests pass
  (`bpsToPct`, `distinctCategories`, `filterByCategory`, `dayOverDayChange`); i18n parity **4401×3** (no new keys).

### P1-4 · Weather detail + preferences — ✅ DONE
- **Was missing:** hourly forecast, feels-like, humidity, UV, pressure; a place-**name** for the header; per-toggle
  weather-pref persistence.
- **Screens:** `(farmer)/weather/index` (54), `weather/detail` (117), `weather/settings` (118).
- **Closed:**
  - **Extended metrics + hourly** — the Open-Meteo adapter now requests the extended daily fields (apparent temp /
    UV index / dominant wind bearing / sunrise-sunset) + an hourly block (temp/feels-like/humidity/precip-prob/
    pressure/uv/wind); pure `normaliseOpenMeteoDaily` (now with optional metrics) + new `normaliseOpenMeteoHourly`
    (bounded to the next ~24h, drops fully-elapsed hours) map them. `ForecastDay`/`NormalisedForecast` carry the new
    optional fields (SDK `ForecastHour`); screen 117 shows a real hourly strip + a real conditions grid
    (humidity/wind+compass/UV+WHO band/pressure/feels-like/sunrise) + feels-like in the hero.
  - **Reverse-geocoded place name** — new `ReverseGeocode` port + BigDataCloud HTTP adapter (free, no key) + noop,
    resilience-wrapped; `ForecastService` attaches `placeName` best-effort (cached with the forecast; degrades to
    null → generic "your area", never a fabricated place). Config `weather.geocode.*` (`WEATHER_GEOCODE_*` env).
  - **Weather-pref persistence** — new migration **0060 `weather_prefs`** (RLS, one row per tenant+user) +
    repo/service (`WeatherPrefsService`, defaults-on-first-read) + `GET`/`PUT land/weather-prefs` → SDK
    `weather.prefs()`/`savePrefs()` → screen 118 has real, persisted toggles (morning advisory / weekly outlook /
    severe-only) with optimistic save + revert-on-error. Channel delivery (push/SMS/quiet-hours) still links to the
    notification settings (P-04) — this table holds only weather CONTENT toggles.
  - **§13 (still honest):** visibility isn't in the requested provider field set → shows "—"; the crop-stage
    personalised advisory remains a coming-soon note (no crop-season↔weather link).
- **Verify:** SQL parens balanced (0060); API tsc clean (changed non-spec); SDK dist rebuilt (adds `ForecastHour`/
  `WeatherPrefs` + extended `ForecastDay`/`NormalisedForecast`); mobile tsc clean on all changed files; **33/33** pure
  tests pass (`uvBand`, `windCompass`, `bpsToPct`, `distinctCategories`, `filterByCategory`, `dayOverDayChange`,
  `normaliseOpenMeteoDaily/Hourly`); i18n parity **4420×3** (+19 keys × 3 — uvBand/compass/hpa/feelsLikeShort/weekly/severeOnly).

### P1-5 · Content: crop-agronomy calendar + resource metadata
- **Missing:** the crop-agronomy calendar (the bulk of crop-hub) and extra fields on the content resource
  read-model.
- **Screens:** `(farmer)/crop-hub` (104), `tips/index` (55), `tips/[id]` (101).
- **Today:** tips render with real title/kind/read-time; the calendar is a coming-soon block.
- **Close it:** a crop-calendar content type + resource metadata fields.

### P1-6 · Schemes: detail + application timeline
- **Missing:** extra scheme-detail fields and intermediate application-step states (only submittedAt / decidedAt /
  DBT dates are contracted).
- **Screens:** `(farmer)/schemes/[id]` (105), `schemes/status` (107), `schemes/apply` (106/108), `schemes/mine`
  (109).
- **Today:** shows the real dates + status; other steps show state without a timestamp; rejection reason IS shown.
- **Close it:** a richer scheme-application event timeline.

### P1-7 · Worker profile / skills / reviews aggregates
- **Missing:** worker **age/dob beyond dob**, availability day-counts, per-skill job-count + rating, per-star
  lifetime review split.
- **Screens:** `(worker)/profile` (38), `profile/edit` (136), `skills` (37), `skills-add` (137), `reviews` (40).
- **Today:** age/extra fields captured but not persisted (no field); counts/splits omitted or reflect summary only.
- **Close it:** add the profile fields + per-skill and per-star aggregate reads.

### P1-8 · Ambassador earnings / targets / leaderboard
- **Missing:** commission line-item specifics, target/goal persistence (+ the "AI suggestion" target), leaderboard
  motivator figures, visit-log persistence.
- **Screens:** `(ambassador)/home`, `commissions`, `targets`, `goal-setting`, `leaderboard`, `visit-log`.
- **Today:** motivators framed generically (no fabricated ₹ figures); goals not persisted.
- **Close it:** ambassador earnings line-items + a target-persistence endpoint + visit-log write. (This overlaps the
  known "ambassador earnings demo rows" seed gap.)

### P1-9 · Buyer address + delivery metadata
- **Missing:** address TYPE tag (warehouse/restaurant), per-address distance-from-seller + delivery-window.
- **Screens:** `(buyer)/addresses` (134), `(buyer)/delivery` (129).
- **Today:** slot shows "scheduled at dispatch"; type/distance omitted.
- **Close it:** add address-type to the address contract + a distance/ETA compute at delivery selection.

---

## WEB — intentional web-console handoff (not a mobile defect)

These owner/tenant analytics + bulk-ops screens deliberately show a "manage on web" handoff because the heavy
read-models / bulk actions live server- and web-console-side. Listed for completeness; **no mobile change needed**
unless product decides to bring them into the app.

- `(owner)/bulk-actions` — bulk SMS + reason capture + CSV render (server/web-side).
- `(owner)/custom-report`, `farmer-analytics`, `order-analytics`, `worker-analytics` — deltas (↑12% vs Jul),
  retention %, multi-month growth trends: no mobile read-model → web handoff.
- `(owner)/integrations` — per-tenant connection-status read: web-side.
- `(owner)/compliance` — export detail: web-side.
- `(owner)/approve/[id]` — "AI insights" panel: no read-model → omitted.
- `(owner)/apply` — per-plan feature prose: not on the Plan contract.

---

## Cosmetic / static-metadata (lowest priority)

- **App metadata** — build number, last-updated date, download size (`(system)/about` 196, `app-update` 190): no
  mobile contract; Version + language set are real, the rest omitted.
- **Freshness/marketing copy** — "Updated weekly", tier-ladder bonus amounts, founder reply-window: static product
  copy, intentionally not data.
- **Open-source licenses** screen (`about` 196): coming-soon (no licenses screen/asset yet).

---

## Summary for backend planning

| Priority | Gaps | Theme |
|---|---|---|
| P0 | 7 | messaging summary, labour PII/booking fields, wallet earnings+statement, autopay execution, buyer KYC, account-deletion, saved-collections |
| P1 | 9 | order tracking/decision, mandi/weather read-models, content calendar, schemes timeline, worker aggregates, ambassador earnings/targets, address metadata |
| WEB | 6 | owner analytics + bulk ops (by design) |
| Cosmetic | 3 | app metadata, marketing copy, licenses |

**Recommendation:** close the 7 **P0** items before GA (they touch money correctness, KYC, DPDP, and core
labour/messaging UX). The P1 set can ship post-launch behind their existing feature flags — the app already
degrades cleanly without them. Each source file carries the exact `§13` note at the line references above for the
implementing engineer.
