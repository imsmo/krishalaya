// modules/payments/services/payment.service.ts
// Money-IN use-cases. Every write: one ACID tx (UoW) → ledger move via the WALLET port (the only
// money writer, Law 2) → status via the state machine (Law 5) → outbox event in the SAME tx
// (Law 4) → audit. Idempotent (Law 3): create on the caller's key, webhook on the gateway event
// id. The webhook is unauthenticated — verified by signature, tenant taken from the signed notes.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { platform, userMain, PlatformAccount } from '../../../core/wallet/account-codes';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Payment } from '../domain/payment.entity';
import { DomainEvent } from '../domain/payments.events';
import { PaymentRepository } from '../repositories/payment.repository';
import { GatewayRegistry } from '../gateway/gateway.registry';
import { SandboxGateway } from '../gateway/sandbox.gateway';
import { CreatePaymentIntentDto, RefundPaymentDto } from '../dto/create-payment.dto';
import { PaymentNotFoundError, WebhookSignatureError, PaymentAmountMismatchError, PaymentCurrencyMismatchError, InsufficientWalletBalanceError, OrderPaymentAmountMismatchError, PaymentOrderReferenceInvalidError } from '../domain/payments.errors';
import { BadRequestError, InfraError } from '../../../shared/errors/app-error';
// S6 device-test P0 (founder's device 201'd an intent against a demo-seed order that GET /v1/orders/:id
// correctly 404s for him — payments accepted what orders rejects). createIntent must fail CLOSED before
// ever calling the (real, billable) gateway when referenceType==='order': existence + ownership + payable
// state + exact amount, mirroring the orders module's own anti-IDOR contract (404, never 403 — no
// enumeration). OrderRepository is a plain provider in PaymentsModule (READ_REPLICA is @Global), not a
// module import — OrdersModule already imports PaymentsModule, so the reverse module import would cycle.
import { OrderRepository } from '../../orders/repositories/order.repository';
import { OrderNotFoundError, OrderNotAwaitingPaymentError } from '../../orders/domain/orders.errors';
import { SaasInvoiceService } from '../../tenancy/services/saas-invoice.service';
import { FlagsService } from '../../../core/feature-flags/flags.service';

export interface PaymentActor { userId: string; canModerate: boolean; }

@Injectable()
export class PaymentService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly audit: AuditWriter,
    private readonly repo: PaymentRepository,
    private readonly gateways: GatewayRegistry,
    private readonly orders: OrderRepository,
    // PC-56 TENANT-4d-2: the tenancy module's PUBLIC invoice service, for the 'saas_invoice' reference guard
    // below. TenancyModule is already in this module's imports (for TenantService) and exports this service.
    private readonly saasInvoices: SaasInvoiceService,
    private readonly flags: FlagsService,
  ) {}

  /** Create a payment intent: persist 'initiated' + create the gateway order, in one tx. */
  async createIntent(tenantId: string, userId: string, idemKey: string, dto: CreatePaymentIntentDto) {
    return this.idem.remember(idemKey, userId, 'payments.create_intent', () =>
      timed(this.metrics, 'payments.create_intent', { tenant: tenantId }, async () => {
        const purposeId = await this.repo.resolvePurposeId(tenantId, dto.purpose);
        if (!purposeId) throw new BadRequestError(`Unknown payment purpose '${dto.purpose}'`);
        await this.assertValidReference(tenantId, userId, dto);   // fail-closed BEFORE the external gateway call
        const gateway = this.gateways.default();
        const id = uuidv7();
        const payment = Payment.initiate({
          id, tenantId, userId, purposeId, referenceType: dto.referenceType ?? null, referenceId: dto.referenceId ?? null,
          amountMinor: BigInt(dto.amountMinor), currencyCode: dto.currencyCode, providerCode: gateway.providerCode, idempotencyKey: idemKey,
        });
        // Create the gateway order OUTSIDE the DB tx (external call), then persist with its id.
        const order = await gateway.createOrder({
          amountMinor: payment.amountMinor, currencyCode: dto.currencyCode, receipt: id,
          notes: { tenant_id: tenantId, payment_id: id },   // echoed back in the signed webhook
        });
        payment.attachGatewayOrder(order.gatewayOrderId);

        return this.uow.run(tenantId, async (tx) => {
          await this.repo.insert(tx, payment);
          await this.flush(tx, tenantId, id, payment.pullEvents());
          return { paymentId: id, gatewayOrderId: order.gatewayOrderId, provider: gateway.providerCode, amountMinor: dto.amountMinor, status: payment.status };
        }, { userId });
      }));
  }

  /** S6 device-test P0 fix. Validates `dto.referenceType`/`referenceId` BEFORE any gateway call — a
   *  gateway order is real money-in-motion; it must never be created against a reference the caller
   *  doesn't own, that doesn't exist, that isn't awaiting payment, or whose price doesn't match.
   *  Only 'order' has an owning repo wired into this module today (OrderRepository, a plain provider
   *  in PaymentsModule — see the import comment above). Other referenceTypes this DTO already accepts
   *  in production ('membership', 'auction', 'saas_invoice' — see each module's own
   *  payments.payment_succeeded consumer) are NOT validated here: none of those modules' repositories
   *  are wired into PaymentsModule, and reaching into them would add three more cross-module read
   *  dependencies beyond this fix's scope. Their consumers no-op on an unrecognised/foreign
   *  referenceId, which bounds the blast radius to "payment captured, nothing applied" rather than a
   *  wrong party's record being advanced — but a bogus reference of THOSE types still gets a real
   *  gateway order today. Tracked as follow-on hardening (see the payments module README). */
  private async assertValidReference(tenantId: string, userId: string, dto: CreatePaymentIntentDto): Promise<void> {
    // PC-56 TENANT-4d-2: 'saas_invoice' is the second referenceType to be validated here, which is the
    // "follow-on hardening" the comment above names. W2428 lets a tenant pay its own SaaS bill, and without
    // this guard the amount would be whatever the caller typed: a ₹1 intent against a ₹7,954 invoice would
    // capture, the invoice would go `partially_paid`, and the tenant would believe it had paid. TenancyModule
    // is ALREADY imported by this module and SaasInvoiceService is its PUBLIC service (never its repository),
    // so this adds no new coupling — only the check that was missing.
    if (dto.referenceType === 'saas_invoice') {
      if (!dto.referenceId) throw new BadRequestError("referenceId is required when referenceType is 'saas_invoice'");
      const selfPay = await this.flags.isEnabled('saas_invoice_self_pay', { tenantId }).catch(() => false);
      // Throws by name when the invoice is unpayable, in another currency, or the amount is not EXACTLY what
      // is outstanding. Fail closed, before the (real, billable) gateway call.
      await this.saasInvoices.assertPayableAmount(tenantId, dto.referenceId, BigInt(dto.amountMinor), dto.currencyCode.toUpperCase(), selfPay);
      return;
    }
    if (dto.referenceType !== 'order') return;
    if (!dto.referenceId) throw new BadRequestError("referenceId is required when referenceType is 'order'");
    // Read-only, no lock: the gateway call happens OUTSIDE any tx (Law: never hold a row lock across an
    // external HTTP call). Buyer-or-seller visible read, then narrowed to BUYER ONLY below — a seller
    // must not be able to spin up a payment intent against their own sale. Anti-IDOR: nonexistent AND
    // not-the-buyer's both collapse to the SAME 404 (OrderNotFoundError) — mirrors GET /v1/orders/:id
    // exactly (never 403; no enumeration of which order ids exist).
    const order = await this.orders.getVisible(tenantId, dto.referenceId, userId, false);
    if (!order || order.buyerUserId !== userId) throw new OrderNotFoundError(dto.referenceId);
    const p = order.toProps();
    if (p.status !== 'payment_pending') throw new OrderNotAwaitingPaymentError(p.id, p.status);   // already paid / cancelled / etc.
    if (p.currencyCode.toUpperCase() !== dto.currencyCode.toUpperCase()) throw new BadRequestError('Payment currency does not match the order currency');
    if (BigInt(dto.amountMinor) !== p.totalMinor) throw new OrderPaymentAmountMismatchError(p.totalMinor, BigInt(dto.amountMinor));  // exact match only — no partial pay at pilot
  }

  /** Gateway webhook (unauthenticated). Verify signature → idempotent on the event id → move money.
   *  `deliveryEventId` is the provider's canonical delivery id (Razorpay `x-razorpay-event-id` header) — the
   *  most robust dedup key for replays; we prefer it over the body-derived id when present. */
  async handleWebhook(providerCode: string, rawBody: string, signature: string, deliveryEventId?: string) {
    const gateway = this.gateways.get(providerCode);
    if (!gateway.verifySignature(rawBody, signature)) throw new WebhookSignatureError();   // fail closed
    const event = gateway.parseEvent(rawBody);
    if (event.kind === 'ignored') return { ok: true, ignored: true };
    if (!event.tenantId || !event.gatewayOrderId) throw new BadRequestError('webhook missing tenant/order context');
    const idemKey = deliveryEventId && deliveryEventId.length > 0 ? deliveryEventId : event.eventId;

    return this.idem.remember(idemKey, 'system', `payments.webhook.${providerCode}`, () =>
      timed(this.metrics, 'payments.webhook', { provider: providerCode, kind: event.kind }, async () =>
        this.uow.run(event.tenantId!, async (tx) => {
          const payment = await this.repo.getByGatewayOrderForUpdate(tx, event.tenantId!, event.gatewayOrderId!);
          if (!payment) return { ok: true, unknown: true };          // not ours / already gone

          if (event.kind === 'payment_captured') {
            if (event.amountMinor !== undefined && event.amountMinor !== payment.amountMinor) {
              throw new PaymentAmountMismatchError(payment.amountMinor, event.amountMinor); // tamper guard
            }
            if (event.currencyCode !== undefined && event.currencyCode.toUpperCase() !== payment.currencyCode.toUpperCase()) {
              throw new PaymentCurrencyMismatchError(payment.currencyCode, event.currencyCode); // tamper guard
            }
            // S6 defense-in-depth: re-verify the referenced order, INSIDE this tx, immediately before
            // moving money. createIntent validated buyer/state/amount ONCE at intent-creation time; this
            // closes the window until capture (seconds to days later — e.g. the order got cancelled or
            // disputed meanwhile). FOR UPDATE is correct here (unlike createIntent): we're already inside
            // the money-moving tx, about to credit escrow. Only 'order' has an owning repo wired into
            // this module (see assertValidReference); other referenceTypes are not re-checked here either.
            const pp = payment.toProps();
            if (pp.referenceType === 'order' && pp.referenceId) {
              const order = await this.orders.getForUpdate(tx, payment.tenantId, pp.referenceId);
              if (!order) throw new PaymentOrderReferenceInvalidError(payment.id, 'not_found');
              const op = order.toProps();
              if (op.buyerUserId !== payment.userId) throw new PaymentOrderReferenceInvalidError(payment.id, 'wrong_buyer');
              if (op.status !== 'payment_pending') throw new PaymentOrderReferenceInvalidError(payment.id, 'wrong_state');
              if (op.totalMinor !== payment.amountMinor) throw new PaymentOrderReferenceInvalidError(payment.id, 'amount_drift');
            }
            // money arrives: external funds (platform gateway account) → platform escrow. Zero-sum.
            const txn = await this.wallet.post(tx, {
              tenantId: payment.tenantId, txnType: 'order_payment', idempotencyKey: `pay:${payment.id}`,
              referenceType: 'payment', referenceId: payment.id, initiatedBy: payment.userId,
              legs: [
                { account: platform(PlatformAccount.Escrow), amountMinor: payment.amountMinor },
                { account: platform(PlatformAccount.Gateway), amountMinor: -payment.amountMinor },
              ],
            });
            const changed = payment.markCaptured(event.gatewayPaymentId ?? '', event.method ?? null, txn.txnId);
            if (changed) {
              await this.repo.update(tx, payment);
              await this.flush(tx, payment.tenantId, payment.id, payment.pullEvents());
              await this.audit.write(tx, { tenantId: payment.tenantId, actorUserId: payment.userId, action: 'payment.captured', entityType: 'payment', entityId: payment.id, newValue: { status: 'success' }, ip: null });
            }
          } else if (event.kind === 'payment_failed') {
            if (payment.markFailed(event.failureCode ?? null, event.failureReason ?? null)) {
              await this.repo.update(tx, payment);
              await this.flush(tx, payment.tenantId, payment.id, payment.pullEvents());
            }
          }
          return { ok: true };
        }, { userId: 'system' })));
  }

  /** DEV-ONLY: complete a SANDBOX-provider payment by driving it through the EXACT SAME signed-webhook
   *  path a real gateway delivery takes (`handleWebhook` above) — no shortcut through the money-moving
   *  code. Lets a local build with no real PSP configured (payments.module.ts then defaults every intent
   *  to the deterministic sandbox gateway) prove the wallet top-up loop end-to-end: createIntent → this
   *  → wallet credited, exactly like staging-smoke / the integration suite already do by POSTing a
   *  hand-signed webhook. The HMAC secret never leaves this process — we ask the SandboxGateway to sign
   *  its own synthetic event, then hand the body+signature to the real `handleWebhook`.
   *
   *  Safe by construction, not just by convention: this only ever succeeds when the payment's
   *  `providerCode` is literally 'sandbox', which can only be true when the SandboxGateway was
   *  registered for this tenant's gateway calls — and payments.module.ts registers it ONLY when
   *  `allowSandbox` (`NODE_ENV !== 'production'`) is true. A production-created payment is always
   *  'razorpay' (assertProductionSecurity requires a real PSP before boot), so this is inert there
   *  regardless of who calls it. `getVisible` also scopes the read to the caller's own payment (or a
   *  moderator) — 404, never 403, mirroring the rest of this module's anti-IDOR contract. */
  async devCompleteSandboxPayment(tenantId: string, actor: PaymentActor, paymentId: string) {
    const payment = await this.repo.getVisible(tenantId, paymentId, actor.userId, actor.canModerate);
    if (!payment) throw new PaymentNotFoundError(paymentId);
    const p = payment.toProps();
    if (p.providerCode !== 'sandbox') {
      throw new BadRequestError('This payment is not on the sandbox gateway; dev-complete is unavailable (a real payment gateway is configured)');
    }
    if (p.status !== 'initiated') return this.getById(tenantId, actor, paymentId); // already terminal — idempotent no-op
    const gateway = this.gateways.get('sandbox') as SandboxGateway;
    const body = JSON.stringify({
      id: `evt_dev_${paymentId}`, event: 'payment.captured', tenant_id: tenantId,
      order_id: p.gatewayOrderId, payment_id: `dev_${paymentId}`,
      amount: Number(p.amountMinor), currency: p.currencyCode, method: 'dev_sandbox',
    });
    await this.handleWebhook('sandbox', body, gateway.sign(body));
    return this.getById(tenantId, actor, paymentId);
  }

  /** Refund (full or partial): reverse the escrow leg + record on the payment. Admin/moderator.
   *  Issuing the PSP card/UPI refund is confirmed via the 'refund.processed' webhook (next wave);
   *  this performs the LEDGER reversal + status transition that the platform controls. */
  async refund(tenantId: string, actor: PaymentActor, paymentId: string, dto: RefundPaymentDto, ip: string | null) {
    if (!actor.canModerate) throw new InfraError('PAYMENT_REFUND_FORBIDDEN', 'refund requires moderator', {});
    return timed(this.metrics, 'payments.refund', { tenant: tenantId }, async () =>
      this.uow.run(tenantId, async (tx) => {
        const payment = await this.repo.getForUpdate(tx, tenantId, paymentId);
        if (!payment) throw new PaymentNotFoundError(paymentId);
        const amount = BigInt(dto.amountMinor);
        const txn = await this.wallet.post(tx, {
          tenantId, txnType: 'escrow_release', idempotencyKey: `refund:${paymentId}:${payment.refundableMinor}`,
          referenceType: 'payment', referenceId: paymentId, initiatedBy: actor.userId,
          legs: [
            { account: platform(PlatformAccount.Gateway), amountMinor: amount },
            { account: platform(PlatformAccount.Escrow), amountMinor: -amount },
          ],
        });
        payment.refund(amount, txn.txnId);
        await this.repo.update(tx, payment);
        await this.flush(tx, tenantId, paymentId, payment.pullEvents());
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'payment.refunded', entityType: 'payment', entityId: paymentId, newValue: { refundedMinor: amount.toString(), reason: dto.reason ?? null }, ip });
        return { paymentId, status: payment.status, refundedMinor: amount.toString() };
      }, { userId: actor.userId }));
  }

  /** Pay an order from the buyer's OWN wallet balance (no gateway). Mirrors a gateway capture's money
   *  move, but the source is the user's wallet rather than the platform gateway account: user main →
   *  platform escrow (zero-sum). Records a 'wallet'-provider Payment in 'success' and emits
   *  payments.payment_succeeded (referenceType 'order') so the existing orders handler confirms the
   *  order — exactly like the gateway path. Runs inside the CALLER'S tx (the orders service owns the
   *  order load/verify + caller-key idempotency). Fails CLOSED when the wallet can't cover it in full.
   *  Money is idempotent on the order (ledger key `walletpay:<orderId>`) so a retry never double-debits. */
  async captureOrderFromWalletInTx(tx: TxContext, input: { tenantId: string; buyerUserId: string; orderId: string; amountMinor: bigint; currencyCode: string }): Promise<{ paymentId: string; ledgerTxnId: string }> {
    const purposeId = await this.repo.resolvePurposeId(input.tenantId, 'direct_order');
    if (!purposeId) throw new BadRequestError("Unknown payment purpose 'direct_order'");
    const buyer = userMain(input.buyerUserId, input.currencyCode);
    const available = await this.wallet.balanceMinor(tx, buyer);              // server-truth spendable balance
    if (available < input.amountMinor) throw new InsufficientWalletBalanceError(input.amountMinor, available);
    const id = uuidv7();
    const payment = Payment.initiate({
      id, tenantId: input.tenantId, userId: input.buyerUserId, purposeId, referenceType: 'order', referenceId: input.orderId,
      amountMinor: input.amountMinor, currencyCode: input.currencyCode, providerCode: 'wallet', idempotencyKey: `walletpay:${input.orderId}`,
    });
    // money MOVES (Law 11): buyer's wallet → platform escrow, in the caller's tx, idempotent on the order.
    const txn = await this.wallet.post(tx, {
      tenantId: input.tenantId, txnType: 'order_payment', idempotencyKey: `walletpay:${input.orderId}`,
      referenceType: 'payment', referenceId: id, initiatedBy: input.buyerUserId,
      legs: [
        { account: platform(PlatformAccount.Escrow, input.currencyCode), amountMinor: input.amountMinor },
        { account: buyer, amountMinor: -input.amountMinor },
      ],
    });
    payment.markCaptured(`wallet:${id}`, 'wallet', txn.txnId);                // → emits payments.payment_succeeded
    await this.repo.insert(tx, payment);
    await this.flush(tx, input.tenantId, id, payment.pullEvents());
    await this.audit.write(tx, { tenantId: input.tenantId, actorUserId: input.buyerUserId, action: 'payment.wallet_captured', entityType: 'payment', entityId: id, newValue: { status: 'success', orderId: input.orderId, amountMinor: input.amountMinor.toString() }, ip: null });
    return { paymentId: id, ledgerTxnId: txn.txnId };
  }

  async getById(tenantId: string, actor: PaymentActor, id: string) {
    const payment = await this.repo.getVisible(tenantId, id, actor.userId, actor.canModerate);
    if (!payment) throw new PaymentNotFoundError(id);
    return this.serialize(payment.toProps());
  }

  async list(tenantId: string, userId: string, q: { cursor?: { c: string; id: string }; limit: number }) {
    const items = (await this.repo.listForUser(tenantId, userId, q)).map((p) => this.serialize(p.toProps()));
    const last = items[items.length - 1];
    return { items, nextCursor: items.length === q.limit && last ? Buffer.from(`${last.createdAt}|${last.id}`).toString('base64') : null };
  }

  private serialize(p: ReturnType<Payment['toProps']>) {
    return { id: p.id, status: p.status, amountMinor: p.amountMinor.toString(), refundedMinor: p.refundedMinor.toString(),
      currencyCode: p.currencyCode, provider: p.providerCode, method: p.method, referenceType: p.referenceType,
      referenceId: p.referenceId, gatewayOrderId: p.gatewayOrderId, createdAt: p.createdAt };
  }

  private async flush(tx: TxContext, tenantId: string, paymentId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'payment', aggregateId: paymentId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
