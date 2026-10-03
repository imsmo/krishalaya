// modules/logistics/repositories/pod-review.repository.ts · PC-56 TENANT-SW-a · D1 — SQL for pod_reviews (0196). tenant_id in every query
// + RLS (FORCE). kv_app holds SELECT, INSERT and a column-limited UPDATE (the review columns; what was delivered is final —
// trg_pod_reviews_moves, which is also the wall that refuses a reviewer who drove or dispatched the shipment).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { US_SQL } from '../../../shared/pagination/us-keyset';

export type PodStatus = 'awaiting' | 'auto_cleared' | 'flagged' | 'approved' | 'rejected';
export type PodFlagReason = 'mismatch' | 'no_photo' | 'wrong_recipient' | 'weight_variance' | 'other';
export interface PodReviewRow {
  id: string; tenantId: string; shipmentId: string; orderId: string; driverUserId: string | null; dispatcherUserId: string | null; podMediaId: string | null;
  otpVerified: boolean; deliveredAt: string; timerDueAt: string; status: PodStatus; flagReason: PodFlagReason | null; flagNote: string | null; varianceMinor: string | null;
  flaggedBy: string | null; flaggedAt: string | null; reviewerUserId: string | null; claimedAt: string | null; decidedBy: string | null; decidedAt: string | null;
  decisionNote: string | null; rejectProposedBy: string | null; rejectProposedAt: string | null; checkerUserId: string | null; disputeId: string | null;
  autoClearedAt: string | null; createdAt: string;
}
const COLS = `id, tenant_id, shipment_id, order_id, driver_user_id, dispatcher_user_id, pod_media_id, otp_verified, delivered_at, timer_due_at, status, flag_reason,
  flag_note, variance_minor, flagged_by, flagged_at, reviewer_user_id, claimed_at, decided_by, decided_at, decision_note, reject_proposed_by, reject_proposed_at,
  checker_user_id, dispute_id, auto_cleared_at, ${US_SQL('created_at')} AS created_us`;
const iso = (d: any) => (d == null ? null : new Date(d).toISOString());
function toRow(r: any): PodReviewRow {
  return { id: r.id, tenantId: r.tenant_id, shipmentId: r.shipment_id, orderId: r.order_id, driverUserId: r.driver_user_id, dispatcherUserId: r.dispatcher_user_id,
    podMediaId: r.pod_media_id, otpVerified: r.otp_verified, deliveredAt: iso(r.delivered_at)!, timerDueAt: iso(r.timer_due_at)!, status: r.status,
    flagReason: r.flag_reason, flagNote: r.flag_note, varianceMinor: r.variance_minor != null ? String(r.variance_minor) : null, flaggedBy: r.flagged_by,
    flaggedAt: iso(r.flagged_at), reviewerUserId: r.reviewer_user_id, claimedAt: iso(r.claimed_at), decidedBy: r.decided_by, decidedAt: iso(r.decided_at),
    decisionNote: r.decision_note, rejectProposedBy: r.reject_proposed_by, rejectProposedAt: iso(r.reject_proposed_at), checkerUserId: r.checker_user_id,
    disputeId: r.dispute_id, autoClearedAt: iso(r.auto_cleared_at), createdAt: r.created_us };
}

@Injectable()
export class PodReviewRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** One per delivered shipment (idempotent on the shipment). timer_due_at = delivered_at + 2 h exactly (the trigger checks it). */
  async insertTx(tx: TxContext, r: { id: string; tenantId: string; shipmentId: string; shipmentCreatedAt: Date; orderId: string; driverUserId: string | null;
    dispatcherUserId: string | null; podMediaId: string | null; otpVerified: boolean; deliveredAt: Date }): Promise<boolean> {
    const q = await tx.query(
      `INSERT INTO pod_reviews (id, tenant_id, shipment_id, shipment_created_at, order_id, driver_user_id, dispatcher_user_id, pod_media_id, otp_verified, delivered_at, timer_due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz, $10::timestamptz + interval '2 hours') ON CONFLICT (shipment_id) DO NOTHING`,
      [r.id, r.tenantId, r.shipmentId, r.shipmentCreatedAt, r.orderId, r.driverUserId, r.dispatcherUserId, r.podMediaId, r.otpVerified, r.deliveredAt]);
    return (q.rowCount ?? 0) > 0;
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<PodReviewRow | null> {
    const r = await tx.query(`SELECT ${COLS} FROM pod_reviews WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }
  async get(tenantId: string, id: string): Promise<PodReviewRow | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM pod_reviews WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async flagTx(tx: TxContext, tenantId: string, id: string, f: { by: string; reason: PodFlagReason; note: string | null; varianceMinor: bigint | null }): Promise<void> {
    await tx.query(`UPDATE pod_reviews SET status='flagged', flag_reason=$3, flag_note=$4, variance_minor=$5, flagged_by=$6, flagged_at=now() WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId, f.reason, f.note, f.varianceMinor?.toString() ?? null, f.by]);
  }
  async approveTx(tx: TxContext, tenantId: string, id: string, by: string, note: string | null): Promise<void> {
    await tx.query(`UPDATE pod_reviews SET status='approved', decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1 AND tenant_id=$2`, [id, tenantId, by, note]);
  }
  async proposeRejectTx(tx: TxContext, tenantId: string, id: string, by: string, note: string): Promise<void> {
    await tx.query(`UPDATE pod_reviews SET reject_proposed_by=$3, reject_proposed_at=now(), decision_note=$4 WHERE id=$1 AND tenant_id=$2`, [id, tenantId, by, note]);
  }
  async confirmRejectTx(tx: TxContext, tenantId: string, id: string, checker: string, disputeId: string): Promise<void> {
    await tx.query(`UPDATE pod_reviews SET status='rejected', checker_user_id=$3, decided_by=$3, decided_at=now(), dispute_id=$4 WHERE id=$1 AND tenant_id=$2`, [id, tenantId, checker, disputeId]);
  }
  /** "Take next": claim the OLDEST awaiting review nobody holds, skipping rows another desk has locked and shipments the actor drove or
   *  dispatched (the trigger would refuse those anyway). */
  async claimNextTx(tx: TxContext, tenantId: string, me: string): Promise<string | null> {
    const r = await tx.query<{ id: string }>(
      `SELECT id FROM pod_reviews WHERE tenant_id=$1 AND status='awaiting' AND reviewer_user_id IS NULL
          AND driver_user_id IS DISTINCT FROM $2::uuid AND dispatcher_user_id IS DISTINCT FROM $2::uuid
        ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`, [tenantId, me]);
    if (!r.rows[0]) return null;
    await tx.query(`UPDATE pod_reviews SET reviewer_user_id=$3, claimed_at=now() WHERE id=$1 AND tenant_id=$2`, [r.rows[0].id, tenantId, me]);
    return r.rows[0].id;
  }
  /** The 2-hour clock: awaiting, unflagged, past the timer. SKIP LOCKED so a human acting on a row is never blocked by the job. */
  async autoClearDueTx(tx: TxContext, tenantId: string, limit: number): Promise<string[]> {
    const r = await tx.query<{ id: string }>(
      `WITH due AS (SELECT id FROM pod_reviews WHERE tenant_id=$1 AND status='awaiting' AND timer_due_at <= now() ORDER BY timer_due_at, id LIMIT $2 FOR UPDATE SKIP LOCKED)
       UPDATE pod_reviews p SET status='auto_cleared', auto_cleared_at=now() FROM due WHERE p.id = due.id RETURNING p.id`, [tenantId, limit]);
    return r.rows.map((x) => x.id);
  }

  async list(tenantId: string, q: { status?: PodStatus; cursor?: { ts: string; id: string }; limit: number }): Promise<PodReviewRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `tenant_id=$1`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.ts), ci = p(q.cursor.id); where += ` AND (created_at > ${cc}::timestamptz OR (created_at = ${cc}::timestamptz AND id > ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM pod_reviews WHERE ${where} ORDER BY created_at ASC, id ASC LIMIT ${lp}`, params);
    return r.rows.map(toRow);
  }
  /** W237's tiles from real rows (+ escrow released today for orders that went through review, from the ledger). */
  async tiles(tenantId: string): Promise<{ awaiting: number; autoClearedToday: number; flagged: number; escrowReleasedTodayMinor: string }> {
    const db = this.replica.forTenant(tenantId);
    const a = await db.query(
      `SELECT count(*) FILTER (WHERE status='awaiting')::int awaiting,
              count(*) FILTER (WHERE status='auto_cleared' AND (auto_cleared_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date)::int cleared,
              count(*) FILTER (WHERE status='flagged')::int flagged
         FROM pod_reviews WHERE tenant_id=$1`, [tenantId]);
    const e = await db.query(
      `SELECT COALESCE(SUM(-le.amount_minor),0)::text released
         FROM ledger_transactions lt JOIN ledger_entries le ON le.txn_id = lt.id JOIN wallet_accounts wa ON wa.id = le.account_id AND wa.owner_kind='platform' AND wa.account_code='escrow'
        WHERE lt.tenant_id=$1 AND lt.idempotency_key LIKE 'settle:%' AND (lt.created_at AT TIME ZONE 'Asia/Kolkata')::date = (now() AT TIME ZONE 'Asia/Kolkata')::date
          AND le.amount_minor < 0 AND EXISTS (SELECT 1 FROM pod_reviews pr WHERE pr.tenant_id = lt.tenant_id AND pr.order_id = lt.reference_id)`, [tenantId]);
    return { awaiting: a.rows[0].awaiting, autoClearedToday: a.rows[0].cleared, flagged: a.rows[0].flagged, escrowReleasedTodayMinor: e.rows[0].released };
  }
}
