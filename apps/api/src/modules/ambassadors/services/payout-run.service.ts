// modules/ambassadors/services/payout-run.service.ts · PC-56 TENANT-SW-b · A — THE WEEKLY AMBASSADOR RUN, PAID FROM THE TENANT WALLET
// UNDER MAKER-CHECKER (founder decision 2026-10-03; closes 10a F-23 / SWEEP F-17). THE ONLY PLACE AMBASSADOR PAY MOVES.
//
//   prepare   the Thursday 23:00 IST job (prepared_by NULL — the job is the maker) or a person holding ambassador.payout.prepare
//             (an on-demand weekly run, or a ONE-AMBASSADOR exception run — 10a's manual payout, now under a checker): every active
//             ambassador's unpaid earnings up to the period end + the monthly stipend for the latest fully-ended month the ambassador
//             was active for the WHOLE of (pro-rata refused by name). Ambassadors owed ₹0 are excluded, never zero-paid. The
//             "Funding" line is a REAL read of the tenant Main balance against the total. → `prepared`.
//   confirm   ambassador.payout — a DIFFERENT active tenant_admin (the DATABASE refuses the preparer: trg_apr_moves). Then, in the
//             same transaction, every pending line is paid: ONE WalletPort txn per ambassador
//               tenant Main −(commission + stipend) → ambassador Main +(…)          ambrun:<run>:<ambassador> · `ambassador_run`
//             the earnings stamped with payout_id = the line id (10a markPaid, set-derived, rowCount asserted — a stamp that misses a
//             locked row rolls the line's txn back), the stipend recorded once per (ambassador, month). A line the tenant Main cannot
//             cover is `unfunded` with its shortfall — nothing moves for it; a run where nothing could be paid is `unfunded`, by name.
//   pay       re-run a confirmed run's unpaid lines (pending / unfunded / failed) — idempotent: a paid line is never touched and its
//             key could not post twice.
//   refuse    a prepared run is refused with a reason (nothing moves; its earnings roll to the next run).
// THE PLATFORM FEES ACCOUNT NO LONGER PAYS. 10a's `platform(Fees) → ambassador` leg is REPLACED; nothing here references it.
// "Pays alongside the dairy cycle" is REFUSED BY NAME: no coupling to the dairy cycle is built (the run pays when its checker confirms).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import {
  AMBASSADOR_RUN_TXN, RUN_LINE_REFERENCE_TYPE, RunKind, fundingCheck, istParts, monthBounds, nextFriday, runLineKey, runLineLegs, runStatusAfterPay,
  stipendDue, stipendMonthFor, tenantMain, weeklyPeriodEnd,
} from '../domain/payout-run';
import { AmbassadorEventType } from '../domain/ambassadors.events';
import { encodeCursor } from '../domain/cursor';
import {
  AmbassadorNotFoundError, AmbassadorRunNotFoundError, AmbassadorRunRefusedError, AmbassadorsForbiddenError, NothingOwedError, PayoutMarkMismatchError,
  namedRunRefusal,
} from '../domain/ambassadors.errors';
import { requireReason } from './ambassador-earning.service';
import { PayoutRunRepository, LineRow, RunRow } from '../repositories/payout-run.repository';
import { AmbassadorEarningRepository } from '../repositories/ambassador-earning.repository';
import { AmbassadorProfileRepository } from '../repositories/ambassador-profile.repository';

export interface RunActor { userId: string }
export interface PayOutcome { paid: number; unfunded: number; failed: number; paidMinor: string; status: string }
const SYSTEM = 'system';

@Injectable()
export class PayoutRunService {
  private readonly log = new Logger(PayoutRunService.name);
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly audit: AuditWriter,
    private readonly runs: PayoutRunRepository,
    private readonly earnings: AmbassadorEarningRepository,
    private readonly profiles: AmbassadorProfileRepository,
  ) {}

  /* ───────────────────────────── prepare ───────────────────────────── */

  /** A person prepares a weekly run (up to now) or a one-ambassador exception run. ambassador.payout.prepare at the controller. */
  async prepareByPerson(tenantId: string, actor: RunActor, input: { kind: RunKind; ambassadorId?: string; reason: string }, idemKey: string, now: Date = new Date()) {
    if (!actor.userId) throw new AmbassadorsForbiddenError('a run is prepared by a named person');
    const reason = requireReason(input.reason, 'prepare an ambassador run');
    return this.idem.remember(idemKey, actor.userId, 'ambassadors.run.prepare', () =>
      this.uow.run(tenantId, (tx) => this.prepareInTx(tx, tenantId, actor.userId, input.kind, input.ambassadorId ?? null, reason, now, false), { userId: actor.userId }));
  }

  /** The Thursday 23:00 IST job (the maker is the job: prepared_by NULL). Returns null when nothing is owed or a run is already open. */
  async prepareByJob(tenantId: string, now: Date): Promise<{ runId: string } | null> {
    try {
      return await this.uow.run(tenantId, async (tx) => {
        const end = weeklyPeriodEnd(now);
        if (await this.runs.weeklyRunExists(tx, tenantId, end)) return null;
        if (await this.runs.openRunId(tx, tenantId)) { this.metrics.inc('ambassadors.run.skipped_open', { tenant: tenantId }); return null; }
        const v = await this.prepareInTx(tx, tenantId, null, 'weekly', null, 'Weekly earnings run — auto-prepared Thursday 23:00 IST', now, true);
        return { runId: v.id };
      }, { userId: SYSTEM });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'AMB_RUN_NOTHING_OWED' || code === 'AMB_RUN_ALREADY_OPEN') return null;
      throw e;
    }
  }

  private async prepareInTx(tx: TxContext, tenantId: string, preparedBy: string | null, kind: RunKind, ambassadorId: string | null, reason: string, now: Date, byJob: boolean) {
    try {
      if (kind === 'exception') {
        if (!ambassadorId) throw new AmbassadorNotFoundError('');
        const p = await this.profiles.getById(tenantId, ambassadorId, tx);
        if (!p) throw new AmbassadorNotFoundError(ambassadorId);
      }
      const periodEnd = byJob ? weeklyPeriodEnd(now) : now;
      const periodStart = kind === 'weekly' ? await this.runs.lastWeeklyPeriodEnd(tx, tenantId) : null;
      const payDate = kind === 'weekly' ? nextFriday(byJob ? periodEnd : now) : istParts(now).ymd;
      const monthFirst = stipendMonthFor(periodEnd);
      const { start, end } = monthBounds(monthFirst);
      const cands = await this.runs.candidates(tx, tenantId, periodEnd, start, end, monthFirst, kind === 'exception' ? ambassadorId : null);
      const lines = cands.map((c) => {
        // the stipend rides the WEEKLY run only; an exception run pays earned commission only (said on the confirm screen)
        const s = kind === 'weekly'
          ? stipendDue({ monthlyStipendMinor: c.monthlyStipendMinor, isActive: c.isActive, enrolledAt: c.enrolledAt, suspendedDuringMonth: c.suspendedInMonth, alreadyPaid: c.stipendPaid, monthFirst })
          : { due: false, reason: null };
        return { c, stipend: s.due ? c.monthlyStipendMinor : 0n };
      }).filter((x) => x.c.commissionMinor + x.stipend > 0n);
      if (lines.length === 0) throw new NothingOwedError();
      const totalCommission = lines.reduce((s, x) => s + x.c.commissionMinor, 0n);
      const totalStipend = lines.reduce((s, x) => s + x.stipend, 0n);
      // THE FUNDING LINE IS A REAL READ: the tenant Main balance, now, against what this run would pay.
      const balance = await this.wallet.balanceMinor(tx, tenantMain(tenantId));
      const funding = fundingCheck(balance, totalCommission + totalStipend, new Date());
      const id = uuidv7();
      await this.runs.insertRun(tx, { id, tenantId, kind, ambassadorId: kind === 'exception' ? ambassadorId : null, periodStart, periodEnd, payDate, preparedBy,
        prepareReason: reason, totalCommissionMinor: totalCommission, totalStipendMinor: totalStipend, lineCount: lines.length, fundingCheck: funding });
      for (const x of lines) {
        await this.runs.insertLine(tx, { id: uuidv7(), tenantId, runId: id, ambassadorId: x.c.ambassadorId, ambassadorUserId: x.c.userId, commissionMinor: x.c.commissionMinor,
          earningCount: x.c.earningCount, stipendMinor: x.stipend, stipendMonth: x.stipend > 0n ? monthFirst : null });
      }
      await this.audit.write(tx, { tenantId, actorUserId: preparedBy, action: 'ambassador.payout_run.prepared', entityType: 'ambassador_payout_run', entityId: id, reason,
        oldValue: null, newValue: { kind, ambassadorId, periodStart: periodStart?.toISOString() ?? null, periodEnd: periodEnd.toISOString(), payDate, lines: lines.length,
          totalCommissionMinor: totalCommission.toString(), totalStipendMinor: totalStipend.toString(), funding, preparedBy: preparedBy ?? 'job' } });
      this.metrics.inc('ambassadors.run.prepared', { tenant: tenantId, kind });
      return { id, kind, status: 'prepared', periodEnd: periodEnd.toISOString(), payDate, lineCount: lines.length, totalCommissionMinor: totalCommission.toString(),
        totalStipendMinor: totalStipend.toString(), fundingCheck: funding };
    } catch (e) { throw namedRunRefusal(e); }
  }

  /* ───────────────────────────── confirm / pay / refuse ───────────────────────────── */

  /** The checker confirms (the DATABASE refuses the preparer and a non-admin) — and the run is paid in the same transaction. */
  async confirm(tenantId: string, actor: RunActor, runId: string, reasonRaw: string, idemKey: string) {
    if (!actor.userId) throw new AmbassadorsForbiddenError('a run is confirmed by a named person');
    const reason = requireReason(reasonRaw, 'confirm an ambassador run');
    return this.idem.remember(idemKey, actor.userId, 'ambassadors.run.confirm', () =>
      this.uow.run(tenantId, async (tx) => {
        try {
          const run = await this.runs.runForUpdate(tx, tenantId, runId);
          if (!run) throw new AmbassadorRunNotFoundError(runId);
          if (run.status !== 'prepared') throw new AmbassadorRunRefusedError('AMB_RUN_CLOSED', `This run is ${run.status}; only a prepared run is confirmed.`, 409, { status: run.status });
          // NO TypeScript maker ≠ checker check here, deliberately: trg_apr_moves is the wall (a test pins it).
          await this.runs.confirm(tx, tenantId, runId, actor.userId, reason);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'ambassador.payout_run.confirmed', entityType: 'ambassador_payout_run', entityId: runId, reason,
            oldValue: { status: 'prepared', preparedBy: run.preparedBy ?? 'job' }, newValue: { status: 'confirmed', confirmedBy: actor.userId } });
          const outcome = await this.payInTx(tx, tenantId, run, actor.userId, reason);
          return { runId, confirmedBy: actor.userId, ...outcome };
        } catch (e) { throw namedRunRefusal(e); }
      }, { userId: actor.userId }));
  }

  /** Re-run a confirmed run's unpaid lines (pending / unfunded / failed) — never by its preparer (the checker's act). */
  async payAgain(tenantId: string, actor: RunActor, runId: string, reasonRaw: string, idemKey: string) {
    if (!actor.userId) throw new AmbassadorsForbiddenError('a run is paid by a named person');
    const reason = requireReason(reasonRaw, 'pay an ambassador run');
    return this.idem.remember(idemKey, actor.userId, 'ambassadors.run.pay', () =>
      this.uow.run(tenantId, async (tx) => {
        try {
          const run = await this.runs.runForUpdate(tx, tenantId, runId);
          if (!run) throw new AmbassadorRunNotFoundError(runId);
          if (run.status !== 'partially_paid' && run.status !== 'unfunded') throw new AmbassadorRunRefusedError('AMB_RUN_CLOSED', `This run is ${run.status}; only a partly paid or unfunded run is re-run.`, 409, { status: run.status });
          if (run.preparedBy !== null && run.preparedBy === actor.userId) throw new AmbassadorRunRefusedError('AMB_RUN_CHECKER_IS_MAKER', 'The person who prepared this run cannot also pay it — a second tenant administrator must.', 409);
          const outcome = await this.payInTx(tx, tenantId, run, actor.userId, reason);
          return { runId, ...outcome };
        } catch (e) { throw namedRunRefusal(e); }
      }, { userId: actor.userId }));
  }

  async refuse(tenantId: string, actor: RunActor, runId: string, reasonRaw: string) {
    if (!actor.userId) throw new AmbassadorsForbiddenError('a run is refused by a named person');
    const reason = requireReason(reasonRaw, 'refuse an ambassador run');
    return this.uow.run(tenantId, async (tx) => {
      try {
        const run = await this.runs.runForUpdate(tx, tenantId, runId);
        if (!run) throw new AmbassadorRunNotFoundError(runId);
        if (run.status !== 'prepared') throw new AmbassadorRunRefusedError('AMB_RUN_CLOSED', `This run is ${run.status}; only a prepared run is refused.`, 409, { status: run.status });
        await this.runs.refuse(tx, tenantId, runId, actor.userId, reason);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'ambassador.payout_run.refused', entityType: 'ambassador_payout_run', entityId: runId, reason,
          oldValue: { status: 'prepared' }, newValue: { status: 'refused', refusedBy: actor.userId } });
        return { runId, status: 'refused' };
      } catch (e) { throw namedRunRefusal(e); }
    }, { userId: actor.userId });
  }

  /**
   * Pay every unpaid line, each inside its own SAVEPOINT (one line's failure never rolls back another's money). Before each line the
   * tenant Main is read again — the lines before it debited it — and a line it cannot cover is `unfunded` with its shortfall.
   */
  private async payInTx(tx: TxContext, tenantId: string, run: RunRow, actorUserId: string, reason: string): Promise<PayOutcome> {
    const lines = await this.runs.linesForUpdate(tx, tenantId, run.id);
    const periodEnd = new Date(run.periodEnd);
    let paidNow = 0n; let paid = 0; let unfunded = 0; let failed = 0;
    for (const line of lines) {
      if (line.status === 'paid') continue;
      const total = line.commissionMinor + line.stipendMinor;
      const available = await this.wallet.balanceMinor(tx, tenantMain(tenantId));
      if (available < total) {
        await this.runs.markLineUnfunded(tx, tenantId, line.id, total - available);
        unfunded++;
        continue;
      }
      await tx.query('SAVEPOINT amb_run_line');
      try {
        const txnId = await this.payLine(tx, tenantId, run, line, periodEnd, actorUserId, reason);
        await tx.query('RELEASE SAVEPOINT amb_run_line');
        paidNow += total; paid++;
        await this.outbox.write(tx, { tenantId, aggregateType: 'ambassador_payout', aggregateId: line.id, eventType: AmbassadorEventType.EarningsPaidOut,
          payload: { v: 1, payoutId: line.id, runId: run.id, ambassadorId: line.ambassadorId, userId: line.ambassadorUserId, totalMinor: total.toString(),
            commissionMinor: line.commissionMinor.toString(), stipendMinor: line.stipendMinor.toString(), count: line.earningCount, txnId } });
      } catch (e) {
        await tx.query('ROLLBACK TO SAVEPOINT amb_run_line');
        const code = (e as { code?: string }).code === '23505' ? 'STIPEND_ALREADY_PAID' : ((e as { code?: string }).code ?? 'LINE_FAILED');
        this.log.warn(`ambassador run ${run.id} line ${line.id} failed: ${code}`);
        await this.runs.markLineFailed(tx, tenantId, line.id, code);
        failed++;
      }
    }
    const after = await this.runs.linesForUpdate(tx, tenantId, run.id);
    const status = runStatusAfterPay(after);
    const paidTotal = after.filter((l) => l.status === 'paid').reduce((s, l) => s + l.commissionMinor + l.stipendMinor, 0n);
    const unpaidTotal = after.filter((l) => l.status !== 'paid').reduce((s, l) => s + l.commissionMinor + l.stipendMinor, 0n);
    const check = fundingCheck(await this.wallet.balanceMinor(tx, tenantMain(tenantId)), unpaidTotal, new Date());
    await this.runs.recordPayAttempt(tx, tenantId, run.id, status, paidTotal, check);
    await this.audit.write(tx, { tenantId, actorUserId, action: 'ambassador.payout_run.paid', entityType: 'ambassador_payout_run', entityId: run.id, reason,
      oldValue: { status: run.status }, newValue: { status, paidThisAttemptMinor: paidNow.toString(), paidTotalMinor: paidTotal.toString(), paid, unfunded, failed,
        stillUnpaidMinor: unpaidTotal.toString(), funding: check } });
    this.metrics.inc('ambassadors.run.paid', { tenant: tenantId, status });
    return { paid, unfunded, failed, paidMinor: paidNow.toString(), status };
  }

  /** One line: lock exactly the earnings it covers (they must still be what was prepared), post ONE txn tenant Main → ambassador
   *  Main, stamp the earnings (rowCount asserted), record the stipend (once per month), mark the line paid. */
  private async payLine(tx: TxContext, tenantId: string, run: RunRow, line: LineRow, periodEnd: Date, actorUserId: string, reason: string): Promise<string> {
    const locked = line.commissionMinor > 0n ? await this.earnings.lockUnpaidUpTo(tx, tenantId, line.ambassadorId, periodEnd) : [];
    const sum = locked.reduce((s, e) => s + e.amountMinor, 0n);
    if (sum !== line.commissionMinor || locked.length !== line.earningCount) {
      throw new AmbassadorRunRefusedError('EARNINGS_CHANGED', 'The earnings this line covers changed after the run was prepared — refuse this run and prepare a new one.', 409,
        { preparedMinor: line.commissionMinor.toString(), nowMinor: sum.toString() });
    }
    const total = line.commissionMinor + line.stipendMinor;
    const posted = await this.wallet.post(tx, {
      tenantId, txnType: AMBASSADOR_RUN_TXN, idempotencyKey: runLineKey(run.id, line.ambassadorId), referenceType: RUN_LINE_REFERENCE_TYPE, referenceId: line.id,
      initiatedBy: actorUserId, description: line.stipendMinor > 0n ? 'Ambassador weekly run: commission + monthly stipend' : 'Ambassador weekly run: commission',
      legs: runLineLegs(tenantId, line.ambassadorUserId, total),
    });
    if (locked.length > 0) {
      const keys = locked.map((e) => ({ id: e.id, createdAtRaw: e.toProps().createdAtRaw as string }));
      const stamped = await this.earnings.markPaid(tx, tenantId, keys, line.id);
      if (stamped !== keys.length) throw new PayoutMarkMismatchError(keys.length, stamped);
    }
    if (line.stipendMinor > 0n && line.stipendMonth) {
      await this.runs.insertStipendPayment(tx, { tenantId, ambassadorId: line.ambassadorId, month: line.stipendMonth, amountMinor: line.stipendMinor, runId: run.id, lineId: line.id, txnId: posted.txnId });
    }
    await this.runs.markLinePaid(tx, tenantId, line.id, posted.txnId);
    await this.audit.write(tx, { tenantId, actorUserId, action: 'ambassador.payout.run', entityType: 'ambassador_profile', entityId: line.ambassadorId, reason,
      oldValue: { unpaidMinor: line.commissionMinor.toString(), unpaidCount: line.earningCount },
      newValue: { runId: run.id, payoutId: line.id, totalMinor: total.toString(), commissionMinor: line.commissionMinor.toString(), stipendMinor: line.stipendMinor.toString(),
        stipendMonth: line.stipendMonth, count: line.earningCount, txnId: posted.txnId, source: 'tenant_main' } });
    return posted.txnId;
  }

  /* ───────────────────────────── reads ───────────────────────────── */

  private view(run: RunRow) {
    const { createdAtRaw: _raw, ...rest } = run;
    void _raw;
    return { ...rest, totalMinor: (BigInt(run.totalCommissionMinor) + BigInt(run.totalStipendMinor)).toString(), maker: run.preparedBy ? 'person' : 'job' };
  }
  private lineView(l: LineRow) {
    return { id: l.id, ambassadorId: l.ambassadorId, displayName: l.displayName, phoneMasked: l.phoneMasked, commissionMinor: l.commissionMinor.toString(),
      earningCount: l.earningCount, stipendMinor: l.stipendMinor.toString(), stipendMonth: l.stipendMonth, totalMinor: (l.commissionMinor + l.stipendMinor).toString(),
      status: l.status, shortfallMinor: l.shortfallMinor, failureCode: l.failureCode, attempts: l.attempts, payoutId: l.payoutId, txnId: l.txnId, paidAt: l.paidAt };
  }
  async get(tenantId: string, runId: string, viewerUserId: string) {
    const r = await this.runs.get(tenantId, runId);
    if (!r) throw new AmbassadorRunNotFoundError(runId);
    return { ...this.view(r.run), lines: r.lines.map((l) => this.lineView(l)), viewerIsMaker: r.run.preparedBy === viewerUserId };
  }
  /** W161's "current run": the open run (with its lines) or null, and when the job next prepares one. */
  async current(tenantId: string, viewerUserId: string, now: Date = new Date()) {
    const open = await this.runs.currentOpen(tenantId);
    const nextEnd = weeklyPeriodEnd(new Date(now.getTime() + 7 * 86_400_000));
    return { run: open ? await this.get(tenantId, open.id, viewerUserId) : null, nextAutoPrepareAt: nextEnd.toISOString(), nextPayDate: nextFriday(nextEnd) };
  }
  async list(tenantId: string, q: { cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.runs.list(tenantId, q);
    const last = rows[rows.length - 1];
    return { items: rows.map((r) => this.view(r)), nextCursor: rows.length === q.limit && last ? encodeCursor(last.createdAtRaw, last.id) : null };
  }
  /** W160 "Owed this week ₹… pays Friday": TRUE only when a run is prepared — the run's own date; otherwise "no run prepared". */
  async forAmbassador(tenantId: string, ambassadorId: string) {
    const [open, stipends] = await Promise.all([this.runs.openLineFor(tenantId, ambassadorId), this.runs.stipendsPaid(tenantId, ambassadorId)]);
    return {
      run: open ? { runId: open.run.id, status: open.run.status, kind: open.run.kind, payDate: open.run.payDate, periodEnd: open.run.periodEnd, line: this.lineView(open.line) } : null,
      noRunReason: open ? null : 'no_run_prepared',
      stipendsPaid: stipends,
    };
  }
}
