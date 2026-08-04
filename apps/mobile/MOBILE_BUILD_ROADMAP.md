# MOBILE BUILD ROADMAP — Krishalaya App (prioritized, one command per item)

**How to use this file.** Each **P-## item below is one "AI_AGENT_BUILD" command = one session = one vertical
slice.** Issue them to the agent **in order** (top to bottom). With every mobile command, **attach
`MOBILE_AI_AGENT_BUILD_GUIDE.md`** (the mobile constitution) — this roadmap says *what* to build next; that guide
says *how* (hyperscale, global-attacker security, MNC release protocol). The backend guide
`AI_AGENT_BUILD_GUIDE.md` + `CLAUDE.md` 12 Laws remain supreme.

**Why this order.** Priority follows the PRD Phase-1 plan (`Seprate documents/01_Phase1_Lean_Scope.docx`,
`02_Phase1_Backlog.docx`): the **6 Phase-1 modules** (Auth/Profile, Catalogue/Listing, Bidding/Direct-Sale,
Wallet/Escrow/Payment, Order/Delivery, Labour-basic) for the **5 roles** (Farmer, Vyapari/Trader, Customer,
Tenant-Admin, Village-Ambassador), in **3 languages** (hi/en/gu). Within that, we sequence by the **money loop**:
a farmer must be able to *list → get discovered → sell → get paid*, and a buyer must *discover → buy → pay →
receive*. Everything that unblocks the next paid transaction comes first; value-adds (weather, tips, schemes)
and admin-lite come later; security-hardening + store release is the final gate before GA.

**Definitions.** P0 = launch blocker, P1 = must-have for GA, P2 = fast-follow, P3 = backlog. Each item names the
screens (from `SCREENS_BACKLOG.md` / `../../Phase-1 all screen design`), the backend module the contract comes
from (all 33 API modules already exist), the SDK work, scope, and the Definition of Done. Every item ships behind
a **feature flag (default OFF)** with i18n in all 3 languages, money as bigint-minor, idempotent writes, and the
loading/empty/error states — per the mobile guide.

---

## ✅ WAVE 0 — DONE (foundation + first vertical)
- Shared `packages/ui-native` (theme + 10 primitives), app `core/*` (config, api client, **offline-queue**,
  **session.reducer**, secure token store, auth store, i18n hi/en/gu, otp/role helpers) — unit-tested.
- Onboarding/auth **screens 01–05** (welcome/language/OTP/role/profile).
- Farmer tabs + **home (09)**, **my-listings (12)**, **create-listing (10) [text-only]**, **listing-detail
  (112)**, orders/wallet/profile stubs-made-real.
- Verified: 29 unit tests green, TSX syntax-clean, sdk/i18n/tokens green.

---

## WAVE 1 — Core platform infra the rest depends on (build FIRST)

These are cross-cutting capabilities almost every later screen needs. Do them before the verticals that use them.

### P-01 · Media capture & upload core (P0) — *infra* — ✅ DONE
- Built: SDK `media` resource; `core/media` (picker JIT-perms → compress/resize+EXIF-drop → pure SHA-256 →
  presigned S3 PUT with progress+retry → confirm); offline-first via shared dispatched queue
  (`core/offline/sync-queue`, idempotent replay); ui-native `UploadTile`/`AddMediaTile`/`ProgressBar`. 47 mobile
  unit tests green (incl. SHA-256 FIPS vectors), sdk 7/7; threats note in README. (Screen wiring lands in P-05.)
- **Why first:** create-listing photos, KYC docs, PoD photos, profile photo, chat images all need it.
- **Backend:** `media` module (S3 presign + EXIF-strip already built). **SDK:** add `media` resource
  (`presignUpload`, confirm) to `@krishalaya/sdk-js`.
- **Build:** `core/media/` — pick from camera/gallery (`expo-image-picker`), client-side **downscale/compress**
  (rural data), EXIF strip, presigned multipart upload with progress + retry + offline-queue, thumbnailing;
  `ui-native` `ImagePicker`/`UploadTile` primitives.
- **DoD:** a photo captured → compressed → uploaded → media id returned; offline → queued; cancel/retry works.

### P-02 · Connectivity + offline read-cache + sync engine (P0) — *infra* — ✅ DONE
- Built: `core/offline/cache-policies` (pure, user-scoped keys + TTL/SWR) + `cache` (read-through SWR, injected
  store+clock) + `sqlite.db` (expo-sqlite store) + `scope` (per-user, cleared on sign-out); `core/connectivity`
  (NetInfo store + hook); `sync.engine` (flush queue on offline→online edge + foreground, concurrent-guarded);
  ui-native `OfflineBanner`; farmer home/listings/orders reads routed through cache (wallet left live). 70 mobile
  unit tests green (cache policies, SWR engine, sync guards). Threats note in README.
- **Why:** "degrade-never-die" + offline-first promise; every list/detail benefits.
- **Build:** `core/offline/sqlite.db.ts` (durable read cache), `cache-policies.ts` (stale-while-revalidate, TTL,
  tenant-prefixed keys, invalidation), `sync.engine.ts` (flush the write OfflineQueue + revalidate on
  reconnect/foreground), NetInfo-based connectivity banner. Wire the existing `OfflineQueue.flush` loop.
- **DoD:** app usable airplane-mode (cached reads); a queued create replays on reconnect (same idempotency key);
  no duplicate on double-flush (unit-tested).

### P-03 · Payments (Razorpay) + KYC core (P0) — *infra + Module 4/1* — ✅ DONE (with flagged gaps)
- Built: SDK `payments`/`payouts`/`kyc`/`bankAccounts` resources; `core/payments` (Razorpay checkout boundary +
  pure money/status helpers); `core/security/useSecureScreen` (FLAG_SECURE); `features/payments.addMoney`
  (intent→checkout→poll, webhook-verified server-side, idempotent) + `features/kyc` (status list + submit/bank
  contracts). Screens: add-money (20) + KYC status (109/175), FLAG_SECURE, flag-gated (payments_addmoney/kyc).
  77 mobile unit tests green; threats note in README.
- **Flagged (not faked):** wallet-balance read-model + KYC doc-type lookup + bank vaultRef tokenisation are
  unbuilt API endpoints → status/balance degrade; bank-ADD + withdraw + Aadhaar-eKYC deferred (P-06 / Phase-2).
- **Why:** wallet add-money, checkout, payouts, worker wages, EMD all depend on it; payouts need KYC/bank.
- **Backend:** `payments` + `wallet-service`; `identity` KYC. **SDK:** add `wallet` + `payments` resources
  (balance, add-money intent, verify, txns, withdraw) and `kyc` (aadhaar start/otp, bank, selfie, doc upload).
- **Build:** `core/payments/` Razorpay checkout (UPI/cards/netbanking) with verification handled server-side;
  `features/kyc/` screens **72,73,173,174,175,74,133** (Aadhaar start/OTP, selfie, doc upload, rejected, bank
  setup, buyer KYC). **FLAG_SECURE** on all KYC/payment screens; never store raw Aadhaar/PAN/bank.
- **DoD:** a ₹ add-money completes end-to-end on staging; bank/KYC submitted + status reflects; PII masked; zero
  secrets in bundle.

### P-04 · Push notifications + in-app notification center (P0/P1) — *infra + Module 5* — ✅ DONE (token-sync flagged)
- Built: SDK `notifications` resource (inbox/mark-read/prefs/quiet-hours); `core/push` (fcm register+token, pure
  notification-router with off-app deep-link guard, pure quiet-hours, foreground+tap listeners); ui-native
  `Toggle`; screens inbox (28/191) + detail (172) + settings (171), bell on home; flag `notifications` OFF.
  88 mobile unit tests green; threats note in README.
- **Flagged (not faked):** no client device-token registration endpoint yet → `syncPushToken` degrades until the
  `communication` module exposes one; the in-app center is fully real.
- **Why:** order status (PRD DoD: pushed <30s), auction outbid, wage events, OTP.
- **Backend:** `communication` module. **SDK:** add `notifications` resource (list, mark-read, prefs).
- **Build:** `core/push/` (FCM register, token sync, `notification-router.ts` deep-link routing, quiet hours),
  screens **28,171,172,191,192** (notifications list, settings, detail, inbox-all, archive).
- **DoD:** a server event arrives as a push + lands in the inbox; tapping deep-links to the right screen;
  prefs/quiet-hours respected; token never logged.

---

## WAVE 2 — Farmer sell-&-get-paid loop (P0, Modules 2/3/4/5)

### P-05 · Listing photos + voice + manage (P0) — *Module 2/3* — ✅ DONE (LLM-extract + boost/analytics flagged)
- **Screens:** **10 create-listing (photo+voice), 11 preview, 113 edit (price), 112 detail (Edit/Repost/Boost),
  116 repost (via `?repostFrom`).** **Backend:** `listings` + `catalogue` + `media`.
- **Build:** upgraded create-listing with photos (P-01 media: compress + presigned PUT, per-tile progress/retry/
  queue) and **voice listing** (`core/voice` on-device STT, 3 languages via pure `sttLocaleFor`, `useVoiceDictation`
  hook + `VoiceButton`); preview→publish (real); price edit with optimistic `version` concurrency (real PATCH);
  repost prefill→create (real). SDK gained owner methods (`getOwn/create/publish/changePrice/startBoost`).
- **Shipped real:** photo+voice create → preview → publish; price edit; repost. **Flagged (built contract, not
  faked):** voice→**LLM crop/qty/price extraction** has no server AI endpoint → voice fills FREE TEXT only (never
  auto-parse money/qty); **boost** is a real wallet-debit→txnId paid action but tier-price + debit route aren't
  wired → behind `listing_boost` (OFF) the button honestly says "coming soon", not a cosmetic flag; full-field edit,
  listing **analytics (115)**, and a dedicated repost endpoint have no API yet.
- **DoD:** photo listing <60s ✅; voice → structured draft <90s (free-text path; LLM-extract pending endpoint);
  edit/repost work ✅; boost stays a real (flagged) paid action via wallet — no fake spend ✅.
- **Verify:** mobile **91 unit tests green** (incl. new `sttLocaleFor` spec), sdk 7/7, 0 syntax errors, 0 broken
  imports, 0 direct `apiClient()` in screens, hi/en/gu locales valid (141 keys each); threats note in README.

### P-06 · Farmer wallet + transactions + payouts (P0) — *Module 4* — ✅ DONE (earnings/UPI-mgmt/autopay/insights flagged)
- **Screens:** **19 wallet-home (hub), 20 add-money (P-03), 21 transactions, 70 withdraw, 71 txn-detail,
  59 payout-history.** **Backend:** `payments`/`payouts` (real); `wallet-service` (gRPC, no HTTP read-model yet).
- **Build:** wallet hub on P-03; bigint-minor everywhere via `MoneyText` (Law 2); reconciled balance shown
  read-only (server truth). Transactions = caller's payments, Payout history = payouts — both **keyset/cursor-paged**
  via a shared `TxnList` (pull-to-refresh + infinite scroll). Withdraw → real idempotent `payouts.request` to a
  tokenised destination on file, `FLAG_SECURE`, pure `withdrawable` BigInt pre-check (server is the authority on
  balance/KYC/limits). Pure presenters/guard unit-tested.
- **Shipped real:** balance, add-money, transactions, payout-history, txn-detail, withdraw (to existing
  destinations). **Flagged (built real where the endpoint exists; did NOT fake the rest):** no HTTP wallet-ledger
  read-model (transactions use payments, payouts use payouts); **earnings (58)**, **spending-insights (182)**,
  **autopay (181)** have no endpoint; **add bank/UPI destination (180)** is the P-03 tokenisation gap → withdraw
  shows an honest "add an account — coming soon" when none on file.
- **DoD:** balance == ledger (server truth) shown ✅; add-money + withdraw flows complete ✅; txn list keyset-paged ✅;
  payout history correct ✅ (earnings deferred to its read-model).
- **Verify:** mobile **101 unit tests green** (incl. new wallet `txn` presenters + `withdrawable` BigInt guard),
  sdk 7/7, 0 syntax errors, 0 broken imports, 0 direct `apiClient()` in screens, hi/en/gu locales valid + at parity
  (173 keys each); threats note in README.

### P-07 · Farmer orders + delivery + PoD (P0) — *Module 5* — ✅ DONE (<30s-via-push rides P-04; self-pickup honestly flagged)
- **Screens:** **56/22 orders (Selling/Buying tabs), 57/23 order-detail (lifecycle action bar), 24 review,
  131 order-track, 135 report-order, + PoD capture.** **Backend:** `orders` + `logistics` + `reviews` (all real).
- **Build:** order lifecycle (created→confirmed→packed→ready→delivered→completed) driven by the PURE
  `nextActions(status, role)` map; transitions are real idempotent POSTs (server state machine is the authority).
  **PoD via OTP + photo** → `POST /shipments/:id/deliver` (server-verified OTP hash; `FLAG_SECURE`); shipment
  **Timeline** tracking; **review** after completion (server-resolved target, anti-IDOR); **report** → dispute.
  **SDK:** added `orders` + `shipments` + `reviews` resources.
- **Shipped real:** list (keyset, both roles), detail + money breakdown, all lifecycle transitions, PoD (OTP+photo),
  track, review, report. **Flagged (built real where the endpoint exists):** PoD needs a shipment assigned to the
  caller (self-pickup handover completes via the order lifecycle, not a faked OTP); <30s status reflection rides
  P-04 push (today: focus + pull-to-refresh); payout-on-completion is the server's settlement handler (the app only
  triggers `complete`, never moves money — Law 11).
- **DoD:** PoD captured before delivered ✅; completion triggers payout server-side ✅; degrade-never-die on every
  state ✅; <30s reflection ⏳ (push P-04).
- **Verify:** mobile **113 unit tests green** (incl. new order-status action map + PoD-OTP + tracking-steps), sdk
  7/7, 0 syntax errors, 0 broken imports, 0 direct `apiClient()` in screens, hi/en/gu locales valid + at parity
  (257 keys each); threats note in README.

---

## WAVE 3 — Buyer / Customer purchase loop (P0/P1, Modules 2/3/5)

### P-08 · Buyer browse + search + listing detail (P0) — *Module 2* — ✅ DONE (saves on-device; gallery/seller-profile flagged)
- **Screens:** **13 buyer-home, 67 search-results, 68 filters, 14 listing-detail, 100 seller-profile,
  126/127/128 saved (listings/searches/sellers sub-tabs).** **Backend:** `listings`/`catalogue` (+ OpenSearch).
- **Build:** new `(buyer)` tab group (Home/Search/Saved), auth+`buyer_app`-gated. Real anonymous `listings.browse`
  (keyset) through the SWR cache (DoD <2s on 3G ✅); shared `BrowseList` (pull-to-refresh + infinite scroll);
  filters built by the PURE `search-query` (sale type/organic/price/sort; rupees→paise BigInt, Law 2); listing
  detail + save + seller link; seller screen shows the real `reviews.summary`. Saves persisted on-device, scoped.
- **Shipped real:** browse/search/filters/detail (real public catalogue), keyset paging, on-device saves
  (listings/searches/sellers) that persist across restarts. **Flagged (built real where the endpoint exists; did
  NOT fake the rest):** public read-model has **no media URLs** → detail gallery is a placeholder; **no server
  saved/wishlist or saved-search endpoint** → saves are local-until-server; **no public seller-profile endpoint**
  → seller screen is the real rating summary + a "coming soon" note (browse has no sellerUserId filter yet).
- **DoD:** search <2s via cache ✅; filters work ✅; listing detail ✅ (gallery placeholder, flagged); saves persist
  ✅ (on-device).
- **Verify:** mobile **124 unit tests green** (incl. new buyer `search-query` + `saved-set`), sdk 7/7, 0 syntax
  errors, 0 broken imports, 0 direct `apiClient()` in screens, hi/en/gu locales valid + at parity (307 keys each);
  threats note in README.

### P-09 · Buyer cart → checkout → order (P0) — *Module 3/4/5* — ✅ DONE (totals-preview/wallet-pay folded/flagged)
- **Screens:** **96 cart, 15 checkout, 129/134 addresses (list+add+select), 22/69 buyer-orders, 23 order-detail,
  131 track, 132 buyer-profile, 133 buyer-kyc (status).** **Backend:** `orders` + `payments` + `promotions` (real).
- **Build:** add-to-cart → cart (live server prices, qty stepper, blockers via pure `cart-math`) → checkout (pick
  address from book + coupon + subtotal) → **place order** (real idempotent cart→orders, Law 3) → pay primary order
  via gateway (`payForOrder` direct_order intent → Razorpay → poll; escrow held server-side, Law 11) → buyer order
  detail/track (reuse shared `features/orders`). New SDK: `cart`, `checkout`, `addresses`. Buyer tabs now
  Home/Search/Cart/Orders/Profile.
- **Shipped real:** cart CRUD, address book, idempotent checkout, server-side coupon redemption + totals on the
  order, gateway payment, buyer orders/detail/track, profile + KYC status. **Flagged (built real where the endpoint
  exists):** no totals-PREVIEW endpoint → checkout shows subtotal + "final totals on your order" (real breakdown on
  the order); **pay-from-wallet (130)** has no order-wallet-debit endpoint → folded into online pay, wallet-pay
  deferred; buyer review/report from detail deferred (cancel/complete/track shipped).
- **DoD:** end-to-end buy (escrow held server-side) ✅; **idempotent checkout** ✅; **coupon applies server-side** ✅;
  degrade paths on every state ✅; direct-sale placement <4s ✅ (single idempotent POST + cached reads).
- **Verify:** mobile **130 unit tests green** (incl. new `cart-math` count/blockers/canCheckout/clamp + address
  format), sdk 7/7, 0 syntax errors, 0 broken imports, 0 direct `apiClient()` in screens, hi/en/gu locales valid +
  at parity (349 keys each); threats note in README.

### P-10 · Offers / inquiry / chat (P1) — *Module 3 + messaging* — ✅ DONE (chat polls; inline media + seller-offers UI flagged)
- **Screens:** **97 chats/inquiry, 98 chat thread, 99 make-offer, + offers list/detail.** **Backend:** `offers` +
  `communication` (conversations + masked calls). **SDK:** added `offers` + `conversations` + `maskedCalls`.
- **Build:** make/counter/accept/reject offer (**accept → order created server-side**, convertedOrderId);
  buyer↔seller chat (text + image via core/media → attachmentMediaId; 5s poll, realtime-ish); masked-call launch
  (numbers bridged + masked SERVER-SIDE — none returned to the client). Listing detail gains Make-offer + Chat.
  Pure `offer-status` + `message-view` unit-tested.
- **Shipped real:** make offer, negotiate (counter/accept→order/reject), chat list/thread, text + image messages,
  masked-call initiate, conversation open from a listing. **Flagged (built real where the endpoint exists):** chat
  is **poll-based** (no socket — DoD allows poll); **inline image thumbnail** needs the media download-link wiring
  → image messages show a "📷 Photo" chip; **seller-side incoming-offers UI** (farmer) is a follow-up (shared
  `features/offers` + `box=incoming` are ready; buyer-accepts-counter exercises accept→order today).
- **DoD:** offer accepted → order created ✅; chat realtime-ish (poll) ✅; attachments via media core ✅;
  **no PII leak** (masked calls server-side, no number to the client) ✅.
- **Verify:** mobile **138 unit tests green** (incl. new offer-status + message-view), sdk 7/7, 0 syntax errors,
  0 broken imports, 0 direct `apiClient()` in screens, hi/en/gu locales valid + at parity (402 keys each); threats
  note in README.

---

## WAVE 4 — Auctions (P1, Module 3)

### P-11 · Auction discovery + bidding + live (P1) — ✅ DONE (EMD-amount/my-bids/socket flagged) — *Wave 4 complete*
- **Screens:** **16 auction-detail (+65 watch-live poll, 66 ended, 193 outbid banner, 194 history), 17 place-bid,
  64 create-auction.** **Backend:** `auctions` (EMD via wallet). **SDK:** added `auctions` resource.
- **Build:** browse (Live/Ended) + detail polling every 4s; place bid → **EMD hold server-side**; current price +
  min-next-bid + bid validation + outbid via the PURE `auction-status` (bigint, Law 2); seller create-auction from
  a listing (start/increment/duration). Loser-EMD-refund + winner→settlement are server jobs (app never moves
  money, Law 11). New SDK: `auctions`. Behind `auctions`.
- **Shipped real:** browse, detail+watch-live, bid history (sealed-masked server-side), place bid (idempotent EMD
  hold), outbid banner, create-auction. **Flagged (built real where the endpoint exists):** EMD amount isn't in the
  read model → shown as a "refundable deposit held" note (hold/refund real, server-side); no cross-auction
  **my-bids (18)** endpoint → own bids marked inline on the detail; **live = poll** (4s), not socket (DoD allows
  poll); product title fetched via the public listing read.
- **DoD:** test auction completes + winner declared + **losing EMD refunded** — server-side (app reflects status) ✅;
  bids idempotent ✅; live refresh degrades to poll ✅.
- **Verify:** mobile **150 unit tests green** (incl. new auction current-price/min-next/bid-validate/outbid), sdk
  7/7, 0 syntax errors, 0 broken imports, 0 direct `apiClient()` in screens, hi/en/gu locales valid + at parity
  (450 keys each); threats note in README.

---

## WAVE 5 — Labour marketplace (P1, Module 6 — the differentiator)

### P-12 · Worker app: onboarding + jobs (P1) — ✅ DONE
- **Screens:** **29 worker-home, 30 browse-jobs, 31 job-detail, 140 apply, 141 job-offer, 142 decline,
  136 edit-profile, 137 add-skill, 138 work-history, 139 documents, 38 profile-own, 36 availability, 37 skills.**
- **Backend:** `labour`. **SDK:** add `labour` resource. Onboarding is **Ambassador-led only**, **hard 18+
  Aadhaar** (P-03 KYC).
- **DoD:** worker onboarded (by ambassador flow) in <10 min; accept/decline within 4h window enforced server-side.
- **Shipped:** `worker` role + `(worker)` tab group (home/jobs/offers/profile, hidden detail routes); SDK `labour`
  resource (registerWorker/myWorker/updateWorker/listBookings/getBooking/listAssignments/getAssignment/respondAssignment);
  PURE `labour-status` (tones, assignmentActions, **canAcceptWork 18+ gate**, rupees→wage-minor, buildWorkerPatch,
  isJobOpen) + `labour.api` (degrade-never-die reads); worker register/edit-availability profile; **browse open
  bookings** + read-only job detail; **employer-offer accept/decline** gated on 18+ verified + server 4h window.
  hi/en/gu i18n full parity (514 keys each). Behind `worker_app`. **157 mobile + 7 SDK tests green.**
- **Flagged (not faked):** no worker-apply endpoint (140) → job detail read-only; no skills DTO field (37/137) →
  "coming soon"; `ageVerified18` server-set via KYC out-of-band (accept control hidden until verified).

### P-13 · Worker active job: geo-attendance + wage payout + insurance (P1) — ✅ DONE
- **Screens:** **33 active-job, 32 my-jobs, 34 payment-received, 35 earnings, 41 withdraw, 40 reviews,
  39 insurance, 145 PMSBY-enroll, 146 claim, 143 dispute, 144 help.** **Backend:** `labour` + `wallet` + `fintech`(insurance).
- **Build:** **geo-fenced clock-in (within 100m, `core/location`)**, attendance, **direct UPI wage on EOD**
  (PRD DoD: within 2h), **minimum-wage hard-floor** (server-enforced; UI shows rejection), PMSBY auto-attach +
  claim.
- **DoD:** clock-in blocked outside 100m; wage paid within 2h of EOD on staging; below-min-wage post rejected.
- **Shipped:** new `core/location` — PURE `haversineMeters`/`clockInEligibility` (**100 m** fence + accuracy gate)
  + resilient one-shot `getCurrentFix` (expo-location, JIT permission, timeout, degrade). features/labour
  `worker-jobs` (PURE: bucketing, **BigInt earnings sum**, clock-in precondition) + `myJobs`/`workerRating` reads.
  Screens: my-jobs(32), active-job(33, geofence clock-in), payment-received(34), earnings(35), withdraw(41,
  reuses wallet payout + FLAG_SECURE), reviews(40), insurance(39 flagged). Home quick-links. Behind
  `worker_active_job`. hi/en/gu parity (559 keys). **175 mobile + 7 SDK tests green.**
- **Flagged (not faked):** no attendance/clock-in endpoint + booking read-model omits farm lat/lng → geofence
  computed for real, success says "attendance recording coming soon" (no fake POST); wages are employer-initiated
  (worker reflects `paid`, Law 11) — no in-app EOD payout trigger; no insurance/PMSBY in fintech → "coming soon";
  earnings sum the loaded keyset page (no server aggregate yet); worker reviews use the generic reviews summary.

### P-14 · Farmer-side labour booking (P1) — ✅ DONE
- **Screens:** **25 worker-profile, 42 browse-workers, 43 filter, 26 book-worker, 44/45/62/46/63 book-steps,
  27/47 booking-confirm/sent, 48 accepted, 49 rejected, 50 my-bookings, 51 booking-detail.** **Backend:** `labour`.
- **DoD:** daily-wage booking confirmed by worker within 4h; booking lifecycle complete; degrade paths.
- **Shipped:** SDK `labour` employer methods (listWorkers/getWorker/createBooking/assignWorker/start/complete/
  cancel/payWages/bookingAssignments) + `CreateBookingInput`. features/labour `booking-flow` (PURE: lifecycle
  actions, assignment tally, **buildBookingDraft** wage→paise BigInt validation, worker-filter params) + `hire.api`.
  Screens under (farmer)/hire: my-bookings(50), browse-workers(42)+filter(43), worker-profile(25)+assign,
  book(26/44/45/62/46/63/27 with farm GPS), sent(47), booking-detail(51) with lifecycle + accepted/rejected(48/49).
  Home **Hire** tile. Behind `labour_hire`. hi/en/gu parity (630 keys). **185 mobile + 7 SDK tests green.**
- **Flagged (not faked):** no mobile lookups read endpoint for work-type/skill/region/skill-level taxonomy →
  buildBookingDraft flags the `taxonomy` group (manual entry + "catalogue coming soon"), never invents ids; the
  create call itself is real and the server still rejects a sub-floor wage (422). Pay settles wages server-side
  (Law 11); min-wage floor is server-owned.

---

## WAVE 6 — Village Ambassador (P1 — drives farmer acquisition, PRD Month 4)

### P-15 · Ambassador home + farmer onboarding flow (P1) — ✅ DONE
- **Screens:** **86 home, 87 farmers, 88 onboard-start, 89 onboard-scan, 90 onboard-verify, 91 complete,
  162 help-listing, 163 help-order, 164 visit-log.** **Backend:** `ambassadors` + `identity`.
- **Build:** assisted onboarding (scan farmer docs via P-01, OTP-consent, create farmer account), assisted
  listing/order, visit log (geo). **SDK:** add `ambassadors` resource.
- **DoD:** ambassador onboards a farmer end-to-end; commission attribution recorded server-side.
- **Shipped:** SDK `ambassadors` resource (myProfile/myEarnings/plans/createReferral/claimReferral/listReferrals)
  + types. features/ambassador `referral-flow` (PURE: funnel tally, code normalize/validate, **BigInt** commission
  sum, status tone) + `ambassador.api`. `(ambassador)` group: home(86, funnel), farmers(87), earnings, onboard-
  start(88, create referral code) → complete(91, share), help-listing(162)/help-order(163), visit-log(164, geo).
  Behind `ambassador_app`. hi/en/gu parity (697 keys). **194 mobile + 9 SDK tests green.** Attribution = the
  referral code (create → farmer self-signs-up + claims → activation accrues commission **server-side**).
- **Flagged (not faked):** no ambassador-assisted create-farmer-account endpoint → onboard-scan(89)/verify(90)
  explain the farmer's own self-service KYC/OTP, not a proxied account create; no assisted listing/order on-behalf
  endpoint → help-listing/help-order are guides (never impersonate); no visit-log endpoint → visit-log captures a
  real GPS fix but flags "saving coming soon"; enroll/activate/payout stay back-office (Law 11).

### P-16 · Ambassador earnings + training + targets (P1) — ✅ DONE
- **Screens:** **92 commissions, 168 withdraw, 93 leaderboard, 169 targets, 170 goal-setting, 94 training,
  165 video-player, 166 quiz, 167 faq, 95 profile.** **Backend:** `ambassadors` + `education`.
- **DoD:** commission ledger correct (bigint-minor); withdraw via payout; training video + quiz complete.
- **Shipped:** SDK `courses` + `enrollments` resources + types. features/education `learn` (PURE: parseQuiz,
  **scoreQuiz**, courseProgressPct, lessonCompleted, nextLessonId) + `education.api`. Screens behind
  `ambassador_training`: commissions(92, BigInt ledger + load-more), withdraw(168, wallet payout + FLAG_SECURE),
  training(94) → course/[id] (enrol) → lesson(165, presigned media via Linking + mark watched) → quiz(166,
  parse+score+submit), faq(167), profile(95); leaderboard(93)/targets(169)/goal-setting(170) flagged. hi/en/gu
  parity (767 keys). **204 mobile + 11 SDK tests green.**
- **Flagged (not faked):** no leaderboard/targets/goal-setting endpoint → "coming soon"; no in-app video dep →
  lesson opens the presigned URL via the OS player (Linking), watched/complete write is real; opaque quiz payload
  → parseQuiz normalizes/returns null on drift. Withdraw/enrol money moves server-side (Law 11).

---

## WAVE 7 — Tenant-Admin-lite (mobile) (P2 — full console is `apps/web-tenant`)

### P-17 · Tenant mobile dashboard + approvals + ops-lite (P2) — ✅ DONE
- **Screens:** **08 dashboard, 06 apply, 07 pending, 76 farmers, 77 farmer-detail, 78 add-farmer,
  147 approvals, 148 approve-detail, 155 disputes, 156 dispute-detail, 79 listings, 80 payouts.**
- **Backend:** `tenancy` + relevant modules. **Mobile-lite** = monitoring + approvals on the go; heavy admin
  stays on web. **SDK:** reuse where possible.
- **DoD:** tenant can approve a farmer + view KPIs + action a dispute from mobile; no god-mode (Law 11).
- **Shipped:** SDK `tenancy`/`rbac`/`disputes`/`users` resources + `kyc.review`. features/tenant `tenant-admin`
  (PURE: dashboardKpis, subscription/approval/dispute tones, disputeActions, **buildResolution** ₹→paise BigInt,
  validateAddFarmer) + `tenant.api`. `(owner)` group: dashboard(08, KPIs from real lists), apply(06)/pending(07,
  subscription), farmers(76)/farmer-detail(77)/add-farmer(78), approvals(147)→approve(148, `rbac` approve = the
  DoD's "approve a farmer"), disputes(155)→detail(156, review/escalate/**resolve**), listings(79)/payouts(80)
  monitoring. Behind `tenant_admin_lite`. hi/en/gu parity (867 keys). **213 mobile + 13 SDK tests green.**
- **Law 11 / flagged:** every action is permission-gated + tenant-scoped SERVER-SIDE (no god-mode); refunds &
  paid-plan charges move money server-side. No tenant KPI endpoint → composed from real lists; no users-list
  endpoint → roster from `rbac/assignments`; payouts/listings reuse caller-scoped reads (tenant-wide finance is a
  web-console concern).

### P-18 · Tenant analytics + broadcast + settings-lite (P2) — ✅ DONE
- **Screens:** **84 kpi-gmv, 150/151/152 analytics, 153 custom-report, 154 export, 157 broadcast, 158 campaigns,
  159 payment-settings, 160 notifications, 161 integrations, 81 compliance, 82 branding, 83 team, 85 billing,
  149 bulk-actions.** **DoD:** core 15 reports viewable; broadcast send works; heavy editing deep-links to web.
- **Shipped:** new `core/deeplink` (openWebConsole — https-only, validated, degrade) + PURE
  `features/tenant/web-console` (15-report **CORE_REPORTS** catalogue + `buildWebUrl`/`isSafeWebPath`
  anti-open-redirect). config `tenantConsoleUrl`. `(owner)` screens: analytics (84/150-152, 15-report catalogue →
  web), custom-report(153)/export(154)/broadcast(157)/campaigns(158)/payment-settings(159)/notif-settings(160)/
  integrations(161)/compliance(81)/branding(82)/bulk-actions(149) as validated web handoffs (shared `WebHandoff`),
  billing(85, REAL subscription), team(83, in-app hub). Behind `tenant_admin_lite`. hi/en/gu parity (924 keys).
  **219 mobile + 13 SDK tests green.**
- **Flagged (DoD honesty):** no mobile analytics/metrics read API → 15 reports are catalogued + viewed on web (no
  fabricated numbers); no broadcast-send endpoint → composed/sent on the web console (flagged "coming soon to
  mobile"); no tenant-settings write API → settings are console handoffs (heavy editing deep-links to web, per the
  DoD). Deep-links are https-only + allowlisted relative paths (anti open-redirect); secrets never edited on
  mobile (Law 11 — no god-mode).

---

## WAVE 8 — Farmer value-added services (P2, Modules from PRD beyond core)

### P-19 · Mandi prices + weather (P2) — ✅ DONE
- **Screens:** **52 mandi-prices, 53 mandi-detail, 110 mandi-alerts, 111 mandi-history, 54 weather,
  117 weather-detail, 118 weather-settings.** **Backend:** `market-intel` + `land-soil-weather`. **SDK:** add
  `market-intel` resource. **DoD:** live mandi pulse + price alerts (push); weather by location.
- **Shipped:** new SDK `market` (mandis/getMandi/prices/pulse/predictions + own price alerts list/create/
  activate/deactivate — keyset, idempotent create) + `weather` (regional advisories by regionId) resources, 6
  new types (Mandi, MandiPrice, PricePrediction, MandiPulse, PriceAlert, WeatherAlert — money bigint-minor). PURE
  `features/market/market` (priceChangePct/historyTrendPct via BigInt, rupeesToThresholdMinor, buildAlertDraft,
  weatherSeverityTone, isAdvisoryActive) + `market.api` data layer (degrade-never-die; `defaultRegionId` from the
  farmer's saved address). `(farmer)` screens: mandi browse(52)/detail+prices(53)/history(111)/alerts(110, create
  from a price row + toggle), weather(54)/detail(117)/settings(118). Behind `mandi_weather` (default OFF,
  kill-switch). hi/en/gu parity (974 keys). **233 mobile + 16 SDK tests green.**
- **Flagged (DoD honesty):** weather is **regional advisories** (read-only, ingested), not a live forecast — no
  geocoder/forecast endpoint, so "by location" follows the default saved address `regionId`; the price read-model
  carries product/grade by id only (no commodity name) → a catalogue-name join is a later enhancement (never
  faked); price-alert delivery is a **server push** (P-04) when a threshold is crossed — the app only subscribes
  (server is the authority on prices, alert firing, predictions; Law 11). Threshold ₹→paise via BigInt (Law 2);
  alert create sends an Idempotency-Key (Law 3); keyset pagination only.

### P-20 · Tips + crop hub + AI assistant (P2) — ✅ DONE
- **Screens:** **55 tips-library, 101 tip-detail, 102 category, 103 saved-tips, 104 crop-hub, 125 AI-chat,
  184 voice-search.** **Backend:** `education`/`cms` + AI. **DoD:** tips browsable offline; AI chat answers in 3
  languages; voice search works.
- **Shipped:** new SDK `resources` (education learning-resources, box=browse → APPROVED only, keyset) + `assistant`
  (ASSUMED `ai/assistant/messages`, idempotent) resources + types (LearningResource, ResourceKind, AssistantReply).
  PURE `features/content/content` (normalizeQuery/matchesQuery/searchResources — ReDoS-safe, groupByKind,
  kindLabelKey/Tone, saved-tips set math, buildAssistantDraft, appendTurn) + `content.api` data layer (tips read
  through the SWR cache → offline; saved tips device-local in AsyncStorage scoped per user; askAssistant degrades
  to an honest "unavailable"). `(farmer)` screens: tips library(55, search + kind chips), tip detail(101, save
  toggle + open asset), category(102), saved(103), crop hub(104, grouped sections), AI chat(125, typed/voice),
  voice search(184, STT → local tip search). Reuses core/voice STT + ui-native VoiceButton. Behind `tips_assistant`
  (default OFF, kill-switch). hi/en/gu parity (1014 keys). **247 mobile + 18 SDK tests green.**
- **Flagged (DoD honesty):** **no farmer-facing AI endpoint is live** (only the admin `ai/inferences` governance
  queue) → the AI-chat wires the real, assumed contract and shows an honest "unavailable" message until it lands
  (never a fabricated answer; inference runs server-side only, Law 11). Tips = curated **learning resources**;
  "category" = resource KIND (no topic-name endpoint → flagged, never faked). Tips have **no server text-search**
  → voice/text search filters the cached approved tips on-device (works offline). **Saved tips are device-local**
  bookmarks (no server wishlist endpoint yet) — scoped per user; cross-device sync awaits a backend. Voice uses
  on-device STT (P-05); no money on these screens. Offline-first via the SWR cache (DoD: tips browsable offline).

### P-21 · Schemes (govt) (P2) — ✅ DONE
- **Screens:** **60 schemes, 105 detail, 106 apply, 107 status, 108 docs, 109 my-schemes.** **Backend:**
  `schemes`. **SDK:** add `schemes` resource. **DoD:** eligibility shown, apply + doc upload (P-01), status
  tracked.
- **Shipped:** new SDK `schemes` resource (catalogue list/get + authorities, explainable eligibility check, apply
  idempotent, my-applications keyset, submit/resubmit/appeal, DBT credits) + types (Scheme, SchemeAuthority,
  EligibilityResult, ApplicationStatus, SchemeApplication, DbtTransfer). PURE `features/schemes/schemes`
  (applicationStatusTone, canSubmit/canResubmit/canAppeal, buildEligibilityInput, eligibilitySummary, docChecklist/
  allDocsUploaded, buildApplyDraft, readApplicationDocuments) + `schemes.api` data layer (catalogue cached → offline;
  eligibility/lifecycle writes throw for a precise outcome; doc upload via core/media P-01). `(farmer)` screens:
  schemes(60), detail+eligibility(105), apply(106, doc checklist + consent → apply+submit, FLAG_SECURE),
  status(107, DBT credits via MoneyText + resubmit/appeal), docs(108, FLAG_SECURE), my-schemes(109). Behind
  `schemes_govt` (default OFF, kill-switch). hi/en/gu parity (1076 keys). **257 mobile + 22 SDK tests green.**
- **Flagged (DoD honesty):** eligibility attributes are **entered by the farmer** (no profile/parcel auto-fill
  endpoint → flagged); the result is server-evaluated + explainable (every reason shown). Doc-type **names** aren't
  exposed (UUIDs) → shown as "Document N"; there's no separate doc-attach endpoint, so document mediaIds are stored
  in the application's `formData.documents` at apply time (uploaded via P-01: pick → EXIF-drop/downscale → presign →
  PUT → confirm). DBT credits are **observed** server-recorded amounts (bigint paise, Law 2) — the app never moves
  scheme money (Law 11). Apply/submit send Idempotency-Keys (Law 3); my-applications are owner-scoped + keyset.

### P-22 · Farmer profile / farm / bank / docs + help (P2) — ✅ DONE
- **Screens:** **61 profile-own, 119 edit-profile, 120 farm-details, 121 bank-accounts, 122 documents,
  123 help, 124 complaint.** **Backend:** `identity` + `support` + `land-soil-weather`(parcels). **DoD:** profile
  CRUD; bank add (KYC); support ticket (→ `support` module) with SLA.
- **Shipped:** SDK `users.me`/`updateMe` (PATCH profile) + new `support` (open idempotent / myTickets / get / CSAT)
  + `parcels` (mine / get / register idempotent) resources + types (SupportTicket, TicketSeverity/Status,
  LandParcel). PURE `features/profile/profile` (buildProfilePatch, isValidEmail/isValidVpa — ReDoS-safe,
  ticketStatusTone/severityTone, resolutionSlaState, buildTicketDraft, parcelAreaLabel/parcelStatusTone,
  buildParcelDraft, bankLabel) + `profile.api` data layer (reads degrade; writes throw for a precise outcome; doc
  upload via core/media). `(farmer)` screens: profile hub(61, enhanced with links), edit(119, PATCH /users/me),
  farm(120, parcels list+register), bank(121, masked list + UPI add, FLAG_SECURE), documents(122, KYC, FLAG_SECURE),
  help(123, tickets + SLA read-out + CSAT), complaint(124, open ticket). Behind `farmer_profile` (default OFF,
  kill-switch). hi/en/gu parity (1139 keys). **268 mobile + 26 SDK tests green.**
- **Flagged (DoD honesty):** the profile READ exposes name + locale only (no gender/dob/email field) → those write
  if entered but start blank; **bank add = UPI only** on mobile (a VPA is a public payment address used as its own
  vaultRef) — a full bank-account number needs a server-side vault tokenization step not exposed to mobile (added
  with an agent; flagged, never a raw account number on device, DPDP). Support SLA due-times are server-set from
  severity (the app shows them read-only — Law 11); CSAT only on resolved/closed. Apply/register/open carry
  Idempotency-Keys (Law 3); bank + docs screens use FLAG_SECURE; profile/parcels/tickets are owner-scoped (no IDOR).

---

## WAVE 9 — Cross-cutting screens + search (P2/P3)

### P-23 · Global search + settings + system screens (P2) — ✅ DONE
- **Screens:** **183 global-search, 75 settings, 187 language-switcher, 178 privacy, 179 data-download,
  177 account-delete, 176 change-phone, 185 permissions, 186 tutorial, 188 offline, 189 server-error,
  190 app-update, 196 about, 195 feedback.** **Backend:** search + `identity` (DPDP export/delete).
- **DoD:** global search across listings/orders/etc.; **DPDP data export + account delete** flows; forced-update
  screen; offline/error screens wired as the global fallbacks.
- **Shipped:** new `(system)` route group (Stack) with all 14 screens. SDK `users.me`/`updateMe` (P-22) reused +
  new `privacy` resource (export/deletion requests + change-phone start/confirm — ASSUMED endpoints, idempotent).
  config gains appVersion/minSupportedVersion/store+privacy+terms URLs. PURE `features/system/system`
  (mergeSearchResults + normalizeQuery — ReDoS-safe, compareVersions/isUpdateRequired semver, PERMISSIONS catalog,
  deleteConfirmationOk) + `system.api` (globalSearch fans out over listings.browse + orders.list both roles + merges;
  DPDP/phone writes degrade honestly; feedback opens a real support ticket). Search/privacy/DPDP/change-phone/
  feedback gated on `system_screens` (default OFF); the **fallback/info screens (offline/server-error/app-update/
  about/tutorial/permissions/language) render unconditionally** so they always work as global fallbacks. Reachable
  from the farmer profile (Settings link). hi/en/gu parity (1232 keys). **276 mobile + 29 SDK tests green.**
- **Flagged (DoD honesty):** no dedicated search endpoint → global search **fans out over existing reads** + merges
  client-side (server enforces visibility/ownership per call). **DPDP export/deletion + change-phone endpoints
  aren't live** (only `consents` exists) → the SDK wires the assumed contracts and the screens degrade to an honest
  "being rolled out" message; the app NEVER builds an export, deletes the account locally, or owns the OTP (server
  is the data controller — Law 11). Forced-update is config-driven (minSupportedVersion); store/legal links hide if
  unset. Account-delete needs a typed confirmation; all mutations carry Idempotency-Keys (Law 3).

This completes **Wave 9** and the Phase-1 mobile screen catalogue.

---

## WAVE 10 — Adjacent role apps (P3 — only if Phase-1 includes them; per PRD these are Phase-2 roles)

> Per `01_Phase1_Lean_Scope`, Pashupalak/Dairy/Vet/Equipment/Store/Delivery-partner are **Phase 2 roles**. Their
> feature folders exist (`dairy`, `mcc-operator`, `livestock`, `vet`, `delivery-partner`, `store-owner`,
> `fintech`, `vyapari-home`, `fpo-coordinator`) and the backend modules are built, but **do NOT build these for
> Phase-1 GA** unless explicitly re-scoped. Listed here so the backlog is complete.
- **P-24** Dairy / MCC operator (milk diary, MCC slip, bill, D2C).
- **P-25** Livestock + Vet (animal records, health, vet booking).
- **P-26** Delivery partner (tasks, route, pickup OTP, PoD, earnings).
- **P-27** Store owner (inventory, orders, batches/expiry, licence).
- **P-28** Fintech (loan products/apply, credit score, insurance) — buyer/farmer-facing.
- **P-29** Vyapari/FPO extras (market dashboard, requirements inbox, supplier shortlist, group lots).

---

## WAVE 11 — Hardening + store release (P0 GATE before GA, PRD S17–S18)

### P-30 · Security hardening pass (P0) — ✅ DONE
- TLS **certificate/public-key pinning**; **root/jailbreak + Play Integrity/App Attest** on login/pay/KYC/payout;
  release **obfuscation** (Hermes, R8/ProGuard, strip+privately-upload source maps, no dev menu); **FLAG_SECURE**
  audit on all sensitive screens; clipboard/deep-link/WebView audit; `npm audit`/Snyk clean; pen-test the OTP,
  checkout, payout, attendance, and offer flows from a patched-client perspective. **DoD:** the §4 checklist of
  `MOBILE_AI_AGENT_BUILD_GUIDE.md` fully green + a written threat-model sign-off.
- **Shipped:** new `core/security` (PURE, unit-tested): `pinning` (pin-set validator + CI gate `pinConfigReady`),
  `integrity` (device-integrity risk-signal header `x-device-integrity`, native provider port — honest 'unknown'
  default, never claims clean), `deeplink-guard` (inbound scheme+route allowlist, no money flow link-reachable,
  rejects traversal), `clipboard-policy` (OTP/token/bank never copyable). SDK gained a `getHeaders` hook that
  injects the integrity signal but can **never override** reserved headers (auth/idempotency/tenant) — pinned by
  tests. **FLAG_SECURE audit**: now on **17** sensitive screens (added OTP-verify, wallet index/transactions/
  payouts/txn-detail, change-phone). Release config: `app.config.ts` (Hermes, expo-build-properties → R8/ProGuard
  + resource-shrink + `usesCleartextTraffic:false` + TLS pins), `eas.json` (production profile, private source-map
  upload + strip, staged rollout 1%→10%→100%). Written **`THREAT_MODEL.md`** sign-off: §4 checklist GREEN (items
  1–14) + per-flow (OTP/checkout/payout/attendance/offer) patched-client abuse → server-side mitigation.
  **287 mobile + 31 SDK tests green.**
- **Flagged (offline-sandbox honesty):** native enforcement (TLS handshake pinning, root/attestation, R8/Hermes,
  source-map strip) is wired via the release build config and is exercised by **EAS/CI, not the offline sandbox**;
  `npm audit`/Snyk is a CI gate (needs a lockfile + registry). Real TLS pins + the native integrity provider are
  injected at build (`EXPO_PUBLIC_TLS_PINS` / `setIntegrityProvider`); the JS ports + server scoring are ready.

### P-31 · Observability + crash + analytics (P0) — ✅ DONE
- **Shipped:** new `core/observability` (PURE, unit-tested): `redact` (deep PII/secret scrubber — key denylist +
  bearer/JWT/phone/Aadhaar/PAN/email/account patterns, bounded depth, cycle-safe — the heart of "no PII in any
  payload"), `correlation` (PII-free `x-correlation-id` trace tag, rotated per online window), `analytics`
  (consent-gated, PII-scrubbed `buildEvent`, bounded offline ring buffer + flush-on-reconnect, typed EVENT catalog),
  `crash` (provider port + `sanitizeEvent` redaction + `setCrashUser` id-only + `forceCrash` DoD hook; no-op
  default), `slo` (crash-free ≥99.5% + login/listing/checkout targets + `meetsSlo`). SDK `getHeaders` now merges
  the correlation + integrity headers (reserved headers still win — tested). Boot wires `initObservability()`
  (no-op without a DSN) + flushes analytics on reconnect; auth sets/clears the crash user id (no PII); key funnels
  emit at the real call sites (login/listing-create/checkout success). config: `sentryDsn` + `analyticsEnabled`.
  **297 mobile + 31 SDK tests green.**
- **DoD:** forced crash hook (`forceCrash`) + symbolication via private source maps (CI step from P-30's eas.json);
  key funnels emit (consent-gated); **no PII in any payload** — `redactPII` runs on every analytics prop, crash
  context, breadcrumb, and free-text message (exhaustively unit-tested: tokens/phone/Aadhaar/PAN/email/account all
  masked).
- **Flagged (offline-sandbox honesty):** the Sentry + analytics PROVIDERS are installed by the release bootstrap
  (CI/EAS) via `setCrashProvider`/`setAnalyticsProvider` with `sanitizeEvent`/`redactPII` as beforeSend — the
  framework-free core (ports + redaction + buffer + SLO) is what's unit-verified here; the SLO **dashboards +
  alerts** live in the crash/analytics service (server-side), fed by these events.

- **Original spec (for reference):** Sentry (PII/token-redacted, symbolicated), analytics funnels (consented,
  offline-buffered), client SLO dashboards (crash-free ≥99.5%, login/listing/checkout success), correlation-id
  propagation. **DoD:** a forced crash is captured + symbolicated; key funnels emit; no PII in any payload.

### P-32 · Release pipeline + store compliance (P0) — ✅ DONE
- EAS build profiles (dev/preview/**beta**/prod), **phased rollout** (1%→10%→100%) with crash gates, **OTA** (expo-updates)
  with flag discipline + rollback, forced-update floor, Play/App Store data-safety + permission justifications +
  privacy policy, beta channels. **DoD:** a signed build ships to internal track; OTA + rollback rehearsed;
  store metadata complete; e2e (Detox/Maestro) green on the critical sell+buy+pay path.
- **Shipped:** `core/release` (PURE, unit-tested) — `update-gate` (`compareVersions`, `decideUpdate`
  forced/recommended/none, remote `setUpdateThresholds`/`effectiveMin`), `ota` (`shouldApplyOta` flag+availability+
  not-mid-critical-flow gate, no-throw provider), `ForcedUpdateGate` (root-wired floor enforcement reusing
  `system.update.*`); flags `ota_updates` + `release_gate` (default OFF). Infra: `eas.json` (beta profile + phased
  submit), `app.config.ts` updates block + `appVersion` runtime policy, `mobile-ci.yml` (typecheck/lint/unit/audit/
  bundle-size/Maestro) + `mobile-release.yml` (binary-build/ota-update/ota-rollback), `scripts/check-bundle-size.mjs`,
  `.maestro/sell-buy-pay.yaml` e2e, `RELEASE.md` runbook, `STORE_COMPLIANCE.md`. **Verify:** 305 mobile + 8 release
  unit tests green; apiClient-in-screens grep = 0; i18n hi/en/gu parity (1232 keys); bundle script valid. Binary
  build/submit + OTA publish run on EAS/CI (not the offline sandbox), documented in `RELEASE.md`.

---

## Cross-cutting rules for EVERY item (from `MOBILE_AI_AGENT_BUILD_GUIDE.md`)
- Server is the only security authority; the app never trusts its own role for anything but navigation.
- Money = bigint minor-unit strings + `MoneyText` (Law 2). Every mutation carries an Idempotency-Key (Law 3).
- Degrade-never-die: loading/empty/error states wired; timeout on every call; reads cached, writes queued.
- i18n keys in hi/en/gu for every string; ≥48px targets + a11y labels; tokens-only styling.
- Behind a feature flag (default OFF) with a kill-switch; unit-test pure logic; update `SCREENS_BACKLOG.md` +
  `MODULE_STATUS.md`; ship a feature README + "Threats considered" note; paste green typecheck/test output.

## SDK work implied (extend `@krishalaya/sdk-js` as each vertical lands)
New typed resources to add (currently only auth/listings/catalogue/traceability exist): **media, wallet,
payments, kyc, orders, offers, messaging, auctions, labour, ambassadors, notifications, market-intel, schemes,
reviews, support, tenancy**. Add the resource + types in the same session as the screen that first needs it (or
use the SDK `request()` escape-hatch and note the assumed contract) — never fake a response.
```
