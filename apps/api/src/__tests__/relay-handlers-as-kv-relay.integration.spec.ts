// apps/api/src/__tests__/relay-handlers-as-kv-relay.integration.spec.ts · PC-56 HOTFIX-2 — THE RELAY RUNS AS kv_relay. EVERY HANDLER MUST SURVIVE IT.
//
// WHY THIS GATE EXISTS. The outbox relay executes every registered handler INSIDE its own per-event transaction, on its own
// connection — in production that connection is `kv_relay` (app-config `assertProductionSecurity` refuses anything else). In dev
// and in every hand-built spec the relay fell back to DATABASE_URL (kv_app) or ran as the superuser, so a handler that read or
// wrote a table kv_relay holds no grant on passed every suite and died `42501` in production — quarantining its event and rolling
// back every OTHER handler of the same event with it (10a F-27, 10b F-29, 11c, then SWEEP F-1: no shipment and no trade invoice for
// any confirmed order; F-2: no settlement the day `commission_split` turns on). This spec closes the class for good:
//   (a) it boots the REAL AppModule (as the boot gate does) and reads EVERY (event type, handler) pair `OUTBOX_HANDLER_REGISTRY`
//       holds after `onModuleInit` — nothing hand-listed;
//   (b) for each pair it builds the minimal rows the handler needs (as the superuser fixture pool, or through the module's own
//       service as kv_app) and inserts ONE pending outbox event of its type for a seeded tenant;
//   (c) it dispatches that event through the REAL `OutboxDispatcher` on a pool that LOGS IN as `kv_relay` (no SET ROLE, no
//       superuser), with a registry holding exactly that one handler, so a failure is attributed to the handler that caused it;
//   (d) it asserts the event was PUBLISHED (not quarantined), no `42501` / `permission denied` was raised, and — for every case
//       declared depth 'write' — that the handler actually reached its write (a fixture that silently no-ops proves nothing).
// A registered handler that is neither exercised here nor listed in SKIP with a reason FAILS the gate: a new handler must opt in.
//
// Run it in band for determinism (`--runInBand`): the dispatch claims ITS event by id (`relayById`), so it never drains another
// spec's queue, but the feature-flag rows it allow-lists for its own tenant are shared.
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { makeTenant, makeUser, ensureUnitCurrency, ListingFixture } from '../../test/helpers/fixtures';
import { OUTBOX_HANDLER_REGISTRY, OutboxHandler } from '../core/outbox/event-envelope';
import { OutboxDispatcher, OutboxHandlerRegistry, RelayOutcome } from '../core/outbox/outbox.dispatcher';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort } from '../core/wallet/wallet.port';
import { platform, PlatformAccount } from '../core/wallet/account-codes';
import { uuidv7 } from '../core/database/uuid.util';
import { WEBHOOK_CATALOGUE } from '../modules/tenant-webhooks/domain/webhook-catalog';
import { PARTNER_WEBHOOK_EVENTS } from '../modules/partner-api/domain/partner-webhook.rules';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const SRC = path.join(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Handler identity: `<path under src, no .ts>#<Class>` — three classes are called OrderCompletedHandler, two DisputeResolvedHandler.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function handlerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') out.push(...handlerFiles(p)); }
    else if (/handler\.ts$/.test(e.name) || /-fanout\.handler\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}
function identityIndex(): Map<Function, string> {
  const idx = new Map<Function, string>();
  for (const f of [...handlerFiles(path.join(SRC, 'modules')), ...handlerFiles(path.join(SRC, 'core'))]) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(f) as Record<string, unknown>;
    for (const [name, v] of Object.entries(mod)) if (typeof v === 'function') idx.set(v as Function, `${path.relative(SRC, f).replace(/\.ts$/, '')}#${name}`);
  }
  return idx;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The gate's contract.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Built {
  aggregateType: string; aggregateId: string; payload: Record<string, unknown>;
  /** Proves the handler reached its write (depth 'write'); receives the relayed outbox event id. Throws (expect) when it did
   *  not. May return 'read' when the handler legitimately had nothing to write for this event (counted as read depth). */
  verify?: (eventId: string) => Promise<void | 'read'>;
}
interface Case {
  /** 'write' = the fixture drives the handler to its table write(s) and `verify` proves it; 'read' = the handler's first table
   *  read(s) run as kv_relay but the fixture does not reach a write; 'none' = the handler touches no table on the relay tx. */
  depth: 'write' | 'read' | 'none';
  build: (w: World, eventType: string, handler: OutboxHandler) => Promise<Built>;
}
interface World {
  app: INestApplication; admin: Pool; uow: UnitOfWork; wallet: WalletPort;
  tenant: string; buyer: string; seller: string; ambassador: string; listing: ListingFixture;
  disputeReasonId: string;
}

/** Registered handlers this wave could not build a fixture for — each with the reason. The gate FAILS on a stale entry. */
const SKIP: Record<string, string> = {};

/** A published listing (category + product + listing). Not `makePublishedListing`: its `makeCategory` reuses $2 as text and
 *  ltree in one statement ("inconsistent types deduced for parameter $2", the pre-existing fixture bug named in 11d). */
async function makeListing(admin: Pool, tenantId: string, sellerId: string): Promise<ListingFixture> {
  await ensureUnitCurrency(admin, 'quintal');
  const categoryId = randomUUID(); const code = `g${randomUUID().replace(/-/g, '').slice(0, 14)}`;
  await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1,$2,'Wheat',$3::ltree,1,true)`, [categoryId, code, code]);
  const productId = randomUUID();
  await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv) VALUES ($1,$2,'Wheat','quintal',$3,true, to_tsvector('simple','wheat'))`, [productId, categoryId, tenantId]);
  const id = randomUUID();
  await admin.query(
    `INSERT INTO listings (id, tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code, price_minor, currency_code, status, visibility)
     VALUES ($1,$2,$3,$4,$5,'Wheat',100,100,1,'quintal',50000,'INR','published','public')`, [id, tenantId, sellerId, productId, categoryId]);
  return { id, tenantId, sellerId, productId, categoryId };
}

const q1 = async (w: World, sql: string, p: unknown[] = []) => (await w.admin.query(sql, p)).rows[0];
const count = async (w: World, sql: string, p: unknown[] = []) => Number((await w.admin.query(sql, p)).rows[0].n);

/** A minimal order row (+ its one line) in the gate tenant, as checkout/payment leaves it. */
async function makeOrder(w: World, status: string, o: { total?: bigint; subtotal?: bigint; offerId?: string | null; auctionId?: string | null; source?: string } = {}): Promise<string> {
  const id = uuidv7();   // orders is partitioned and its repository prunes on uuid_v7_time(id) (Law 8) — a v4 id is never found
  const total = o.total ?? 452000n; const subtotal = o.subtotal ?? 400000n;
  await w.admin.query(
    `INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, source, currency_code, subtotal_minor, delivery_fee_minor, platform_fee_minor, total_minor, status, version, offer_id, auction_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'INR',$7,$8,$9,$10,$11,1,$12,$13, uuid_v7_time($1))`,
    [id, w.tenant, `KVG-${id.slice(0, 12)}`, w.buyer, w.seller, o.source ?? 'direct', subtotal.toString(), ((total - subtotal) / 2n + (total - subtotal) % 2n).toString(), ((total - subtotal) / 2n).toString(), total.toString(), status, o.offerId ?? null, o.auctionId ?? null]);
  await w.admin.query(
    `INSERT INTO order_items (order_id, order_created_at, tenant_id, listing_id, product_id, title_snapshot, quantity, unit_code, unit_price_minor, line_total_minor)
     SELECT $1, o.created_at, $2, $3, $4, 'Wheat', 8, 'quintal', $5, $6 FROM orders o WHERE o.id=$1`,
    [id, w.tenant, w.listing.id, w.listing.productId, (subtotal / 8n).toString(), subtotal.toString()]);
  return id;
}
/** The buyer's money in platform escrow (checkout + gateway capture), through the app's own wallet as kv_app. */
async function fundEscrow(w: World, orderId: string, total: bigint): Promise<void> {
  await w.uow.run(w.tenant, (tx) => w.wallet.post(tx, { tenantId: w.tenant, txnType: 'order_payment', idempotencyKey: `gate-fund:${orderId}`, initiatedBy: 'system',
    legs: [{ account: platform(PlatformAccount.Escrow), amountMinor: total }, { account: platform(PlatformAccount.Gateway), amountMinor: -total }] }), { userId: 'system' });
}
/** A captured gateway payment row for an order (what a dispute/return refund reverses). */
async function makePayment(w: World, orderId: string, amount: bigint): Promise<string> {
  const id = randomUUID();
  await w.admin.query(
    `INSERT INTO payments (id, tenant_id, user_id, purpose_id, reference_type, reference_id, amount_minor, currency_code, status, provider_code, idempotency_key)
     SELECT $1, $2, $3, lv.id, 'order', $4, $5, 'INR', 'success', 'sandbox', $6 FROM lookup_values lv
      WHERE lv.type_code='payment_purpose' AND lv.tenant_id IS NULL ORDER BY (lv.code='order') DESC, lv.id LIMIT 1`,
    [id, w.tenant, w.buyer, orderId, amount.toString(), `gate-pay-${id}`]);
  return id;
}
const orderPayload = (w: World, orderId: string, extra: Record<string, unknown> = {}) => ({
  v: 1, orderId, buyerUserId: w.buyer, sellerUserId: w.seller, totalMinor: '452000', subtotalMinor: '400000', deliveryFeeMinor: '26000', platformFeeMinor: '26000',
  discountMinor: '0', categoryId: w.listing.categoryId, countryCode: 'IN', source: 'direct', ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The cases. Exact keys `<eventType> → <identity>`; class-wide keys `* → <identity>` (one class registered per event type).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const CASES: Record<string, Case> = {
  // ── logistics ──
  'orders.order_confirmed → modules/logistics/events/handlers/order-confirmed.handler#OrderConfirmedHandler': {
    depth: 'write',
    build: async (w) => {
      const orderId = await makeOrder(w, 'confirmed');
      return { aggregateType: 'order', aggregateId: orderId, payload: orderPayload(w, orderId),
        verify: async () => expect(await count(w, `SELECT count(*) n FROM shipments WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId])).toBe(1) };
    },
  },
  // ── payments ──
  'orders.order_confirmed → modules/payments/events/handlers/order-confirmed-invoice.handler#OrderConfirmedInvoiceHandler': {
    depth: 'write',
    build: async (w) => {
      const orderId = await makeOrder(w, 'confirmed');
      return { aggregateType: 'order', aggregateId: orderId, payload: orderPayload(w, orderId),
        verify: async () => expect(await count(w, `SELECT count(*) n FROM trade_invoices WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId])).toBe(1) };
    },
  },
  'orders.order_completed → modules/payments/events/handlers/trade-invoice.handler#TradeInvoiceHandler': {
    depth: 'write',
    build: async (w) => {
      const orderId = await makeOrder(w, 'completed');
      return { aggregateType: 'order', aggregateId: orderId, payload: orderPayload(w, orderId),
        verify: async () => expect(await count(w, `SELECT count(*) n FROM trade_invoices WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId])).toBe(1) };
    },
  },
  'orders.order_completed → modules/payments/events/handlers/order-completed.handler#OrderCompletedHandler': {
    depth: 'write',   // commission_split ON for the gate tenant: the split path (rule lookup) runs
    build: async (w) => {
      const orderId = await makeOrder(w, 'completed');
      await fundEscrow(w, orderId, 452000n);
      return { aggregateType: 'order', aggregateId: orderId, payload: orderPayload(w, orderId),
        verify: async () => {
          expect(await count(w, `SELECT count(*) n FROM ledger_transactions WHERE idempotency_key=$1`, [`settle:${orderId}`])).toBe(1);
          const line = await q1(w, `SELECT commission_minor::text c, gst_minor::text g FROM settlement_lines WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId]);
          expect(line).toBeDefined();
          expect(BigInt(line.c)).toBeGreaterThan(0n);   // the split ran: a commission was priced from commission_rules
        } };
    },
  },
  // PC-56 TENANT-SW-a · the last settlement hold of an order released (a flagged POD approved / a COD shortfall paid): the completion that
  // arrived while it was held is settled now, through the SAME settle:<order> key — the deferral and the hold rows are read as kv_app.
  'payments.settlement_hold_released → modules/payments/events/handlers/settlement-hold-released.handler#SettlementHoldReleasedHandler': {
    depth: 'write',
    build: async (w) => {
      const orderId = await makeOrder(w, 'completed');
      await fundEscrow(w, orderId, 452000n);
      // the completion met an open POD hold (deferred, nothing settled); the hold has since been released
      const holdId = randomUUID();
      await w.admin.query(`INSERT INTO settlement_holds (tenant_id, order_id, reason, source_id, released_at, release_note) VALUES ($1,$2,'pod_review',$3, now(), 'POD approved on review')`, [w.tenant, orderId, holdId]);
      await w.admin.query(`INSERT INTO settlement_deferrals (tenant_id, order_id, payload) VALUES ($1,$2,$3::jsonb)`, [w.tenant, orderId, JSON.stringify(orderPayload(w, orderId))]);
      return { aggregateType: 'order', aggregateId: orderId, payload: { v: 1, orderId, reason: 'pod_review', sourceId: holdId },
        verify: async () => {
          expect(await count(w, `SELECT count(*) n FROM ledger_transactions WHERE idempotency_key=$1`, [`settle:${orderId}`])).toBe(1);
          expect((await q1(w, `SELECT settled_at FROM settlement_deferrals WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId])).settled_at).not.toBeNull();
        } };
    },
  },
  'disputes.dispute_resolved → modules/payments/events/handlers/dispute-resolved.handler#DisputeResolvedHandler': {
    depth: 'write',   // dispute_refunds + commission_split ON: payment read, partial refund, the kept remainder priced
    build: async (w) => {
      const orderId = await makeOrder(w, 'disputed');
      await fundEscrow(w, orderId, 452000n);
      await makePayment(w, orderId, 452000n);
      const disputeId = randomUUID();
      // `source` is set so the remainder finds the platform's `direct` rule. The production payload (dispute.entity.ts:91) carries
      // NO source and NO category — with commission_split ON a partial refund then throws NO_COMMISSION_RULE (a pricing defect,
      // not a privilege one; named in the HOTFIX-2 report as an open finding, not fixed here).
      return { aggregateType: 'dispute', aggregateId: disputeId,
        payload: { v: 1, disputeId, orderId, resolutionType: 'refund_partial', resolutionAmountMinor: '100000', raisedBy: w.buyer, againstUser: w.seller, categoryId: w.listing.categoryId, source: 'direct' },
        verify: async () => {
          expect(await count(w, `SELECT count(*) n FROM ledger_transactions WHERE idempotency_key=$1`, [`dispute-refund:${disputeId}`])).toBe(1);
          expect(BigInt((await q1(w, `SELECT commission_minor::text c FROM settlement_lines WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId])).c)).toBeGreaterThan(0n);
        } };
    },
  },
  'disputes.return_refunded → modules/payments/events/handlers/return-refunded.handler#ReturnRefundedHandler': {
    depth: 'write',
    build: async (w) => {
      const orderId = await makeOrder(w, 'completed');
      await fundEscrow(w, orderId, 452000n);
      await makePayment(w, orderId, 452000n);
      const returnId = randomUUID();
      // `source` set for the same reason as the dispute case: the production return_refunded payload carries none.
      return { aggregateType: 'return', aggregateId: returnId,
        payload: { v: 1, returnId, orderId, refundAmountMinor: '100000', sellerUserId: w.seller, categoryId: w.listing.categoryId, source: 'direct' },
        verify: async () => expect(await count(w, `SELECT count(*) n FROM ledger_transactions WHERE idempotency_key=$1`, [`return-refund:${returnId}`])).toBe(1) };
    },
  },
  // PC-56 TENANT-SW-b · F-11 — `labour.wages_paid → BookingClockedOutHandler` is RETIRED (unregistered: it promoted `payouts` rows nothing
  // writes; wages are wallet legs paid by the daily 18:00 IST wage run). Its case is removed with it — a case for an unregistered handler is stale.

  // ── orders ──
  'payments.payment_succeeded → modules/orders/events/handlers/payment-succeeded.handler#PaymentSucceededHandler': {
    depth: 'write',
    build: async (w) => {
      const orderId = await makeOrder(w, 'payment_pending');
      return { aggregateType: 'payment', aggregateId: randomUUID(), payload: { v: 1, referenceType: 'order', referenceId: orderId, buyerUserId: w.buyer, amountMinor: '452000' },
        verify: async () => expect((await q1(w, `SELECT status FROM orders WHERE id=$1`, [orderId])).status).toBe('confirmed') };
    },
  },
  'offers.offer_accepted → modules/orders/events/handlers/offer-accepted.handler#OfferAcceptedHandler': {
    depth: 'write',
    build: async (w) => {
      const offerId = randomUUID();
      return { aggregateType: 'listing_offer', aggregateId: offerId,
        payload: { v: 1, offerId, listingId: w.listing.id, buyerUserId: w.buyer, sellerUserId: w.seller, agreedPriceMinor: '48000', quantity: '2' },
        verify: async () => expect(await count(w, `SELECT count(*) n FROM orders WHERE tenant_id=$1 AND offer_id=$2`, [w.tenant, offerId])).toBe(1) };
    },
  },
  'requirements.quote_accepted → modules/orders/events/handlers/quote-accepted.handler#QuoteAcceptedHandler': {
    // The pre-11d payload (no responseId) — the branch that writes the order ON THE RELAY TX. The 11d branch (responseId) runs
    // entirely in kv_app's unit of work and is proven live by tenant11d-requirement-truth (A2/A6).
    depth: 'write',
    build: async (w) => {
      const requirementId = randomUUID();
      await w.admin.query(`INSERT INTO requirements (id, tenant_id, buyer_user_id, product_id, category_id, title, quantity, unit_code, status) VALUES ($1,$2,$3,$4,$5,'Wheat wanted',2,'quintal','open')`,
        [requirementId, w.tenant, w.buyer, w.listing.productId, w.listing.categoryId]);
      return { aggregateType: 'requirement', aggregateId: requirementId,
        payload: { v: 1, requirementId, buyerUserId: w.buyer, listingId: w.listing.id, quotedPriceMinor: '47000', quantity: '2', sellerUserId: w.seller },
        verify: async () => expect(await count(w, `SELECT count(*) n FROM orders WHERE tenant_id=$1 AND requirement_id=$2`, [w.tenant, requirementId])).toBe(1) };
    },
  },
  'logistics.shipment_delivered → modules/orders/events/handlers/shipment-delivered.handler#ShipmentDeliveredHandler': {
    depth: 'write',
    build: async (w) => {
      const orderId = await makeOrder(w, 'out_for_delivery');
      return { aggregateType: 'shipment', aggregateId: randomUUID(), payload: { v: 1, orderId, buyerUserId: w.buyer },
        verify: async () => expect((await q1(w, `SELECT status FROM orders WHERE id=$1`, [orderId])).status).toBe('delivered') };
    },
  },
  'disputes.dispute_opened → modules/orders/events/handlers/dispute-opened.handler#DisputeOpenedHandler': {
    depth: 'write',
    build: async (w) => {
      const orderId = await makeOrder(w, 'delivered');
      return { aggregateType: 'dispute', aggregateId: randomUUID(), payload: { v: 1, orderId, raisedBy: w.buyer, againstUser: w.seller },
        verify: async () => expect((await q1(w, `SELECT status FROM orders WHERE id=$1`, [orderId])).status).toBe('disputed') };
    },
  },
  'disputes.dispute_resolved → modules/orders/events/handlers/dispute-resolved.handler#DisputeResolvedHandler': {
    depth: 'write',
    build: async (w) => {
      const orderId = await makeOrder(w, 'disputed');
      return { aggregateType: 'dispute', aggregateId: randomUUID(), payload: { v: 1, orderId, resolutionType: 'rejected', raisedBy: w.buyer, againstUser: w.seller },
        verify: async () => expect((await q1(w, `SELECT status FROM orders WHERE id=$1`, [orderId])).status).toBe('completed') };
    },
  },
  'auctions.auction_won → modules/orders/events/handlers/auction-won.handler#AuctionWonHandler': {
    depth: 'write',
    build: async (w) => {
      const auctionId = randomUUID();
      await w.admin.query(
        `INSERT INTO auctions (id, tenant_id, listing_id, start_price_minor, starts_at, ends_at, status, quantity, unit_code, auction_no)
         VALUES ($1,$2,$3,40000, now() - interval '2 hours', now() - interval '1 hour', 'ended', 2, 'quintal', $4)`, [auctionId, w.tenant, w.listing.id, `AUC-${auctionId.slice(0, 10)}`]);
      return { aggregateType: 'auction', aggregateId: auctionId,
        payload: { v: 1, auctionId, listingId: w.listing.id, bidderUserId: w.buyer, unitPriceMinor: '45000', quantity: '2', unitCode: 'quintal' },
        verify: async () => expect(await count(w, `SELECT count(*) n FROM orders WHERE tenant_id=$1 AND auction_id=$2`, [w.tenant, auctionId])).toBe(1) };
    },
  },

  // ── ambassadors ──
  'orders.order_completed → modules/ambassadors/events/handlers/order-completed.handler#OrderCompletedHandler': {
    depth: 'write',   // the seller was referred by an active ambassador (world): the sale commission accrues
    build: async (w) => {
      const orderId = await makeOrder(w, 'completed');
      return { aggregateType: 'order', aggregateId: orderId, payload: orderPayload(w, orderId),
        verify: async () => expect(await count(w, `SELECT count(*) n FROM ambassador_earnings WHERE tenant_id=$1 AND reference_id=$2 AND event_code='first_sale_facilitated'`, [w.tenant, orderId])).toBe(1) };
    },
  },

  // ── reviews / disputes eligibility ──
  'orders.order_completed → modules/reviews/events/handlers/order-completed.handler#OrderCompletedHandler': {
    depth: 'write',
    build: async (w) => {
      const orderId = await makeOrder(w, 'completed');
      return { aggregateType: 'order', aggregateId: orderId, payload: orderPayload(w, orderId),
        verify: async () => expect(await count(w, `SELECT count(*) n FROM review_eligibility WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId])).toBeGreaterThan(0) };
    },
  },
  'services.booking_completed → modules/reviews/events/handlers/booking-completed.handler#BookingCompletedHandler': {
    depth: 'write',
    build: async (w) => {
      const bookingId = randomUUID();
      return { aggregateType: 'service_booking', aggregateId: bookingId, payload: { v: 1, bookingId, customerUserId: w.buyer, providerUserId: w.seller },
        verify: async () => expect(await count(w, `SELECT count(*) n FROM review_eligibility WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, bookingId])).toBeGreaterThan(0) };
    },
  },
  'orders.order_delivered → modules/disputes/events/handlers/order-delivered.handler#OrderDeliveredHandler': {
    depth: 'write',
    build: async (w) => {
      const orderId = await makeOrder(w, 'delivered');
      return { aggregateType: 'order', aggregateId: orderId, payload: { v: 1, orderId, buyerUserId: w.buyer, sellerUserId: w.seller },
        verify: async () => expect(await count(w, `SELECT count(*) n FROM dispute_eligibility WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId])).toBeGreaterThan(0) };
    },
  },
  'payments.dispute_refunded → modules/disputes/events/handlers/dispute-refunded.handler#DisputeRefundedHandler': {
    depth: 'write',
    build: async (w) => {
      const orderId = await makeOrder(w, 'refunded'); const disputeId = randomUUID(); const txnId = randomUUID();
      await w.admin.query(`INSERT INTO disputes (id, tenant_id, order_id, raised_by, against_user, reason_id, status, resolution_type) VALUES ($1,$2,$3,$4,$5,$6,'resolved','refund_full')`,
        [disputeId, w.tenant, orderId, w.buyer, w.seller, w.disputeReasonId]);
      return { aggregateType: 'dispute', aggregateId: disputeId, payload: { v: 1, disputeId, txnId, refundedMinor: '452000', buyerUserId: w.buyer },
        verify: async () => expect((await q1(w, `SELECT resolution_txn_id FROM disputes WHERE id=$1`, [disputeId])).resolution_txn_id).toBe(txnId) };
    },
  },
  'payments.return_refunded → modules/disputes/events/handlers/return-refunded-stamp.handler#ReturnRefundedStampHandler': {
    depth: 'write',
    build: async (w) => {
      const orderId = await makeOrder(w, 'completed'); const returnId = randomUUID(); const txnId = randomUUID();
      await w.admin.query(`INSERT INTO returns (id, tenant_id, order_id, status, refund_amount_minor) VALUES ($1,$2,$3,'received',100000)`, [returnId, w.tenant, orderId]);
      return { aggregateType: 'return', aggregateId: returnId, payload: { v: 1, returnId, orderId, txnId, refundedMinor: '100000' },
        verify: async () => expect((await q1(w, `SELECT refund_txn_id FROM returns WHERE id=$1`, [returnId])).refund_txn_id).toBe(txnId) };
    },
  },

  // ── promotions (each runs in kv_app's unit of work through CouponRedemptionService; the relay tx is not used) ──
  'orders.order_created → modules/promotions/events/handlers/order-created.handler#OrderCreatedHandler': {
    depth: 'read',   // a code the tenant does not hold → nothing to record (the reservation path is proven by tenant10b A1 / F-29)
    build: async (w) => { const orderId = await makeOrder(w, 'created'); return { aggregateType: 'order', aggregateId: orderId, payload: { ...orderPayload(w, orderId), couponCode: 'NOSUCHCODE', discountMinor: '5000' } }; },
  },
  'orders.order_cancelled → modules/promotions/events/handlers/order-closed.handler#OrderClosedHandler': {
    depth: 'read',
    build: async (w) => { const orderId = await makeOrder(w, 'cancelled'); return { aggregateType: 'order', aggregateId: orderId, payload: orderPayload(w, orderId) }; },
  },
  'orders.order_refunded → modules/promotions/events/handlers/order-closed.handler#OrderClosedHandler': {
    depth: 'read',
    build: async (w) => { const orderId = await makeOrder(w, 'refunded'); return { aggregateType: 'order', aggregateId: orderId, payload: orderPayload(w, orderId) }; },
  },

  // ── auctions (kv_app unit of work inside AuctionService; the relay tx is not used) ──
  'payments.payment_succeeded → modules/auctions/events/handlers/payment-succeeded.handler#AuctionPaymentSucceededHandler': {
    depth: 'read',
    build: async (w) => { const orderId = await makeOrder(w, 'confirmed'); return { aggregateType: 'payment', aggregateId: randomUUID(), payload: { v: 1, referenceType: 'order', referenceId: orderId } }; },
  },
  'orders.order_cancelled → modules/auctions/events/handlers/order-cancelled.handler#AuctionOrderCancelledHandler': {
    depth: 'read',
    build: async (w) => { const orderId = await makeOrder(w, 'cancelled'); return { aggregateType: 'order', aggregateId: orderId, payload: { ...orderPayload(w, orderId), role: 'buyer' } }; },
  },

  // ── group lots ──
  'orders.order_completed → modules/group-lots/events/handlers/order-completed.handler#GroupLotOrderCompletedHandler': {
    depth: 'read',   // an ordinary order (no group-lot listing): the order-line read runs in kv_app; nothing is enqueued (the lot path: tenant11c A2)
    build: async (w) => { const orderId = await makeOrder(w, 'completed'); return { aggregateType: 'order', aggregateId: orderId, payload: orderPayload(w, orderId) }; },
  },
  'group_lot.sale_settled → modules/group-lots/events/handlers/sale-settled.handler#GroupLotSaleSettledHandler': {
    depth: 'read',   // a lot id that does not exist → 'unrecorded' (kv_app unit of work; the sold path: tenant11c A2)
    build: async (w) => { const lotId = randomUUID(); return { aggregateType: 'group_lot', aggregateId: lotId, payload: { v: 1, groupLotId: lotId, orderId: await makeOrder(w, 'completed') } }; },
  },

  // ── requirements ──
  'listing.published → modules/requirements/events/handlers/listing-published.handler#ListingPublishedHandler': {
    depth: 'write',
    build: async (w) => {
      const requirementId = randomUUID();
      await w.admin.query(`INSERT INTO requirements (id, tenant_id, buyer_user_id, product_id, category_id, title, quantity, unit_code, status) VALUES ($1,$2,$3,$4,$5,'Wheat wanted',2,'quintal','open')`,
        [requirementId, w.tenant, w.buyer, w.listing.productId, w.listing.categoryId]);
      return { aggregateType: 'listing', aggregateId: w.listing.id, payload: { v: 1, listingId: w.listing.id, productId: w.listing.productId, categoryId: w.listing.categoryId, sellerUserId: w.seller },
        verify: async () => expect(await count(w, `SELECT count(*) n FROM outbox_events WHERE aggregate_id=$1 AND event_type='requirements.requirement_matched'`, [requirementId])).toBeGreaterThan(0) };
    },
  },

  // ── offers ──
  'orders.order_from_offer_created → modules/offers/events/handlers/order-from-offer-created.handler#OrderFromOfferCreatedHandler': {
    depth: 'write',
    build: async (w) => {
      const offerId = randomUUID();
      await w.admin.query(`INSERT INTO listing_offers (id, tenant_id, listing_id, buyer_user_id, quantity, offered_price_minor, status, expires_at) VALUES ($1,$2,$3,$4,2,48000,'accepted', now() + interval '1 day')`,
        [offerId, w.tenant, w.listing.id, w.buyer]);
      const orderId = await makeOrder(w, 'created', { offerId, source: 'offer' });
      return { aggregateType: 'order', aggregateId: orderId, payload: { v: 1, orderId, offerId },
        verify: async () => expect(await q1(w, `SELECT status, converted_order_id FROM listing_offers WHERE id=$1`, [offerId])).toEqual({ status: 'converted', converted_order_id: orderId }) };
    },
  },

  // ── memberships ──
  'payments.payment_succeeded → modules/memberships/events/handlers/payment-succeeded.handler#MembershipPaymentSucceededHandler': {
    depth: 'write',
    build: async (w) => {
      const tierId = randomUUID(); const membershipId = randomUUID();
      await w.admin.query(`INSERT INTO membership_tiers (id, tenant_id, code, default_name, monthly_fee_minor, currency_code) VALUES ($1,$2,$3,'Gold',9900,'INR')`, [tierId, w.tenant, `gold${tierId.slice(0, 6)}`]);
      await w.admin.query(`INSERT INTO user_memberships (id, tenant_id, user_id, tier_id, status) VALUES ($1,$2,$3,$4,'past_due')`, [membershipId, w.tenant, w.buyer, tierId]);
      const paymentId = randomUUID();
      await w.admin.query(
        `INSERT INTO payments (id, tenant_id, user_id, purpose_id, reference_type, reference_id, amount_minor, currency_code, status, provider_code, idempotency_key)
         SELECT $1, $2, $3, lv.id, 'membership', $4, 9900, 'INR', 'success', 'sandbox', $5 FROM lookup_values lv WHERE lv.type_code='payment_purpose' AND lv.tenant_id IS NULL ORDER BY lv.id LIMIT 1`,
        [paymentId, w.tenant, w.buyer, membershipId, `gate-mem-${paymentId}`]);
      return { aggregateType: 'payment', aggregateId: paymentId, payload: { v: 1, referenceType: 'membership', referenceId: membershipId, paymentId, buyerUserId: w.buyer },
        verify: async () => expect(await q1(w, `SELECT status, payment_id FROM user_memberships WHERE id=$1`, [membershipId])).toEqual({ status: 'active', payment_id: paymentId }) };
    },
  },

  // ── insurance ──
  'payments.payment_succeeded → modules/insurance/events/handlers/premium-payment-succeeded.handler#PremiumPaymentSucceededHandler': {
    depth: 'read',   // a policy id the tenant does not hold: the policy lock (SELECT … FOR UPDATE) runs; nothing to activate
    build: async () => ({ aggregateType: 'payment', aggregateId: randomUUID(), payload: { v: 1, referenceType: 'insurance_policy', referenceId: randomUUID(), paymentId: randomUUID(), amountMinor: '1200' } }),
  },
  'insurance.policy_proposed → modules/insurance/events/handlers/pmfby-policy-sync.handler#PmfbyPolicySyncHandler': {
    depth: 'read',   // pmfby_sync ON; a policy id the tenant does not hold → nothing to sync (the policy read is kv_app's)
    build: async () => { const id = randomUUID(); return { aggregateType: 'insurance_policy', aggregateId: id, payload: { v: 1, policyId: id, subjectType: 'crop_season' } }; },
  },
  'insurance.claim_survey_scheduled → modules/insurance/events/handlers/surveyor-dispatch.handler#SurveyorDispatchHandler': {
    depth: 'read',   // surveyor_dispatch ON; a claim id the tenant does not hold → nothing to dispatch (the claim read is kv_app's)
    build: async (w) => { const id = randomUUID(); return { aggregateType: 'insurance_claim', aggregateId: id, payload: { v: 1, claimId: id, surveyorUserId: w.seller } }; },
  },

  // ── tenancy (SaaS billing) ──
  'payments.payment_succeeded → modules/tenancy/events/handlers/payment-succeeded.handler#SaasInvoicePaymentHandler': {
    depth: 'read',   // an invoice id the tenant does not hold: the invoice lookup/lock runs as kv_relay; nothing to apply
    build: async (w) => ({ aggregateType: 'payment', aggregateId: randomUUID(), payload: { v: 1, referenceType: 'saas_invoice', referenceId: randomUUID(), amountMinor: '100000', paymentId: randomUUID(), payerUserId: w.buyer } }),
  },
  'tenancy.saas_invoice_paid → modules/tenancy/events/handlers/saas-invoice-paid.handler#SaasInvoicePaidHandler': {
    depth: 'read',   // a subscription id the tenant does not hold: the period roll's subscription read runs as kv_relay; nothing to roll
    build: async () => { const inv = randomUUID(); return { aggregateType: 'saas_invoice', aggregateId: inv, payload: { v: 1, invoiceId: inv, status: 'paid', subscriptionId: randomUUID(), periodTag: '2026-10' } }; },
  },

  // ── support ──
  'disputes.dispute_escalated → modules/support/events/handlers/dispute-escalated.handler#DisputeEscalatedHandler': {
    depth: 'write',
    build: async (w) => {
      const disputeId = randomUUID();
      const ticketNo = `DSP-${disputeId.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
      return { aggregateType: 'dispute', aggregateId: disputeId, payload: { v: 1, disputeId, raisedBy: w.buyer },
        verify: async () => expect(await count(w, `SELECT count(*) n FROM support_tickets WHERE ticket_no=$1`, [ticketNo])).toBe(1) };
    },
  },

  // ── communication ──
  'communication.broadcast_requested → modules/communication/events/handlers/broadcast-requested.handler#BroadcastRequestedHandler': {
    depth: 'write',   // a queued broadcast to the tenant's customers: claimed, fanned out (or refused by name), never left queued
    build: async (w) => {
      const id = randomUUID();
      // a broadcast is born a draft (DB-enforced); the send request queues it, as BroadcastService.requestSend does
      await w.admin.query(
        `INSERT INTO tenant_broadcasts (id, tenant_id, created_by_user_id, audience_role_code, title, body, status, channel)
         VALUES ($1,$2,$3,'customer','Mandi closed Friday','The mandi is closed this Friday.','draft','inapp')`, [id, w.tenant, w.seller]);
      await w.admin.query(`UPDATE tenant_broadcasts SET status='queued', send_requested_by=$2, send_requested_at=now(), queued_at=now() WHERE id=$1`, [id, w.ambassador]);
      return { aggregateType: 'tenant_broadcast', aggregateId: id, payload: { v: 1, broadcastId: id },
        verify: async () => expect(['sent', 'failed']).toContain((await q1(w, `SELECT status FROM tenant_broadcasts WHERE id=$1`, [id])).status) };
    },
  },
  '* → modules/communication/events/handlers/domain-event-fanout.handler#DomainEventFanoutHandler': {
    depth: 'write',   // every recipient key carries a real member; a catalogued event records ≥ 1 notification row for them
    build: async (w, eventType, handler) => {
      const entry = (handler as unknown as { entry: { eventCode: string; recipientKeys: string[] } }).entry;
      const payload: Record<string, unknown> = { v: 1, orderId: randomUUID(), title: 'Gate', body: 'Gate' };
      for (const k of entry.recipientKeys) payload[k] = /Ids$|recipients$/i.test(k) ? [w.buyer] : w.buyer;
      return { aggregateType: eventType.split('.')[0], aggregateId: randomUUID(), payload,
        verify: async (eventId) => {
          const catalogued = await count(w, `SELECT count(*) n FROM notification_events WHERE code=$1`, [entry.eventCode]);
          if (catalogued === 0) return 'read';   // an uncatalogued code is refused by design (fail-closed) — the read still ran
          // a notification row for THIS member and code, recorded no earlier than this very outbox event
          expect(await count(w, `SELECT count(*) n FROM notifications WHERE user_id=$1 AND event_code=$2 AND created_at >= (SELECT created_at FROM outbox_events WHERE id=$3)`,
            [w.buyer, entry.eventCode, eventId])).toBeGreaterThan(0);
        } };
    },
  },

  // ── identity (PC-56 TENANT-SW-c) ──
  'tenancy.staff_invited → modules/identity/events/handlers/staff-invited.handler#StaffInvitedHandler': {
    depth: 'write',   // a pending invite with a KEK-sealed token: the SMS leaves (noop sender) and the invite is marked sent, the sealed copy cleared
    build: async (w) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { sealEnvelope, resolveKek } = require('../core/secrets/secret-envelope') as typeof import('../core/secrets/secret-envelope');
      const id = randomUUID(); const token = randomUUID().replace(/-/g, '') + 'abcdefghijk';
      const c = await w.admin.connect();
      try {
        // the invite as TeamService writes it (fixture: triggers off for this one insert — the inviter-session rule is not this gate's subject)
        await c.query('BEGIN'); await c.query('SET LOCAL session_replication_role = replica');
        await c.query(
          `INSERT INTO staff_invites (id, tenant_id, phone, role_id, invited_by, language_code, channel, token_hash, token_sealed, expires_at)
           SELECT $1, $2, '+919812345678', r.id, $3, 'hi', 'sms', encode(sha256(convert_to($4, 'UTF8')), 'hex'), $5, now() + interval '7 days' FROM roles r WHERE r.code = 'tenant_staff'`,
          [id, w.tenant, w.seller, token, sealEnvelope(resolveKek('', false), token, `staff_invite:${id}`)]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
      return { aggregateType: 'staff_invite', aggregateId: id, payload: { v: 1, inviteId: id },
        verify: async () => expect(await q1(w, `SELECT sent_at IS NOT NULL AS sent, token_sealed IS NULL AS cleared FROM staff_invites WHERE id=$1`, [id])).toEqual({ sent: true, cleared: true }) };
    },
  },

  // ── tenancy (PC-56 TENANT-SW-d) ──
  'tenancy.setup_call_requested → modules/tenancy/events/handlers/setup-call-requested.handler#SetupCallRequestedHandler': {
    depth: 'write',   // a requested setup call: the admin realm's in-app notice is written (kv_app UoW) and the request stamped notified
    build: async (w) => {
      const id = randomUUID();
      await w.admin.query(
        `INSERT INTO setup_call_requests (id, tenant_id, requested_by, preferred_slot_start, preferred_slot_end, language_code, phone_masked)
         VALUES ($1, $2, $3, now() + interval '2 days', now() + interval '2 days 1 hour', 'gu', '••••4321')`, [id, w.tenant, w.seller]);
      return { aggregateType: 'setup_call_request', aggregateId: id, payload: { v: 1, requestId: id, requestedBy: w.seller, slotStart: '2026-10-12 10:30', slotEnd: '2026-10-12 11:30', language: 'gu' },
        verify: async () => {
          expect(await count(w, `SELECT count(*) n FROM platform_ops_notices WHERE kind='setup_call_requested' AND ref_id=$1`, [id])).toBe(1);
          expect(await q1(w, `SELECT ops_notified_at IS NOT NULL AS n FROM setup_call_requests WHERE id=$1`, [id])).toEqual({ n: true });
        } };
    },
  },

  // ── tenant webhooks ──
  '* → modules/tenant-webhooks/events/handlers/webhook-fanout.handler#WebhookFanoutHandler': {
    depth: 'write',   // the world's endpoint subscribes to every public name: one delivery per name, enqueued on the relay tx
    build: async (w, eventType) => ({ aggregateType: eventType.split('.')[0], aggregateId: randomUUID(), payload: { ...orderPayload(w, randomUUID()), listingId: w.listing.id },
      verify: async (eventId) => expect(await count(w, `SELECT count(*) n FROM webhook_deliveries WHERE tenant_id=$1 AND source_event_id=$2`, [w.tenant, eventId])).toBeGreaterThan(0) }),
  },

  // ── partner webhooks ──
  '* → modules/partner-api/events/handlers/partner-webhook-fanout.handler#PartnerWebhookFanoutHandler': {
    depth: 'read',   // an aggregate no partner owns: the ownership read (loans / insurance_policies / insurance_claims) runs; silence by design
    build: async (_w, eventType) => ({ aggregateType: PARTNER_WEBHOOK_EVENTS[eventType] ?? 'loan', aggregateId: randomUUID(), payload: { v: 1 } }),
  },

  // ── realtime ──
  '* → core/realtime/realtime-fanout.handler#RealtimeFanoutHandler': {
    depth: 'none',   // realtime_fanout ON; publishes non-PII messages to the (Noop) publisher — no table, never throws
    build: async (w, eventType) => ({ aggregateType: eventType.split('.')[0], aggregateId: randomUUID(), payload: orderPayload(w, randomUUID()) }),
  },
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
run('PC-56 HOTFIX-2 · every registered outbox handler runs as kv_relay through the real OutboxDispatcher (integration, real Postgres)', () => {
  let app: INestApplication; let admin: Pool; let relayPool: Pool; let w: World;
  let entries: Array<{ eventType: string; handler: OutboxHandler; id: string; key: string }> = [];
  const flagBackup: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = [];
  // PC-56 TENANT-SW-b: + the three module flags the wave's cadence jobs read per tenant (so the job sweeps below reach their table work)
  const GATE_FLAGS = ['commission_split', 'dispute_refunds', 'wage_priority_payout', 'realtime_fanout', 'pmfby_sync', 'surveyor_dispatch', 'ambassadors', 'labour', 'schemes'];

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    // The relay LOGS IN as kv_relay — exactly production's shape. Locally the role's password is 'dev' (db/local/local-login-roles.sql);
    // RELAY_TEST_DATABASE_URL overrides (a CI database whose kv_relay has another secret).
    let relayUrl = process.env.RELAY_TEST_DATABASE_URL;
    if (!relayUrl) {
      await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`);   // same statement as db/local/local-login-roles.sql
      const u = new URL(APP_URL as string); u.username = 'kv_relay'; u.password = 'dev'; relayUrl = u.toString();
    }
    relayPool = new Pool({ connectionString: relayUrl, max: 4, application_name: 'hotfix2-relay-gate' });
    const who = (await relayPool.query(`SELECT current_user AS u, (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS b`)).rows[0];
    expect(who).toEqual({ u: 'kv_relay', b: true });

    // world
    const tenant = randomUUID(); await makeTenant(admin, tenant, 'Relay Gate FPO');
    const [buyer, seller, ambassador] = [await makeUser(admin), await makeUser(admin), await makeUser(admin)];
    for (const [u, r] of [[buyer, 'customer'], [seller, 'farmer'], [ambassador, 'farmer']] as const) {
      await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code=$3 ON CONFLICT DO NOTHING`, [u, tenant, r]);
    }
    const listing = await makeListing(admin, tenant, seller);
    const disputeReasonId = (await admin.query(`SELECT id FROM lookup_values WHERE type_code='dispute_reason' AND tenant_id IS NULL ORDER BY id LIMIT 1`)).rows[0].id as string;
    // the seller was referred by an active ambassador (the sale-commission accrual has someone to pay)
    await admin.query(`INSERT INTO ambassador_profiles (user_id, tenant_id) VALUES ($1,$2)`, [ambassador, tenant]);
    await admin.query(`INSERT INTO referrals (tenant_id, referrer_user_id, referee_user_id, code, status) VALUES ($1,$2,$3,$4,'activated')`,
      [tenant, ambassador, seller, `G${randomUUID().replace(/-/g, '').slice(0, 7).toUpperCase()}`]);
    // one live tenant webhook endpoint subscribed to EVERY public name (the fan-out has somewhere to enqueue)
    await admin.query(
      `INSERT INTO webhook_endpoints (tenant_id, url, secret_enc, secret_hint, event_types, developer_email) VALUES ($1,'https://hooks.gate.example.com/k','v2.00000000.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb','bbb',$2::jsonb,'dev@gate.example.com')`,
      [tenant, JSON.stringify(WEBHOOK_CATALOGUE.map((c) => c.name))]);
    // flags: ON for the gate tenant only (allow-list), restored afterwards
    for (const key of GATE_FLAGS) {
      const row = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key=$1`, [key])).rows[0];
      if (!row) continue;
      flagBackup.push(row);
      const rules = row.is_enabled ? { ...(row.rules ?? {}), tenant_ids: [...((row.rules ?? {}).tenant_ids ?? []), tenant] } : { tenant_ids: [tenant] };
      await admin.query(`UPDATE feature_flags SET is_enabled=true, rollout_pct=$2, rules=$3::jsonb WHERE key=$1`, [key, row.is_enabled ? row.rollout_pct : 0, JSON.stringify(rules)]);
    }

    // the REAL AppModule, every onModuleInit run (that is where handlers register)
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'relay-gate-access-secret-relay-gate-32';
    process.env.AUTH_HASH_PEPPER = process.env.AUTH_HASH_PEPPER || 'relay-gate-hash-pepper-relay-gate-32b';
    process.env.SHARD_COUNT = process.env.SHARD_COUNT || '1';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../app.module') as typeof import('../app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    const registry = app.get<OutboxHandlerRegistry>(OUTBOX_HANDLER_REGISTRY);
    const ids = identityIndex();
    entries = registry.entries().map((e) => {
      const id = ids.get(e.handler.constructor) ?? `UNKNOWN#${e.handler.constructor.name}`;
      return { ...e, id, key: `${e.eventType} → ${id}` };
    });
    w = { app, admin, uow: app.get<UnitOfWork>(UNIT_OF_WORK), wallet: app.get<WalletPort>(WALLET_SERVICE), tenant, buyer, seller, ambassador, listing, disputeReasonId };
  }, 180_000);

  afterAll(async () => {
    // the handlers' own follow-on events (shipment_created, order_confirmed, offer_converted, …) were enqueued for the gate tenant;
    // close them so a neighbouring spec's relayBatch() never processes this spec's leftovers (the 11c afterAll does the same)
    if (w) await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id=$1`, [w.tenant]).catch(() => undefined);
    for (const f of flagBackup) await admin?.query(`UPDATE feature_flags SET is_enabled=$2, rollout_pct=$3, rules=$4::jsonb WHERE key=$1`, [f.key, f.is_enabled, f.rollout_pct, JSON.stringify(f.rules ?? {})]).catch(() => undefined);
    await app?.close().catch(() => undefined);
    await relayPool?.end().catch(() => undefined);
    await admin?.end().catch(() => undefined);
  });

  const caseFor = (e: { key: string; id: string }): Case | undefined => CASES[e.key] ?? CASES[`* → ${e.id}`];

  /** Insert ONE pending event and relay exactly it, as kv_relay, through the real dispatcher with the given registry. */
  async function relay(registry: OutboxHandlerRegistry, eventType: string, b: Built): Promise<RelayOutcome> {
    const id = (await admin.query(`INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id`,
      [w.tenant, b.aggregateType, b.aggregateId, eventType, JSON.stringify(b.payload)])).rows[0].id as string;
    const metrics = { inc: () => undefined, observe: () => undefined } as never;
    return new OutboxDispatcher(relayPool, registry, metrics).relayById(String(id));
  }
  const describeErr = (e: unknown) => { const x = e as { code?: string; message?: string }; return `${x?.code ?? ''} ${x?.message ?? String(e)}`.trim(); };

  it('enumerates the real registry: every registered handler is exercised here or SKIPped with a reason; no stale SKIP', () => {
    expect(entries.length).toBeGreaterThan(100);                                  // 152 at HOTFIX-2; a floor, so an empty boot cannot pass
    expect(entries.filter((e) => e.id.startsWith('UNKNOWN#')).map((e) => e.key)).toEqual([]);
    const uncovered = entries.filter((e) => !caseFor(e) && !(e.key in SKIP)).map((e) => e.key);
    expect(uncovered).toEqual([]);
    const keys = new Set(entries.map((e) => e.key));
    expect(Object.keys(SKIP).filter((k) => !keys.has(k))).toEqual([]);           // a SKIP for a handler that no longer exists is stale
    for (const [k, why] of Object.entries(SKIP)) { expect(caseFor({ key: k, id: k.split(' → ')[1] })).toBeUndefined(); expect(why.trim().length).toBeGreaterThan(20); }
    const declared = Object.keys(CASES).filter((k) => !k.startsWith('* → '));
    expect(declared.filter((k) => !keys.has(k))).toEqual([]);                     // a case for a handler that is not registered is stale
  });

  it('every exercised handler, alone, dispatched AS kv_relay: published, no 42501 / permission denied, and write-depth cases reached their write', async () => {
    const failures: string[] = [];
    const tally = { write: 0, read: 0, none: 0, skipped: 0 };
    const byModule = new Map<string, number>();
    for (const e of entries) {
      const c = caseFor(e);
      if (!c) { tally.skipped++; continue; }
      let built: Built;
      try { built = await c.build(w, e.eventType, e.handler); }
      catch (err) { failures.push(`${e.key} :: FIXTURE ${describeErr(err)}`); continue; }
      const one = new OutboxHandlerRegistry(); one.register(e.handler);
      const out = await relay(one, e.eventType, built);
      if (out.status !== 'published') {
        const why = out.status === 'failed' ? describeErr(out.error) : 'event was not pending when claimed';
        failures.push(`${e.key} :: ${out.status.toUpperCase()}${/42501|permission denied/i.test(why) ? ' [PERMISSION]' : ''} ${why}`);
        continue;
      }
      let depth = c.depth;
      if (c.depth === 'write') {
        if (!built.verify) { failures.push(`${e.key} :: declared depth 'write' with no verify`); continue; }
        try { if ((await built.verify(out.eventId)) === 'read') depth = 'read'; }
        catch (err) { failures.push(`${e.key} :: published but did NOT reach its write — ${describeErr(err).slice(0, 300)}`); continue; }
      }
      tally[depth]++;
      byModule.set(e.id.split('/')[1] ?? e.id, (byModule.get(e.id.split('/')[1] ?? e.id) ?? 0) + 1);
    }
    // eslint-disable-next-line no-console
    console.log(`[relay-gate] registered=${entries.length} exercised=${tally.write + tally.read + tally.none} (write=${tally.write} read=${tally.read} none=${tally.none}) skipped=${tally.skipped} byModule=${JSON.stringify(Object.fromEntries([...byModule].sort()))}`);
    expect(failures).toEqual([]);
  }, 600_000);
  it('the UoW route widened nothing: kv_relay still holds no privilege on the tables its handlers now reach through kv_app; 0195 is SELECT-only', async () => {
    const priv = async (t: string, p: string) => (await admin.query(`SELECT has_table_privilege('kv_relay', $1, $2) AS v`, [t, p])).rows[0].v as boolean;
    // PC-56 TENANT-SW-a: the new money / review tables are reached through kv_app only — the relay holds nothing on them either
    for (const t of ['shipments', 'trade_invoices', 'commission_rules', 'tax_rules', 'payments', 'user_memberships', 'listing_offers', 'loans',
      'settlement_holds', 'settlement_deferrals', 'pod_reviews', 'cod_collections', 'cod_shortfalls', 'cod_cash_days', 'commission_rule_proposals', 'delivery_zone_proposals',
      // PC-56 TENANT-SW-b (0198): the ambassador run, the wage run, advances and the eligibility sweep — kv_app only
      'ambassador_payout_runs', 'ambassador_payout_run_lines', 'ambassador_stipend_payments', 'labour_wage_runs', 'labour_wage_run_lines', 'worker_advances',
      'worker_advance_recoveries', 'scheme_eligibility_sweeps', 'scheme_eligibility_sweep_rows',
      // PC-56 TENANT-SW-c (0199): claims, conflicts, invites, 2FA, per-tenant session cut-offs, override proposals — kv_app only
      'kyc_claims', 'staff_conflict_declarations', 'staff_invites', 'user_totp', 'user_recovery_codes', 'tenant_session_revocations', 'staff_override_proposals',
      // PC-56 TENANT-SW-d (0200): drafts, setup calls, the ops queue, AGM packs + sections, register imports + lines — kv_app only
      'tenant_onboarding_drafts', 'setup_call_requests', 'platform_ops_notices', 'agm_packs', 'agm_pack_sections', 'share_register_imports', 'share_register_import_rows',
      // PC-56 TENANT-SW-e (0201): slot proposals, the Village Run, the parcel fee, the cold-chain store / keys / nonces / breaches / silences —
      // kv_app only (the breach and the fee are written by SECURITY DEFINER triggers, so the relay needs nothing on them either)
      'pickup_slot_proposals', 'route_drop_points', 'route_runs', 'parcel_handovers', 'parcel_handover_fees', 'cold_chain_thresholds', 'device_keys',
      'cold_chain_ingest_nonces', 'cold_chain_breaches', 'cold_chain_device_silences']) {
      for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) expect(`${t}:${p}:${await priv(t, p)}`).toBe(`${t}:${p}:false`);
    }
    expect(await priv('insurance_policies', 'UPDATE')).toBe(false);
    // the shipments partitions too (a grant on a partition would let the relay write around the parent)
    const parts = (await admin.query(`SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = 'shipments'::regclass`)).rows.map((r) => r.relname as string);
    expect(parts.length).toBeGreaterThan(0);
    for (const t of parts) expect(`${t}:${await priv(t, 'SELECT')}:${await priv(t, 'INSERT')}`).toBe(`${t}:false:false`);
    // the one grant: read-only
    expect(await priv('notification_template_versions', 'SELECT')).toBe(true);
    for (const p of ['INSERT', 'UPDATE', 'DELETE']) expect(await priv('notification_template_versions', p)).toBe(false);
  });

  // ── PC-56 TENANT-SW-a · D2: the wave's CADENCE JOBS run on the runner's kv_relay pool (as ScheduledJobsRunner hands it), reading only
  //    `tenants` there and doing every table act per tenant in kv_app's unit of work — proven by running each sweep on the relay pool. ──
  it('SW-a · the POD auto-clear clock and the proposal clock (commission rules + zones) sweep on the kv_relay pool without 42501', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PodAutoClearJob } = require('../modules/logistics/services/pod-review.service') as typeof import('../modules/logistics/services/pod-review.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SettingProposalsJob } = require('../modules/tenancy/jobs/setting-proposals.job') as typeof import('../modules/tenancy/jobs/setting-proposals.job');
    const pod = await app.get(PodAutoClearJob).sweep(relayPool);
    expect(pod.failed).toBe(0);
    const props = await app.get(SettingProposalsJob).sweep(relayPool);
    expect(props.failed).toBe(0);
  }, 120_000);

  // ── PC-56 TENANT-SW-b: the wave's three CADENCE JOBS run on the runner's kv_relay pool — the Thursday 23:00 IST ambassador-run preparer, the
  //    daily 18:00 IST wage run (+ its 16:00 retry pass) and the eligibility sweep — each reading only `tenants` there and doing every table act
  //    per tenant in kv_app's unit of work. Driven at an instant INSIDE each window, narrowed to the gate tenant (the world has an ambassador
  //    with an accrued commission, so the preparer reaches its insert). No 42501; the relay still holds nothing on the tables (test above). ──
  it('SW-b · the ambassador-run preparer, the wage run and the eligibility sweep sweep on the kv_relay pool without 42501', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AmbassadorPayoutRunJob } = require('../modules/ambassadors/jobs/payout-run.job') as typeof import('../modules/ambassadors/jobs/payout-run.job');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { WageRunJob } = require('../modules/labour/jobs/wage-run.job') as typeof import('../modules/labour/jobs/wage-run.job');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { EligibilitySweepJob } = require('../modules/schemes/jobs/eligibility-sweep.job') as typeof import('../modules/schemes/jobs/eligibility-sweep.job');
    // a Thursday 23:10 IST (17:40Z) next week; and 18:05 IST today
    const now = new Date(); const thu = new Date(now.getTime() + ((4 - now.getUTCDay() + 7) % 7 + 7) * 86_400_000);
    thu.setUTCHours(17, 40, 0, 0);
    const amb = await app.get(AmbassadorPayoutRunJob).sweep(relayPool, thu, [w.tenant]);
    expect(amb).toMatchObject({ inWindow: true, failed: 0, prepared: 1 });   // the world's ambassador has accrued commission: a run is prepared
    expect(await count(w, `SELECT count(*) n FROM ambassador_payout_runs WHERE tenant_id=$1 AND prepared_by IS NULL AND status='prepared'`, [w.tenant])).toBe(1);
    const ist1805 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 35));
    const wage = await app.get(WageRunJob).sweep(relayPool, ist1805, [w.tenant]);
    expect(wage.failed).toBe(0);
    const sweep = await app.get(EligibilitySweepJob).sweep(relayPool, now, [w.tenant]);
    expect(sweep.failed).toBe(0);
  }, 120_000);

  // ── PC-56 TENANT-SW-c: the take-next claim-expiry job sweeps on the kv_relay pool (tenants only), releasing per tenant in kv_app's UoW ──
  it('SW-c · the KYC claim-expiry job sweeps on the kv_relay pool without 42501', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { KycClaimsExpiryJob } = require('../modules/identity/jobs/kyc-claims-expiry.job') as typeof import('../modules/identity/jobs/kyc-claims-expiry.job');
    const out = await app.get(KycClaimsExpiryJob).sweep(relayPool, [w.tenant]);
    expect(out).toMatchObject({ tenants: 1, failed: 0 });
  }, 60_000);

  // ── PC-56 TENANT-SW-d: the AGM render job and the register-import apply job sweep on the kv_relay pool (tenants only) and work per tenant
  //    in kv_app's UoW; and `tenants` itself — the relay keeps SELECT (its sweeps), and holds no write on it any more (0200). ──
  it('SW-d · the AGM render and register-import apply jobs sweep on the kv_relay pool without 42501; kv_relay reads tenants and cannot write them', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AgmPackRenderJob } = require('../modules/memberships/jobs/agm-pack-render.job') as typeof import('../modules/memberships/jobs/agm-pack-render.job');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RegisterImportApplyJob } = require('../modules/memberships/jobs/register-import-apply.job') as typeof import('../modules/memberships/jobs/register-import-apply.job');
    expect(await app.get(AgmPackRenderJob).sweep(relayPool, [w.tenant])).toMatchObject({ tenants: 1, failed: 0 });
    expect(await app.get(RegisterImportApplyJob).sweep(relayPool, [w.tenant])).toMatchObject({ tenants: 1, failed: 0 });
    const priv = async (p: string) => (await admin.query(`SELECT has_table_privilege('kv_relay', 'tenants', $1) AS v`, [p])).rows[0].v as boolean;
    expect(await priv('SELECT')).toBe(true);
    for (const p of ['INSERT', 'UPDATE', 'DELETE']) expect(`${p}:${await priv(p)}`).toBe(`${p}:false`);
  }, 60_000);

  // ── PC-56 TENANT-SW-e: the cold-chain watch (silence > 15 min · buyer offer ≥ 15 min) and the slot-proposal expiry clock sweep on the kv_relay
  //    pool (tenants only) and work per tenant in kv_app's UoW. The world gets a registered logger with an active key that last spoke 20 minutes
  //    ago and a proposal 8 days old, so each sweep reaches its write: one silence flagged (once — a second sweep adds nothing), one expired. ──
  it('SW-e · the cold-chain watch and the slot-proposal expiry sweep on the kv_relay pool without 42501, and reach their writes', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ColdChainWatchJob, SlotProposalExpiryJob } = require('../modules/logistics/jobs/logistics-ops.jobs') as typeof import('../modules/logistics/jobs/logistics-ops.jobs');
    const deviceId = randomUUID(); const subjectId = randomUUID(); const proposalId = randomUUID();
    const c = await admin.connect();
    try {
      // fixtures as the services write them (triggers off for these inserts — the born-state rules are not this gate's subject)
      await c.query('BEGIN'); await c.query('SET LOCAL session_replication_role = replica');
      await c.query(`INSERT INTO twin_devices (id, tenant_id, kind_code, serial, status, registered_by, last_reading_at) VALUES ($1,$2,'cold_chain_logger',$3,'registered',$4, now() - interval '20 minutes')`, [deviceId, w.tenant, `GATE-${deviceId.slice(0, 8)}`, w.seller]);
      await c.query(`INSERT INTO device_keys (tenant_id, device_id, key_enc, key_hint, subject_type, subject_id, issued_by, issue_reason, status)
                     VALUES ($1,$2,'v2.gate','gate','vaccine_box',$3,$4,'relay gate logger key','active')`, [w.tenant, deviceId, subjectId, w.seller]);
      await c.query(`INSERT INTO pickup_slot_proposals (id, tenant_id, seller_user_id, proposed_by, slots, reason, status, created_at, expires_at)
                     VALUES ($1,$2,$3,$4,'[{"weekday":2,"start":"09:00","end":"11:00"}]'::jsonb,'relay gate proposal','proposed', now() - interval '8 days', now() - interval '1 day')`, [proposalId, w.tenant, w.seller, w.buyer]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    const watch = await app.get(ColdChainWatchJob).sweep(relayPool, [w.tenant]);
    expect(watch).toMatchObject({ tenants: 1, failed: 0 });
    expect(await count(w, `SELECT count(*) n FROM cold_chain_device_silences WHERE device_id=$1 AND resolved_at IS NULL`, [deviceId])).toBe(1);
    expect((await app.get(ColdChainWatchJob).sweep(relayPool, [w.tenant])).failed).toBe(0);
    expect(await count(w, `SELECT count(*) n FROM cold_chain_device_silences WHERE device_id=$1`, [deviceId])).toBe(1);   // flagged once
    const exp = await app.get(SlotProposalExpiryJob).sweep(relayPool, [w.tenant]);
    expect(exp).toMatchObject({ tenants: 1, failed: 0 });
    expect(await q1(w, `SELECT status FROM pickup_slot_proposals WHERE id=$1`, [proposalId])).toEqual({ status: 'expired' });
  }, 120_000);

  // ── B4 · END TO END: the REAL registry (every handler of the event, in boot order), the REAL dispatcher, LOGGED IN as kv_relay ──
  it('B4 · orders.order_confirmed through the FULL registry as kv_relay: published, ONE shipment AND ONE trade invoice; a redelivery adds nothing', async () => {
    const full = app.get<OutboxHandlerRegistry>(OUTBOX_HANDLER_REGISTRY);
    expect(full.handlersFor('orders.order_confirmed').length).toBeGreaterThanOrEqual(4);   // invoice, shipment, notification, realtime
    const orderId = await makeOrder(w, 'confirmed');
    const b: Built = { aggregateType: 'order', aggregateId: orderId, payload: orderPayload(w, orderId) };
    const out = await relay(full, 'orders.order_confirmed', b);
    expect(out.status === 'failed' ? describeErr(out.error) : out.status).toBe('published');
    expect(await count(w, `SELECT count(*) n FROM shipments WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId])).toBe(1);
    expect(await q1(w, `SELECT status FROM shipments WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId])).toEqual({ status: 'pending' });
    expect(await count(w, `SELECT count(*) n FROM trade_invoices WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId])).toBe(1);
    // the shipment's own event committed with it (kv_app's unit of work), not lost
    expect(await count(w, `SELECT count(*) n FROM outbox_events o JOIN shipments s ON s.id::text = o.aggregate_id::text WHERE s.order_id=$1 AND o.event_type='logistics.shipment_created'`, [orderId])).toBe(1);
    // at-least-once: the same event again moves nothing
    const again = await relay(full, 'orders.order_confirmed', b);
    expect(again.status).toBe('published');
    expect(await count(w, `SELECT count(*) n FROM shipments WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId])).toBe(1);
    expect(await count(w, `SELECT count(*) n FROM trade_invoices WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId])).toBe(1);
  }, 60_000);

  it('B4 · orders.order_completed through the FULL registry as kv_relay with commission_split ON: escrow → seller net + commission + GST + TDS (+ fees), the line, the ambassador accrual; a redelivery adds nothing', async () => {
    const full = app.get<OutboxHandlerRegistry>(OUTBOX_HANDLER_REGISTRY);
    expect(full.handlersFor('orders.order_completed').length).toBeGreaterThanOrEqual(7);
    const orderId = await makeOrder(w, 'completed');
    await fundEscrow(w, orderId, 452000n);
    const b: Built = { aggregateType: 'order', aggregateId: orderId, payload: orderPayload(w, orderId) };
    const out = await relay(full, 'orders.order_completed', b);
    expect(out.status === 'failed' ? describeErr(out.error) : out.status).toBe('published');
    const legs = (await admin.query(
      `SELECT wa.owner_kind, wa.account_code, le.amount_minor::text AS amt
         FROM ledger_transactions lt JOIN ledger_entries le ON le.txn_id = lt.id JOIN wallet_accounts wa ON wa.id = le.account_id
        WHERE lt.idempotency_key = $1 ORDER BY wa.owner_kind, wa.account_code`, [`settle:${orderId}`])).rows as Array<{ owner_kind: string; account_code: string; amt: string }>;
    const sum = legs.reduce((a, l) => a + BigInt(l.amt), 0n);
    expect(sum).toBe(0n);                                                          // zero-sum
    const leg = (code: string) => legs.filter((l) => l.account_code === code).reduce((a, l) => a + BigInt(l.amt), 0n);
    expect(leg('escrow')).toBe(-452000n);                                          // the whole escrow released
    expect(leg('gst_payable')).toBeGreaterThan(0n);                               // GST on the commission
    const line = await q1(w, `SELECT gross_minor::text g, commission_minor::text c, gst_minor::text gst, tds_minor::text tds, net_minor::text n, platform_fees_minor::text f FROM settlement_lines WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId]);
    expect(line.g).toBe('400000');                                                 // settles on the goods, not the buyer charges
    expect(BigInt(line.c)).toBeGreaterThan(0n);                                    // commission priced from commission_rules (as kv_app)
    expect(BigInt(line.gst)).toBe(leg('gst_payable'));
    expect(BigInt(line.n)).toBe(400000n - BigInt(line.c) - BigInt(line.gst) - BigInt(line.tds));   // the seller net is the residual
    // the other handlers of the same event committed with it
    expect(await count(w, `SELECT count(*) n FROM ambassador_earnings WHERE tenant_id=$1 AND reference_id=$2 AND event_code='first_sale_facilitated'`, [w.tenant, orderId])).toBe(1);
    expect(await count(w, `SELECT count(*) n FROM trade_invoices WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId])).toBe(1);
    expect(await count(w, `SELECT count(*) n FROM review_eligibility WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId])).toBeGreaterThan(0);
    // at-least-once
    const again = await relay(full, 'orders.order_completed', b);
    expect(again.status).toBe('published');
    expect(await count(w, `SELECT count(*) n FROM ledger_transactions WHERE idempotency_key=$1`, [`settle:${orderId}`])).toBe(1);
    expect(await count(w, `SELECT count(*) n FROM ambassador_earnings WHERE tenant_id=$1 AND reference_id=$2`, [w.tenant, orderId])).toBe(1);
    expect(await count(w, `SELECT count(*) n FROM trade_invoices WHERE tenant_id=$1 AND order_id=$2`, [w.tenant, orderId])).toBe(1);
  }, 60_000);
});
