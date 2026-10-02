# auctions module (PRD M04)

English-open + sealed auctions on a listing, with **EMD** (earnest-money) holds, **anti-snipe**
auto-extend, reserve price, min-bidders, and optional seller approval. Built to the
`listings`/`identity` bar. Gated by the `auctions` feature flag (default OFF).

## What it owns
- **Auction lifecycle** — a seller opens an auction on THEIR published listing (one per listing).
  `scheduled → live → (extended…) → ended → settled | awaiting_approval | failed_reserve`, plus
  `cancelled`. Opening/closing are worker jobs (`open-scheduled`, `close-ended`, kv_relay, SKIP LOCKED).
- **Bidding** — `POST /v1/auctions/:id/bids` (auction.bid, idempotency-key). In one tx the auction
  row is **locked FOR UPDATE** (serializes concurrent bids), the bid is validated (≥ start, or ≥
  high + min-increment for english), the **EMD is held** via the wallet (main → hold, once per
  bidder; the wallet's no-overdraw rule means a bidder must actually have the funds — anti-spam),
  the **immutable** bid is appended, and **anti-snipe** extends the end time if the bid lands inside
  `extend_trigger_secs`. Sealed auctions hide other bidders' amounts until the auction ends.
- **Resolution** — at close the highest valid bid wins iff it meets the reserve and min-bidders,
  else `failed_reserve`; `requires_seller_approval` routes to `awaiting_approval` with a decision clock
  (`decision_due_at`, 1–72 h). **PC-56 TENANT-11a (founder decisions F-12 per unit, F-2 apply + forfeit):** every
  price is PER UNIT of the lot (`quantity` + `unit_code`, copied from the listing at create); the close returns the
  LOSERS' EMD and keeps the winner's; settlement — in ONE transaction — writes `settled` + `settled_order_id`, creates
  the order (quantity × hammer) through `AuctionOrderService`, APPLIES the winner's EMD to it (hold → escrow,
  `emd-apply:<auction>`) and records `auction_settlements` (balance due in 48 h). A balance still unpaid at that time
  (online collection) — or a winner who cancels the order — FORFEITS the EMD to the seller (`emd-forfeit:`), the
  auction is `defaulted`, the order cancelled, the listing re-published; a seller / system cancel returns it
  (`emd-return:`). The listing is `reserved_auction` while it is auctioned. Five sweeps (open, close, lapse, default,
  EMD-release backstop) run through `SCHEDULED_JOB_REGISTRY`, claiming per tenant in kv_app's unit of work.

## Security properties (threats considered)
- **Tenant isolation (Law 1)** — `tenant_id` in every query + RLS; proven by the integration test
  (tenant B sees zero of tenant A's auctions).
- **No self-deal** — the listing's seller cannot bid on their own auction (resolved via
  ListingService, never the listings repository — Law 11); a bidder can't outbid themselves (english).
- **Money safety (Law 2)** — bigint minor units; EMD moves ONLY via the wallet boundary, idempotent
  per `(auction, bidder)`; release is idempotent — a re-run can't double-refund. Money is conserved
  (the integration test asserts holds return to zero and main is fully restored).
- **Concurrency** — the bid path locks the auction row (`SELECT … FOR UPDATE`); other writes use the
  `version` optimistic lock; jobs use `FOR UPDATE SKIP LOCKED`.
- **Bids are immutable** (append-only; DB grants revoke UPDATE/DELETE) — a tamper-proof bid trail;
  `auction_events` records the lifecycle.
- **Idempotency** scoped per `(user, endpoint)`; **bounded** lists (cursor/keyset, never OFFSET);
  bidding is throttled by the global edge rate-limit; audit rows on approve/cancel.

## Endpoints
`POST /v1/auctions` (create) · `GET /v1/auctions` (list) · `GET /v1/auctions/:id` ·
`POST /v1/auctions/:id/approve|cancel` · `POST /v1/auctions/:id/bids` (bid) · `GET /v1/auctions/:id/bids`.

## Tests
Unit (`auction.service.spec.ts`): state machine + aggregate (create guards, english/sealed min-bid,
EMD math, anti-snipe extend, reserve/min-bidders resolution, approval). `tenant-isolation.spec.ts`:
SQL contract (tenant_id everywhere, FOR UPDATE, version, SKIP LOCKED, keyset). Integration
(`auctions.integration.spec.ts`, real Postgres + RLS): open → bids (EMD held once, seller blocked,
too-low rejected) → close (winner + all EMD released) → cross-tenant RLS denial.

## Watch-list + outbid notifications + EMD-release glue (API-W3-11)
- **Watch-list** — `domain/auction-watcher.entity.ts` + `repositories/auction-watcher.repository.ts` +
  `services/auction-watcher.service.ts`: a member watches/unwatches an auction (idempotent — composite
  PK) and lists their own watched auctions. `auction_watchers` has no `tenant_id`; it is reachable only
  through the tenant-scoped, RLS-protected `auctions` row (every read JOINs `auctions` + filters
  `tenant_id`), and the auction is resolved within the tenant before a watch (a non-member → 404, no
  enumeration). `POST/DELETE /v1/auctions/:id/watch`, `GET /v1/auctions/watching`,
  `GET /v1/auctions/:id/watch` (O(1) `isWatching` for the UI toggle state). watch emits
  `auctions.watch_started` (Law 4). **On close (P1-7)** `closeAndResolve` loads the auction's watchers
  (`listWatcherUserIds`, bounded cap, read in the close tx) and emits `auctions.watchers_auction_ended` carrying
  `recipientUserIds` → mapped in `communication/events/notification-event-map.ts` to the `auction.ended` catalog
  event, so every watcher is notified atomically with the close (Law 4); the fanout is bounded (write-amplification
  cap) and carries no PII beyond in-tenant user ids.
- **Outbid notifications** — when a strictly-higher open-auction bid displaces the previous high bidder,
  `BidService` emits `auctions.bidder_outbid` (via `AuctionsPublisher`) IN THE SAME bid tx → notifications
  fan out to the outbid bidder. Sealed bids never emit it.
- **Edit a scheduled auction** — `update-auction.dto` + `AuctionService.updateScheduled` (+ `Auction.editSchedule`):
  seller/moderator may change reserve/min-increment/window WHILE scheduled (invariants re-validated,
  optimistic-locked, audited, emits `auctions.auction_updated`). `PATCH /v1/auctions/:id`.
- **EMD-release sweeper** — `releaseLosingEmd` (registered as `auctions-release-losing-emd`) is a BACKSTOP since
  TENANT-11a: the close itself returns the losers' EMD. It never touches a winner whose hold is kept
  (awaiting_approval) or applied (settled / defaulted). `payments.payment_succeeded` no longer releases the winner's EMD
  (it is applied to the order at settlement); for an auction ORDER it records the settlement `paid`, through kv_app.
  Tests: `auction-watchers.integration.spec.ts`, `tenant11a-auction-truth.integration.spec.ts`.

## Deferred (flagged, not faked) — next wave
- **Offer to the next bidder after a default** — not built (TENANT-11a names it on W139).
- **reverse / dutch** auction kinds (rejected at creation) + **bidder qualification** enforcement
  (roles/regions/KYC in `bidder_qualification`) + a Redis live read-model. English-open + sealed +
  the EMD/anti-snipe + watch-list/outbid core are complete.