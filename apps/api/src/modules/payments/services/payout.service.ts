// modules/payments/services/payout.service.ts
// Money-OUT: a user withdraws wallet funds to their verified bank/UPI account. One ACID tx:
// reserve the funds (debit the user's main wallet → credit the platform 'payouts' account, via the
// WALLET port) → queue a payout row → outbox + audit. The actual disbursement (RazorpayX) is driven
// by the worker's payout-execution job (next wave). Idempotent on the caller's key; the wallet debit
// is itself idempotent, so a retry can never double-debit.
// S3 review finding: requestPayout is gated on the caller's KYC (kyc_status='verified' on any active
// role in this tenant) BEFORE any debit/ledger work.
//
// **PC-56 TENANT-1 CORRECTED THAT PARENTHESIS.** "Any active role" was the defect: KYC is per ROLE (W153), so the gate
// now resolves the payout's PURPOSE first, reads the roles that purpose accepts (0125's declared map), and requires a
// verified status on one of THOSE — with an unmapped purpose requiring every active role verified rather than any.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { userMain, platform, PlatformAccount } from '../../../core/wallet/account-codes';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Payout } from '../domain/payout.entity';
import { mapProviderFailureCode, PAYOUT_FAILURE_REASON_FALLBACK } from '../domain/payout-failure-reason.map';
import { PayoutRepository } from '../repositories/payout.repository';
import { PAYOUT_GATEWAY, PayoutGateway } from '../gateway/payout-gateway.port';
import { CreatePayoutDto } from '../dto/create-payout.dto';
import { BadRequestError, ForbiddenError } from '../../../shared/errors/app-error';
import { RoleKycRequiredError } from '../domain/payments.errors';
import { kycVerdictFor } from '../domain/payout-kyc';

export interface PayoutActor { userId: string; canModerate: boolean; }

@Injectable()
export class PayoutService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    @Inject(PAYOUT_GATEWAY) private readonly gateway: PayoutGateway,
    private readonly audit: AuditWriter,
    private readonly repo: PayoutRepository,
  ) {}

  /** Request a withdrawal from the caller's wallet to one of THEIR bank accounts. */
  async requestPayout(tenantId: string, userId: string, idemKey: string, dto: CreatePayoutDto) {
    return this.idem.remember(idemKey, userId, 'payments.request_payout', () =>
      timed(this.metrics, 'payments.request_payout', { tenant: tenantId }, async () =>
        this.uow.run(tenantId, async (tx) => {
          // **THE MONEY-OUT KYC GATE, PER ROLE (PC-56 TENANT-1).** It used to pass on a verified status on ANY active
          // role, so a member verified as a WORKER could draw a SETTLEMENT payout — crop sale proceeds on the strength
          // of a wage-receipt check. W153 states the rule the other way round ("KYC is per role, not per person") and
          // the schema modelled it correctly all along; only this gate collapsed it.
          //
          // The purpose is resolved FIRST now, because the purpose is what says under which capacity the money is being
          // claimed — and the gate cannot be evaluated without it. Still before any debit or ledger work.
          const purposeCode = dto.purpose ?? 'settlement';
          const purposeId = await this.repo.resolvePurposeId(tx, purposeCode);
          if (!purposeId) throw new BadRequestError('unknown payout purpose');

          const [purposeRoles, roleKyc] = await Promise.all([
            this.repo.rolesForPurpose(tx, purposeCode),
            this.repo.callerRoleKyc(tx, tenantId, userId),
          ]);
          const verdict = kycVerdictFor(purposeRoles, roleKyc);
          if (!verdict.allowed) {
            this.metrics.inc('payments.payout.role_kyc_refused', { tenant: tenantId, purpose: purposeCode, reason: verdict.reason });
            // The refusal NAMES the role and its status: "settlement money is claimed as farmer or dairy_farmer; your
            // farmer verification is pending" is something a field officer can act on today. A bare "KYC required" is
            // not, and that is what a member used to be told when they were told anything at all.
            throw new RoleKycRequiredError({
              purpose: purposeCode, eligibleRoles: verdict.eligibleRoles,
              decidingRole: verdict.decidingRole, decidingStatus: verdict.decidingStatus, reason: verdict.reason,
            });
          }
          if (!(await this.repo.bankAccountBelongsTo(tx, tenantId, userId, dto.bankAccountId))) {
            throw new ForbiddenError('bank account does not belong to you');   // anti-IDOR / anti-fraud
          }

          const amount = BigInt(dto.amountMinor);
          const id = uuidv7();
          // reserve funds: debit the user's wallet, credit the platform payouts account (zero-sum).
          // The wallet enforces no-overdraw — a withdrawal beyond balance fails here, loudly.
          const txn = await this.wallet.post(tx, {
            tenantId, txnType: 'payout', idempotencyKey: `payout:${id}`, referenceType: 'payout', referenceId: id, initiatedBy: userId,
            legs: [ { account: userMain(userId), amountMinor: -amount }, { account: platform(PlatformAccount.Payouts), amountMinor: amount } ],
          });

          const payout = Payout.queue({ id, tenantId, userId, bankAccountId: dto.bankAccountId, purposeId,
            referenceType: dto.referenceType ?? null, referenceId: dto.referenceId ?? null, amountMinor: amount, currencyCode: dto.currencyCode,
            providerCode: 'razorpayx', idempotencyKey: `payout:${id}`, ledgerTxnId: txn.txnId });
          await this.repo.insertIdempotent(tx, payout);
          await this.outbox.write(tx, { tenantId, aggregateType: 'payout', aggregateId: id, eventType: 'payments.payout_queued', payload: { v: 1, payoutId: id, amountMinor: amount.toString() } });
          await this.audit.write(tx, { tenantId, actorUserId: userId, action: 'payout.queued', entityType: 'payout', entityId: id, newValue: { amountMinor: amount.toString(), bankAccountId: dto.bankAccountId }, ip: null });
          return { payoutId: id, status: 'queued', amountMinor: amount.toString() };
        }, { userId })));
  }

  /** Disburse a queued/claimed payout via the gateway. Called by the worker's payout-execution job
   *  (one payout per tx). Single-row lock is held during a BOUNDED gateway call (resilience timeout)
   *  — acceptable since nothing else touches this payout; at very high volume split into
   *  claim→call→finalize. Idempotent: a payout already success/reversed is skipped.
   *    • gateway success  → debit platform payouts, credit platform gateway (money exits, zero-sum);
   *    • DEFINITIVE failure → REVERSE: debit payouts, credit the user's wallet (funds returned);
   *    • ambiguous transport error → throw ⇒ tx rolls back ⇒ payout stays claimed/queued ⇒ retried
   *      (the PSP dedups on the idempotency key — NEVER auto-reverse an ambiguous disbursement). */
  async execute(tenantId: string, payoutId: string) {
    return timed(this.metrics, 'payments.execute_payout', { tenant: tenantId }, async () =>
      this.uow.run(tenantId, async (tx) => {
        const p = await this.repo.getForUpdate(tx, tenantId, payoutId);
        if (!p || (p.status !== 'queued' && p.status !== 'processing')) return { skipped: true, status: p?.status ?? 'missing' };
        const v = p.toProps();
        const fundRef = await this.repo.fundAccountRef(tx, tenantId, v.bankAccountId);
        if (!fundRef) throw new BadRequestError('payout bank account missing fund-account token');

        const res = await this.gateway.createPayout({ amountMinor: v.amountMinor, currencyCode: v.currencyCode, fundAccountRef: fundRef, idempotencyKey: v.idempotencyKey });
        if (v.status === 'queued') p.startProcessing(res.gatewayPayoutId); else p.recordGatewayId(res.gatewayPayoutId);

        if (res.status === 'success') {
          await this.wallet.post(tx, { tenantId, txnType: 'payout', idempotencyKey: `payout-exec:${payoutId}`, referenceType: 'payout', referenceId: payoutId, initiatedBy: 'system',
            legs: [ { account: platform(PlatformAccount.Payouts), amountMinor: -v.amountMinor }, { account: platform(PlatformAccount.Gateway), amountMinor: v.amountMinor } ] });
          p.markSuccess();
          await this.repo.update(tx, p);
          // PC-56 ADMIN-6b — THE PAYLOAD GAINS A RECIPIENT, WHICH IS WHAT MADE THIS EVENT UNNOTIFIABLE. `payout.credited`
          // has been in the notification catalogue since 0068 and nothing emitted it; adding the map row alone would not
          // have worked, because `DomainEventFanoutHandler` reads its recipients out of the payload and this payload had
          // no user id in it. It would have found none and returned early — silently, the same way it does for any
          // mapped event whose recipient key is absent. So the farmer would still have been told nothing, and the fix
          // would have looked complete.
          //
          // `amountMinor` stays a STRING (Law 2) and is formatted once, server-side, by the notification renderer.
          // `last4` is the most of a bank account that ever travels on an event; the full number is in the vault and has
          // no business in an outbox row that many handlers read.
          await this.outbox.write(tx, {
            tenantId, aggregateType: 'payout', aggregateId: payoutId, eventType: 'payments.payout_succeeded',
            payload: {
              v: 2, payoutId, amountMinor: v.amountMinor.toString(), currencyCode: v.currencyCode,
              userId: v.userId ?? null, last4: await this.repo.bankLast4(tx, tenantId, v.bankAccountId),
            },
          });
        } else if (res.status === 'failed') {
          await this.wallet.post(tx, { tenantId, txnType: 'payout', idempotencyKey: `payout-reverse:${payoutId}`, referenceType: 'payout', referenceId: payoutId, initiatedBy: 'system',
            legs: [ { account: platform(PlatformAccount.Payouts), amountMinor: -v.amountMinor }, { account: userMain(v.userId ?? ''), amountMinor: v.amountMinor } ] });
          p.markFailed(res.failureCode ?? 'gateway_failed', res.failureReason ?? null);
          p.reverse();                                  // funds returned to the user wallet
          await this.repo.update(tx, p);
          await this.outbox.write(tx, { tenantId, aggregateType: 'payout', aggregateId: payoutId, eventType: 'payments.payout_failed', payload: { v: 1, payoutId, failureCode: res.failureCode ?? 'gateway_failed' } });
          await this.audit.write(tx, { tenantId, actorUserId: 'system', action: 'payout.reversed', entityType: 'payout', entityId: payoutId, newValue: { failureCode: res.failureCode ?? 'gateway_failed' }, ip: null });
        } else {
          // async 'processing' — RazorpayX will confirm via webhook (handler = next wave)
          await this.repo.update(tx, p);
        }
        return { payoutId, status: p.status };
      }, { userId: 'system' }));
  }

  /** KV-BL-023 (03_API_CONTRACT_DELTA.md §payouts, PILOT-BLOCKING, screens 442/516): `lang` defaults to 'en' for
   *  any pre-existing caller that doesn't pass one (additive — response shape only gains fields, never changes
   *  existing ones). Always call with `ctx.lang` from the controller when available. */
  async getById(tenantId: string, actor: PayoutActor, id: string, lang = 'en') {
    const p = await this.repo.getVisible(tenantId, id, actor.userId, actor.canModerate);
    if (!p) throw new BadRequestError('payout not found');
    const labels = await this.repo.failureReasonLabels(tenantId, lang);
    return this.serialize(p, labels);
  }
  async list(tenantId: string, userId: string, q: { cursor?: { c: string; id: string }; limit: number }, lang = 'en') {
    const labels = await this.repo.failureReasonLabels(tenantId, lang);
    const items = (await this.repo.listForUser(tenantId, userId, q)).map((p) => this.serialize(p, labels));
    const last = items[items.length - 1];
    return { items, nextCursor: items.length === q.limit && last ? Buffer.from(`${last.createdAt}|${last.id}`).toString('base64') : null };
  }
  /** `failureReason` (raw provider text, unchanged/additive — kept for anyone already reading it) alongside the
   *  NEW `failureReasonLocalized` (KV-BL-023): mapProviderFailureCode() buckets the raw `failure_code`, then the
   *  bucket resolves to a locale-aware label via the `payout_failure_reason` lookup_values vocabulary (falls back
   *  to the 'other' bucket's own label if somehow the map returns a bucket the vocabulary doesn't have, so this
   *  NEVER throws and NEVER exposes the raw gateway code to the client). Both fields are null for a payout with
   *  no failure (queued/processing/success). */
  private serialize(p: Payout, labels: Map<string, string>) {
    const v = p.toProps();
    const failureReasonLocalized = v.failureCode
      ? (labels.get(mapProviderFailureCode(v.failureCode)) ?? labels.get(PAYOUT_FAILURE_REASON_FALLBACK) ?? null)
      : null;
    return {
      id: v.id, status: v.status, amountMinor: v.amountMinor.toString(), currencyCode: v.currencyCode,
      bankAccountId: v.bankAccountId, createdAt: v.createdAt,
      failureReason: v.failureReason, failureReasonLocalized,
    };
  }
}
