// modules/payments/services/settlement-cycle.service.ts · W147's "Close current cycle" (PC-56 TENANT-4c).
// ensure → request (settlement.close) → approve by a DIFFERENT person → generate, resumably → closed.
//
// FIFTH maker-checker site inside a tenant's console (0139 refunds, 0140 credit notes riding it, 0141 charge
// changes, 0143 payout batches). What is signed here is a PERIOD: a fortnight of trade turning into
// documents a member will hold and a bank manager will read.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, type TxContext } from '../../../core/database/unit-of-work';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { DomainError, ForbiddenError } from '../../../shared/errors/app-error';
import { SettlementCycleRepository, type CycleRow } from '../repositories/settlement-cycle.repository';
import { SettlementStatementService } from './settlement-statement.service';
import {
  DEFAULT_CYCLE_LENGTH, NOTE_FLOOR, approveRefusal, isCompletable, isCycleLength, periodFor,
  progressOf, rejectRefusal, requestRefusal, type CycleLength,
} from '../domain/settlement-cycle';

const CYCLE_LENGTH_KEY = 'settlements.cycle_length';
/** How many sellers one generation pass handles. Bounded (Law 5) and RESUMABLE: the pass is called again
 *  until the cycle completes, which is what makes a 100,000-seller close possible at all. */
export const GENERATION_BATCH = 50;

export class SettlementCycleServiceError extends DomainError {}

export interface CycleView extends CycleRow { progress: ReturnType<typeof progressOf> }

@Injectable()
export class SettlementCycleService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: SettlementCycleRepository,
    private readonly statements: SettlementStatementService,
  ) {}

  private async cycleLength(tx: TxContext, tenantId: string): Promise<CycleLength> {
    const r = await tx.query<{ value: unknown }>(`SELECT value FROM tenant_settings WHERE tenant_id=$1 AND key=$2`, [tenantId, CYCLE_LENGTH_KEY]);
    const raw = r.rows[0]?.value;
    return isCycleLength(raw) ? raw : DEFAULT_CYCLE_LENGTH;
  }

  /** The tenant's live cycle, opened if this is the first time anybody looked. Opening a cycle is not a
   *  decision — the period exists whether or not the console was visited. */
  async ensureLive(tenantId: string, actorUserId: string, now = new Date()): Promise<CycleView> {
    const existing = await this.repo.live(tenantId);
    if (existing) return { ...existing, progress: progressOf(existing) };
    const row = await this.uow.run(tenantId, async (tx) => {
      const period = periodFor(now, await this.cycleLength(tx, tenantId));
      return this.repo.ensureOpen(tx, tenantId, period);
    }, { userId: actorUserId });
    return { ...row, progress: progressOf(row) };
  }

  /** W147's button, step one. The period must have ENDED and there must be sellers to settle — a cycle
   *  closed over nobody produces a status claiming a settlement that did not happen. */
  async requestClose(tenantId: string, actorUserId: string, cycleId: string, ip: string | null, now = new Date()): Promise<CycleView> {
    return this.uow.run(tenantId, async (tx) => {
      const c = await this.repo.getForUpdate(tx, tenantId, cycleId);
      if (!c) throw new SettlementCycleServiceError('SETTLEMENT_CYCLE_NOT_FOUND', 'cycle not found', 404);
      const counts = await this.repo.countSellersInPeriod(tx, tenantId, { startIso: c.periodStart, endIso: c.periodEnd });
      const refusal = requestRefusal({ ...c, sellersExpected: c.sellersExpected, statementsGenerated: c.statementsGenerated }, counts.sellers, now);
      if (refusal) throw new SettlementCycleServiceError(refusal, refusal, 409, { cycleId, sellers: counts.sellers, periodEnd: c.periodEnd });

      const ok = await this.repo.requestClose(tx, tenantId, cycleId, actorUserId);
      if (!ok) throw new SettlementCycleServiceError('SETTLEMENT_CYCLE_NOT_OPEN', 'this cycle is no longer open', 409, { cycleId });
      await this.audit.write(tx, {
        tenantId, actorUserId, action: 'settlement.cycle_close_requested', entityType: 'settlement_cycle', entityId: cycleId,
        newValue: { periodStart: c.periodStart, periodEnd: c.periodEnd, sellers: counts.sellers, grossMinor: counts.grossMinor.toString() }, ip,
      });
      const after = await this.repo.getForUpdate(tx, tenantId, cycleId);
      return { ...after!, progress: progressOf(after!) };
    }, { userId: actorUserId });
  }

  /** Step two: a DIFFERENT person signs, and the expected seller count is frozen with the signature so
   *  progress is measured against what was true when they signed. */
  async decideClose(
    tenantId: string, actorUserId: string, cycleId: string,
    input: { decision: 'approved' | 'rejected'; note?: string }, ip: string | null,
  ): Promise<CycleView> {
    return this.uow.run(tenantId, async (tx) => {
      const c = await this.repo.getForUpdate(tx, tenantId, cycleId);
      if (!c) throw new SettlementCycleServiceError('SETTLEMENT_CYCLE_NOT_FOUND', 'cycle not found', 404);
      const note = (input.note ?? '').trim();

      if (input.decision === 'rejected') {
        const refusal = rejectRefusal(c, note);
        if (refusal) throw new SettlementCycleServiceError(refusal, refusal, 409, { cycleId, noteFloor: NOTE_FLOOR });
        const ok = await this.repo.rejectClose(tx, tenantId, cycleId, actorUserId, note);
        if (!ok) throw new SettlementCycleServiceError('SETTLEMENT_CYCLE_NOT_PENDING', 'this cycle was already decided', 409, { cycleId });
        // The period is still live and still needs settling, so the cycle returns to open rather than
        // becoming a dead row a tenant cannot act on. The rejection stays in the audit trail.
        await this.repo.reopen(tx, tenantId, cycleId);
        await this.audit.write(tx, { tenantId, actorUserId, action: 'settlement.cycle_close_rejected', entityType: 'settlement_cycle', entityId: cycleId, newValue: { note }, ip });
      } else {
        const refusal = approveRefusal(c, actorUserId);
        if (refusal) {
          throw refusal === 'SETTLEMENT_CYCLE_CHECKER_IS_REQUESTER'
            ? new ForbiddenError('You requested this close — a different person must approve it', { code: refusal })
            : new SettlementCycleServiceError(refusal, refusal, 409, { cycleId });
        }
        const counts = await this.repo.countSellersInPeriod(tx, tenantId, { startIso: c.periodStart, endIso: c.periodEnd });
        const ok = await this.repo.approveClose(tx, tenantId, cycleId, actorUserId, counts.sellers, note || null);
        if (!ok) throw new SettlementCycleServiceError('SETTLEMENT_CYCLE_NOT_PENDING', 'this cycle was already decided', 409, { cycleId });
        await this.audit.write(tx, {
          tenantId, actorUserId, action: 'settlement.cycle_close_approved', entityType: 'settlement_cycle', entityId: cycleId,
          newValue: { sellersExpected: counts.sellers, grossMinor: counts.grossMinor.toString() }, ip,
        });
        this.metrics.inc('payments.settlement_cycle_approved', { tenant: tenantId });
      }
      const after = await this.repo.getForUpdate(tx, tenantId, cycleId);
      return { ...after!, progress: progressOf(after!) };
    }, { userId: actorUserId });
  }

  /** ONE BOUNDED, RESUMABLE PASS of generation. This is the honest replacement for W147's "generates 186
   *  statements ... atomically": each seller's statement is its own ACID transaction (the existing,
   *  idempotent `SettlementStatementService.generate`), the pass is bounded, and the cycle's counters are
   *  recomputed from the rows afterwards. A crash at seller 99,000 resumes; it does not roll back a month.
   *  Called by the console (so an operator can watch it finish) and by the worker. */
  async generatePass(tenantId: string, actorUserId: string, cycleId: string, ip: string | null): Promise<CycleView & { generatedNow: number; failed: number }> {
    const c = await this.repo.getById(tenantId, cycleId);
    if (!c) throw new SettlementCycleServiceError('SETTLEMENT_CYCLE_NOT_FOUND', 'cycle not found', 404);
    if (c.status !== 'closing') throw new SettlementCycleServiceError('SETTLEMENT_CYCLE_NOT_CLOSING', 'only an approved close generates statements', 409, { status: c.status });

    const sellers = await this.repo.sellersInPeriod(tenantId, { startIso: c.periodStart, endIso: c.periodEnd }, GENERATION_BATCH);
    // Exclusive end: the statement service takes [from, to), and the cycle's last DAY must be included.
    const from = `${c.periodStart}T00:00:00.000Z`;
    const to = new Date(Date.parse(`${c.periodEnd}T00:00:00.000Z`) + 86_400_000).toISOString();

    let generatedNow = 0;
    let failed = 0;
    for (const s of sellers) {
      try {
        const row = await this.statements.generate(tenantId, s.sellerUserId, from, to, actorUserId, ip);
        await this.uow.run(tenantId, async (tx) => {
          await tx.query(`UPDATE settlement_statements SET cycle_id=$3 WHERE id=$2 AND tenant_id=$1 AND cycle_id IS NULL`, [tenantId, row.id, cycleId]);
        }, { userId: actorUserId });
        generatedNow += 1;
      } catch {
        // One seller's statement failing must never stop the cycle: the remainder is visible on the screen
        // and the next pass retries it. Counted, never swallowed silently.
        failed += 1;
        this.metrics.inc('payments.settlement_statement_failed', { tenant: tenantId });
      }
    }

    const after = await this.uow.run(tenantId, async (tx) => {
      await this.repo.recount(tx, tenantId, cycleId);
      const row = (await this.repo.getForUpdate(tx, tenantId, cycleId))!;
      if (isCompletable(row)) {
        await this.repo.markClosed(tx, tenantId, cycleId);
        await this.audit.write(tx, { tenantId, actorUserId, action: 'settlement.cycle_closed', entityType: 'settlement_cycle', entityId: cycleId, newValue: { statements: row.statementsGenerated }, ip });
        return (await this.repo.getForUpdate(tx, tenantId, cycleId))!;
      }
      return row;
    }, { userId: actorUserId });

    return { ...after, progress: progressOf(after), generatedNow, failed };
  }
}
