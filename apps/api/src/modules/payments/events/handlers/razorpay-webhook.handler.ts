// modules/payments/events/handlers/razorpay-webhook.handler.ts
// Async PAYOUT confirmation from RazorpayX (the disbursement leg PayoutService.execute leaves in
// 'processing' when the gateway returns asynchronously). RazorpayX later POSTs a signed webhook:
//   payout.processed → the money actually left → post the ledger move (platform Payouts → Gateway),
//                       flip the payout to 'success', emit payments.payout_succeeded.
//   payout.failed / payout.reversed → the disbursement did NOT happen → REVERSE the reservation
//                       (platform Payouts → user main, funds returned), payout 'reversed',
//                       emit payments.payout_failed.
//
// Trust model mirrors the payment webhook: UNAUTHENTICATED ingress, trusted ONLY by the HMAC over the
// raw body; the tenant comes from the signature-verified payout `notes.tenant_id`. Idempotent on the
// gateway event id AND on the wallet idempotency keys — a replay can never double-move money. Money
// flows ONLY through the wallet boundary (Law 2). Fails CLOSED: a bad signature throws (401), an
// unknown/terminal payout is a no-op. Webhook bodies/secrets are NEVER logged.
import { Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { UNIT_OF_WORK, UnitOfWork } from '../../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../../core/observability/metrics';
import { AuditWriter } from '../../../../core/audit/audit.writer';
import { WALLET_SERVICE, WalletPort } from '../../../../core/wallet/wallet.port';
import { userMain, platform, PlatformAccount } from '../../../../core/wallet/account-codes';
import { PayoutRepository } from '../../repositories/payout.repository';
import { PaymentsPublisher } from '../payments.publisher';
import { PayoutWebhookSignatureError } from '../../domain/payments.errors';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { AppConfig } from '../../../../core/config/app-config';

type PayoutOutcome = 'processed' | 'failed' | 'reversed';
interface ParsedPayoutEvent { eventId: string; outcome: PayoutOutcome; gatewayPayoutId: string; tenantId: string; failureCode: string | null; }

@Injectable()
export class RazorpayPayoutWebhookHandler {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly audit: AuditWriter,
    private readonly repo: PayoutRepository,
    private readonly publisher: PaymentsPublisher,
    private readonly config: AppConfig,
  ) {}

  // Resolved via AppConfig (the only place env is read). In production this NEVER falls back to a shared
  // literal — an unconfigured payout webhook secret throws here, so a forged callback can't be accepted.
  private secret(): string {
    const s = this.config.payments.payoutWebhookSecret;
    if (!s) throw new Error('FATAL: payout webhook secret not configured (RAZORPAYX_WEBHOOK_SECRET)');
    return s;
  }

  /** Sign a body the way the gateway/sandbox would — exported shape used by tests to craft webhooks. */
  sign(rawBody: string): string { return createHmac('sha256', this.secret()).update(rawBody).digest('hex'); }

  private verify(rawBody: string, signature: string): boolean {
    const a = Buffer.from(this.sign(rawBody)); const b = Buffer.from(signature ?? '');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Public, unauthenticated ingress. Verify HMAC → parse → idempotent (event id) → confirm. Returns
   *  an accepted/ignored envelope; throws on a forged signature (401, fail closed). */
  async ingest(rawBody: string, signature: string): Promise<{ ok: true; ignored?: boolean; payoutId?: string; status?: string }> {
    if (!this.verify(rawBody, signature)) throw new PayoutWebhookSignatureError();   // hostile → never trust
    const ev = this.parse(rawBody);
    if (!ev) return { ok: true, ignored: true };                                     // not a payout event → ignore
    return this.idem.remember(ev.eventId, 'system', 'payments.payout_webhook', () =>
      timed(this.metrics, 'payments.payout_webhook', { outcome: ev.outcome }, () => this.confirm(ev)));
  }

  /** Finalize the async payout in its (signature-verified) tenant context. Idempotent. */
  private async confirm(ev: ParsedPayoutEvent) {
    return this.uow.run(ev.tenantId, async (tx) => {
      const p = await this.repo.getByGatewayIdForUpdate(tx, ev.tenantId, ev.gatewayPayoutId);
      if (!p) return { ok: true as const, ignored: true };                  // unknown gateway id → no-op (no enumeration)
      if (p.status !== 'processing') return { ok: true as const, payoutId: p.id, status: p.status };  // already terminal → idempotent
      const v = p.toProps();

      if (ev.outcome === 'processed') {
        await this.wallet.post(tx, { tenantId: ev.tenantId, txnType: 'payout', idempotencyKey: `payout-exec:${p.id}`, referenceType: 'payout', referenceId: p.id, initiatedBy: 'system',
          legs: [ { account: platform(PlatformAccount.Payouts), amountMinor: -v.amountMinor }, { account: platform(PlatformAccount.Gateway), amountMinor: v.amountMinor } ] });
        p.markSuccess();
        await this.repo.update(tx, p);
        await this.publisher.payoutSucceeded(tx, ev.tenantId, p.id, v.amountMinor);
      } else {
        // failed / reversed → return the reserved funds to the user wallet (payouts → user main)
        await this.wallet.post(tx, { tenantId: ev.tenantId, txnType: 'payout', idempotencyKey: `payout-reverse:${p.id}`, referenceType: 'payout', referenceId: p.id, initiatedBy: 'system',
          legs: [ { account: platform(PlatformAccount.Payouts), amountMinor: -v.amountMinor }, { account: userMain(v.userId ?? ''), amountMinor: v.amountMinor } ] });
        p.markFailed(ev.failureCode ?? 'gateway_failed', null);
        p.reverse();
        await this.repo.update(tx, p);
        await this.publisher.payoutFailed(tx, ev.tenantId, p.id, ev.failureCode ?? 'gateway_failed');
        await this.audit.write(tx, { tenantId: ev.tenantId, actorUserId: 'system', action: 'payout.reversed', entityType: 'payout', entityId: p.id, newValue: { failureCode: ev.failureCode ?? 'gateway_failed', via: 'webhook' }, ip: null });
      }
      return { ok: true as const, payoutId: p.id, status: p.status };
    }, { userId: 'system' });
  }

  /** Parse the RazorpayX payout webhook envelope. Defensive: any shape mismatch → null (ignored). */
  private parse(rawBody: string): ParsedPayoutEvent | null {
    let body: any;
    try { body = JSON.parse(rawBody); } catch { throw new BadRequestError('malformed payout webhook body'); }
    const map: Record<string, PayoutOutcome> = { 'payout.processed': 'processed', 'payout.failed': 'failed', 'payout.reversed': 'reversed' };
    const outcome = map[body?.event];
    if (!outcome) return null;
    const entity = body?.payload?.payout?.entity ?? body?.payout ?? {};
    const gatewayPayoutId = entity?.id;
    const tenantId = entity?.notes?.tenant_id;
    const eventId = body?.id ?? (gatewayPayoutId ? `${body?.event}:${gatewayPayoutId}` : undefined);
    if (!gatewayPayoutId || !tenantId || !eventId) return null;
    return { eventId, outcome, gatewayPayoutId, tenantId, failureCode: entity?.failure_reason ?? entity?.status_details?.reason ?? null };
  }
}
