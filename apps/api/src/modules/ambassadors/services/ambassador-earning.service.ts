// modules/ambassadors/services/ambassador-earning.service.ts · accrual + the PAYOUT money path.
// accrue(): resolve the effective commission plan for an event, EVALUATE ITS CONDITIONS (F-5), compute the amount (flat or
// rate×base capped), and append an ambassador_earnings row — IDEMPOTENT via existsFor (the partitioned UNIQUE can't dedupe
// alone). No wallet movement on accrual. payoutAmbassador(): lock the ambassador's unpaid earnings, post ONE zero-sum,
// idempotent 'commission' wallet transfer (platform Fees → ambassador userMain), and stamp payout_id (Law 2/3/4).
//
// PC-56 TENANT-10a — WHAT CHANGED, AND WHY
//   • F-1 (DEV-55, a double-pay). The stamp matched nothing and its row count was never read, so the wallet paid and the
//     earnings stayed unpaid for the next run to pay again; the wallet key was a fresh uuidv7 per call, so nothing deduped.
//     Now: the stamp matches the locked rows at full precision and RETURNS how many it stamped; anything but every locked
//     row throws PayoutMarkMismatchError INSIDE the transaction (the wallet leg rolls back with it); and the wallet key is
//     derived from the locked set itself — `ambpayout:<ambassador>:<sha256(sorted earning ids)>` — so the same earnings
//     can never be posted twice whatever the caller's key says.
//   • F-3. The actor is the human who pressed the button (`initiatedBy`, the idempotency owner, the unit of work's user),
//     never `system`; the payout writes `ambassador.payout.run` (actor · reason · before → after) in the same transaction.
//   • A13. `runPayouts` is the console's weekly earnings run: every active ambassador with unpaid earnings, each in its OWN
//     transaction (one failure never stops or rolls back another), one `ambassador.payout.batch` audit row. There is NO
//     automatic Friday schedule — founder question F-23 (the PLATFORM Fees account funds a tenant's village agents) is open.
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { userMain, platform, PlatformAccount } from '../../../core/wallet/account-codes';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { AmbassadorEarning } from '../domain/ambassador-earning.entity';
import { evaluatePlanConditions, needsSubjectCount, TRAIL_BASE_EVENT } from '../domain/commission-plan.entity';
import { encodeCursor } from '../domain/cursor';
import { AmbassadorEventType } from '../domain/ambassadors.events';
import { CommissionPlanRepository } from '../repositories/commission-plan.repository';
import { AmbassadorEarningRepository } from '../repositories/ambassador-earning.repository';
import { AmbassadorProfileRepository } from '../repositories/ambassador-profile.repository';
import { NothingToPayoutError, AmbassadorNotFoundError, AmbassadorsForbiddenError, PayoutMarkMismatchError, ReasonRequiredError } from '../domain/ambassadors.errors';

export interface AccrueInput {
  tenantId: string; ambassadorId: string; eventCode: string; referenceType: string | null; referenceId: string | null; baseMinor: bigint;
  /** The farmer this earning is about (F-5 per-farmer caps). */
  subjectUserId?: string | null;
  /** When the attributing referral was created (F-5 `within_days`). */
  referralCreatedAt?: Date | null;
}
export interface PayoutActor { userId: string }
export interface PayoutResult { payoutId: string; ambassadorId: string; paidMinor: string; earningCount: number }
export type BatchLine =
  | { ambassadorId: string; outcome: 'paid'; payoutId: string; paidMinor: string; earningCount: number }
  | { ambassadorId: string; outcome: 'nothing_to_pay' }
  | { ambassadorId: string; outcome: 'failed'; code: string };
export interface BatchResult { batchId: string; attempted: number; paid: number; nothingToPay: number; failed: number; totalPaidMinor: string; lines: BatchLine[] }

export const MIN_REASON = 3;
export const MAX_REASON = 300;
/** A reason the audit trail can carry: trimmed, 3–300 characters, or the act is refused by name. */
export function requireReason(raw: string | null | undefined, act: string): string {
  const s = (raw ?? '').trim();
  if (s.length < MIN_REASON || s.length > MAX_REASON) throw new ReasonRequiredError(act);
  return s;
}

/** PURE (F-1): the wallet key is a function of WHICH earnings are paid — never of the call. */
export function payoutWalletKey(ambassadorId: string, earningIds: string[]): string {
  const digest = createHash('sha256').update([...earningIds].sort().join(',')).digest('hex');
  return `ambpayout:${ambassadorId}:${digest}`;
}

@Injectable()
export class AmbassadorEarningService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly audit: AuditWriter,
    private readonly plans: CommissionPlanRepository,
    private readonly earnings: AmbassadorEarningRepository,
    private readonly profiles: AmbassadorProfileRepository,
  ) {}

  /** Accrue one commission event inside the caller's tx. Returns null if no plan / zero amount / already credited / a
   *  plan condition refuses it (each counted by name in the metrics). */
  async accrue(tx: TxContext, input: AccrueInput): Promise<AmbassadorEarning | null> {
    const plan = await this.plans.resolveEffective(input.tenantId, input.eventCode, tx);
    if (!plan) { this.metrics.inc('ambassadors.accrue.no_plan', { event: input.eventCode }); return null; }
    const amount = plan.compute(input.baseMinor);
    if (amount <= 0n) return null;
    if (await this.earnings.existsFor(tx, input.ambassadorId, input.eventCode, input.referenceId)) { this.metrics.inc('ambassadors.accrue.duplicate', { event: input.eventCode }); return null; }
    const subject = input.subjectUserId ?? null;
    let prior = 0; let priorSales = 0;
    if (needsSubjectCount(plan.conditions) && subject) {
      // Two completions of one farmer's orders must not both read "4 of 5": serialise on (ambassador, farmer).
      await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`ambaccrue:${input.ambassadorId}:${subject}`]);
      prior = await this.earnings.countForSubject(tx, input.tenantId, input.ambassadorId, input.eventCode, subject);
      priorSales = plan.conditions.after_first_sales !== undefined
        ? (input.eventCode === TRAIL_BASE_EVENT ? prior : await this.earnings.countForSubject(tx, input.tenantId, input.ambassadorId, TRAIL_BASE_EVENT, subject))
        : 0;
    }
    const refusal = evaluatePlanConditions(plan.conditions, { now: new Date(), referralCreatedAt: input.referralCreatedAt ?? null, subjectUserId: subject, priorCountForSubject: prior, priorSalesForSubject: priorSales });
    if (refusal) { this.metrics.inc('ambassadors.accrue.condition_refused', { event: input.eventCode, reason: refusal }); return null; }
    const earning = AmbassadorEarning.accrue({ id: uuidv7(), tenantId: input.tenantId, ambassadorId: input.ambassadorId, planId: plan.id, eventCode: input.eventCode, referenceType: input.referenceType, referenceId: input.referenceId, amountMinor: amount, subjectUserId: subject });
    await this.earnings.insert(tx, earning);
    for (const e of earning.pullEvents()) await this.outbox.write(tx, { tenantId: input.tenantId, aggregateType: 'ambassador_earning', aggregateId: earning.id, eventType: e.type, payload: { v: 1, ...e.payload } });
    this.metrics.inc('ambassadors.accrue.ok', { event: input.eventCode });
    return earning;
  }

  /** Settle an ambassador's unpaid earnings to their wallet. `ambassador.payout` at the controller; idempotent (Law 3). */
  async payoutAmbassador(tenantId: string, actor: PayoutActor, ambassadorId: string, idemKey: string, reasonRaw: string): Promise<PayoutResult> {
    if (!actor.userId) throw new AmbassadorsForbiddenError('a payout needs a named actor');
    const reason = requireReason(reasonRaw, 'run a payout');
    return this.idem.remember(idemKey, actor.userId, 'ambassadors.payout', () =>
      timed(this.metrics, 'ambassadors.payout', { tenant: tenantId }, () =>
        this.uow.run(tenantId, (tx) => this.payoutInTx(tx, tenantId, actor, ambassadorId, reason), { userId: actor.userId })));
  }

  private async payoutInTx(tx: TxContext, tenantId: string, actor: PayoutActor, ambassadorId: string, reason: string): Promise<PayoutResult> {
    const profile = await this.profiles.getById(tenantId, ambassadorId, tx);
    if (!profile) throw new AmbassadorNotFoundError(ambassadorId);
    const unpaid = await this.earnings.lockUnpaid(tx, tenantId, ambassadorId);
    const total = unpaid.reduce((sum, e) => sum + e.amountMinor, 0n);
    if (total <= 0n) throw new NothingToPayoutError(ambassadorId);
    const keys = unpaid.map((e) => ({ id: e.id, createdAtRaw: e.toProps().createdAtRaw as string }));
    if (keys.some((k) => !k.createdAtRaw)) throw new PayoutMarkMismatchError(unpaid.length, 0);
    const payoutId = uuidv7();
    await this.wallet.post(tx, { tenantId, txnType: 'commission', idempotencyKey: payoutWalletKey(ambassadorId, keys.map((k) => k.id)), referenceType: 'ambassador_payout', referenceId: payoutId, initiatedBy: actor.userId,
      legs: [{ account: platform(PlatformAccount.Fees), amountMinor: -total }, { account: userMain(profile.userId), amountMinor: total }] });
    const stamped = await this.earnings.markPaid(tx, tenantId, keys, payoutId);
    if (stamped !== keys.length) throw new PayoutMarkMismatchError(keys.length, stamped);
    await this.outbox.write(tx, { tenantId, aggregateType: 'ambassador_payout', aggregateId: payoutId, eventType: AmbassadorEventType.EarningsPaidOut, payload: { v: 1, payoutId, ambassadorId, userId: profile.userId, totalMinor: total.toString(), count: unpaid.length } });
    await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'ambassador.payout.run', entityType: 'ambassador_profile', entityId: ambassadorId,
      oldValue: { unpaidMinor: total.toString(), unpaidCount: unpaid.length },
      newValue: { ambassadorId, payoutId, totalMinor: total.toString(), count: unpaid.length, reason, unpaidMinorAfter: '0' }, reason });
    this.metrics.inc('ambassadors.payout.ok', { tenant: tenantId });
    return { payoutId, ambassadorId, paidMinor: total.toString(), earningCount: unpaid.length };
  }

  /**
   * A13 — the weekly earnings run, as a recorded human act. Every ACTIVE ambassador with unpaid earnings, each paid in its
   * own transaction through the same path as a single payout (so the F-1 guarantees hold per ambassador), then one batch
   * audit row. Idempotent on the caller's key: a retry returns the first run's result and pays nothing again.
   */
  async runPayouts(tenantId: string, actor: PayoutActor, idemKey: string, reasonRaw: string): Promise<BatchResult> {
    if (!actor.userId) throw new AmbassadorsForbiddenError('a payout run needs a named actor');
    const reason = requireReason(reasonRaw, 'run the weekly earnings payout');
    return this.idem.remember(idemKey, actor.userId, 'ambassadors.payout.batch', async () => {
      const batchId = uuidv7();
      const ids = await this.earnings.ambassadorsWithUnpaid(tenantId);
      const lines: BatchLine[] = [];
      let total = 0n;
      for (const ambassadorId of ids) {
        try {
          const r = await this.uow.run(tenantId, (tx) => this.payoutInTx(tx, tenantId, actor, ambassadorId, reason), { userId: actor.userId });
          lines.push({ ambassadorId, outcome: 'paid', payoutId: r.payoutId, paidMinor: r.paidMinor, earningCount: r.earningCount });
          total += BigInt(r.paidMinor);
        } catch (e) {
          const code = (e as { code?: string }).code ?? 'UNKNOWN';
          lines.push(code === 'NOTHING_TO_PAYOUT' ? { ambassadorId, outcome: 'nothing_to_pay' } : { ambassadorId, outcome: 'failed', code });
        }
      }
      const result: BatchResult = {
        batchId, attempted: ids.length, paid: lines.filter((l) => l.outcome === 'paid').length,
        nothingToPay: lines.filter((l) => l.outcome === 'nothing_to_pay').length, failed: lines.filter((l) => l.outcome === 'failed').length,
        totalPaidMinor: total.toString(), lines,
      };
      await this.uow.run(tenantId, (tx) => this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'ambassador.payout.batch', entityType: 'ambassador_payout_batch', entityId: batchId,
        oldValue: { ambassadorsWithUnpaid: ids.length },
        newValue: { batchId, attempted: result.attempted, paid: result.paid, nothingToPay: result.nothingToPay, failed: result.failed, totalPaidMinor: result.totalPaidMinor, reason }, reason }), { userId: actor.userId });
      return result;
    });
  }

  async listForAmbassador(tenantId: string, ambassadorId: string, q: { unpaidOnly?: boolean; cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.earnings.listForAmbassador(tenantId, ambassadorId, q);
    const items = rows.map((e) => e.toJSON());
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === q.limit && last ? encodeCursor(last.toProps().createdAtRaw, last.id) : null;
    return { items, nextCursor };
  }
}
export { AmbassadorsForbiddenError };
