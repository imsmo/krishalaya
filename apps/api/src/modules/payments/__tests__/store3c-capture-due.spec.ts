// modules/payments/__tests__/store3c-capture-due.spec.ts · PC-56 STORE-3c · B1 / B7 (founder D2 / D7) — ONE RULE FOR THE INTENT, THE WALLET PAY AND
// THE CAPTURE, as unit tests against in-memory fakes (no Postgres). The webhook capture re-check compares the payment to what the order still owes —
// total − the auction deposit applied to it in escrow (`amountDueForOrderInTx`), not the total:
//   • a capture of the BALANCE of an auction order is booked (`pay:<paymentId>`, escrow + / gateway −, zero-sum);
//   • a capture of the TOTAL of an auction order is now `amount_drift` (it would over-fund escrow by the deposit) and NOTHING is booked;
//   • a direct order (no deposit) still captures its total;
//   • `capturedForOrderInTx` (the "paid" test, D7) is true for a success / refunded payment row, false with none.
// The live proof is apps/api/src/__tests__/store3c-auctions-group.integration.spec.ts (1) and (9).
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
import { OrderRepository } from '../../orders/repositories/order.repository';
import { Order } from '../../orders/domain/order.entity';
import { OrderItem } from '../../orders/domain/order-item.entity';
import { uuidv7 } from '../../../core/database/uuid.util';

const SECRET = 'sandbox-secret-s3c';
const TENANT = 'tenant-s3c';
const TOTAL = 13_100_000n; const EMD = 1_000_000n;
class FakeTx implements TxContext { constructor(readonly tenantId: string) {} async query<T = any>(): Promise<{ rows: T[]; rowCount: number }> { return { rows: [], rowCount: 0 }; } }   // eslint-disable-line @typescript-eslint/no-explicit-any
class FakeUow extends UnitOfWork { async run<T>(t: string, fn: (tx: TxContext) => Promise<T>): Promise<T> { return fn(new FakeTx(t)); } }
class PassIdem extends IdempotencyService { async remember<T>(_k: string, _u: string | undefined, _e: string, fn: () => Promise<T>): Promise<T> { return fn(); } }
class FakeMetrics extends Metrics { inc(): void {} observe(): void {} }
class FakeWallet implements WalletPort {
  posts: PostTxnInput[] = [];
  async post(_tx: TxContext, input: PostTxnInput): Promise<PostTxnResult> { this.posts.push(input); return { txnId: `txn_${this.posts.length}`, alreadyApplied: false }; }
  async balanceMinor(): Promise<bigint> { return 10n ** 12n; }
}
function world(credit: bigint) {
  const payments = new Map<string, Payment>(); const byGw = new Map<string, string>(); const orders = new Map<string, Order>();
  const repo = {
    orderEmdCreditMinor: async () => credit,
    contextForGatewayOrder: async (_p: string, gw: string) => { const id = byGw.get(gw); const p = id ? payments.get(id) : undefined; return p ? { tenantId: p.tenantId, paymentId: p.id } : null; },
    getByGatewayOrderForUpdate: async (_tx: TxContext, _t: string, gw: string) => { const id = byGw.get(gw); return id ? payments.get(id) ?? null : null; },
    update: async (_tx: TxContext, p: Payment) => { payments.set(p.id, p); },
    capturedForOrderTx: async (_tx: TxContext, _t: string, orderId: string) => [...payments.values()].find((p) => p.toProps().referenceId === orderId
      && ['success', 'refund_initiated', 'partially_refunded', 'refunded'].includes(p.status)) ?? null,
  };
  const wallet = new FakeWallet();
  const gateways = new GatewayRegistry(); const sandbox = new SandboxGateway(SECRET); gateways.register(sandbox, true);
  const svc = new PaymentService(new FakeUow(), { write: async () => undefined } as never, new PassIdem(), new FakeMetrics(), wallet, { write: async () => undefined } as unknown as AuditWriter,
    repo as unknown as PaymentRepository, gateways, { getForUpdate: async (_tx: TxContext, _t: string, id: string) => orders.get(id) ?? null } as unknown as OrderRepository,
    {} as never, { isEnabled: async () => false } as never);
  const buyer = randomUUID();
  const order = (() => {
    const id = uuidv7();
    const item = OrderItem.of({ id: uuidv7(), orderId: id, orderCreatedAt: new Date(), tenantId: TENANT, listingId: uuidv7(), productId: uuidv7(), titleSnapshot: 'Ghee (auction lot)',
      quantity: 200, unitCode: 'kg', unitPriceMinor: 65_500n, gstRatePct: null, hsnCode: null, batchId: null });
    return Order.place({ id, tenantId: TENANT, orderNo: 'KV2026-0000S3C1', checkoutGroupId: null, buyerUserId: buyer, sellerUserId: randomUUID(), source: credit > 0n ? 'auction' : 'direct',
      currencyCode: 'INR', items: [item], deliveryMethodId: null, deliveryAddressId: null, requiresPayment: true });
  })();
  orders.set(order.id, order);
  const pay = (amount: bigint) => {
    const p = Payment.initiate({ id: uuidv7(), tenantId: TENANT, userId: buyer, purposeId: 'x', referenceType: 'order', referenceId: order.id, amountMinor: amount, currencyCode: 'INR',
      providerCode: 'sandbox', idempotencyKey: randomUUID() });
    p.attachGatewayOrder(`gw_${p.id}`); p.pullEvents(); payments.set(p.id, p); byGw.set(`gw_${p.id}`, p.id);
    return p;
  };
  const capture = (p: Payment) => {
    const body = JSON.stringify({ id: `evt_${randomUUID()}`, event: 'payment.captured', order_id: `gw_${p.id}`, payment_id: `pay_${p.id.slice(-6)}`, amount: Number(p.amountMinor), currency: 'INR', method: 'upi' });
    return svc.handleWebhook('sandbox', body, sandbox.sign(body));
  };
  return { svc, wallet, order, pay, capture };
}

describe('STORE-3c · B1 the capture re-check accepts the DUE (founder D2)', () => {
  it('an auction order: the BALANCE (total − the deposit applied) is captured and booked `pay:<paymentId>`, zero-sum', async () => {
    const w = world(EMD);
    expect(w.order.toProps().totalMinor).toBe(TOTAL);
    const p = w.pay(TOTAL - EMD);
    await w.capture(p);
    expect(w.wallet.posts.map((x) => [x.idempotencyKey, x.legs.reduce((s, l) => s + l.amountMinor, 0n)])).toEqual([[`pay:${p.id}`, 0n]]);
    expect(w.wallet.posts[0].legs.find((l) => l.amountMinor > 0n)?.amountMinor).toBe(TOTAL - EMD);
  });
  it('an auction order: a capture carrying the TOTAL is now `amount_drift` — nothing booked', async () => {
    const w = world(EMD);
    const p = w.pay(TOTAL);
    await expect(w.capture(p)).rejects.toMatchObject({ details: expect.objectContaining({ reason: 'amount_drift' }) });
    expect(w.wallet.posts).toHaveLength(0);
  });
  it('a direct order (no deposit): its due IS its total — captured as before', async () => {
    const w = world(0n);
    const p = w.pay(TOTAL);
    await w.capture(p);
    expect(w.wallet.posts.map((x) => x.idempotencyKey)).toEqual([`pay:${p.id}`]);
  });
});

describe('STORE-3c · B7 the captured-payment test (founder D7)', () => {
  it('true once a payment row for the order is captured; false with none', async () => {
    const w = world(EMD);
    const tx = new FakeTx(TENANT);
    expect(await w.svc.capturedForOrderInTx(tx, TENANT, w.order.id)).toBe(false);
    const p = w.pay(TOTAL - EMD);
    expect(await w.svc.capturedForOrderInTx(tx, TENANT, w.order.id)).toBe(false);   // initiated is not captured
    await w.capture(p);
    expect(await w.svc.capturedForOrderInTx(tx, TENANT, w.order.id)).toBe(true);
  });
});
