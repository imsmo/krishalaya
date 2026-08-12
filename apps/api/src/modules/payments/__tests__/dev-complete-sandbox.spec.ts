// modules/payments/__tests__/dev-complete-sandbox.spec.ts
// R2-05 founder finding: the mobile add-money screen showed "Add money is temporarily unavailable"
// because, with no real Razorpay keys configured locally, the server already defaults every intent to
// the deterministic SANDBOX gateway (see payments.module.ts's GatewayRegistry factory) — but the app
// unconditionally tried to open the REAL Razorpay checkout SDK against that fake `sbx_order_…` id,
// which throws. PaymentService.devCompleteSandboxPayment lets a sandbox-provider payment be captured
// via the EXACT SAME signed-webhook path a real gateway delivery takes (handleWebhook) so the wallet
// top-up loop is provable locally with no real PSP. These unit tests exercise it against hand-rolled
// in-memory fakes (no Postgres), mirroring order-reference-guard.spec.ts's pattern.
import { randomUUID } from 'node:crypto';
import { UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { Metrics } from '../../../core/observability/metrics';
import { WalletPort, PostTxnInput, PostTxnResult } from '../../../core/wallet/wallet.port';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { BadRequestError } from '../../../shared/errors/app-error';
import { PaymentService, PaymentActor } from '../services/payment.service';
import { PaymentRepository } from '../repositories/payment.repository';
import { GatewayRegistry } from '../gateway/gateway.registry';
import { SandboxGateway } from '../gateway/sandbox.gateway';
import { Payment } from '../domain/payment.entity';
import { PaymentNotFoundError } from '../domain/payments.errors';
import { OrderRepository } from '../../orders/repositories/order.repository';
import { uuidv7 } from '../../../core/database/uuid.util';

const SECRET = 'sandbox-secret';
const TENANT = 'tenant-1';
const AMOUNT = 50000n; // ₹500.00

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

/** In-memory stand-in for the real (SQL) PaymentRepository — same duck-typed shape as
 *  order-reference-guard.spec.ts's fake, plus ownership-aware getVisible (the one method that fake
 *  didn't need, since devCompleteSandboxPayment's anti-IDOR guard depends on it). */
class FakePaymentRepository {
  byId = new Map<string, Payment>();
  byGatewayOrder = new Map<string, string>();
  async resolvePurposeId(): Promise<string | null> { return 'purpose-wallet-recharge'; }
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
  /** Mirrors the real repo's contract (payment.repository.ts): visible to the owner or a moderator only. */
  async getVisible(_tenantId: string, id: string, viewerUserId: string, canModerate: boolean): Promise<Payment | null> {
    const p = this.byId.get(id);
    if (!p) return null;
    return canModerate || p.userId === viewerUserId ? p : null;
  }
  async listForUser(): Promise<Payment[]> { return []; }
  async findSuccessByOrder(): Promise<Payment | null> { return null; }
  async attachGatewayOrder(): Promise<void> {}
}

function buildService() {
  const uow = new FakeUow();
  const idem = new FakeIdem();
  const metrics = new FakeMetrics();
  const wallet = new FakeWallet();
  const audit = new AuditWriter(undefined as any); // .write() only touches tx.query (a no-op fake)
  const paymentRepo = new FakePaymentRepository();
  const gateways = new GatewayRegistry();
  gateways.register(new SandboxGateway(SECRET), true);
  const orderRepo = {} as OrderRepository; // unused: these intents carry no 'order' referenceType
  const payments = new PaymentService(
    uow, new FakeOutbox() as any, idem, metrics, wallet, audit,
    paymentRepo as unknown as PaymentRepository, gateways, orderRepo,
  );
  return { payments, wallet, paymentRepo };
}

const actorFor = (userId: string, canModerate = false): PaymentActor => ({ userId, canModerate });

describe('PaymentService.devCompleteSandboxPayment (R2-05 dev-only sandbox top-up)', () => {
  it('captures a sandbox wallet_recharge intent exactly like a real webhook would: escrow credited once, status success', async () => {
    const { payments, wallet } = buildService();
    const buyer = randomUUID();
    const intent = await payments.createIntent(TENANT, buyer, `idem-${randomUUID()}`, { purpose: 'wallet_recharge', amountMinor: AMOUNT.toString(), currencyCode: 'INR' } as any);
    expect(intent.provider).toBe('sandbox'); // the exact condition the mobile client checks before calling this

    const result = await payments.devCompleteSandboxPayment(TENANT, actorFor(buyer), intent.paymentId);
    expect(result.status).toBe('success');
    expect(wallet.posts.length).toBe(1); // exactly one zero-sum ledger move
  });

  it('is idempotent — calling it again after capture does not move money twice', async () => {
    const { payments, wallet } = buildService();
    const buyer = randomUUID();
    const intent = await payments.createIntent(TENANT, buyer, `idem-${randomUUID()}`, { purpose: 'wallet_recharge', amountMinor: AMOUNT.toString(), currencyCode: 'INR' } as any);
    await payments.devCompleteSandboxPayment(TENANT, actorFor(buyer), intent.paymentId);
    const again = await payments.devCompleteSandboxPayment(TENANT, actorFor(buyer), intent.paymentId);
    expect(again.status).toBe('success');
    expect(wallet.posts.length).toBe(1); // unchanged — no double credit
  });

  it('404s (anti-IDOR) when a different user tries to complete someone else\'s payment', async () => {
    const { payments } = buildService();
    const owner = randomUUID();
    const intent = await payments.createIntent(TENANT, owner, `idem-${randomUUID()}`, { purpose: 'wallet_recharge', amountMinor: AMOUNT.toString(), currencyCode: 'INR' } as any);
    const attacker = randomUUID();
    await expect(payments.devCompleteSandboxPayment(TENANT, actorFor(attacker), intent.paymentId)).rejects.toBeInstanceOf(PaymentNotFoundError);
  });

  it('refuses (BadRequestError, money NOT moved) a payment that is not on the sandbox gateway', async () => {
    const { payments, wallet, paymentRepo } = buildService();
    const buyer = randomUUID();
    // Hand-craft a 'razorpay' payment directly in the fake repo (bypassing createIntent, which would
    // never assign this providerCode while only the sandbox gateway is registered) to prove the guard
    // holds even if a sandbox-only payment id were somehow guessed/forged against a real payment.
    const razorpayPayment = Payment.initiate({
      id: uuidv7(), tenantId: TENANT, userId: buyer, purposeId: 'purpose-wallet-recharge', referenceType: null,
      referenceId: null, amountMinor: AMOUNT, currencyCode: 'INR', providerCode: 'razorpay', idempotencyKey: `idem-${randomUUID()}`,
    });
    await paymentRepo.insert(new FakeTx(TENANT), razorpayPayment);

    await expect(payments.devCompleteSandboxPayment(TENANT, actorFor(buyer), razorpayPayment.id)).rejects.toBeInstanceOf(BadRequestError);
    expect(wallet.posts.length).toBe(0);
  });
});
