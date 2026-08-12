// modules/payments/__tests__/order-reference-guard.spec.ts
// S6 device-test P0: createIntent (referenceType==='order') and the webhook capture path must
// fail CLOSED against a bogus/foreign/stale order reference — a founder's device 201'd an intent
// against a demo-seed order id that GET /v1/orders/:id correctly 404s for him. These unit tests
// exercise PaymentService directly against hand-rolled in-memory fakes (no Postgres) so the guard
// logic is proven without the real-Postgres integration harness. Real-Postgres coverage of the
// SAME guard lives in payments.integration.spec.ts (fixtures there now seed a real order per intent).
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
import { OrderNotFoundError, OrderNotAwaitingPaymentError } from '../../orders/domain/orders.errors';
import { OrderPaymentAmountMismatchError, PaymentOrderReferenceInvalidError } from '../domain/payments.errors';
import { OrderRepository } from '../../orders/repositories/order.repository';
import { Order } from '../../orders/domain/order.entity';
import { OrderItem } from '../../orders/domain/order-item.entity';
import { uuidv7 } from '../../../core/database/uuid.util';

const SECRET = 'sandbox-secret';
const TENANT = 'tenant-1';
const AMOUNT = 150000n;

class FakeTx implements TxContext {
  constructor(readonly tenantId: string, readonly userId?: string) {}
  async query<T = any>(): Promise<{ rows: T[]; rowCount: number }> { return { rows: [], rowCount: 0 }; }
}
class FakeUow extends UnitOfWork {
  async run<T>(tenantId: string, fn: (tx: TxContext) => Promise<T>, opts?: { userId?: string }): Promise<T> {
    return fn(new FakeTx(tenantId, opts?.userId));
  }
}
class FakeIdem extends IdempotencyService {
  async remember<T>(_key: string, _userId: string | undefined, _endpoint: string, fn: () => Promise<T>): Promise<T> { return fn(); }
}
class FakeMetrics extends Metrics {
  inc(): void {}
  observe(): void {}
}
class FakeOutbox { async write(): Promise<void> {} }
class FakeWallet implements WalletPort {
  posts: PostTxnInput[] = [];
  async post(_tx: TxContext, input: PostTxnInput): Promise<PostTxnResult> {
    this.posts.push(input);
    return { txnId: `txn_${this.posts.length}`, alreadyApplied: false };
  }
  // eslint's no-unused-vars does not exempt leading-underscore params in this config, and the port's
  // signature is fixed — so the stub takes none and satisfies the interface structurally.
  async balanceMinor(): Promise<bigint> { return 0n; }
}

/** In-memory stand-in for the real (SQL) PaymentRepository. Duck-typed — cast at the call site. */
class FakePaymentRepository {
  byId = new Map<string, Payment>();
  byGatewayOrder = new Map<string, string>();
  async resolvePurposeId(): Promise<string | null> { return 'purpose-direct-order'; }
  async insert(_tx: TxContext, p: Payment): Promise<void> {
    const v = p.toProps();
    this.byId.set(v.id, p);
    if (v.gatewayOrderId) this.byGatewayOrder.set(v.gatewayOrderId, v.id);
  }
  async getByGatewayOrderForUpdate(_tx: TxContext, _tenantId: string, gatewayOrderId: string): Promise<Payment | null> {
    const id = this.byGatewayOrder.get(gatewayOrderId);
    return id ? this.byId.get(id) ?? null : null;
  }
  async update(_tx: TxContext, p: Payment): Promise<void> { this.byId.set(p.toProps().id, p); }
  async getForUpdate(_tx: TxContext, _tenantId: string, id: string): Promise<Payment | null> { return this.byId.get(id) ?? null; }
  async getVisible(): Promise<Payment | null> { return null; }
  async listForUser(): Promise<Payment[]> { return []; }
  async findSuccessByOrder(): Promise<Payment | null> { return null; }
  async attachGatewayOrder(): Promise<void> {}
}

/** In-memory stand-in for the real (SQL) OrderRepository — exactly the two read methods
 *  PaymentService now calls (getVisible at intent time, getForUpdate at webhook-capture time). */
class FakeOrderRepository {
  constructor(private readonly orders: Map<string, Order>) {}
  async getVisible(_tenantId: string, id: string, viewerUserId: string, canModerate: boolean): Promise<Order | null> {
    const o = this.orders.get(id);
    if (!o) return null;
    const p = o.toProps();
    if (canModerate || p.buyerUserId === viewerUserId || p.sellerUserId === viewerUserId) return o;
    return null;
  }
  async getForUpdate(_tx: TxContext, _tenantId: string, id: string): Promise<Order | null> { return this.orders.get(id) ?? null; }
}

function makeOrder(opts: { buyerUserId: string; sellerUserId?: string; totalMinor?: bigint; currencyCode?: string }): Order {
  const id = uuidv7();
  const unitPriceMinor = opts.totalMinor ?? AMOUNT;
  const item = OrderItem.of({
    id: uuidv7(), orderId: id, orderCreatedAt: new Date(), tenantId: TENANT, listingId: uuidv7(), productId: uuidv7(),
    titleSnapshot: 'Test crop', quantity: 1, unitCode: 'kg', unitPriceMinor, gstRatePct: null, hsnCode: null, batchId: null,
  });
  return Order.place({
    id, tenantId: TENANT, orderNo: `KV-${id.slice(0, 8)}`, checkoutGroupId: null, buyerUserId: opts.buyerUserId,
    sellerUserId: opts.sellerUserId ?? randomUUID(), source: 'direct', currencyCode: opts.currencyCode ?? 'INR',
    items: [item], deliveryMethodId: null, deliveryAddressId: null, requiresPayment: true,
  });
}

function buildService(orders: Map<string, Order>) {
  const uow = new FakeUow();
  const idem = new FakeIdem();
  const metrics = new FakeMetrics();
  const wallet = new FakeWallet();
  const audit = new AuditWriter(undefined as any);   // .write() only touches tx.query (a no-op fake)
  const paymentRepo = new FakePaymentRepository();
  const gateways = new GatewayRegistry();
  gateways.register(new SandboxGateway(SECRET), true);
  const orderRepo = new FakeOrderRepository(orders);
  const payments = new PaymentService(
    uow, new FakeOutbox() as any, idem, metrics, wallet, audit,
    paymentRepo as unknown as PaymentRepository, gateways, orderRepo as unknown as OrderRepository,
  );
  return { payments, wallet, paymentRepo };
}

const intentDto = (referenceId: string, amountMinor = AMOUNT.toString()) =>
  ({ purpose: 'direct_order' as const, amountMinor, currencyCode: 'INR', referenceType: 'order', referenceId }) as any;

describe('PaymentService.createIntent — order reference guard (S6 P0)', () => {
  it('404s (OrderNotFoundError) for a nonexistent order — mirrors GET /v1/orders/:id', async () => {
    const { payments } = buildService(new Map());
    const buyer = randomUUID();
    await expect(payments.createIntent(TENANT, buyer, `idem-${randomUUID()}`, intentDto(randomUUID())))
      .rejects.toBeInstanceOf(OrderNotFoundError);
  });

  it('404s (never 403 — no enumeration) for an order that exists but belongs to someone else', async () => {
    const orders = new Map<string, Order>();
    const realBuyer = randomUUID();
    const order = makeOrder({ buyerUserId: realBuyer });
    orders.set(order.id, order);
    const { payments } = buildService(orders);

    const attacker = randomUUID();
    let caught: unknown;
    try { await payments.createIntent(TENANT, attacker, `idem-${randomUUID()}`, intentDto(order.id)); }
    catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(OrderNotFoundError);
    expect((caught as OrderNotFoundError).httpStatus).toBe(404);
  });

  it('rejects (409) when amountMinor does not equal the order total — exact match only, no partial pay', async () => {
    const buyer = randomUUID();
    const orders = new Map<string, Order>();
    const order = makeOrder({ buyerUserId: buyer, totalMinor: AMOUNT });
    orders.set(order.id, order);
    const { payments } = buildService(orders);

    let caught: unknown;
    try { await payments.createIntent(TENANT, buyer, `idem-${randomUUID()}`, intentDto(order.id, '1')); }
    catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(OrderPaymentAmountMismatchError);
    expect((caught as OrderPaymentAmountMismatchError).httpStatus).toBe(409);
  });

  it('rejects (409) when the order is not in a payable state (already confirmed)', async () => {
    const buyer = randomUUID();
    const orders = new Map<string, Order>();
    const order = makeOrder({ buyerUserId: buyer });
    order.markPaid();   // payment_pending -> confirmed (e.g. already paid via another channel)
    orders.set(order.id, order);
    const { payments } = buildService(orders);

    await expect(payments.createIntent(TENANT, buyer, `idem-${randomUUID()}`, intentDto(order.id)))
      .rejects.toBeInstanceOf(OrderNotAwaitingPaymentError);
  });

  it('happy path unchanged: valid own order, payment_pending, exact amount → intent created', async () => {
    const buyer = randomUUID();
    const orders = new Map<string, Order>();
    const order = makeOrder({ buyerUserId: buyer, totalMinor: AMOUNT });
    orders.set(order.id, order);
    const { payments } = buildService(orders);

    const res = await payments.createIntent(TENANT, buyer, `idem-${randomUUID()}`, intentDto(order.id));
    expect(res.status).toBe('initiated');
    expect(res.amountMinor).toBe(AMOUNT.toString());
    expect(res.gatewayOrderId).toMatch(/^sbx_order_/);
  });

  it('non-order referenceTypes (e.g. membership) are unaffected — no order lookup performed', async () => {
    const { payments } = buildService(new Map());
    const buyer = randomUUID();
    const res = await payments.createIntent(TENANT, buyer, `idem-${randomUUID()}`,
      { purpose: 'subscription', amountMinor: '5000', currencyCode: 'INR', referenceType: 'membership', referenceId: randomUUID() } as any);
    expect(res.status).toBe('initiated');
  });
});

describe('PaymentService.handleWebhook — order reference re-check before moving money (S6 P0, defense-in-depth)', () => {
  const gateway = new SandboxGateway(SECRET);
  const capturedEvent = (gatewayOrderId: string, amountMinor: bigint) => {
    const body = JSON.stringify({ id: `evt_${randomUUID()}`, event: 'payment.captured', tenant_id: TENANT, order_id: gatewayOrderId, payment_id: `pay_${randomUUID()}`, amount: Number(amountMinor), method: 'upi' });
    return { body, sig: gateway.sign(body) };
  };

  /** Creates a valid order + a valid intent against it (mirrors the happy path from the describe
   *  block above), returning the live service/fakes so a test can mutate the order afterwards to
   *  simulate drift between intent-creation time and capture time. */
  async function createValidIntent(orders: Map<string, Order>, buyer: string) {
    const order = makeOrder({ buyerUserId: buyer, totalMinor: AMOUNT });
    orders.set(order.id, order);
    const svc = buildService(orders);
    const intent = await svc.payments.createIntent(TENANT, buyer, `idem-${randomUUID()}`, intentDto(order.id));
    return { ...svc, order, orders, intent };
  }

  it('happy path unchanged: capture succeeds → escrow credited exactly once, payment success', async () => {
    const buyer = randomUUID();
    const { payments, wallet, paymentRepo, intent } = await createValidIntent(new Map(), buyer);
    const { body, sig } = capturedEvent(intent.gatewayOrderId, AMOUNT);
    await payments.handleWebhook('sandbox', body, sig);
    expect(wallet.posts.length).toBe(1);
    expect(paymentRepo.byId.get(intent.paymentId)?.status).toBe('success');
  });

  it('rejects (money NOT moved) when the order was deleted/unknown by capture time', async () => {
    const buyer = randomUUID();
    const { payments, wallet, orders, order, intent } = await createValidIntent(new Map(), buyer);
    orders.delete(order.id);   // simulate the reference vanishing between intent-time and capture-time
    const { body, sig } = capturedEvent(intent.gatewayOrderId, AMOUNT);
    await expect(payments.handleWebhook('sandbox', body, sig)).rejects.toBeInstanceOf(PaymentOrderReferenceInvalidError);
    expect(wallet.posts.length).toBe(0);   // no escrow credit
  });

  it('rejects (money NOT moved) when the order now belongs to a different buyer by capture time', async () => {
    const buyer = randomUUID();
    const { payments, wallet, orders, order, intent } = await createValidIntent(new Map(), buyer);
    orders.set(order.id, makeOrder({ buyerUserId: randomUUID(), totalMinor: AMOUNT }));   // swapped reference
    const { body, sig } = capturedEvent(intent.gatewayOrderId, AMOUNT);
    let caught: unknown;
    try { await payments.handleWebhook('sandbox', body, sig); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(PaymentOrderReferenceInvalidError);
    expect((caught as PaymentOrderReferenceInvalidError).details?.reason).toBe('wrong_buyer');
    expect(wallet.posts.length).toBe(0);
  });

  it('rejects (money NOT moved) when the order is no longer awaiting payment by capture time', async () => {
    const buyer = randomUUID();
    const { payments, wallet, order, intent } = await createValidIntent(new Map(), buyer);
    order.markPaid();   // e.g. confirmed via another path (wallet pay) in the gap before this webhook lands
    const { body, sig } = capturedEvent(intent.gatewayOrderId, AMOUNT);
    let caught: unknown;
    try { await payments.handleWebhook('sandbox', body, sig); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(PaymentOrderReferenceInvalidError);
    expect((caught as PaymentOrderReferenceInvalidError).details?.reason).toBe('wrong_state');
    expect(wallet.posts.length).toBe(0);
  });

  it('rejects (money NOT moved) when the order total has drifted from the captured payment amount', async () => {
    const buyer = randomUUID();
    const { payments, wallet, orders, order, intent } = await createValidIntent(new Map(), buyer);
    orders.set(order.id, makeOrder({ buyerUserId: buyer, totalMinor: AMOUNT + 1n }));   // total changed since intent-time
    const { body, sig } = capturedEvent(intent.gatewayOrderId, AMOUNT);
    let caught: unknown;
    try { await payments.handleWebhook('sandbox', body, sig); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(PaymentOrderReferenceInvalidError);
    expect((caught as PaymentOrderReferenceInvalidError).details?.reason).toBe('amount_drift');
    expect(wallet.posts.length).toBe(0);
  });
});
