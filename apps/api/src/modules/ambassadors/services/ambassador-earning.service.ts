// modules/ambassadors/services/ambassador-earning.service.ts · accrual + the PAYOUT money path.
// accrue(): resolve the effective commission plan for an event, EVALUATE ITS CONDITIONS (F-5), compute the amount (flat or
// rate×base capped), and append an ambassador_earnings row — IDEMPOTENT via existsFor (the partitioned UNIQUE can't dedupe
// alone). No wallet movement on accrual. PAYING an ambassador is PayoutRunService's (PC-56 TENANT-SW-b: tenant Main, maker-checker).
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
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { AmbassadorEarning } from '../domain/ambassador-earning.entity';
import { evaluatePlanConditions, needsSubjectCount, TRAIL_BASE_EVENT } from '../domain/commission-plan.entity';
import { encodeCursor } from '../domain/cursor';
import { AmbassadorEventType } from '../domain/ambassadors.events';
import { CommissionPlanRepository } from '../repositories/commission-plan.repository';
import { AmbassadorEarningRepository } from '../repositories/ambassador-earning.repository';
import { AmbassadorProfileRepository } from '../repositories/ambassador-profile.repository';
import { AmbassadorsForbiddenError, ReasonRequiredError } from '../domain/ambassadors.errors';

export interface AccrueInput {
  tenantId: string; ambassadorId: string; eventCode: string; referenceType: string | null; referenceId: string | null; baseMinor: bigint;
  /** The farmer this earning is about (F-5 per-farmer caps). */
  subjectUserId?: string | null;
  /** When the attributing referral was created (F-5 `within_days`). */
  referralCreatedAt?: Date | null;
}
export interface PayoutActor { userId: string }

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

  // PC-56 TENANT-SW-b · `payoutAmbassador` and `runPayouts` are GONE. They paid every line from `platform(Fees)` — the platform's fee
  // account paid a tenant's village agents — and one tenant_admin both decided and paid. The founder decided (2026-10-03, closing
  // F-23): ambassador pay comes from the TENANT's Main wallet under maker-checker. The money path is `PayoutRunService` (a run is
  // prepared, a DIFFERENT tenant_admin confirms, one ambrun:<run>:<ambassador> txn per line); the 10a manual payout survives as a
  // one-ambassador EXCEPTION run through the same checker. The 10a guarantees (the set-derived stamp, rowCount asserted) are kept
  // there, on this module's `AmbassadorEarningRepository.markPaid`.

  async listForAmbassador(tenantId: string, ambassadorId: string, q: { unpaidOnly?: boolean; cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.earnings.listForAmbassador(tenantId, ambassadorId, q);
    const items = rows.map((e) => e.toJSON());
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === q.limit && last ? encodeCursor(last.toProps().createdAtRaw, last.id) : null;
    return { items, nextCursor };
  }
}
export { AmbassadorsForbiddenError };
