// modules/labour/services/labour-money.service.ts · PC-56 TENANT-11b · F-5 / A2–A4 — THE ONLY PLACE LABOUR MONEY MOVES.
//
// Founder decision (2026-10-02): wages are ESCROWED AT ROSTER CONFIRM + a flat ₹20 platform fee; the same-day fairness fee is
// REFUSED BY NAME. Every move is a balanced, idempotency-keyed WalletPort post inside the CALLER'S transaction (the booking
// row is locked FOR UPDATE by the caller), and every move is recorded on a 0187 row carrying the txn id it produced:
//
//   escrowInTx    employer Main −(wages+fee) → employer Hold +wages, platform Fees +fee     labour-escrow:<booking>
//   payRunInTx    per assignment, the CONFIRMED days not yet paid (domain/labour-money computeWage):
//                   employer Hold −w → worker Main +w                                        wage:<assignment>:<sha(days)>
//                   overtime the same way                                                     wage-ot:<assignment>:<sha(days)>
//                 a run the escrow cannot cover first TOPS UP employer Main → employer Hold   labour-escrow-topup:<booking>:<n>
//                 (unfunded → the base it can pay is paid, the rest is recorded `awaiting_topup` and retried next run)
//                 on a COMPLETED booking with nothing outstanding: the remainder Hold → Main  labour-escrow-release:<booking>
//   releaseInTx   cancel before the work is paid: the whole remainder Hold → Main (the FEE IS KEPT, said on screen)
//
// THE HOLD IS POOLED. The employer's Hold account may also carry an auction EMD; `labour_escrows` is this booking's share and
// nothing here ever debits Hold beyond `heldMinor(escrow)`.
//
// A BOOKING STARTED BEFORE 0187 has no escrow row: its pay run debits the employer's Main directly (the old source) with the
// corrected amounts, and never releases anything. Named on the row (`source = employer_main`).
import { Inject, Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { AccountRef, userHold, userMain } from '../../../core/wallet/account-codes';
import { InsufficientWalletBalanceError, WalletFrozenError } from '../../../core/wallet/wallet.errors';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { LabourBooking } from '../domain/labour-booking.entity';
import { BookingAssignment } from '../domain/booking-assignment.entity';
import {
  LABOUR_REFERENCE_TYPE, LABOUR_TXN, computeWage, escrowEstimate, escrowKey, escrowLegs, feeFor, heldMinor, releaseKey, releaseLegs,
  runKeyOf, topupKey, topupLegs, wageKey, wageLegs, wageOtKey, FeeRule,
} from '../domain/labour-money';
import { EmployerFundsUnavailableError } from '../domain/labour.errors';
import { LabourMoneyRepository, EscrowRow, PayoutRow } from '../repositories/labour-money.repository';
import { AttendanceRepository } from '../repositories/attendance.repository';
import { WorkerProfileRepository } from '../repositories/worker-profile.repository';

const isFundsRefusal = (e: unknown) => e instanceof InsufficientWalletBalanceError || e instanceof WalletFrozenError;

export interface PayRunLine {
  assignmentId: string; workerId: string; daysConfirmed: number; baseMinor: string; otMinor: string; paidThisRunMinor: string;
  status: 'paid' | 'partial' | 'awaiting_topup' | 'zero' | 'nothing_new' | 'task_on_completion';
  otStatus: 'none' | 'paid' | 'awaiting_topup' | 'not_priced'; zeroReason: string | null; payoutId: string | null;
}
export interface PayRunResult {
  movedMinor: bigint; toppedUpMinor: bigint; releasedMinor: bigint; lines: PayRunLine[];
  outstanding: number; source: 'escrow' | 'employer_main'; released: boolean;
}

@Injectable()
export class LabourMoneyService {
  constructor(
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly audit: AuditWriter,
    private readonly money: LabourMoneyRepository,
    private readonly attendance: AttendanceRepository,
    private readonly workers: WorkerProfileRepository,
  ) {}

  feeRule(tx: TxContext | null, tenantId: string, onDate: string): Promise<FeeRule | null> { return this.money.activeFeeRule(tx, tenantId, onDate); }

  /** A3 — set the wages aside. Refuses (nothing moves) when the employer's Main cannot cover wages + fee. */
  async escrowInTx(tx: TxContext, input: { tenantId: string; booking: LabourBooking; accepted: BookingAssignment[]; actorUserId: string; onBehalf: boolean; consentId: string | null; today: string }) {
    const b = input.booking.toProps();
    const rule = await this.money.activeFeeRule(tx, input.tenantId, input.today);
    const est = escrowEstimate({ kind: b.wageKind, startDate: b.startDate, endDate: b.endDate, dailyHours: b.dailyHours, rates: input.accepted.map((a) => a.wageMinor), fee: rule });
    const needed = est.totalMinor;
    const available = await this.wallet.balanceMinor(tx, userMain(b.employerUserId, b.currencyCode));
    if (available < needed) throw new EmployerFundsUnavailableError(needed, available);
    let txnId: string;
    try {
      txnId = (await this.wallet.post(tx, {
        tenantId: input.tenantId, txnType: LABOUR_TXN.Escrow, idempotencyKey: escrowKey(b.id), referenceType: LABOUR_REFERENCE_TYPE, referenceId: b.id,
        initiatedBy: input.actorUserId, description: 'Labour wages set aside at roster confirm (+ platform fee)',
        legs: escrowLegs(b.employerUserId, est.wagesMinor, est.feeMinor),
      })).txnId;
    } catch (e) {
      if (isFundsRefusal(e)) throw new EmployerFundsUnavailableError(needed, available);
      throw e;
    }
    const id = uuidv7();
    await this.money.insertEscrow(tx, { id, tenantId: input.tenantId, bookingId: b.id, employerUserId: b.employerUserId, expectedMinor: est.wagesMinor, feeMinor: est.feeMinor,
      feeRuleId: rule?.id ?? null, escrowTxnId: txnId, confirmedBy: input.actorUserId, onBehalf: input.onBehalf, consentId: input.consentId });
    return { escrowId: id, txnId, wagesMinor: est.wagesMinor, feeMinor: est.feeMinor, totalMinor: est.totalMinor, days: est.days, perWorkerMinor: est.perWorkerMinor, feeRule: rule };
  }

  /** A4 — cancel: return what the booking still holds (the fee is kept). No escrow → nothing to return. */
  async releaseInTx(tx: TxContext, input: { tenantId: string; booking: LabourBooking; actorUserId: string; reason: 'completed' | 'cancelled' }): Promise<{ releasedMinor: bigint; feeKeptMinor: bigint; txnId: string | null; hadEscrow: boolean }> {
    const b = input.booking.toProps();
    const e = await this.money.escrowForUpdate(tx, input.tenantId, b.id);
    if (!e || e.status === 'released') return { releasedMinor: 0n, feeKeptMinor: e?.feeMinor ?? 0n, txnId: null, hadEscrow: !!e };
    const held = heldMinor(e);
    let txnId: string | null = null;
    if (held > 0n) {
      txnId = (await this.wallet.post(tx, {
        tenantId: input.tenantId, txnType: LABOUR_TXN.Release, idempotencyKey: releaseKey(b.id), referenceType: LABOUR_REFERENCE_TYPE, referenceId: b.id,
        initiatedBy: input.actorUserId, description: input.reason === 'cancelled' ? 'Labour escrow returned on cancel (platform fee kept)' : 'Labour escrow remainder returned on completion',
        legs: releaseLegs(b.employerUserId, held),
      })).txnId;
    }
    await this.money.recordRelease(tx, input.tenantId, e.id, held, txnId, input.reason);
    return { releasedMinor: held, feeKeptMinor: e.feeMinor, txnId, hadEscrow: true };
  }

  /**
   * A2 + A4 — THE PAY RUN. Pays every accepted assignment's confirmed, unpaid attendance; retries rows awaiting a top-up;
   * on a completed booking with nothing outstanding, releases the remainder (the caller then marks the booking paid).
   */
  async payRunInTx(tx: TxContext, input: { tenantId: string; booking: LabourBooking; accepted: BookingAssignment[]; actorUserId: string; ip: string | null; reason: string | null; mayRelease: boolean }): Promise<PayRunResult> {
    const b = input.booking.toProps();
    const completed = b.status === 'completed';
    const escrow = await this.money.escrowForUpdate(tx, input.tenantId, b.id);
    if (escrow && escrow.status === 'released') return { movedMinor: 0n, toppedUpMinor: 0n, releasedMinor: 0n, lines: [], outstanding: 0, source: 'escrow', released: true };
    const state = { escrow, moved: 0n, toppedUp: 0n };
    const source: AccountRef = escrow ? userHold(b.employerUserId, b.currencyCode) : userMain(b.employerUserId, b.currencyCode);
    const lines: PayRunLine[] = [];
    let outstanding = 0;

    for (const a of input.accepted) {
      const worker = await this.workers.getById(input.tenantId, a.workerId, tx);
      if (!worker) continue;
      const prior = await this.money.payoutsForAssignment(tx, input.tenantId, a.id);
      // 1 · rows a previous run could not fully fund
      for (const row of prior.filter((r) => r.status === 'awaiting_topup' || r.status === 'partial')) {
        const line = await this.settleOutstanding(tx, input, b, row, source, state, worker.userId);
        lines.push(line);
        if (line.status === 'awaiting_topup' || line.status === 'partial') outstanding++;
      }
      // 2 · confirmed days not yet paid
      const days = await this.attendance.confirmedUnpaidForUpdate(tx, input.tenantId, a.id);
      const taskPaidBefore = prior.some((r) => r.wageKind === 'per_task' && r.baseMinor > 0n);
      const calc = computeWage({ kind: b.wageKind, rateMinor: a.wageMinor, dailyHours: b.dailyHours, overtimeMultiplier: b.overtimeRateMultiplier,
        days: days.map((d) => ({ id: d.id, hoursRegular: d.hoursRegularText, hoursOvertime: d.hoursOvertimeText })), bookingCompleted: completed, taskPaidBefore });
      if (calc.deferred) {
        lines.push({ assignmentId: a.id, workerId: a.workerId, daysConfirmed: days.length, baseMinor: '0', otMinor: '0', paidThisRunMinor: '0', status: 'task_on_completion', otStatus: 'none', zeroReason: null, payoutId: null });
        continue;
      }
      const ids = days.map((d) => d.id);
      const runKey = runKeyOf(ids);
      if (days.length === 0) {
        // A worker with no confirmed attendance is paid 0 and the row says why — ONCE per assignment (the empty set's key).
        if (prior.length === 0 && !(await this.money.payoutByRun(tx, input.tenantId, a.id, runKey))) {
          const id = uuidv7();
          await this.money.insertPayout(tx, { id, tenantId: input.tenantId, bookingId: b.id, assignmentId: a.id, workerId: a.workerId, workerUserId: worker.userId, runKey,
            wageKind: b.wageKind, rateMinor: a.wageMinor, attendanceIds: [], daysConfirmed: 0, hoursRegularH: 0n, hoursOvertimeH: 0n, baseMinor: 0n, otMinor: 0n,
            baseTxnId: null, otTxnId: null, status: 'zero', otStatus: 'none', source: escrow ? 'escrow' : 'employer_main', zeroReason: 'no_confirmed_attendance', paidBy: input.actorUserId });
          await this.auditPayout(tx, input, b.id, id, a, { daysConfirmed: 0, baseMinor: 0n, otMinor: 0n, paidMinor: 0n, status: 'zero', zeroReason: 'no_confirmed_attendance' });
          lines.push({ assignmentId: a.id, workerId: a.workerId, daysConfirmed: 0, baseMinor: '0', otMinor: '0', paidThisRunMinor: '0', status: 'zero', otStatus: 'none', zeroReason: 'no_confirmed_attendance', payoutId: id });
        } else if (prior.length > 0 && !lines.some((l) => l.assignmentId === a.id)) {
          lines.push({ assignmentId: a.id, workerId: a.workerId, daysConfirmed: 0, baseMinor: '0', otMinor: '0', paidThisRunMinor: '0', status: 'nothing_new', otStatus: 'none', zeroReason: null, payoutId: null });
        }
        continue;
      }
      const payoutId = uuidv7();
      const otWanted = calc.otStatus === 'due' ? calc.otMinor : 0n;
      let basePaid = false; let otPaid = false;
      let baseTxn: string | null = null; let otTxn: string | null = null;
      if (calc.baseMinor + otWanted === 0n) basePaid = true;
      else if (await this.fund(tx, input, b, state, calc.baseMinor + otWanted)) { basePaid = true; otPaid = otWanted > 0n; }
      else if (calc.baseMinor > 0n && otWanted > 0n && await this.fund(tx, input, b, state, calc.baseMinor)) basePaid = true;
      else if (calc.baseMinor === 0n) basePaid = true;
      if (basePaid && calc.baseMinor > 0n) baseTxn = await this.payLeg(tx, input, b, source, state, worker.userId, calc.baseMinor, wageKey(a.id, runKey), 'Wages for confirmed attendance');
      if (otPaid) otTxn = await this.payLeg(tx, input, b, source, state, worker.userId, otWanted, wageOtKey(a.id, runKey), 'Overtime for confirmed attendance');
      const otStatus: PayoutRow['otStatus'] = calc.otStatus === 'not_priced' ? 'not_priced' : otWanted === 0n ? 'none' : otPaid ? 'paid' : 'awaiting_topup';
      const status: PayoutRow['status'] = calc.zeroReason ? 'zero' : !basePaid ? 'awaiting_topup' : otStatus === 'awaiting_topup' ? 'partial' : 'paid';
      await this.money.insertPayout(tx, { id: payoutId, tenantId: input.tenantId, bookingId: b.id, assignmentId: a.id, workerId: a.workerId, workerUserId: worker.userId, runKey,
        wageKind: b.wageKind, rateMinor: a.wageMinor, attendanceIds: ids, daysConfirmed: calc.daysConfirmed, hoursRegularH: calc.hoursRegularH, hoursOvertimeH: calc.hoursOvertimeH,
        baseMinor: calc.baseMinor, otMinor: calc.otStatus === 'due' ? calc.otMinor : 0n, baseTxnId: baseTxn, otTxnId: otTxn, status, otStatus,
        source: escrow ? 'escrow' : 'employer_main', zeroReason: calc.zeroReason, paidBy: input.actorUserId });
      if (basePaid) {
        const stamped = await this.attendance.stampPayout(tx, input.tenantId, ids, payoutId);
        if (stamped !== ids.length) throw new Error(`labour pay run: stamped ${stamped} of ${ids.length} attendance rows for assignment ${a.id}`);
      }
      const paidNow = (baseTxn ? calc.baseMinor : 0n) + (otTxn ? otWanted : 0n);
      await this.auditPayout(tx, input, b.id, payoutId, a, { daysConfirmed: calc.daysConfirmed, baseMinor: calc.baseMinor, otMinor: otWanted, paidMinor: paidNow, status, zeroReason: calc.zeroReason });
      if (status === 'awaiting_topup' || status === 'partial') outstanding++;
      lines.push({ assignmentId: a.id, workerId: a.workerId, daysConfirmed: calc.daysConfirmed, baseMinor: calc.baseMinor.toString(), otMinor: otWanted.toString(),
        paidThisRunMinor: paidNow.toString(), status, otStatus, zeroReason: calc.zeroReason, payoutId });
    }

    let releasedMinor = 0n; let released = false;
    if (completed && input.mayRelease && outstanding === 0 && state.escrow) {
      const r = await this.releaseInTx(tx, { tenantId: input.tenantId, booking: input.booking, actorUserId: input.actorUserId, reason: 'completed' });
      releasedMinor = r.releasedMinor; released = true;
    }
    return { movedMinor: state.moved, toppedUpMinor: state.toppedUp, releasedMinor, lines, outstanding, source: escrow ? 'escrow' : 'employer_main', released: released || (completed && input.mayRelease && !escrow && outstanding === 0) };
  }

  /** Make sure the booking's share of the Hold covers `amount`, topping up from the employer's Main when it can. */
  private async fund(tx: TxContext, input: { tenantId: string; actorUserId: string }, b: ReturnType<LabourBooking['toProps']>, state: { escrow: EscrowRow | null; toppedUp: bigint }, amount: bigint): Promise<boolean> {
    if (amount <= 0n) return true;
    if (!state.escrow) return (await this.wallet.balanceMinor(tx, userMain(b.employerUserId, b.currencyCode))) >= amount;
    const held = heldMinor(state.escrow);
    if (held >= amount) return true;
    const short = amount - held;
    if ((await this.wallet.balanceMinor(tx, userMain(b.employerUserId, b.currencyCode))) < short) return false;
    const n = state.escrow.topupCount + 1;
    await this.wallet.post(tx, {
      tenantId: input.tenantId, txnType: LABOUR_TXN.Topup, idempotencyKey: topupKey(b.id, n), referenceType: LABOUR_REFERENCE_TYPE, referenceId: b.id,
      initiatedBy: input.actorUserId, description: 'Labour escrow topped up for wages beyond the escrow', legs: topupLegs(b.employerUserId, short),
    });
    await this.money.recordTopup(tx, input.tenantId, state.escrow.id, short);
    state.escrow = { ...state.escrow, toppedUpMinor: state.escrow.toppedUpMinor + short, topupCount: n };
    state.toppedUp += short;
    return true;
  }

  private async payLeg(tx: TxContext, input: { tenantId: string; actorUserId: string }, b: ReturnType<LabourBooking['toProps']>, source: AccountRef, state: { escrow: EscrowRow | null; moved: bigint }, workerUserId: string, amount: bigint, key: string, description: string): Promise<string> {
    const r = await this.wallet.post(tx, {
      tenantId: input.tenantId, txnType: LABOUR_TXN.Wage, idempotencyKey: key, referenceType: LABOUR_REFERENCE_TYPE, referenceId: b.id,
      initiatedBy: input.actorUserId, description, legs: wageLegs(source, workerUserId, amount),
    });
    if (!r.alreadyApplied) {
      state.moved += amount;
      if (state.escrow) { await this.money.recordPaid(tx, input.tenantId, state.escrow.id, amount); state.escrow = { ...state.escrow, paidMinor: state.escrow.paidMinor + amount }; }
    }
    return r.txnId;
  }

  /** Retry a row a previous run could not fully fund: the base (and its days' stamp) first, then the overtime. */
  private async settleOutstanding(tx: TxContext, input: { tenantId: string; actorUserId: string; ip: string | null; reason: string | null }, b: ReturnType<LabourBooking['toProps']>, row: PayoutRow, source: AccountRef, state: { escrow: EscrowRow | null; moved: bigint; toppedUp: bigint }, workerUserId: string): Promise<PayRunLine> {
    let baseTxn = row.baseTxnId; let otTxn = row.otTxnId;
    const otDue = row.otStatus === 'awaiting_topup' ? row.otMinor : 0n;
    let paidNow = 0n;
    if (!baseTxn && row.baseMinor > 0n) {
      if (await this.fund(tx, input, b, state, row.baseMinor + otDue)) {
        baseTxn = await this.payLeg(tx, input, b, source, state, workerUserId, row.baseMinor, wageKey(row.assignmentId, row.runKey), 'Wages for confirmed attendance');
        paidNow += row.baseMinor;
        if (otDue > 0n) { otTxn = await this.payLeg(tx, input, b, source, state, workerUserId, otDue, wageOtKey(row.assignmentId, row.runKey), 'Overtime for confirmed attendance'); paidNow += otDue; }
      } else if (otDue > 0n && await this.fund(tx, input, b, state, row.baseMinor)) {
        baseTxn = await this.payLeg(tx, input, b, source, state, workerUserId, row.baseMinor, wageKey(row.assignmentId, row.runKey), 'Wages for confirmed attendance');
        paidNow += row.baseMinor;
      }
      if (baseTxn) {
        const stamped = await this.attendance.stampPayout(tx, input.tenantId, row.attendanceIds, row.id);
        if (stamped !== row.attendanceIds.length) throw new Error(`labour pay run: stamped ${stamped} of ${row.attendanceIds.length} attendance rows for payout ${row.id}`);
      }
    } else if (baseTxn && otDue > 0n && !otTxn && await this.fund(tx, input, b, state, otDue)) {
      otTxn = await this.payLeg(tx, input, b, source, state, workerUserId, otDue, wageOtKey(row.assignmentId, row.runKey), 'Overtime for confirmed attendance');
      paidNow += otDue;
    }
    const otStatus: PayoutRow['otStatus'] = otDue === 0n ? row.otStatus : otTxn ? 'paid' : 'awaiting_topup';
    const status: PayoutRow['status'] = !baseTxn && row.baseMinor > 0n ? 'awaiting_topup' : otStatus === 'awaiting_topup' ? 'partial' : 'paid';
    if (paidNow > 0n) {
      await this.money.updatePayout(tx, input.tenantId, row.id, { baseTxnId: baseTxn, otTxnId: otTxn, status, otStatus, paidBy: input.actorUserId });
      await this.audit.write(tx, { tenantId: input.tenantId, actorUserId: input.actorUserId, action: 'labour.wages.paid', entityType: 'labour_wage_payout', entityId: row.id, ip: input.ip, reason: input.reason,
        oldValue: { status: row.status, otStatus: row.otStatus }, newValue: { bookingId: b.id, assignmentId: row.assignmentId, paidMinor: paidNow.toString(), status, otStatus, retry: true } });
    }
    return { assignmentId: row.assignmentId, workerId: row.workerId, daysConfirmed: row.daysConfirmed, baseMinor: row.baseMinor.toString(), otMinor: row.otMinor.toString(),
      paidThisRunMinor: paidNow.toString(), status, otStatus, zeroReason: row.zeroReason, payoutId: row.id };
  }

  private async auditPayout(tx: TxContext, input: { tenantId: string; actorUserId: string; ip: string | null; reason: string | null }, bookingId: string, payoutId: string, a: BookingAssignment, v: { daysConfirmed: number; baseMinor: bigint; otMinor: bigint; paidMinor: bigint; status: string; zeroReason: string | null }) {
    await this.audit.write(tx, {
      tenantId: input.tenantId, actorUserId: input.actorUserId, action: 'labour.wages.paid', entityType: 'labour_wage_payout', entityId: payoutId, ip: input.ip, reason: input.reason,
      oldValue: { attendancePaid: false },
      newValue: { bookingId, assignmentId: a.id, workerId: a.workerId, rateMinor: a.wageMinor.toString(), daysConfirmed: v.daysConfirmed, baseMinor: v.baseMinor.toString(),
        otMinor: v.otMinor.toString(), paidMinor: v.paidMinor.toString(), status: v.status, zeroReason: v.zeroReason },
    });
  }

  /** Read side: the booking's escrow + payouts, as the detail screen prints them. */
  async moneyFacts(tenantId: string, bookingId: string): Promise<{ escrow: EscrowRow | null; payouts: PayoutRow[] }> {
    const [escrows, payouts] = await Promise.all([this.money.escrowsFor(tenantId, [bookingId]), this.money.payoutsForBooking(tenantId, bookingId)]);
    return { escrow: escrows.get(bookingId) ?? null, payouts };
  }
  escrowsFor(tenantId: string, bookingIds: string[]) { return this.money.escrowsFor(tenantId, bookingIds); }
  feeOf(rule: FeeRule | null) { return feeFor(rule); }
}
