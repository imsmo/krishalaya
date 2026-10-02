// modules/labour/repositories/labour-money.repository.ts · PC-56 TENANT-11b · all SQL for the four 0187 tables:
// labour_fee_rules (read), labour_escrows, labour_wage_payouts, labour_consents. tenant_id in EVERY query (Law 1) + RLS
// (ENABLE + FORCE, the 0175 split). These tables RECORD money; they never move it — every move is a WalletPort post the
// service makes in the same transaction, and the txn id it returns is what these rows carry.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { FeeRule } from '../domain/labour-money';

export interface EscrowRow {
  id: string; tenantId: string; bookingId: string; employerUserId: string; expectedMinor: bigint; feeMinor: bigint; feeRuleId: string | null;
  escrowTxnId: string; toppedUpMinor: bigint; topupCount: number; paidMinor: bigint; releasedMinor: bigint; releaseTxnId: string | null;
  status: 'held' | 'released'; releaseReason: 'completed' | 'cancelled' | null; releasedAt: Date | null; confirmedBy: string; onBehalf: boolean;
  consentId: string | null; createdAt: Date;
}
const ESCROW_COLS = `id, tenant_id, booking_id, employer_user_id, expected_minor, fee_minor, fee_rule_id, escrow_txn_id, topped_up_minor, topup_count,
  paid_minor, released_minor, release_txn_id, status, release_reason, released_at, confirmed_by, on_behalf, consent_id, created_at`;
const toEscrow = (r: any): EscrowRow => ({
  id: r.id, tenantId: r.tenant_id, bookingId: r.booking_id, employerUserId: r.employer_user_id, expectedMinor: BigInt(r.expected_minor),
  feeMinor: BigInt(r.fee_minor), feeRuleId: r.fee_rule_id ?? null, escrowTxnId: r.escrow_txn_id, toppedUpMinor: BigInt(r.topped_up_minor),
  topupCount: Number(r.topup_count), paidMinor: BigInt(r.paid_minor), releasedMinor: BigInt(r.released_minor), releaseTxnId: r.release_txn_id ?? null,
  status: r.status, releaseReason: r.release_reason ?? null, releasedAt: r.released_at ?? null, confirmedBy: r.confirmed_by, onBehalf: r.on_behalf === true,
  consentId: r.consent_id ?? null, createdAt: r.created_at,
});

export interface PayoutRow {
  id: string; bookingId: string; assignmentId: string; workerId: string; workerUserId: string; runKey: string; wageKind: string; rateMinor: bigint;
  attendanceIds: string[]; daysConfirmed: number; hoursRegular: string; hoursOvertime: string; baseMinor: bigint; otMinor: bigint;
  baseTxnId: string | null; otTxnId: string | null; status: 'paid' | 'partial' | 'awaiting_topup' | 'zero';
  otStatus: 'none' | 'paid' | 'awaiting_topup' | 'not_priced'; source: 'escrow' | 'employer_main'; zeroReason: string | null; createdAt: Date;
}
const PAYOUT_COLS = `id, booking_id, assignment_id, worker_id, worker_user_id, run_key, wage_kind, rate_minor, attendance_ids::text[] AS attendance_ids,
  days_confirmed, hours_regular::text AS hours_regular, hours_overtime::text AS hours_overtime, base_minor, ot_minor, base_txn_id, ot_txn_id,
  status, ot_status, source, zero_reason, created_at`;
const toPayout = (r: any): PayoutRow => ({
  id: r.id, bookingId: r.booking_id, assignmentId: r.assignment_id, workerId: r.worker_id, workerUserId: r.worker_user_id, runKey: String(r.run_key).trim(),
  wageKind: r.wage_kind, rateMinor: BigInt(r.rate_minor), attendanceIds: r.attendance_ids ?? [], daysConfirmed: Number(r.days_confirmed),
  hoursRegular: r.hours_regular, hoursOvertime: r.hours_overtime, baseMinor: BigInt(r.base_minor), otMinor: BigInt(r.ot_minor),
  baseTxnId: r.base_txn_id ?? null, otTxnId: r.ot_txn_id ?? null, status: r.status, otStatus: r.ot_status, source: r.source,
  zeroReason: r.zero_reason ?? null, createdAt: r.created_at,
});

export interface ConsentRow { id: string; bookingId: string; employerUserId: string; act: string; channel: string; mediaId: string | null; note: string | null; recordedBy: string; recordedAt: Date }

@Injectable()
export class LabourMoneyRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  // ---- fee rule ----
  /** The fee rule in effect for this tenant on `onDate`: the tenant's own row wins over the platform row. */
  async activeFeeRule(tx: TxContext | null, tenantId: string, onDate: string): Promise<FeeRule | null> {
    const sql = `SELECT id, kind, amount_minor, cap_minor, cap_rule_note FROM labour_fee_rules
                  WHERE is_active AND effective_from <= $2::date AND (tenant_id = $1 OR tenant_id IS NULL)
                  ORDER BY (tenant_id IS NULL), effective_from DESC LIMIT 1`;
    const r = tx ? await tx.query(sql, [tenantId, onDate]) : await this.replica.forTenant(tenantId).query(sql, [tenantId, onDate]);
    const x = r.rows[0];
    return x ? { id: x.id, kind: x.kind, amountMinor: BigInt(x.amount_minor), capMinor: x.cap_minor == null ? null : BigInt(x.cap_minor), capRuleNote: x.cap_rule_note } : null;
  }

  // ---- escrow ----
  async insertEscrow(tx: TxContext, e: { id: string; tenantId: string; bookingId: string; employerUserId: string; expectedMinor: bigint; feeMinor: bigint; feeRuleId: string | null; escrowTxnId: string; confirmedBy: string; onBehalf: boolean; consentId: string | null }): Promise<void> {
    await tx.query(
      `INSERT INTO labour_escrows (id, tenant_id, booking_id, employer_user_id, expected_minor, fee_minor, fee_rule_id, escrow_txn_id, confirmed_by, on_behalf, consent_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [e.id, e.tenantId, e.bookingId, e.employerUserId, e.expectedMinor.toString(), e.feeMinor.toString(), e.feeRuleId, e.escrowTxnId, e.confirmedBy, e.onBehalf, e.consentId]);
  }
  async escrowForUpdate(tx: TxContext, tenantId: string, bookingId: string): Promise<EscrowRow | null> {
    const r = await tx.query(`SELECT ${ESCROW_COLS} FROM labour_escrows WHERE tenant_id=$1 AND booking_id=$2 FOR UPDATE`, [tenantId, bookingId]);
    return r.rows[0] ? toEscrow(r.rows[0]) : null;
  }
  async escrowsFor(tenantId: string, bookingIds: string[]): Promise<Map<string, EscrowRow>> {
    if (bookingIds.length === 0) return new Map();
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${ESCROW_COLS} FROM labour_escrows WHERE tenant_id=$1 AND booking_id = ANY($2::uuid[])`, [tenantId, bookingIds]);
    return new Map(r.rows.map((x: any) => [x.booking_id, toEscrow(x)]));
  }
  async recordTopup(tx: TxContext, tenantId: string, escrowId: string, amountMinor: bigint): Promise<void> {
    await tx.query(`UPDATE labour_escrows SET topped_up_minor = topped_up_minor + $3, topup_count = topup_count + 1, updated_at = now() WHERE id=$1 AND tenant_id=$2 AND status='held'`,
      [escrowId, tenantId, amountMinor.toString()]);
  }
  async recordPaid(tx: TxContext, tenantId: string, escrowId: string, amountMinor: bigint): Promise<void> {
    await tx.query(`UPDATE labour_escrows SET paid_minor = paid_minor + $3, updated_at = now() WHERE id=$1 AND tenant_id=$2 AND status='held'`,
      [escrowId, tenantId, amountMinor.toString()]);
  }
  async recordRelease(tx: TxContext, tenantId: string, escrowId: string, amountMinor: bigint, txnId: string | null, reason: 'completed' | 'cancelled'): Promise<void> {
    const r = await tx.query(
      `UPDATE labour_escrows SET released_minor = released_minor + $3, release_txn_id = $4, status='released', release_reason=$5, released_at=now(), updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND status='held'`,
      [escrowId, tenantId, amountMinor.toString(), txnId, reason]);
    if ((r.rowCount ?? 0) !== 1) throw new Error(`labour escrow ${escrowId}: release matched ${r.rowCount} rows`);
  }

  // ---- payouts ----
  async payoutByRun(tx: TxContext, tenantId: string, assignmentId: string, runKey: string): Promise<PayoutRow | null> {
    const r = await tx.query(`SELECT ${PAYOUT_COLS} FROM labour_wage_payouts WHERE tenant_id=$1 AND assignment_id=$2 AND run_key=$3 FOR UPDATE`, [tenantId, assignmentId, runKey]);
    return r.rows[0] ? toPayout(r.rows[0]) : null;
  }
  async payoutsForAssignment(tx: TxContext, tenantId: string, assignmentId: string): Promise<PayoutRow[]> {
    const r = await tx.query(`SELECT ${PAYOUT_COLS} FROM labour_wage_payouts WHERE tenant_id=$1 AND assignment_id=$2 ORDER BY created_at FOR UPDATE`, [tenantId, assignmentId]);
    return r.rows.map(toPayout);
  }
  async payoutsForBooking(tenantId: string, bookingId: string): Promise<PayoutRow[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${PAYOUT_COLS} FROM labour_wage_payouts WHERE tenant_id=$1 AND booking_id=$2 ORDER BY created_at`, [tenantId, bookingId]);
    return r.rows.map(toPayout);
  }
  async insertPayout(tx: TxContext, p: {
    id: string; tenantId: string; bookingId: string; assignmentId: string; workerId: string; workerUserId: string; runKey: string; wageKind: string; rateMinor: bigint;
    attendanceIds: string[]; daysConfirmed: number; hoursRegularH: bigint; hoursOvertimeH: bigint; baseMinor: bigint; otMinor: bigint; baseTxnId: string | null; otTxnId: string | null;
    status: PayoutRow['status']; otStatus: PayoutRow['otStatus']; source: PayoutRow['source']; zeroReason: string | null; paidBy: string;
  }): Promise<void> {
    const h = (x: bigint) => `${x / 100n}.${String(x % 100n).padStart(2, '0')}`;
    await tx.query(
      `INSERT INTO labour_wage_payouts (id, tenant_id, booking_id, assignment_id, worker_id, worker_user_id, run_key, wage_kind, rate_minor, attendance_ids,
         days_confirmed, hours_regular, hours_overtime, base_minor, ot_minor, base_txn_id, ot_txn_id, status, ot_status, source, zero_reason, paid_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[],$11,$12::numeric,$13::numeric,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [p.id, p.tenantId, p.bookingId, p.assignmentId, p.workerId, p.workerUserId, p.runKey, p.wageKind, p.rateMinor.toString(), p.attendanceIds,
       p.daysConfirmed, h(p.hoursRegularH), h(p.hoursOvertimeH), p.baseMinor.toString(), p.otMinor.toString(), p.baseTxnId, p.otTxnId, p.status, p.otStatus,
       p.source, p.zeroReason, p.paidBy]);
  }
  async updatePayout(tx: TxContext, tenantId: string, id: string, p: { baseTxnId: string | null; otTxnId: string | null; status: PayoutRow['status']; otStatus: PayoutRow['otStatus']; paidBy: string }): Promise<void> {
    await tx.query(`UPDATE labour_wage_payouts SET base_txn_id=$3, ot_txn_id=$4, status=$5, ot_status=$6, paid_by=$7, updated_at=now() WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId, p.baseTxnId, p.otTxnId, p.status, p.otStatus, p.paidBy]);
  }

  // ---- consents ----
  async insertConsent(tx: TxContext, c: { id: string; tenantId: string; bookingId: string; employerUserId: string; act: string; channel: string; mediaId: string | null; note: string | null; recordedBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO labour_consents (id, tenant_id, booking_id, employer_user_id, act, channel, media_id, note, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [c.id, c.tenantId, c.bookingId, c.employerUserId, c.act, c.channel, c.mediaId, c.note, c.recordedBy]);
  }
  async latestConsent(tx: TxContext, tenantId: string, bookingId: string, act: string): Promise<ConsentRow | null> {
    const r = await tx.query(
      `SELECT id, booking_id, employer_user_id, act, channel, media_id, note, recorded_by, recorded_at FROM labour_consents
        WHERE tenant_id=$1 AND booking_id=$2 AND act=$3 ORDER BY recorded_at DESC LIMIT 1`, [tenantId, bookingId, act]);
    const x = r.rows[0];
    return x ? { id: x.id, bookingId: x.booking_id, employerUserId: x.employer_user_id, act: x.act, channel: x.channel, mediaId: x.media_id ?? null, note: x.note ?? null, recordedBy: x.recorded_by, recordedAt: x.recorded_at } : null;
  }
  async consentsFor(tenantId: string, bookingId: string): Promise<ConsentRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, booking_id, employer_user_id, act, channel, media_id, note, recorded_by, recorded_at FROM labour_consents WHERE tenant_id=$1 AND booking_id=$2 ORDER BY recorded_at`, [tenantId, bookingId]);
    return r.rows.map((x: any) => ({ id: x.id, bookingId: x.booking_id, employerUserId: x.employer_user_id, act: x.act, channel: x.channel, mediaId: x.media_id ?? null, note: x.note ?? null, recordedBy: x.recorded_by, recordedAt: x.recorded_at }));
  }

  // ---- A11 summary ----
  /** Fill facts over the last 30 days: bookings posted, seats needed and filled, and per filled booking the hours from
   *  posting to its LAST acceptance (time-to-fill). Bounded. */
  async fillFacts(tenantId: string, since: Date): Promise<{ posted: number; seatsNeeded: number; seatsFilled: number; fillHours: number[] }> {
    const r = await this.replica.forTenant(tenantId).query(
      `WITH b AS (
         SELECT id, workers_needed, created_at FROM labour_bookings
          WHERE tenant_id=$1 AND created_at >= $2 AND deleted_at IS NULL AND status <> 'cancelled'
          ORDER BY created_at DESC LIMIT 5000),
       f AS (
         SELECT b.id, b.workers_needed, b.created_at,
                count(ba.id) FILTER (WHERE ba.status IN ('accepted','paid'))::int AS filled,
                max(ba.accepted_at) FILTER (WHERE ba.status IN ('accepted','paid')) AS last_accepted
           FROM b LEFT JOIN booking_assignments ba ON ba.booking_id = b.id AND ba.tenant_id = $1 AND ba.deleted_at IS NULL
          GROUP BY b.id, b.workers_needed, b.created_at)
       SELECT count(*)::int AS posted, COALESCE(sum(workers_needed),0)::int AS needed, COALESCE(sum(LEAST(filled, workers_needed)),0)::int AS filled,
              COALESCE(array_agg(EXTRACT(EPOCH FROM (last_accepted - created_at)) / 3600.0) FILTER (WHERE filled >= workers_needed AND last_accepted IS NOT NULL), '{}') AS fill_hours
         FROM f`, [tenantId, since]);
    const x = r.rows[0] ?? {};
    return { posted: x.posted ?? 0, seatsNeeded: x.needed ?? 0, seatsFilled: x.filled ?? 0, fillHours: (x.fill_hours ?? []).map((v: unknown) => Number(v)) };
  }
  /** Open jobs + workers still needed (open bookings: needed − accepted). */
  async openFacts(tenantId: string): Promise<{ openJobs: number; workersNeeded: number }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT count(*)::int AS open_jobs,
              COALESCE(sum(GREATEST(b.workers_needed - (SELECT count(*) FROM booking_assignments ba WHERE ba.tenant_id=b.tenant_id AND ba.booking_id=b.id
                   AND ba.status IN ('accepted','paid') AND ba.deleted_at IS NULL), 0)),0)::int AS workers_needed
         FROM labour_bookings b WHERE b.tenant_id=$1 AND b.status='open' AND b.deleted_at IS NULL`, [tenantId]);
    return { openJobs: r.rows[0]?.open_jobs ?? 0, workersNeeded: r.rows[0]?.workers_needed ?? 0 };
  }
}
