# payments module (PRD M05) + wallet boundary

Money-IN for the platform: **payment intents**, signature-verified **gateway webhooks**, and
**refunds** — every rupee recorded as a balanced, double-entry ledger transaction. The module never
writes the ledger itself (Law 2); it calls the **wallet boundary** (`core/wallet`, the in-process
implementation of the wallet-service gRPC contract). Gated by the `online_payments` feature flag.

## What it owns
- **Payment intents** — `POST /v1/payments` creates an intent (status `initiated`) and a gateway
  order (Razorpay or the deterministic sandbox), idempotent on the caller's `Idempotency-Key`.
- **Gateway webhooks** — `POST /v1/payments/webhooks/:provider` (PUBLIC, unauthenticated). Trust is
  established ONLY by the HMAC signature over the raw body; the tenant comes from the
  signature-verified order `notes`. On `payment.captured` it posts a zero-sum ledger txn
  (escrow credited, gateway debited), flips the payment to `success`, links `ledger_txn_id`, and
  emits `payments.payment_succeeded` — all in ONE tx. Idempotent on the gateway event id.
- **Refunds** — `POST /v1/payments/:id/refund` (needs `wallet.adjust`): reverses the escrow leg and
  records partial/full refund on the payment (issuing the PSP card/UPI refund is confirmed via the
  `refund.processed` webhook — next wave).
- **Reads** — `GET /v1/payments[/:id]`, owner-scoped, cursor-paginated.

## The wallet boundary (core/wallet) — the only money writer
`InProcessWalletClient` posts double-entry transactions to `wallet_accounts` + `ledger_*`:
ZERO-SUM enforced (legs sum to 0), single currency, ≥2 legs; idempotent on the txn idempotency key;
each account locked `FOR UPDATE`; no overdraw of user/tenant accounts; frozen accounts reject
debits; per-account hash chain (tamper-evidence). At `shard_count=1` this IS the wallet service;
`apps/wallet-service` is the gRPC extraction target (same contract — `wallet.proto`).

## Security properties (threats considered)
- **Forged webhooks** → HMAC verified in constant time; bad signature = 401, fail closed. Amount in
  the webhook is checked against the recorded intent (tamper guard).
- **Replays / double-credit** → webhook processing is idempotent on the gateway event id AND the
  ledger post is idempotent on `pay:<paymentId>` — a captured payment can never credit twice.
- **Money safety (Law 2)** → bigint minor units only; movement only via the wallet boundary; the
  ledger is zero-sum (a real-Postgres test asserts `SUM(amount_minor)=0`); refunds can't exceed the
  refundable balance.
- **Tenant isolation (Law 1)** → `tenant_id` in every query + RLS; the webhook runs in the
  signed-notes tenant's context; reads are owner-or-moderator (404 to others — no enumeration).
- **Least privilege / resilience** → refunds need `wallet.adjust`; the Razorpay adapter is wrapped
  in `core/resilience` (timeout + retry + circuit-breaker; money calls never auto-retry without an
  idempotency key, never have a fallback). Webhook bodies/secrets/PII are never logged.
- **Idempotency** scoped per `(user, endpoint)` for the create call; per event id for webhooks.

## Tests
Unit: payment state machine + aggregate (capture-once, partial→full refund, over-refund guard);
wallet money invariants (zero-sum, idempotency, overdraw, frozen — `core/wallet`); resilience
(timeout/retry/breaker/bulkhead). `tenant-isolation.spec.ts`: SQL contract (tenant_id everywhere,
FOR UPDATE, keyset). Integration (`payments.integration.spec.ts`, real Postgres + RLS): intent →
signed capture webhook → success + **zero-sum ledger** + escrow balance + outbox; webhook
idempotency (no double-credit); forged-signature rejection; cross-tenant RLS denial. Schema/seeds
come from the real `db/migrations` + `db/seeds`.

## Money-OUT + settlement (built)
- **Payouts** — `POST /v1/payouts`: a user withdraws from THEIR wallet to THEIR verified bank/UPI
  account (ownership enforced — anti-IDOR). The funds are reserved via a wallet move
  (user main → platform payouts, zero-sum, no-overdraw), a `payouts` row is queued, idempotent on
  the caller's key. The RazorpayX disbursement (queued→processing→success) is driven by the worker
  (next wave); the wallet debit is immediate and correct.
- **Settlement** — on `orders.order_completed` (delivered by the outbox relay), `OrderCompletedHandler`
  releases the held escrow to the seller's wallet (escrow → seller main, zero-sum), idempotent on
  `settle:<orderId>`. Commission/tax split is the next wave; the escrow→seller move is the
  settlement of record.

## Order ↔ payment flow (end-to-end, via the outbox relay — Law 4)
No synchronous cross-module calls. `payments.payment_succeeded` (referenceType `order`) → the
core **outbox dispatcher** → `PaymentSucceededHandler` (orders) → `order.markPaid()` (confirm).
`orders.order_completed` → the dispatcher → `OrderCompletedHandler` (payments) → escrow settlement.
Handlers run inside the relay's per-event tx and are idempotent (at-least-once delivery). The relay
runs as the BYPASSRLS `kv_relay` role (migration 0018) via `core/outbox/relay.poller.runRelay`.
The `orders-payments-e2e.integration.spec.ts` proves the whole chain (pay→confirm→settle→payout)
with zero-sum ledger assertions.

## Payout execution + reconciliation (built)
- **Payout execution** — `PayoutExecutionJob` (worker, kv_relay) atomically claims queued payouts
  (`FOR UPDATE SKIP LOCKED` → `processing`) and disburses each via the `PayoutGateway` (RazorpayX
  adapter / sandbox, resilience-wrapped, money: no auto-retry, no fallback). On success: a zero-sum
  `payouts → gateway` ledger move. On a DEFINITIVE gateway rejection: **failure-reversal** — the
  reserved funds are returned to the user's wallet (`payouts → user`), payout `reversed`. On an
  ambiguous transport error the payout stays claimed and is retried (PSP idempotency key) — we never
  auto-reverse an ambiguous disbursement (double-pay guard). Async PSP confirmation via webhook is
  the remaining step (next wave); sandbox settles synchronously.
- **Reconciliation** (`core/wallet/ReconciliationService`) — continuous money-safety net writing
  `reconciliation_runs`: **zero-sum** (every txn's legs sum to 0) + **internal-balance** (each
  account's cached balance equals Σ its entries). Proven by the integration test (clean → ok; an
  injected imbalance → `mismatch`).

## Commission / tax engine (built — `commission_split` flag)
Effective-dated, most-specific rule resolution (`commission_rules` tenant-override → platform
default; `tax_rules` GST + 194-O TDS, country-level) + a pure, zero-sum settlement calculator.
At settlement the held escrow is split into: **seller net (residual)** + **tenant commission** +
**platform share (fees)** + **GST-on-commission (gst_payable)** + **TDS (tds_payable)**. The seller
net is the residual so the split always sums back to gross (rounding can't break zero-sum). Behind
the `commission_split` flag (default OFF = legacy full release), so it rolls out per-tenant. Proven
by `commission-settlement.integration.spec.ts` (tenant-override vs platform-default, isolation,
idempotent, zero-sum) + `commission.spec.ts` (math, cap, TDS threshold, fail-closed on bad rates).
`charged_to='buyer'` commissions are a checkout-time buyer fee (`charge_definitions`, deferred);
the engine computes the seller-deduction model used by the seeded direct/auction rules.

## Billing documents (built)
- **Settlement statements** — each split settlement writes a per-order `settlement_lines` row
  (seller-tagged breakdown; idempotent per order). `SettlementStatementService.generate` aggregates a
  seller's un-statemented lines for a cycle into a statement (gross/commission/tax/net) with a
  GST-style sequential `statement_no` (`next_doc_number`), links the lines (no double-count next
  cycle), and is idempotent per seller+period. Sellers read their own; finance (`payout.approve`)
  generates. `GET/POST /v1/settlement-statements`.
- **GST trade invoices** — `TradeInvoiceHandler` (fan-out on `orders.order_completed`) generates one
  invoice per order (idempotent) with a CGST/SGST `tax_breakup` (intra-state) at the resolved GST
  rate; `total = order total`. Readable by the order's buyer/seller or a finance moderator (404 to
  others — IDOR-safe; buyer/seller carried on the invoice row). `GET /v1/invoices/order/:id`.
  Proven by `billing-documents.integration.spec.ts` + `commission.spec.ts`.

## Buyer-side charge engine (built — `buyer_charges` flag)
`charge_definitions`-driven fees resolved (tenant override → platform default, effective-dated) and
computed by a pure calculator: **flat / percent (min/max) / slab / per_unit** (per_km deferred —
needs distance). `ChargePricingService.checkoutCharges` quotes the **delivery slab** + **2.5%
buyer platform fee** on the order subtotal; the orders checkout adds them to the buyer's total
(behind `buyer_charges`, default OFF). CRITICAL correctness: at settlement the buyer charges are
routed to the **platform fees** account and EXCLUDED from the seller's settleable gross — the seller
never pockets delivery/platform fees — and the whole settlement stays **zero-sum** (proven by
`buyer-charges.integration.spec.ts` + `charge.spec.ts`). `OrderCompletedHandler` settles on
`gross − buyerCharges`.

## Document PDFs (built — `document_pdfs` flag)
`DocumentPdfService` renders settlement statements + GST invoices to real PDFs (self-contained
writer in `core/media/pdf`) and stores them via the media boundary (`putGeneratedDocument` → clean
tenant document), setting `pdf_media_id`. Statement generation attaches its PDF best-effort
(a PDF failure never fails statement generation). Default OFF (no S3 write); when ON + S3 configured,
clients fetch the PDF via the media download-url using `pdf_media_id`.

## Invoicing domain + commission catalog (API-W3-07)
The B2B-invoicing surface now has first-class, unit-tested domain value objects + a tenant-managed rule catalog:
- **Domain value objects** (`domain/{trade-invoice,settlement-statement,charge-definition,tax-rule}.entity.ts`) —
  pure, bigint-only, invariant-enforcing: `SettlementStatement` (net = gross − commission − tax, zero-sum),
  `TradeInvoice` (GST split consistency: cgst+sgst+igst ≤ total, never IGST mixed with CGST/SGST),
  `ChargeDefinition` (per-`calc_method` config validation), `TaxRule` (rate + CGST/SGST split sums + TDS
  threshold). `TradeInvoiceService` now validates each generated invoice through `TradeInvoice.create()` before
  persisting (fail closed); the settlement-statements job validates each generated statement through
  `SettlementStatement.fromAggregate()`.
- **Commission-rule catalog** — a tenant finance admin (`payout.approve`) manages its OWN commission OVERRIDES
  via `POST/GET /v1/commission-rules` + `POST /v1/commission-rules/:id/deactivate` (`CommissionRuleService`).
  Platform-default rules (`tenant_id NULL`) are **god-mode** (admin-api) — every write binds `ctx.tenantId`, and
  a mutate against a platform row 404s (no privilege escalation, Law 11). These rules are CONFIG and move no money;
  settlement resolves the most-specific effective rule at order time. Rates are bps; money is bigint minor units.
- **Settlement-statements run** (`jobs/settlement-statements.job.ts`, worker) — finds every (tenant, seller) with
  un-statemented `settlement_lines` in a cycle and generates one statement each via the (idempotent)
  `SettlementStatementService.generate`; cross-tenant, bounded; NO money moves (payout is a separate flow).

## Batched payouts + async gateway confirmation + recon (API-W3-08)
The money-OUT pipeline now has its batching, async-confirmation, and reconciliation glue:
- **Payout batches** (`domain/payout-batch.entity.ts` + `payout-batch.state.ts`, `repositories/payout-batch.repository.ts`,
  `services/payout-batch.service.ts`) — a `PayoutBatch` is a bookkeeping envelope for a disbursement RUN
  (daily settlement run / weekly ambassador run / wage lane): `open → executing → executed` (or `failed`),
  recording `total_minor` + `count`. `PayoutBatchService.runBatch(pool, …)` opens a batch, CLAIMS queued
  payouts into it (`FOR UPDATE SKIP LOCKED`, lowest priority number first), then disburses each via
  `PayoutService.execute` (the wallet boundary — the batch NEVER moves money itself, so one failing payout
  can't poison the run). `payout_batches` is an operational table outside tenant RLS (like
  `reconciliation_runs`) — runs are driven by the worker on a privileged connection and can span tenants.
- **Wage priority lane** — labour wages should reach a worker's bank ahead of the bulk queue. The
  `booking-clocked-out` handler consumes `labour.wages_paid` and, behind the `wage_priority_payout` flag
  (default OFF, kill-switch), PROMOTES that booking's still-queued payouts into the wage lane
  (`priority = WAGE_LANE_PRIORITY`). It touches ONLY payments' own `payouts` table (the booking id comes
  from the event payload — never a cross-module table read, Law 11) and is idempotent. The
  `wage-priority-lane` worker job then drains that lane first via a `wage_lane` batch.
- **Async payout webhook** (`events/handlers/razorpay-webhook.handler.ts`, ingress
  `POST /v1/payments/webhooks/:provider/payouts`) — closes the gap `PayoutService.execute` leaves when the
  gateway returns asynchronously ('processing'). RazorpayX later POSTs a signed callback:
  `payout.processed` → post the `payouts → gateway` ledger move + flip to `success` +
  `payments.payout_succeeded`; `payout.failed/reversed` → REVERSE the reservation (`payouts → user main`,
  funds returned) + `payments.payout_failed`. Same trust model as the payment webhook: unauthenticated,
  HMAC over the raw body, tenant from the signature-verified `notes`. Idempotent on the gateway event id
  AND the wallet idempotency keys (`payout-exec:` / `payout-reverse:`) — a replay can never double-move money.
- **Monitoring + recon jobs** — live in **apps/worker** (PC-56 PAY-9; the copies that used to sit here were never
  scheduled by anything): `payout-queue-monitor` (every 5 min) gauges payouts the executor may claim that waited >15 min,
  and payouts 'processing' >2 h without a gateway confirmation; `payout-gateway-recon` (once per UTC day) records a
  `reconciliation_runs` row (`run_type='daily_gateway'`) listing reservation_missing / settled_without_gateway /
  stuck_processing (page) and unreserved_batch_payout (ticket — the known loan/co-op gap). Alerts:
  `ops/alerts/payout-alerts.yml`; runbook: `ops/runbooks/payout-stuck-or-mismatch.md`. Both move nothing.
- **`PaymentsPublisher`** — typed façade writing payout events to the outbox in the SAME tx (Law 4); payloads
  carry only ids + minor-unit amounts (no PII/bank details). **`WalletBalanceReadModel`** — replica-served
  (CQRS) withdrawable balance for the payout UI, anti-IDOR (one user can't read another's balance).
  Tests: `payout-batch.spec.ts` (entity + state machine) + `payout-batch.integration.spec.ts`
  (real Postgres: batch run + zero-sum ledger, wage-lane promotion flag-gated, async webhook
  confirm + forged-signature rejection, cross-tenant RLS denial).

## Deferred (flagged, not faked) — next wave, each its own session
- **e-invoice IRN** (GSP integration) + **GSTIN capture** (KYC) — `irn`/`*_gstin` stay null until then.
- **per_km delivery** (needs a resolved delivery distance) + a dedicated **logistics/3PL payout**
  account (buyer delivery fee currently lands in platform fees).
- **Wallet-service gRPC extraction** (Phase-3 scale trigger) + **hot-account striping** (platform
  escrow/fees `shard_no` to remove lock contention at billions of ops) — see `apps/wallet-service/README.md`.
