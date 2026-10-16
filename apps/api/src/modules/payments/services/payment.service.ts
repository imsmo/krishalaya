// modules/payments/services/payment.service.ts
// Money-IN use-cases. Every write: one ACID tx (UoW) → ledger move via the WALLET port (the only
// money writer, Law 2) → status via the state machine (Law 5) → outbox event in the SAME tx
// (Law 4) → audit. Idempotent (Law 3): create on the caller's key, webhook on the gateway event
// id. The webhook is unauthenticated — verified by signature; the tenant comes from OUR payment row (HOTFIX-4 · A4), notes cross-check.
import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { PaymentNotFoundError, WebhookSignatureError, PaymentAmountMismatchError, PaymentCurrencyMismatchError, InsufficientWalletBalanceError, OrderPaymentAmountMismatchError, PaymentOrderReferenceInvalidError, WebhookContextMismatchError, LateCaptureSameAttemptError, PaymentAttemptLiveError, RefundGatewayReferenceMissingError,
  PaymentRefundInFlightError, ResolutionRefundExceedsRefundableError } from '../domain/payments.errors';
import { ResolutionRefundKind, RESOLUTION_REFUND_TXN_TYPE, RESOLUTION_GATEWAY_ENDPOINT, resolutionRefundKey, resolutionGatewayRefundKey, resolutionRefundReason } from '../domain/resolution-refund';
import { attemptExpiresAt, chargedNothing, failureReasonCode, isLapsedAttempt, isLiveAttempt } from '../domain/payment-attempt';
import type { PostTxnResult } from '../../../core/wallet/wallet.port';
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

/** PC-56 STORE-3a · B3 (survey B11) — THE BUYER'S REFUND READ for one order, from its captured payment (the payment row's own facts, 0210):
 *    none      nothing was captured, or the capture stands unrefunded
 *    initiated the refund was booked (escrow → source, `refund:<orderId>`) and asked of the provider; awaiting its confirmation
 *    refunded  the source confirmed the whole amount         partial  the source confirmed part of it (a desk refund)
 *  `gatewayRefundId` is the provider's reference the buyer may quote (`rfnd_…`) — nothing else about the gateway leaves the API. */
export interface OrderRefundView {
  state: 'none' | 'initiated' | 'refunded' | 'partial'; amountMinor: string; currencyCode: string | null;
  initiatedAt: string | null; completedAt: string | null; gatewayRefundId: string | null;
}
export function refundView(p: Payment | null): OrderRefundView {
  if (!p) return { state: 'none', amountMinor: '0', currencyCode: null, initiatedAt: null, completedAt: null, gatewayRefundId: null };
  const v = p.toProps();
  const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
  const state: OrderRefundView['state'] = v.status === 'refund_initiated' ? 'initiated' : v.status === 'refunded' ? 'refunded' : v.status === 'partially_refunded' ? 'partial' : 'none';
  return { state, amountMinor: state === 'none' ? '0' : v.refundedMinor.toString(), currencyCode: v.currencyCode,
    initiatedAt: state === 'none' ? null : iso(v.refundInitiatedAt), completedAt: state === 'refunded' || state === 'partial' ? iso(v.refundedAt) : null,
    gatewayRefundId: state === 'refunded' || state === 'partial' ? (v.gatewayRefundId ?? null) : null };
}

@Injectable()
export class PaymentService {
  private readonly log = new Logger(PaymentService.name);
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

  /** Create a payment intent: persist 'initiated' + create the gateway order, in one tx.
   *  PC-56 STORE-2c · B3 (survey B6 / F-4): for an ORDER, one LIVE attempt at a time — a second is refused PAYMENT_ATTEMPT_LIVE {paymentId,
   *  expiresAt} (checked before the gateway call, and again under the order's row lock inside the insert tx, so two racing requests cannot both
   *  pass); a previous attempt that FAILED or LAPSED (`platform.payment_attempt_ttl_seconds`) allows a NEW one — a new gateway order and a new
   *  row; a lapsed one is marked `expired` (its late capture is still booked once: payment.state `expired → success`). The caller's key is the
   *  attempt's (`order-pay:<orderId>:<attempt>` from the storefront): a replay returns the SAME attempt. */
  async createIntent(tenantId: string, userId: string, idemKey: string, dto: CreatePaymentIntentDto) {
    return this.idem.remember(idemKey, userId, 'payments.create_intent', () =>
      timed(this.metrics, 'payments.create_intent', { tenant: tenantId }, async () => {
        const purposeId = await this.repo.resolvePurposeId(tenantId, dto.purpose);
        if (!purposeId) throw new BadRequestError(`Unknown payment purpose '${dto.purpose}'`);
        await this.assertValidReference(tenantId, userId, dto);   // fail-closed BEFORE the external gateway call
        const orderRef = dto.referenceType === 'order' && dto.referenceId ? dto.referenceId : null;
        const ttl = orderRef ? await this.repo.attemptTtlSeconds(tenantId) : null;
        if (orderRef) {
          // the fast refusal (no gateway order is created for a request that would be refused below anyway)
          const live = (await this.repo.attemptsForOrder(tenantId, orderRef, userId, false)).find((a) => isLiveAttempt(a.toProps(), ttl, new Date()));
          if (live) throw new PaymentAttemptLiveError(live.id, attemptExpiresAt(live.createdAt, ttl)?.toISOString() ?? null);
        }
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
          let attempt: number | null = null;
          if (orderRef) {
            // THE AUTHORITATIVE CHECK, serialised per order: the existing attempts' rows are locked FIRST (the webhook's lock order — payment,
            // then order), then the order row; the attempts are re-read after the order lock (READ COMMITTED: a racing attempt that committed
            // meanwhile is seen here) — a live one refuses, a lapsed one is marked `expired`. The gateway order created above for a refused
            // request is never shown to the buyer and never paid (named in the wave report).
            await this.repo.attemptsForOrderTx(tx, tenantId, orderRef, true);
            await this.orders.getForUpdate(tx, tenantId, orderRef);
            const prior = await this.repo.attemptsForOrderTx(tx, tenantId, orderRef, false);
            const now = new Date();
            const live = prior.find((a) => isLiveAttempt(a.toProps(), ttl, now));
            if (live) throw new PaymentAttemptLiveError(live.id, attemptExpiresAt(live.createdAt, ttl)?.toISOString() ?? null);
            for (const a of prior) {
              if (isLapsedAttempt(a.toProps(), ttl, now) && a.markExpired()) {
                await this.repo.update(tx, a);
                await this.audit.write(tx, { tenantId, actorUserId: userId, action: 'payment.attempt_lapsed', entityType: 'payment', entityId: a.id,
                  oldValue: { status: 'initiated' }, newValue: { status: 'expired', replacedBy: id, ttlSeconds: ttl }, ip: null });
              }
            }
            attempt = prior.length + 1;
          }
          await this.repo.insert(tx, payment);
          await this.flush(tx, tenantId, id, payment.pullEvents());
          return { paymentId: id, gatewayOrderId: order.gatewayOrderId, provider: gateway.providerCode, amountMinor: dto.amountMinor, status: payment.status,
            attempt, expiresAt: orderRef ? (attemptExpiresAt(payment.createdAt, ttl)?.toISOString() ?? null) : null };
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
    // PC-56 TENANT-11a (F-2): an auction order is paid by its BALANCE — the winner's EMD was applied to it in escrow at
    // settlement. Exact match on what is DUE (total − credit; credit 0 for every other order), never a partial pay.
    const due = p.totalMinor - (await this.repo.orderEmdCreditMinor(tenantId, p.id));
    if (BigInt(dto.amountMinor) !== due) throw new OrderPaymentAmountMismatchError(due, BigInt(dto.amountMinor));  // exact match only — no partial pay at pilot
  }

  /** Gateway webhook (unauthenticated). Verify signature → idempotent on the event id → move money.
   *  `deliveryEventId` is the provider's canonical delivery id (Razorpay `x-razorpay-event-id` header) — the
   *  most robust dedup key for replays; we prefer it over the body-derived id when present. */
  async handleWebhook(providerCode: string, rawBody: string, signature: string, deliveryEventId?: string) {
    const gateway = this.gateways.get(providerCode);
    if (!gateway.verifySignature(rawBody, signature)) throw new WebhookSignatureError();   // fail closed
    const event = gateway.parseEvent(rawBody);
    if (event.kind === 'ignored') return { ok: true, ignored: true };
    if (!event.gatewayOrderId) throw new BadRequestError('webhook missing gateway order');
    // PC-56 HOTFIX-4 · A4 (survey F-4b): the CONTEXT comes from OUR payment row, found by the gateway ORDER id (0206 definer lookup) — not
    // from `notes.tenant_id`, which the storefront's sheet never sets and the gateway may not copy from the order onto the payment. Notes
    // stay a cross-check: present and disagreeing → refused and logged, never trusted. Real Razorpay test-mode proof is still owed.
    const ctx = await this.repo.contextForGatewayOrder(providerCode, event.gatewayOrderId);
    if (!ctx) return { ok: true, unknown: true };                   // not ours (or ambiguous) — nothing is booked
    if (event.tenantId && event.tenantId !== ctx.tenantId) {
      this.log.warn(`payments.webhook context mismatch (tenant) provider=${providerCode} payment=${ctx.paymentId}`);
      throw new WebhookContextMismatchError('tenant_id');
    }
    if (event.notesPaymentId && event.notesPaymentId !== ctx.paymentId) {
      this.log.warn(`payments.webhook context mismatch (payment) provider=${providerCode} payment=${ctx.paymentId}`);
      throw new WebhookContextMismatchError('payment_id');
    }
    const tenantId = ctx.tenantId;
    const idemKey = deliveryEventId && deliveryEventId.length > 0 ? deliveryEventId : event.eventId;

    return this.idem.remember(idemKey, 'system', `payments.webhook.${providerCode}`, () =>
      timed(this.metrics, 'payments.webhook', { provider: providerCode, kind: event.kind }, async () =>
        this.uow.run(tenantId, async (tx) => {
          const payment = await this.repo.getByGatewayOrderForUpdate(tx, tenantId, event.gatewayOrderId!);
          if (!payment || payment.id !== ctx.paymentId) return { ok: true, unknown: true };   // not ours / already gone

          // PC-56 STORE-2c · B2 (founder D3): the gateway CONFIRMS a refund the platform asked for (Razorpay `refund.processed`) → `refunded`.
          // Only a payment the platform put in `refund_initiated` moves; a replay, or a refund made elsewhere (the gateway dashboard), books
          // nothing here — the ledger refund was booked when the platform asked (refundCancelledOrder), never on a webhook.
          if (event.kind === 'refund_processed') {
            if (payment.status !== 'refund_initiated') {
              this.log.warn(`payments.webhook refund.processed for a payment in '${payment.status}' — nothing to complete provider=${providerCode} payment=${payment.id}`);
              return { ok: true, duplicate: true };
            }
            const rp = payment.toProps();
            if (payment.completeRefund('order_cancelled', rp.referenceType === 'order' ? rp.referenceId : null, event.gatewayRefundId ?? null)) {
              await this.repo.update(tx, payment);
              await this.flush(tx, payment.tenantId, payment.id, payment.pullEvents());
              await this.audit.write(tx, { tenantId: payment.tenantId, actorUserId: null, action: 'payment.refund_processed', entityType: 'payment', entityId: payment.id,
                oldValue: { status: 'refund_initiated' }, newValue: { status: payment.status, gatewayRefundId: event.gatewayRefundId ?? null, via: 'webhook' }, ip: null });
            }
            return { ok: true };
          }

          if (event.kind === 'payment_captured') {
            // HOTFIX-4 · A3: a REPLAYED capture (same gateway payment id, already booked) is a no-op — before the order re-check below, which
            // would otherwise refuse it as `wrong_state` (the order is `confirmed` by then) and make the gateway retry forever.
            if (payment.isCaptureReplay(event.gatewayPaymentId)) return { ok: true, duplicate: true };
            if (payment.status === 'success') {
              // a DIFFERENT gateway payment captured on a gateway order already paid: not booked twice (the wallet key is per payment row),
              // and not silently dropped either — logged for the money desk.
              this.log.warn(`payments.webhook second capture on a paid gateway order provider=${providerCode} payment=${payment.id}`);
              return { ok: true, duplicate: true };
            }
            // HOTFIX-4 · A3: after a recorded failure, only ANOTHER attempt's capture is booked — refused by name BEFORE any money call
            if (payment.status === 'failed' && !payment.isLaterAttempt(event.gatewayPaymentId)) {
              this.log.warn(`payments.webhook capture of the failed attempt itself refused provider=${providerCode} payment=${payment.id}`);
              throw new LateCaptureSameAttemptError(payment.id);
            }
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
              // PC-56 STORE-3c · B1 (founder D2): ONE rule for the intent, the wallet pay and THIS capture — the payment must equal what is DUE
              // (total − the auction deposit applied to the order in escrow; the deposit is 0 for every non-auction order). A capture of the
              // TOTAL for an auction order is now the drift (it would over-fund escrow by the deposit); the balance is accepted.
              const due = await this.amountDueForOrderInTx(tx, payment.tenantId, op.id, op.totalMinor);
              if (due !== payment.amountMinor) throw new PaymentOrderReferenceInvalidError(payment.id, 'amount_drift');
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
            // HOTFIX-4 · A3: an earlier attempt's failure delivered AFTER another attempt was captured changes nothing (no legal edge back)
            if (payment.status === 'success') return { ok: true, superseded: true };
            // HOTFIX-4 · A3: the failed ATTEMPT's gateway payment id is recorded, so a later capture of ANOTHER attempt can be told apart
            if (payment.markFailed(event.failureCode ?? null, event.failureReason ?? null, event.gatewayPaymentId ?? null)) {
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
        // PC-56 STORE-2c · B2: the ONE refund posting function (the automatic refund posts through it too)
        const txn = await this.postRefundToSource(tx, { tenantId, payment, amountMinor: amount, txnType: 'escrow_release',
          idempotencyKey: `refund:${paymentId}:${payment.refundableMinor}`, initiatedBy: actor.userId });
        payment.refund(amount, txn.txnId);
        await this.repo.update(tx, payment);
        await this.flush(tx, tenantId, paymentId, payment.pullEvents());
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'payment.refunded', entityType: 'payment', entityId: paymentId, newValue: { refundedMinor: amount.toString(), reason: dto.reason ?? null }, ip });
        return { paymentId, status: payment.status, refundedMinor: amount.toString() };
      }, { userId: actor.userId }));
  }

  /**
   * PC-56 STORE-2c · B2 (founder D3) — THE ONE REFUND POSTING FUNCTION: escrow → the money's SOURCE, zero-sum, in the caller's tx.
   *   • a GATEWAY payment (card / UPI / netbanking): `platform:gateway +amount · platform:escrow −amount` — byte-for-byte the legs the moderator
   *     refund has always posted (the mirror of the capture's `escrow + · gateway −`, both in the capture's account currency);
   *   • a WALLET payment (paid from the buyer's balance): `user:<buyer>:main +amount · platform:escrow −amount` in the payment's currency — the
   *     mirror of `captureOrderFromWalletInTx`'s legs. Before this wave the moderator refund credited the GATEWAY account for a wallet payment
   *     too — money that never came from the gateway (named in the wave report §9).
   * Idempotent on `idempotencyKey` (the wallet's unique key): the moderator's `refund:<paymentId>:<refundable>`, the automatic
   * `refund:<orderId>`.
   */
  // PC-56 HOTFIX-7 · D3: + txnType `refund` (the dispute / return refund — the type those refunds always posted under) and an optional ledger
  // reference (a resolution refund keeps `dispute` / `return` + its id, as the handlers recorded it before). The legs are unchanged.
  private postRefundToSource(tx: TxContext, p: { tenantId: string; payment: Payment; amountMinor: bigint; txnType: 'escrow_release' | 'order_cancel_refund' | typeof RESOLUTION_REFUND_TXN_TYPE; idempotencyKey: string; initiatedBy: string;
    reference?: { type: string; id: string } }): Promise<PostTxnResult> {
    const fromWallet = p.payment.providerCode === 'wallet';
    const source = fromWallet ? userMain(p.payment.userId, p.payment.currencyCode) : platform(PlatformAccount.Gateway);
    const escrow = fromWallet ? platform(PlatformAccount.Escrow, p.payment.currencyCode) : platform(PlatformAccount.Escrow);
    return this.wallet.post(tx, {
      tenantId: p.tenantId, txnType: p.txnType, idempotencyKey: p.idempotencyKey, referenceType: p.reference?.type ?? 'payment', referenceId: p.reference?.id ?? p.payment.id, initiatedBy: p.initiatedBy,
      legs: [{ account: source, amountMinor: p.amountMinor }, { account: escrow, amountMinor: -p.amountMinor }],
    });
  }

  /**
   * PC-56 STORE-2c · B2 (founder D3) — THE AUTOMATIC REFUND OF A CANCELLED, PAID ORDER, TO SOURCE (OrderCancelledRefundHandler calls this on
   * `orders.order_cancelled` — the buyer's cancel, the seller's decline, the 24 h auto-cancel, a dispute that cancels).
   *   1. ONE kv_app transaction: the order's captured payment is found, LOCKED (payment, then order — the webhook's lock order); only an order
   *      that IS cancelled and a payment that is `success` with nothing refunded is refunded: the ledger `order_cancel_refund` (escrow −,
   *      source +, key `refund:<orderId>`) through `postRefundToSource`; the payment → `refund_initiated`; audit `payment.auto_refunded`.
   *      A wallet payment's refund lands in the wallet in that same transaction → `refunded` + `payments.payment_refunded` at once.
   *   2. A gateway payment: the gateway's refund (the port), OUTSIDE any transaction (never a row lock across HTTP), behind the idempotency
   *      service (`gateway-refund:<paymentId>`) so a retry never asks twice. `processed` (the sandbox; an instant refund) → `refunded` +
   *      `payments.payment_refunded` now; `pending` (Razorpay's normal answer) → stays `refund_initiated` until `refund.processed` arrives on
   *      the webhook (handleWebhook). A failed gateway call THROWS — the relay retries; the ledger refund already stands (escrow can no longer
   *      be settled to the seller) and the payment says `refund_initiated` until the gateway answers.
   * IDEMPOTENT end to end: a replayed event finds `refund_initiated` / `refunded` and books nothing (the ledger key would refuse a second post
   * anyway). An UNPAID order (no captured payment — online payments off, or never paid) books nothing. A payment the money desk already refunded
   * (wholly or partly) is left to the desk (logged).
   */
  async refundCancelledOrder(tenantId: string, orderId: string): Promise<{ outcome: 'unpaid' | 'not_cancelled' | 'refunded' | 'pending_gateway' | 'already'; paymentId?: string; ledgerTxnId?: string }> {
    return timed(this.metrics, 'payments.auto_refund', { tenant: tenantId }, async () => {
      const booked = await this.uow.run(tenantId, async (tx) => {
        const found = await this.repo.capturedForOrderTx(tx, tenantId, orderId);
        if (!found) return { outcome: 'unpaid' as const };
        const payment = await this.repo.getForUpdate(tx, tenantId, found.id);
        if (!payment) return { outcome: 'unpaid' as const };
        const order = await this.orders.getForUpdate(tx, tenantId, orderId);
        if (!order || order.status !== 'cancelled') return { outcome: 'not_cancelled' as const, paymentId: payment.id };
        if (payment.status === 'refund_initiated') return { outcome: 'pending_gateway' as const, payment };
        if (payment.status !== 'success' || payment.refundedMinor !== 0n) {
          if (payment.status === 'partially_refunded') this.log.warn(`payments.auto_refund order=${orderId} payment=${payment.id} was partly refunded by the desk — the remainder is the desk's`);
          return { outcome: 'already' as const, paymentId: payment.id };
        }
        const amount = payment.amountMinor;
        const txn = await this.postRefundToSource(tx, { tenantId, payment, amountMinor: amount, txnType: 'order_cancel_refund', idempotencyKey: `refund:${orderId}`, initiatedBy: 'system' });
        payment.initiateRefund(amount);
        const fromWallet = payment.providerCode === 'wallet';
        if (fromWallet) payment.completeRefund('order_cancelled', orderId, null);   // the money is already back in the buyer's wallet
        await this.repo.update(tx, payment);
        await this.flush(tx, tenantId, payment.id, payment.pullEvents());
        await this.audit.write(tx, { tenantId, actorUserId: null, action: 'payment.auto_refunded', entityType: 'payment', entityId: payment.id,
          oldValue: { status: 'success' }, newValue: { status: payment.status, orderId, refundedMinor: amount.toString(), currencyCode: payment.currencyCode,
            ledgerTxnId: txn.txnId, idempotencyKey: `refund:${orderId}`, source: fromWallet ? 'wallet' : payment.providerCode, reason: 'order_cancelled' }, ip: null });
        this.metrics.inc('payments.auto_refund_booked', { tenant: tenantId, source: fromWallet ? 'wallet' : 'gateway' });
        return fromWallet
          ? { outcome: 'refunded' as const, paymentId: payment.id, ledgerTxnId: txn.txnId }
          : { outcome: 'pending_gateway' as const, payment, ledgerTxnId: txn.txnId };
      }, { userId: 'system' });
      if (booked.outcome !== 'pending_gateway') return booked;

      // 2. the gateway's refund — outside any transaction, asked at most once
      const p = booked.payment;
      const gatewayPaymentId = p.gatewayPaymentId;
      if (!gatewayPaymentId) throw new RefundGatewayReferenceMissingError(p.id);
      const gateway = this.gateways.get(p.providerCode);
      const res = await this.idem.remember(`gateway-refund:${p.id}`, 'system', 'payments.gateway_refund', () =>
        gateway.refund({ gatewayPaymentId, amountMinor: p.refundedMinor, currencyCode: p.currencyCode, receipt: `refund:${orderId}`,
          notes: { tenant_id: tenantId, payment_id: p.id, order_id: orderId } }));
      if (res.status !== 'processed') return { outcome: 'pending_gateway', paymentId: p.id, ledgerTxnId: booked.ledgerTxnId };
      await this.uow.run(tenantId, async (tx) => {
        const locked = await this.repo.getForUpdate(tx, tenantId, p.id);
        if (locked && locked.completeRefund('order_cancelled', orderId, res.gatewayRefundId)) {
          await this.repo.update(tx, locked);
          await this.flush(tx, tenantId, locked.id, locked.pullEvents());
          await this.audit.write(tx, { tenantId, actorUserId: null, action: 'payment.refund_processed', entityType: 'payment', entityId: locked.id,
            oldValue: { status: 'refund_initiated' }, newValue: { status: locked.status, gatewayRefundId: res.gatewayRefundId, via: 'gateway_response' }, ip: null });
        }
      }, { userId: 'system' });
      return { outcome: 'refunded', paymentId: p.id, ledgerTxnId: booked.ledgerTxnId };
    });
  }

  /**
   * PC-56 HOTFIX-7 · D3 (founder Q3) — A DISPUTE OR RETURN REFUND GOES BACK TO THE SOURCE: one refund rule for the buyer, 2c's. Called by the two
   * payments handlers (dispute-resolved / return-refunded) for the BUYER's leg — which used to be `userMain(buyer)` (the buyer's wallet, whatever
   * they paid with) — mirroring refundCancelledOrder:
   *   1. ONE kv_app transaction: the order's captured payment found and LOCKED (the order row is NOT locked: the orders handler of the same
   *      event may hold it on the relay transaction); the ledger refund through `postRefundToSource` — escrow −amount · source +amount (the
   *      gateway account for a card / UPI payment, the buyer's wallet for a wallet payment), txn type `refund`, key `dispute-refund:<id>` /
   *      `return-refund:<id>`; the payment → `refund_initiated` for the amount (PARTIAL amounts supported; a further refund after an earlier
   *      partial one is allowed — `Payment.initiateRefund(…, { further })`); a WALLET payment completes in the same transaction (`refunded` /
   *      `partially_refunded` + `payments.payment_refunded`); audit `payment.resolution_refunded`.
   *   2. A gateway payment: the gateway's refund OUTSIDE any transaction, asked at most once per (payment, resolution) —
   *      `gateway-refund:<paymentId>:<referenceId>` (a second refund on the same payment has its own key). `processed` (the sandbox) → completed
   *      now; `pending` (Razorpay) → stays `refund_initiated` until `refund.processed` arrives on the webhook, which completes it as today.
   * IDEMPOTENT end to end: a replay finds its key booked and books nothing (a pending gateway answer is asked again under the same key). Another
   * refund still pending at the gateway → PAYMENT_REFUND_IN_FLIGHT (the relay retries); more than is refundable → RESOLUTION_REFUND_EXCEEDS_REFUNDABLE
   * (loud, for the money desk). No captured payment (pay-on-delivery) → `unpaid`, nothing booked.
   */
  async refundForResolution(tenantId: string, orderId: string, r: { referenceType: ResolutionRefundKind; referenceId: string; amountMinor: bigint }):
    Promise<{ outcome: 'unpaid' | 'refunded' | 'pending_gateway' | 'already'; paymentId?: string; ledgerTxnId?: string; source?: string; alreadyBooked?: boolean }> {
    const key = resolutionRefundKey(r.referenceType, r.referenceId);
    return timed(this.metrics, 'payments.resolution_refund', { tenant: tenantId, kind: r.referenceType }, async () => {
      const booked = await this.uow.run(tenantId, async (tx) => {
        const found = await this.repo.capturedForOrderTx(tx, tenantId, orderId);
        if (!found) return { outcome: 'unpaid' as const };
        const payment = await this.repo.getForUpdate(tx, tenantId, found.id);
        if (!payment) return { outcome: 'unpaid' as const };
        const prior = await this.repo.ledgerTxnIdByKeyTx(tx, key);
        if (prior) {
          // booked already (a replay, or a relay retry after the remainder failed): a gateway refund still unanswered is asked again under its key
          if (payment.status === 'refund_initiated' && payment.providerCode !== 'wallet') return { outcome: 'pending_gateway' as const, payment, ledgerTxnId: prior, alreadyBooked: true };
          return { outcome: 'already' as const, paymentId: payment.id, ledgerTxnId: prior, source: payment.providerCode };
        }
        if (payment.status === 'refund_initiated') throw new PaymentRefundInFlightError(payment.id, r.referenceType, r.referenceId);
        if (r.amountMinor <= 0n || r.amountMinor > payment.refundableMinor) throw new ResolutionRefundExceedsRefundableError(payment.id, r.amountMinor, payment.refundableMinor);
        const before = payment.status;
        const txn = await this.postRefundToSource(tx, { tenantId, payment, amountMinor: r.amountMinor, txnType: RESOLUTION_REFUND_TXN_TYPE, idempotencyKey: key,
          initiatedBy: 'system', reference: { type: r.referenceType, id: r.referenceId } });
        payment.initiateRefund(r.amountMinor, new Date(), { further: true });
        const fromWallet = payment.providerCode === 'wallet';
        if (fromWallet) payment.completeRefund(resolutionRefundReason(r.referenceType), orderId, null);   // the money is already back in the buyer's wallet
        await this.repo.update(tx, payment);
        await this.flush(tx, tenantId, payment.id, payment.pullEvents());
        await this.audit.write(tx, { tenantId, actorUserId: null, action: 'payment.resolution_refunded', entityType: 'payment', entityId: payment.id,
          oldValue: { status: before }, newValue: { status: payment.status, orderId, referenceType: r.referenceType, referenceId: r.referenceId, refundedMinor: r.amountMinor.toString(),
            totalRefundedMinor: payment.refundedMinor.toString(), currencyCode: payment.currencyCode, ledgerTxnId: txn.txnId, idempotencyKey: key,
            source: fromWallet ? 'wallet' : payment.providerCode }, ip: null });
        this.metrics.inc('payments.resolution_refund_booked', { tenant: tenantId, kind: r.referenceType, source: fromWallet ? 'wallet' : 'gateway' });
        return fromWallet
          ? { outcome: 'refunded' as const, paymentId: payment.id, ledgerTxnId: txn.txnId, source: 'wallet' }
          : { outcome: 'pending_gateway' as const, payment, ledgerTxnId: txn.txnId, alreadyBooked: false };
      }, { userId: 'system' });
      if (booked.outcome !== 'pending_gateway') return booked;

      // 2. the gateway's refund — outside any transaction, asked at most once per (payment, resolution)
      const p = booked.payment;
      const gatewayPaymentId = p.gatewayPaymentId;
      if (!gatewayPaymentId) throw new RefundGatewayReferenceMissingError(p.id);
      const gateway = this.gateways.get(p.providerCode);
      const res = await this.idem.remember(resolutionGatewayRefundKey(p.id, r.referenceId), 'system', RESOLUTION_GATEWAY_ENDPOINT, () =>
        gateway.refund({ gatewayPaymentId, amountMinor: r.amountMinor, currencyCode: p.currencyCode, receipt: key,
          notes: { tenant_id: tenantId, payment_id: p.id, order_id: orderId, [`${r.referenceType}_id`]: r.referenceId } }));
      if (res.status !== 'processed') return { outcome: 'pending_gateway', paymentId: p.id, ledgerTxnId: booked.ledgerTxnId, source: p.providerCode, alreadyBooked: booked.alreadyBooked };
      await this.uow.run(tenantId, async (tx) => {
        const locked = await this.repo.getForUpdate(tx, tenantId, p.id);
        if (locked && locked.completeRefund(resolutionRefundReason(r.referenceType), orderId, res.gatewayRefundId)) {
          await this.repo.update(tx, locked);
          await this.flush(tx, tenantId, locked.id, locked.pullEvents());
          await this.audit.write(tx, { tenantId, actorUserId: null, action: 'payment.refund_processed', entityType: 'payment', entityId: locked.id,
            oldValue: { status: 'refund_initiated' }, newValue: { status: locked.status, gatewayRefundId: res.gatewayRefundId, via: 'gateway_response', referenceType: r.referenceType, referenceId: r.referenceId }, ip: null });
        }
      }, { userId: 'system' });
      return { outcome: 'refunded', paymentId: p.id, ledgerTxnId: booked.ledgerTxnId, source: p.providerCode, alreadyBooked: booked.alreadyBooked };
    });
  }

  /** PC-56 STORE-2c · B3 / C5 — the storefront's read of an order's payment attempts: the newest (its state, failure reason code, expiry and
   *  number) and the number the NEXT attempt would carry (the storefront's key `order-pay:<orderId>:<attempt>`). Buyer (or a moderator) only. */
  async attemptsForOrder(tenantId: string, actor: PaymentActor, orderId: string) {
    const all = await this.repo.attemptsForOrder(tenantId, orderId, actor.userId, actor.canModerate);
    const ttl = await this.repo.attemptTtlSeconds(tenantId);
    const latest = all[0] ? this.serialize(all[0].toProps(), { attempt: all.length, ttl }) : null;
    const live = all.some((a) => isLiveAttempt(a.toProps(), ttl, new Date()));
    const captured = await this.repo.capturedForOrder(tenantId, orderId, actor.userId, actor.canModerate);
    return { latest, attempts: all.length, nextAttempt: all.length + 1, liveAttempt: live, ttlSeconds: ttl, refund: refundView(captured) };
  }

  /** PC-56 STORE-3a · B4 (survey B3): what an order still needs paid and the auction deposit already applied to it — THE rule the gateway intent
   *  (`assertValidReference`) and the wallet pay (`amountDueForOrderInTx`) apply: total − `orderEmdCreditMinor` (0 for every non-auction
   *  order). A read for the order page (replica); never a second formula. */
  async amountDueForOrder(tenantId: string, orderId: string, totalMinor: bigint): Promise<{ dueMinor: bigint; depositAppliedMinor: bigint }> {
    const credit = await this.repo.orderEmdCreditMinor(tenantId, orderId);
    return { dueMinor: totalMinor - credit, depositAppliedMinor: credit };
  }

  /** Pay an order from the buyer's OWN wallet balance (no gateway). Mirrors a gateway capture's money
   *  move, but the source is the user's wallet rather than the platform gateway account: user main →
   *  platform escrow (zero-sum). Records a 'wallet'-provider Payment in 'success' and emits
   *  payments.payment_succeeded (referenceType 'order') so the existing orders handler confirms the
   *  order — exactly like the gateway path. Runs inside the CALLER'S tx (the orders service owns the
   *  order load/verify + caller-key idempotency). Fails CLOSED when the wallet can't cover it in full.
   *  Money is idempotent on the order (ledger key `walletpay:<orderId>`) so a retry never double-debits. */
  /** PC-56 TENANT-11a (F-2): what an order still needs paid, in the caller's tx — its total less any auction deposit already
   *  credited to it in escrow (`emd_apply`). The wallet-pay door asks this; the gateway door applies the same rule above. */
  async amountDueForOrderInTx(tx: TxContext, tenantId: string, orderId: string, totalMinor: bigint): Promise<bigint> {
    return totalMinor - (await this.repo.orderEmdCreditMinor(tenantId, orderId, tx));
  }

  /** PC-56 STORE-3c · B7 (founder D7): was a payment CAPTURED for this order (its payment row `success`, or since refunded / being refunded)?
   *  Read in the CALLER's kv_app tx (the cancel's) — the order's timeline may not yet say `confirmed` when the capture has landed (the relay
   *  delivers `payments.payment_succeeded` after the webhook commits), and a captured balance must never leave the deposit forfeited. */
  async capturedForOrderInTx(tx: TxContext, tenantId: string, orderId: string): Promise<boolean> {
    return (await this.repo.capturedForOrderTx(tx, tenantId, orderId)) !== null;
  }

  /** PC-56 STORE-3c · B3 (survey C-8): the LEDGER's facts for a set of idempotency keys (replica, one query, bounded by the caller) — when each
   *  transaction was booked and the amount it moved (the sum of its credit legs; every txn is zero-sum). The auction module reads a bidder's
   *  deposit state from here (`emd:` / `emd-release:` / `emd-apply:` / `emd-forfeit:` / `emd-return:` keys) — never from the EMD rule. */
  async ledgerTxnsByKeys(tenantId: string, keys: readonly string[]): Promise<Map<string, { at: Date; amountMinor: bigint }>> {
    return this.repo.ledgerTxnsByKeys(tenantId, keys);
  }

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
    const p = payment.toProps();
    if (p.referenceType === 'order' && p.referenceId) {
      // PC-56 STORE-2c · B3: which attempt this is (1-based, oldest first) and when it lapses
      const all = await this.repo.attemptsForOrder(tenantId, p.referenceId, actor.userId, actor.canModerate);
      const idx = all.findIndex((a) => a.id === p.id);
      return this.serialize(p, { attempt: idx >= 0 ? all.length - idx : null, ttl: await this.repo.attemptTtlSeconds(tenantId) });
    }
    return this.serialize(p);
  }

  async list(tenantId: string, userId: string, q: { cursor?: { c: string; id: string }; limit: number }) {
    const items = (await this.repo.listForUser(tenantId, userId, q)).map((p) => this.serialize(p.toProps()));
    const last = items[items.length - 1];
    return { items, nextCursor: items.length === q.limit && last ? Buffer.from(`${last.createdAt}|${last.id}`).toString('base64') : null };
  }

  /** PC-56 STORE-2c · B3: + `failureCode` (the gateway's, as recorded), `failureReason` (a CODE the buyer's page localizes — never the
   *  provider's English), `chargedNothing` (only for failures before any debit), `expiresAt` (an order attempt's lapse time) and `attempt`. */
  private serialize(p: ReturnType<Payment['toProps']>, a: { attempt: number | null; ttl: number | null } = { attempt: null, ttl: null }) {
    const failed = p.status === 'failed';
    const reason = failed ? failureReasonCode(p.failureReason, p.failureCode) : null;
    const isOrder = p.referenceType === 'order';
    return { id: p.id, status: p.status, amountMinor: p.amountMinor.toString(), refundedMinor: p.refundedMinor.toString(),
      currencyCode: p.currencyCode, provider: p.providerCode, method: p.method, referenceType: p.referenceType,
      referenceId: p.referenceId, gatewayOrderId: p.gatewayOrderId, createdAt: p.createdAt,
      failureCode: failed ? (p.failureCode ?? null) : null, failureReason: reason, chargedNothing: reason ? chargedNothing(reason) : null,
      expiresAt: isOrder ? (attemptExpiresAt(new Date(p.createdAt), a.ttl)?.toISOString() ?? null) : null, attempt: isOrder ? a.attempt : null };
  }

  private async flush(tx: TxContext, tenantId: string, paymentId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'payment', aggregateId: paymentId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
