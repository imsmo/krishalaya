# promotions module (PRD §9.5 — promotions & coupons)

Tenant marketing campaigns + redeemable **coupon codes**. An admin creates a budgeted **promotion**
(whose `rules` define a percent/flat discount with min-order + cap) and attaches **coupons** (codes with
a global `max_uses` + a `per_user_limit`). A buyer **validates** a code (preview) and **redeems** it
against an order — the authoritative, capped, budget-bounded, append-only redemption. Built to the
`listings`/`identity` bar. Gated by the `promotions` feature flag (default OFF).

## PC-56 TENANT-10b — the tenant wallet funds the discount (founder decision F-2; supersedes the "no money" notes below)
- **Reserve at redemption.** `redeemInTx` (checkout's own tx, coupon + promotion rows `FOR UPDATE`) posts
  `promo_hold` tenant Main −d → tenant Hold +d (key `promo-hold:<orderId>:<couponId>`, inside a SAVEPOINT so a funds
  refusal leaves nothing) BEFORE writing the redemption, which carries `hold_txn_id` (0185).
- **Pay at settlement.** payments' `OrderCompletedHandler` calls `CouponMoneyService.settleOrderInTx` after the escrow
  leg, in the relay tx: `promo_settle` tenant Hold −d → seller Main +d; the seller is settled on the FULL goods value.
  The escrow txn is unchanged. kv_relay holds SELECT + UPDATE(settled_txn_id, settled_at) on `coupon_redemptions` only.
- **Return on cancel / refund** (`orders.order_cancelled`, `orders.order_refunded`, before settlement): `promo_release`
  tenant Hold −d → Main +d; the coupon's use and the promotion's spend are given back.
- **A decline never aborts a checkout.** `couponDecision` (domain/coupon-outcome) answers both validate (preview) and
  redeem: `applied | user_limit | budget_exhausted | window | tenant_funds_unavailable | invalid | max_uses_reached |
  not_applicable`. Declined → the order is placed at full price with `couponNotice { code, outcome, messageKey }`.
- **Every outcome is recorded** in `coupon_redemption_attempts` (append-only by trigger, RLS with WITH CHECK).
- `spent_minor` = sum of reservations taken (and not released). A new promotion needs a budget; only `discount` and
  `festival` (the types with an engine) can be created. The budget watch and festival scheduler run through
  `SCHEDULED_JOB_REGISTRY`; the scheduler never re-opens a promotion a person paused (`paused_at`).

## What it owns
- **Promotion** — `promo_type` + `rules` jsonb (parsed/validated into a typed `PromoRules`, never trusted
  freeform) + `budget_minor`/`spent_minor` + `[starts_at, ends_at]` + `is_active`. Validity is **derived**
  (Law 5, `promotion.state`): `scheduled | active | paused | exhausted | expired`. Admin CRUD + pause/resume.
- **Coupon** — a code attached to a promotion with `max_uses` (global) + `per_user_limit`. Admin create /
  soft-delete / list. `UNIQUE(tenant_id, code)`.
- **validate** — `POST /v1/coupons/validate` (any authed user): computes the discount for a subtotal +
  checks window/active/global-capacity. **Read-only** (no state change) — the storefront preview.
- **redeem** — `POST /v1/coupons/redeem` (any authed user, Idempotency-Key): the authoritative path. In
  ONE ACID tx it locks the coupon + its promotion `FOR UPDATE`, enforces the **per-user cap**, the
  **global cap**, and the **budget** (all fail CLOSED), appends the **immutable** `coupon_redemption`
  (`UNIQUE(coupon_id, order_id)` → idempotent per order), and increments `uses` + `spent_minor`. Returns
  the discount for checkout to apply to `order.discount_minor`.

## Security properties (threats considered)
- **Tenant isolation (Law 1)** — `tenant_id` in every query + RLS (auto-applied by 0014; the integration
  test proves tenant B sees zero of tenant A's promotions).
- **No oversell under concurrency** — redeem locks the coupon + promotion rows (`SELECT … FOR UPDATE`),
  so concurrent redemptions can't exceed `max_uses`, `per_user_limit`, or the budget; the
  `UNIQUE(coupon_id, order_id)` stops double-applying a coupon to one order; idempotency-key per
  `(user, redeem)` stops client retries double-spending.
- **No money via wallet** — a coupon discount is a **price reduction**, not a ledger movement;
  `spent_minor` is promo accounting. (Cashback/recharge-bonus promo types that DO credit the wallet are
  deferred — see below.)
- **Authorization that throws** — promotion/coupon CRUD requires `promotion.manage`; validate/redeem are
  any authenticated tenant user (the redeemer is `ctx.userId`, never client-supplied). No god/`*`.
- **Input validation** — zod `.strict()` on every body; `rules` re-validated in the domain
  (`parsePromoRules`) — bounded percent (1..100), minor amounts as integer strings (no float, no ReDoS).
  Coupon codes are `[A-Z0-9_-]{3,40}`, upper-cased.
- **Anti-enumeration** — an unknown code returns a generic `COUPON_NOT_FOUND` (no echo of the code);
  validate/redeem are throttled by the global edge rate-limit (coupon-code brute force is bounded).
- **Audit** — every admin action (create promotion/coupon, pause, delete) writes an `audit_log` row in-tx.
- **Append-only redemptions** — the DB revokes UPDATE/DELETE on `coupon_redemptions` (history is physics).

## Endpoints
`POST /v1/promotions` · `GET /v1/promotions` · `GET /v1/promotions/:id` · `POST /v1/promotions/:id/active`
(admin) · `POST /v1/coupons` · `GET /v1/coupons?promotionId=` · `DELETE /v1/coupons/:id` (admin) ·
`POST /v1/coupons/validate` · `POST /v1/coupons/redeem` · `GET /v1/coupons/redemptions` (any authed user).

## Tests
Unit (`promotion.service.spec.ts`): validity derivation, rules parsing, discount math (percent/flat/min/
cap/clamp), budget guard, coupon caps. `tenant-isolation.spec.ts`: SQL contract (tenant_id everywhere,
FOR UPDATE, no version, ON CONFLICT uniqueness, keyset, per-user count). Integration
(`promotions.integration.spec.ts`, real Postgres + RLS): create → validate → redeem (uses/spent
incremented, idempotent per order) → per-user cap + budget both fail closed → cross-tenant RLS denial.

## Deferred (flagged, not faked) — later wave
- **Checkout integration (DONE)** — orders' `CheckoutService` accepts a `couponCode` and calls
  `CouponService.redeemInTx` INSIDE the checkout tx, applying the discount to the primary order's
  `order.discount_minor` (atomic: the redemption + the order commit together; behind the `promotions`
  flag). Proven by `apps/api/src/modules/orders/__tests__/orders.integration.spec.ts`. (The
  `order-created.handler` scaffold stays unwired — a discount must be priced BEFORE the order total.)
- **Cashback / recharge-bonus** promo types that CREDIT the buyer's wallet (a real ledger movement via
  the wallet boundary) — deferred; this build ships the discount engine.
- **`festival-campaign-scheduler` / `promo-budget-watch` jobs** (auto start/stop, budget alerts) — budget
  is already enforced inline at redeem; the proactive jobs land with the worker wave.

## Async glue (API-W4-01)
- **`CouponRedemptionService`** — the decoupled redemption recorder. `recordFromOrder` is idempotent on the
  `coupon_redemptions` UNIQUE(coupon_id, order_id): for the normal flow (checkout already redeemed synchronously
  in its own tx) it no-ops; otherwise it records the redemption + bumps the coupon use + promo spend (the latter
  via `recordSpend(…, {enforceBudget:false})` so it never throws inside the relay tx).
- **`OrderCreatedHandler`** (`orders.order_created`) — when an order carried a coupon, calls the recorder. The
  coupon code + applied discount + buyer travel IN the event (`Order.place` payload) so orders never imports
  promotions' repo (Law 11). Backstop / decoupled — mirrors the auctions W3-11 idempotent-overlap pattern.
- **Worker sweeps** — `PromoBudgetWatchJob` deactivates promotions that crossed budget; `FestivalCampaignSchedulerJob`
  opens/closes `festival` promos on their [starts_at, ends_at] window. Both claim candidates cross-tenant
  (FOR UPDATE SKIP LOCKED, bounded) then call `PromotionService.deactivateExhausted` / `applyScheduleWindow`
  (own tx + outbox + audit), idempotent (already-aligned rows are never re-claimed).
