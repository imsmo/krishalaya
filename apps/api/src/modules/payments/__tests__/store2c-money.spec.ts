// modules/payments/__tests__/store2c-money.spec.ts · PC-56 STORE-2c — THE MONEY WAVE, as unit tests against in-memory fakes (no Postgres):
//   B2 (founder D3) the automatic refund of a cancelled, paid order: ONE posting function, ZERO-SUM legs, key `refund:<orderId>`, the gateway asked
//      once, `refund_initiated → refunded`, a replay books nothing, an unpaid order books nothing, a wallet payment refunds to the wallet, the
//      moderator refund posts through the same function with byte-identical gateway legs, the webhook's `refund.processed` completes it;
//   B3 attempt-scoped intents: a second LIVE attempt refused PAYMENT_ATTEMPT_LIVE {paymentId, expiresAt}; after a failure a NEW attempt (new
//      gateway order, attempt 2); a lapsed attempt marked `expired` and its late capture still booked; the failure reason as a CODE;
//   B5 (founder D4) `per_km` refused by name at definition and REPORTED by name where it would be priced (never a bare 500, never priced 0).
// The live proofs are apps/api/src/__tests__/store2c-checkout.integration.spec.ts (2)–(9).
import { randomUUID } from 'node:crypto';
import { UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { Metrics } from '../../../core/observability/metrics';
import { WalletPort, PostTxnInput, PostTxnResult } from '../../../core/wallet/wallet.port';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { PaymentService } from '../services/payment.service';
import { PaymentRepository } from '../repositories/payment.repository';
import { GatewayRegistry } from '../gateway/gateway.registry';
import { SandboxGateway } from '../gateway/sandbox.gateway';
import { Payment } from '../domain/payment.entity';
import { canTransition } from '../domain/payment.state';
import { PaymentAttemptLiveError, RefundGatewayReferenceMissingError, ChargeMethodUnsupportedError } from '../domain/payments.errors';
import { attemptExpiresAt, chargedNothing, failureReasonCode, isLapsedAttempt, isLiveAttempt, FAILURE_REASON_CODES } from '../domain/payment-attempt';
import { validateChargeConfig } from '../domain/charge-change';
import { ProposeChargeSchema } from '../dto/charge-change.dto';
import { ChargePricingService } from '../services/charge-pricing.service';
import { ChargeDefinitionRepository } from '../repositories/charge-definition.repository';
import { OrderRepository } from '../../orders/repositories/order.repository';
import { Order } from '../../orders/domain/order.entity';
import { OrderItem } from '../../orders/domain/order-item.entity';
import { uuidv7 } from '../../../core/database/uuid.util';
import { OrderCancelledRefundHandler } from '../events/handlers/order-cancelled-refund.handler';

const SECRET = 'sandbox-secret';
const TENANT = 'tenant-s2c';
const AMOUNT = 452_000n;

class FakeTx implements TxContext {
  constructor(readonly tenantId: string, readonly userId?: string) {}
  async query<T = any>(): Promise<{ rows: T[]; rowCount: number }> { return { rows: [], rowCount: 0 }; }   // eslint-disable-line @typescript-eslint/no-explicit-any
}
class FakeUow extends UnitOfWork {
  async run<T>(tenantId: string, fn: (tx: TxContext) => Promise<T>, opts?: { userId?: string }): Promise<T> { return fn(new FakeTx(tenantId, opts?.userId)); }
}
/** Remembers by key like the real one (a replay returns the stored result and does NOT run fn again). */
class FakeIdem extends IdempotencyService {
  store = new Map<string, unknown>();
  async remember<T>(key: string, userId: string | undefined, endpoint: string, fn: () => Promise<T>): Promise<T> {
    const k = `${userId}::${endpoint}::${key}`;
    if (this.store.has(k)) return this.store.get(k) as T;
    const r = await fn(); this.store.set(k, r); return r;
  }
}
class FakeMetrics extends Metrics { inc(): void {} observe(): void {} }
class FakeOutbox { events: Array<{ eventType: string; payload: Record<string, unknown> }> = []; async write(_tx: TxContext, e: { eventType: string; payload: Record<string, unknown> }) { this.events.push(e); } }
/** The ledger as the wallet-service keeps it: a post with a key it has seen is NOT applied again. */
class FakeWallet implements WalletPort {
  posts: PostTxnInput[] = []; keys = new Map<string, string>();
  async post(_tx: TxContext, input: PostTxnInput): Promise<PostTxnResult> {
    const seen = this.keys.get(input.idempotencyKey);
    if (seen) return { txnId: seen, alreadyApplied: true };
    this.posts.push(input); const id = `txn_${this.posts.length}`; this.keys.set(input.idempotencyKey, id);
    return { txnId: id, alreadyApplied: false };
  }
  async balanceMinor(): Promise<bigint> { return 10n ** 12n; }
}
class FakePaymentRepository {
  byId = new Map<string, Payment>(); byGw = new Map<string, string>(); ttl: number | null = 900;
  async orderEmdCreditMinor(): Promise<bigint> { return 0n; }
  async resolvePurposeId(): Promise<string | null> { return 'purpose-direct-order'; }
  async insert(_tx: TxContext, p: Payment) { this.byId.set(p.id, p); if (p.toProps().gatewayOrderId) this.byGw.set(p.toProps().gatewayOrderId!, p.id); }
  async update(_tx: TxContext, p: Payment) { this.byId.set(p.id, p); }
  async getForUpdate(_tx: TxContext, _t: string, id: string) { return this.byId.get(id) ?? null; }
  async contextForGatewayOrder(_pr: string, gw: string) { const id = this.byGw.get(gw); const p = id ? this.byId.get(id) : undefined; return p ? { tenantId: p.tenantId, paymentId: p.id } : null; }
  async getByGatewayOrderForUpdate(_tx: TxContext, _t: string, gw: string) { const id = this.byGw.get(gw); return id ? this.byId.get(id) ?? null : null; }
  private forOrder(orderId: string) {
    return [...this.byId.values()].filter((p) => p.toProps().referenceId === orderId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async attemptsForOrder(_t: string, orderId: string) { return this.forOrder(orderId); }
  async attemptsForOrderTx(_tx: TxContext, _t: string, orderId: string) { return this.forOrder(orderId); }
  async capturedForOrderTx(_tx: TxContext, _t: string, orderId: string) { return this.forOrder(orderId).find((p) => ['success', 'refund_initiated', 'partially_refunded', 'refunded'].includes(p.status)) ?? null; }
  async attemptTtlSeconds() { return this.ttl; }
  async getVisible(_t: string, id: string) { return this.byId.get(id) ?? null; }
}
class FakeOrderRepository {
  constructor(readonly orders: Map<string, Order>) {}
  async getVisible(_t: string, id: string) { return this.orders.get(id) ?? null; }
  async getForUpdate(_tx: TxContext, _t: string, id: string) { return this.orders.get(id) ?? null; }
}

function makeOrder(buyer: string, total = AMOUNT, requiresPayment = true): Order {
  const id = uuidv7();
  const item = OrderItem.of({ id: uuidv7(), orderId: id, orderCreatedAt: new Date(), tenantId: TENANT, listingId: uuidv7(), productId: uuidv7(),
    titleSnapshot: 'Groundnut', quantity: 1, unitCode: 'quintal', unitPriceMinor: total, gstRatePct: null, hsnCode: null, batchId: null });
  return Order.place({ id, tenantId: TENANT, orderNo: `KV-${id.slice(-8)}`, checkoutGroupId: null, buyerUserId: buyer, sellerUserId: randomUUID(),
    source: 'direct', currencyCode: 'INR', items: [item], deliveryMethodId: null, deliveryAddressId: null, requiresPayment, stockReserved: true });
}
function world() {
  const orders = new Map<string, Order>();
  const repo = new FakePaymentRepository(); const wallet = new FakeWallet(); const outbox = new FakeOutbox(); const idem = new FakeIdem();
  const gateways = new GatewayRegistry(); const sandbox = new SandboxGateway(SECRET); gateways.register(sandbox, true);
  const audit = { write: async () => undefined } as unknown as AuditWriter;
  const svc = new PaymentService(new FakeUow(), outbox as any, idem, new FakeMetrics(), wallet, audit, repo as unknown as PaymentRepository, gateways,   // eslint-disable-line @typescript-eslint/no-explicit-any
    new FakeOrderRepository(orders) as unknown as OrderRepository,
    { assertPayableAmount: async () => { throw new Error('not in this suite'); } } as any, { isEnabled: async () => false } as any);   // eslint-disable-line @typescript-eslint/no-explicit-any
  return { svc, repo, wallet, outbox, sandbox, orders, idem };
}
/** A captured (success) payment for an order, as the webhook leaves it. */
function captured(w: ReturnType<typeof world>, order: Order, provider: 'sandbox' | 'wallet' = 'sandbox', gwPay: string | null = 'pay_s2c_1'): Payment {
  const p = Payment.initiate({ id: uuidv7(), tenantId: TENANT, userId: order.buyerUserId, purposeId: 'x', referenceType: 'order', referenceId: order.id,
    amountMinor: order.toProps().totalMinor, currencyCode: 'INR', providerCode: provider, idempotencyKey: randomUUID() });
  p.attachGatewayOrder(`gw_${p.id}`);
  p.markCaptured(gwPay ?? '', 'upi', 'txn_capture');
  if (!gwPay) (p as unknown as { props: { gatewayPaymentId: string | null } }).props.gatewayPaymentId = null;
  p.pullEvents();
  w.repo.byId.set(p.id, p); w.repo.byGw.set(`gw_${p.id}`, p.id);
  return p;
}
const zeroSum = (input: PostTxnInput) => input.legs.reduce((a, l) => a + l.amountMinor, 0n);

describe('STORE-2c · B2 — the automatic refund of a cancelled, paid order (founder D3)', () => {
  it('cancelled + paid (gateway) → ONE ledger post `order_cancel_refund`, key refund:<orderId>, zero-sum (escrow −, gateway +); the gateway asked once; refunded + event', async () => {
    const w = world(); const buyer = randomUUID();
    const o = makeOrder(buyer); w.orders.set(o.id, o); const pay = captured(w, o);
    o.cancel(buyer, null, true);
    const r = await w.svc.refundCancelledOrder(TENANT, o.id);
    expect(r.outcome).toBe('refunded');
    expect(w.wallet.posts).toHaveLength(1);
    const post = w.wallet.posts[0];
    expect([post.txnType, post.idempotencyKey, post.referenceType, post.referenceId]).toEqual(['order_cancel_refund', `refund:${o.id}`, 'payment', pay.id]);
    expect(zeroSum(post)).toBe(0n);
    expect(post.legs.map((l) => [l.account.kind, l.account.accountCode, l.amountMinor])).toEqual([['platform', 'gateway', AMOUNT], ['platform', 'escrow', -AMOUNT]]);
    expect(w.sandbox.refunds).toHaveLength(1);
    expect(w.sandbox.refunds[0]).toMatchObject({ gatewayPaymentId: 'pay_s2c_1', amountMinor: AMOUNT, receipt: `refund:${o.id}` });
    expect([pay.status, pay.refundedMinor]).toEqual(['refunded', AMOUNT]);
    const ev = w.outbox.events.filter((e) => e.eventType === 'payments.payment_refunded');
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ paymentId: pay.id, orderId: o.id, buyerUserId: buyer, fully: true, reason: 'order_cancelled' });
  });
  it('a REPLAYED cancel books nothing more: still one ledger post, the gateway still asked once', async () => {
    const w = world(); const buyer = randomUUID();
    const o = makeOrder(buyer); w.orders.set(o.id, o); captured(w, o); o.cancel(buyer, null, true);
    await w.svc.refundCancelledOrder(TENANT, o.id);
    const again = await w.svc.refundCancelledOrder(TENANT, o.id);
    expect(again.outcome).toBe('already');
    expect(w.wallet.posts).toHaveLength(1);
    expect(w.sandbox.refunds).toHaveLength(1);
  });
  it('the HANDLER is the same call (orders.order_cancelled → refundCancelledOrder) and is idempotent on replay', async () => {
    const w = world(); const buyer = randomUUID();
    const o = makeOrder(buyer); w.orders.set(o.id, o); captured(w, o); o.systemCancel('seller_confirm_timeout');
    const h = new OrderCancelledRefundHandler(w.svc);
    const ev = { id: '1', tenantId: TENANT, aggregateType: 'order', aggregateId: o.id, eventType: 'orders.order_cancelled', payload: { v: 1, orderId: o.id } };
    await h.handle(ev); await h.handle(ev);
    expect(h.eventType).toBe('orders.order_cancelled');
    expect(w.wallet.posts).toHaveLength(1);
  });
  it('an UNPAID cancelled order books nothing (online payments off / never paid)', async () => {
    const w = world(); const buyer = randomUUID();
    const o = makeOrder(buyer, AMOUNT, false); w.orders.set(o.id, o); o.cancel(buyer, null, true);
    expect((await w.svc.refundCancelledOrder(TENANT, o.id)).outcome).toBe('unpaid');
    expect(w.wallet.posts).toHaveLength(0);
    expect(w.sandbox.refunds).toHaveLength(0);
  });
  it('an order that is NOT cancelled is never refunded by this path', async () => {
    const w = world(); const buyer = randomUUID();
    const o = makeOrder(buyer); w.orders.set(o.id, o); captured(w, o);
    expect((await w.svc.refundCancelledOrder(TENANT, o.id)).outcome).toBe('not_cancelled');
    expect(w.wallet.posts).toHaveLength(0);
  });
  it('a WALLET payment is refunded to the buyer\'s wallet (source) at once: user main +, escrow − (payment currency)', async () => {
    const w = world(); const buyer = randomUUID();
    const o = makeOrder(buyer); w.orders.set(o.id, o); const pay = captured(w, o, 'wallet', `wallet:x`);
    o.cancel(buyer, null, true);
    expect((await w.svc.refundCancelledOrder(TENANT, o.id)).outcome).toBe('refunded');
    const post = w.wallet.posts[0];
    expect(zeroSum(post)).toBe(0n);
    expect(post.legs.map((l) => [l.account.kind, l.account.accountCode, l.account.userId ?? null, l.account.currencyCode, l.amountMinor]))
      .toEqual([['user', 'main', buyer, 'INR', AMOUNT], ['platform', 'escrow', null, 'INR', -AMOUNT]]);
    expect(w.sandbox.refunds).toHaveLength(0);           // no gateway for wallet money
    expect(pay.status).toBe('refunded');
  });
  it('no gateway payment id recorded → the ledger refund stands, refund_initiated, and it THROWS by name (the relay retries / the desk)', async () => {
    const w = world(); const buyer = randomUUID();
    const o = makeOrder(buyer); w.orders.set(o.id, o); const pay = captured(w, o, 'sandbox', null);
    o.cancel(buyer, null, true);
    await expect(w.svc.refundCancelledOrder(TENANT, o.id)).rejects.toBeInstanceOf(RefundGatewayReferenceMissingError);
    expect([pay.status, w.wallet.posts.length]).toEqual(['refund_initiated', 1]);
  });
  it('the MODERATOR refund posts through the same function: byte-identical gateway legs to before (gateway +, escrow −)', async () => {
    const w = world(); const buyer = randomUUID();
    const o = makeOrder(buyer); w.orders.set(o.id, o); const pay = captured(w, o);
    await w.svc.refund(TENANT, { userId: 'mod', canModerate: true }, pay.id, { amountMinor: '1000' } as never, null);
    const post = w.wallet.posts[0];
    expect([post.txnType, post.idempotencyKey]).toEqual(['escrow_release', `refund:${pay.id}:${AMOUNT}`]);
    expect(post.legs.map((l) => [l.account.accountCode, l.account.currencyCode, l.amountMinor])).toEqual([['gateway', 'INR', 1000n], ['escrow', 'INR', -1000n]]);
  });
  it('the webhook `refund.processed` completes a refund_initiated payment (Razorpay\'s async arrival) — a replay is a no-op', async () => {
    const w = world(); const buyer = randomUUID();
    const o = makeOrder(buyer); w.orders.set(o.id, o); const pay = captured(w, o);
    pay.initiateRefund(AMOUNT); pay.pullEvents();
    const body = JSON.stringify({ id: 'evt_r1', event: 'refund.processed', order_id: `gw_${pay.id}`, payment_id: 'pay_s2c_1', refund_id: 'rfnd_1' });
    await w.svc.handleWebhook('sandbox', body, w.sandbox.sign(body));
    expect(pay.status).toBe('refunded');
    const body2 = JSON.stringify({ id: 'evt_r2', event: 'refund.processed', order_id: `gw_${pay.id}`, payment_id: 'pay_s2c_1', refund_id: 'rfnd_1' });
    expect(await w.svc.handleWebhook('sandbox', body2, w.sandbox.sign(body2))).toMatchObject({ ok: true, duplicate: true });
    expect(w.outbox.events.filter((e) => e.eventType === 'payments.payment_refunded')).toHaveLength(1);
  });
  it('the entity: initiateRefund only from success with nothing refunded; completeRefund only from refund_initiated', () => {
    const p = Payment.initiate({ id: 'p', tenantId: TENANT, userId: 'u', purposeId: 'x', referenceType: 'order', referenceId: 'o', amountMinor: 100n, currencyCode: 'INR', providerCode: 'sandbox', idempotencyKey: 'k' });
    expect(() => p.initiateRefund(100n)).toThrow();      // not captured
    p.markCaptured('pay', 'upi', 't');
    expect(p.completeRefund('order_cancelled', 'o', null)).toBe(false);
    p.initiateRefund(100n);
    expect(() => p.initiateRefund(100n)).toThrow();      // never twice
    expect(p.completeRefund('order_cancelled', 'o', 'r')).toBe(true);
    expect(p.status).toBe('refunded');
  });
});

describe('STORE-2c · B3 — attempt-scoped intents', () => {
  const dto = (orderId: string) => ({ purpose: 'direct_order', amountMinor: AMOUNT.toString(), currencyCode: 'INR', referenceType: 'order', referenceId: orderId }) as never;
  it('a second LIVE attempt is refused PAYMENT_ATTEMPT_LIVE {paymentId, expiresAt}; the same key replays the same attempt', async () => {
    const w = world(); const buyer = randomUUID(); const o = makeOrder(buyer); w.orders.set(o.id, o);
    const a1 = await w.svc.createIntent(TENANT, buyer, `order-pay:${o.id}:1`, dto(o.id));
    expect([a1.attempt, typeof a1.expiresAt]).toEqual([1, 'string']);
    expect(await w.svc.createIntent(TENANT, buyer, `order-pay:${o.id}:1`, dto(o.id))).toEqual(a1);    // a refresh of the same attempt
    try { await w.svc.createIntent(TENANT, buyer, `order-pay:${o.id}:2`, dto(o.id)); throw new Error('not refused'); } catch (e) {
      expect(e).toBeInstanceOf(PaymentAttemptLiveError);
      expect((e as PaymentAttemptLiveError).details).toEqual({ paymentId: a1.paymentId, expiresAt: a1.expiresAt });
    }
  });
  it('after the attempt FAILED a new one is allowed: a new gateway order, attempt 2', async () => {
    const w = world(); const buyer = randomUUID(); const o = makeOrder(buyer); w.orders.set(o.id, o);
    const a1 = await w.svc.createIntent(TENANT, buyer, `order-pay:${o.id}:1`, dto(o.id));
    w.repo.byId.get(a1.paymentId)!.markFailed('BAD_REQUEST_ERROR', 'payment_timed_out', 'pay_A');
    const a2 = await w.svc.createIntent(TENANT, buyer, `order-pay:${o.id}:2`, dto(o.id));
    expect([a2.attempt, a2.gatewayOrderId === a1.gatewayOrderId, a2.paymentId === a1.paymentId]).toEqual([2, false, false]);
  });
  it('after the attempt LAPSED (past the TTL) a new one is allowed and the old one is marked expired — whose late capture is still booked', async () => {
    const w = world(); const buyer = randomUUID(); const o = makeOrder(buyer); w.orders.set(o.id, o);
    const a1 = await w.svc.createIntent(TENANT, buyer, `order-pay:${o.id}:1`, dto(o.id));
    const old = w.repo.byId.get(a1.paymentId)!;
    (old as unknown as { props: { createdAt: Date } }).props.createdAt = new Date(Date.now() - 901_000);
    await w.svc.createIntent(TENANT, buyer, `order-pay:${o.id}:2`, dto(o.id));
    expect(old.status).toBe('expired');
    expect(canTransition('expired', 'success')).toBe(true);
    expect(old.markCaptured('pay_late', 'upi', 'txn_late')).toBe(true);    // the lapsed attempt's late capture books
  });
  it('the pure rules: live / lapsed / expiry from the setting (no setting → never lapses by time; an authorized hold stays live)', () => {
    const t0 = new Date('2026-10-15T10:00:00Z'); const t1 = new Date('2026-10-15T10:15:01Z');
    expect(attemptExpiresAt(t0, 900)?.toISOString()).toBe('2026-10-15T10:15:00.000Z');
    expect(isLiveAttempt({ id: 'a', status: 'initiated', createdAt: t0 }, 900, t1)).toBe(false);
    expect(isLapsedAttempt({ id: 'a', status: 'initiated', createdAt: t0 }, 900, t1)).toBe(true);
    expect(isLiveAttempt({ id: 'a', status: 'initiated', createdAt: t0 }, null, t1)).toBe(true);
    expect(isLiveAttempt({ id: 'a', status: 'authorized', createdAt: t0 }, 900, t1)).toBe(true);
    expect(isLiveAttempt({ id: 'a', status: 'failed', createdAt: t0 }, 900, t0)).toBe(false);
  });
  it('the failure reason is a CODE from a closed list; "nothing was charged" only before a debit', () => {
    expect(failureReasonCode('payment_cancelled')).toBe('cancelled');
    expect(failureReasonCode('payment_timed_out')).toBe('timed_out');
    expect(failureReasonCode('insufficient_funds')).toBe('insufficient_funds');
    expect(failureReasonCode('incorrect_otp')).toBe('authentication_failed');
    expect(failureReasonCode('card_declined')).toBe('declined');
    expect(failureReasonCode('bank_technical_error')).toBe('gateway_error');
    expect(failureReasonCode('Payment failed', 'BAD_REQUEST_ERROR')).toBe('unknown');
    expect(failureReasonCode(null)).toBe('unknown');
    for (const c of FAILURE_REASON_CODES) expect(typeof chargedNothing(c)).toBe('boolean');
    expect([chargedNothing('cancelled'), chargedNothing('gateway_error'), chargedNothing('unknown')]).toEqual([true, false, false]);
  });
});

describe('STORE-2c · B5 — per_km refused at definition, reported by name where priced (founder D4)', () => {
  it('the propose DTO accepts the word so the service can refuse it BY NAME; the domain refuses it CHARGE_METHOD_UNSUPPORTED', () => {
    expect(ProposeChargeSchema.safeParse({ chargeCode: 'delivery_fee', action: 'add', calcMethod: 'per_km', config: {}, effectiveFrom: '2026-12-01', note: 'x'.repeat(25) }).success).toBe(true);
    expect(ProposeChargeSchema.safeParse({ chargeCode: 'delivery_fee', action: 'add', calcMethod: 'per_mile', config: {}, effectiveFrom: '2026-12-01', note: 'x'.repeat(25) }).success).toBe(false);
    expect(validateChargeConfig('per_km', { rate_minor: 80 })).toMatchObject({ ok: false, error: 'CHARGE_METHOD_UNSUPPORTED' });
  });
  it('an existing per_km definition (a pre-gate row) is REPORTED by name at the quote — never a 500, never priced 0', async () => {
    const defs = { resolve: async () => ({ id: 'd1', calcMethod: 'per_km', config: { rate_minor: 80 }, effectiveFrom: '2026-01-01', isTenantOverride: true }),
      resolveById: async () => ({ id: 'd1', calcMethod: 'per_km', config: {}, effectiveFrom: '2026-01-01', isTenantOverride: true }) } as unknown as ChargeDefinitionRepository;
    const svc = new ChargePricingService(defs);
    const tx = new FakeTx(TENANT);
    await expect(svc.quote(tx, TENANT, 'delivery_fee', { amountMinor: 100n })).rejects.toMatchObject({ code: 'CHARGE_METHOD_UNSUPPORTED', details: { chargeCode: 'delivery_fee', method: 'per_km' } });
    await expect(svc.quoteByDefinitionId(tx, TENANT, 'd1', { amountMinor: 100n })).rejects.toBeInstanceOf(ChargeMethodUnsupportedError);
    await expect(svc.checkoutChargesWithSnapshot(tx, TENANT, 100n, new Date(), null)).rejects.toBeInstanceOf(ChargeMethodUnsupportedError);
  });
});
