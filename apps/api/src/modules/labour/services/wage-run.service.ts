// modules/labour/services/wage-run.service.ts · PC-56 TENANT-SW-b · C1 — THE DAILY 18:00 IST WAGE RUN (founder decision 2026-10-03; SWEEP F-11).
//
//   runDaily   from 18:00 IST, once per tenant per IST day (labour_wage_runs UNIQUE): every booking with confirmed-but-unpaid days (or 11b
//              payout rows awaiting a top-up) is paid through the 11b pay run — escrow Hold → worker Main, wage:<assignment>:<sha256(days)>
//              — each booking in ITS OWN transaction (one booking's failure never touches another's money). Each assignment paid becomes a
//              run line: gross · advance recovery (≤ 25 %) · net. A booking whose pay transaction fails writes `retrying` lines (next attempt
//              16:00 IST the next day) in a separate transaction; nothing moved for it.
//   retryDue   from 16:00 IST: the `retrying` lines whose time has come are retried, one booking per transaction; a line that fails a
//              fourth time is `failed`, by name (RETRY_LADDER_EXHAUSTED). A booking on the ladder is skipped by the 18:00 run.
// The actor is the job: payouts carry paid_by NULL, audits actor NULL ("daily_wage_run"). The manual 11b pay act stays as an exception
// act and appears in W166 as "manual" (wage_run_id NULL).
// THE LANE IS RETIRED, NOT FED. `BookingClockedOutHandler` promoted `payouts` rows nothing writes (F-11); wages are wallet legs, not bank
// payouts — the handler is unregistered (payments.module.ts says why) and the HOTFIX-2 gate's case for it is removed with it.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { WAGE_MAX_ATTEMPTS, dailyRunDue, lineStatusFrom, nextRetryAt, runStatusFrom, istYmd } from '../domain/wage-run';
import { acceptsPayRun } from '../domain/labour-booking.state';
import { WageRunRepository } from '../repositories/wage-run.repository';
import { LabourBookingRepository } from '../repositories/labour-booking.repository';
import { LabourMoneyRepository } from '../repositories/labour-money.repository';
import { LabourBookingService } from './labour-booking.service';
import { WageRunNotFoundError, LabourForbiddenError } from '../domain/labour.errors';
import { LabourActor, canOverseeLabour } from '../policies/labour.policies';

const SYSTEM = 'system';
type PayResult = Awaited<ReturnType<LabourBookingService['payBookingInTx']>>;

@Injectable()
export class WageRunService {
  private readonly log = new Logger(WageRunService.name);
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly runs: WageRunRepository,
    private readonly bookings: LabourBookingRepository,
    private readonly money: LabourMoneyRepository,
    private readonly svc: LabourBookingService,
  ) {}

  /** Pay one booking in its own transaction (the job is the actor). Throws on failure (the caller records the retry). */
  private payBooking(tenantId: string, bookingId: string, runId: string): Promise<PayResult | null> {
    return this.uow.run(tenantId, async (tx) => {
      const booking = await this.bookings.getForWrite(tx, tenantId, bookingId);
      if (!booking || !acceptsPayRun(booking.status) || booking.status === 'paid') return null;
      return this.svc.payBookingInTx(tx, tenantId, booking, { actorUserId: null, ip: null, reason: 'daily 18:00 IST wage run', wageRunId: runId });
    }, { userId: SYSTEM });
  }

  private async recordLines(tx: TxContext, tenantId: string, runId: string, bookingId: string, res: PayResult): Promise<number> {
    let n = 0;
    for (const l of res.lines) {
      const paid = BigInt(l.paidThisRunMinor);
      const status = lineStatusFrom(l.status, paid);
      if (!status) continue;
      const gross = BigInt(l.grossMinor); const rec = BigInt(l.recoveryMinor);
      await this.runs.upsertPaidLine(tx, { tenantId, runId, bookingId, assignmentId: l.assignmentId, workerId: l.workerId, payoutId: l.payoutId, grossMinor: gross, recoveryMinor: rec,
        netMinor: gross - rec, days: l.daysConfirmed, status });
      n++;
    }
    return n;
  }

  /** The 18:00 IST run for one tenant. Returns null before 18:00 or when today's run already exists. */
  async runDaily(tenantId: string, now: Date = new Date()): Promise<{ runId: string; bookings: number; paid: number; retrying: number } | null> {
    const due = dailyRunDue(now);
    if (!due.due) return null;
    const runId = await this.uow.run(tenantId, (tx) => this.runs.createRun(tx, tenantId, uuidv7(), due.runDate), { userId: SYSTEM });
    if (!runId) return null;                                  // today's run exists (another pod, or an earlier tick)
    const bookingIds = await this.uow.run(tenantId, (tx) => this.runs.bookingsDue(tx, tenantId), { userId: SYSTEM });
    let paid = 0; let retrying = 0;
    for (const bookingId of bookingIds) {
      try {
        const res = await this.payBooking(tenantId, bookingId, runId);
        if (res) paid += await this.uow.run(tenantId, (tx) => this.recordLines(tx, tenantId, runId, bookingId, res), { userId: SYSTEM });
      } catch (e) {
        const code = (e as { code?: string }).code ?? (e as Error).name ?? 'PAY_FAILED';
        this.log.warn(`wage run ${runId}: booking ${bookingId} failed (${code}) — retrying at 16:00 IST tomorrow`);
        retrying += await this.uow.run(tenantId, async (tx) => {
          const owed = await this.runs.owedAssignments(tx, tenantId, bookingId);
          for (const o of owed) await this.runs.insertRetryingLine(tx, { tenantId, runId, bookingId, assignmentId: o.assignmentId, workerId: o.workerId, days: o.days, nextRetryAt: nextRetryAt(now), error: code });
          return owed.length;
        }, { userId: SYSTEM });
      }
    }
    await this.uow.run(tenantId, async (tx) => this.runs.refreshRun(tx, tenantId, runId, runStatusFrom(await this.runs.lineStatuses(tx, tenantId, runId)), bookingIds.length), { userId: SYSTEM });
    this.metrics.inc('labour.wage_run.done', { tenant: tenantId });
    return { runId, bookings: bookingIds.length, paid, retrying };
  }

  /** The 16:00 IST retry pass for one tenant: every `retrying` line whose time has come, one booking per transaction. */
  async retryDue(tenantId: string, now: Date = new Date()): Promise<{ retried: number; paid: number; failed: number; stillRetrying: number }> {
    const groups = await this.uow.run(tenantId, (tx) => this.runs.retriesDue(tx, tenantId, now), { userId: SYSTEM });
    let paid = 0; let failed = 0; let still = 0; let retried = 0;
    const touchedRuns = new Set<string>();
    for (const g of groups) {
      retried += g.lines.length; touchedRuns.add(g.runId);
      try {
        const res = await this.payBooking(tenantId, g.bookingId, g.runId);
        await this.uow.run(tenantId, async (tx) => {
          for (const line of g.lines) {
            const hit = res?.lines.filter((l) => l.assignmentId === line.assignmentId) ?? [];
            const gross = hit.reduce((s, l) => s + BigInt(l.grossMinor), 0n); const rec = hit.reduce((s, l) => s + BigInt(l.recoveryMinor), 0n);
            const net = hit.reduce((s, l) => s + BigInt(l.paidThisRunMinor), 0n);
            const statuses = hit.map((l) => lineStatusFrom(l.status, BigInt(l.paidThisRunMinor))).filter(Boolean);
            const status = statuses.includes('skipped_unfunded') && net === 0n ? 'skipped_unfunded' : 'paid';
            await this.runs.markRetryResult(tx, tenantId, line.id, { status, payoutId: hit.find((l) => l.payoutId)?.payoutId ?? null, grossMinor: gross, recoveryMinor: rec, netMinor: net,
              days: hit.reduce((s, l) => s + l.daysConfirmed, 0), nextRetryAt: null, error: null });
            if (status === 'paid') paid++;
          }
        }, { userId: SYSTEM });
      } catch (e) {
        const code = (e as { code?: string }).code ?? (e as Error).name ?? 'PAY_FAILED';
        await this.uow.run(tenantId, async (tx) => {
          for (const line of g.lines) {
            const exhausted = line.attempts + 1 >= WAGE_MAX_ATTEMPTS;
            await this.runs.markRetryResult(tx, tenantId, line.id, { status: exhausted ? 'failed' : 'retrying', payoutId: null, grossMinor: 0n, recoveryMinor: 0n, netMinor: 0n, days: 0,
              nextRetryAt: exhausted ? null : nextRetryAt(now), error: exhausted ? `RETRY_LADDER_EXHAUSTED:${code}` : code });
            if (exhausted) failed++; else still++;
          }
        }, { userId: SYSTEM });
      }
    }
    for (const runId of touchedRuns) {
      await this.uow.run(tenantId, async (tx) => this.runs.refreshRun(tx, tenantId, runId, runStatusFrom(await this.runs.lineStatuses(tx, tenantId, runId))), { userId: SYSTEM });
    }
    return { retried, paid, failed, stillRetrying: still };
  }

  /* ── W166 reads (labour.desk / booking.manage) ── */
  private assertOversight(actor: LabourActor) { if (!canOverseeLabour(actor)) throw new LabourForbiddenError('requires labour.desk or booking.manage'); }

  /** Today's run (or "queued for 18:00"), its lines, the manual acts, the retry ladder, the tiles — every number read. */
  async today(tenantId: string, actor: LabourActor, now: Date = new Date()) {
    this.assertOversight(actor);
    const runDate = istYmd(now);
    const run = await this.runs.runFor(tenantId, runDate);
    const [lines, manual, problems, week, advances] = await Promise.all([
      run ? this.runs.linesOf(tenantId, run.id) : Promise.resolve([]), this.runs.manualPayouts(tenantId, runDate), this.runs.openProblems(tenantId),
      this.runs.paidLast7Days(tenantId), this.money.advanceTotals(tenantId)]);
    return { runDate, runAt: '18:00 Asia/Kolkata', run, lines, manual, retryLadder: problems, paidLast7Days: week, advancesOutstanding: advances,
      lane: { built: false, reason: 'wages_are_wallet_legs_not_bank_payouts' } };
  }
  async history(tenantId: string, actor: LabourActor, q: { before?: string; limit: number }) {
    this.assertOversight(actor);
    const rows = await this.runs.listRuns(tenantId, q);
    const last = rows[rows.length - 1];
    return { items: rows, nextBefore: rows.length === q.limit && last ? last.runDate : null };
  }
  async run(tenantId: string, actor: LabourActor, id: string) {
    this.assertOversight(actor);
    const run = await this.runs.runById(tenantId, id);
    if (!run) throw new WageRunNotFoundError(id);
    return { run, lines: await this.runs.linesOf(tenantId, id), manual: await this.runs.manualPayouts(tenantId, run.runDate) };
  }
}
