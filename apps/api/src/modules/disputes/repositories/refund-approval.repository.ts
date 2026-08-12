// modules/disputes/repositories/refund-approval.repository.ts · SQL for the refund maker-checker plane (0139).
// tenant_id in EVERY query (Law 1) + RLS. No version column (add_std_columns) → decisions LOCK the row FOR UPDATE.
// Reads that a decision depends on run on the PRIMARY inside the deciding transaction; only the console list reads
// the replica — approving a refund off a lagging replica is how a refused proposal gets approved a second later.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { ApprovalStatus, RefundSubject } from '../domain/refund-gate';

export interface RefundApprovalRow {
  id: string; tenantId: string; subjectType: RefundSubject; subjectId: string; orderId: string;
  amountMinor: bigint; resolutionType: string | null; status: ApprovalStatus;
  proposedBy: string; proposedAt: Date; proposalNote: string; thresholdMinor: bigint;
  decidedBy: string | null; decidedAt: Date | null; decisionNote: string | null; appliedAt: Date | null;
}

const COLS = `id, tenant_id, subject_type, subject_id, order_id, amount_minor, resolution_type, status,
  proposed_by, proposed_at, proposal_note, threshold_minor, decided_by, decided_at, decision_note, applied_at`;

function toRow(r: any): RefundApprovalRow {
  return {
    id: r.id, tenantId: r.tenant_id, subjectType: r.subject_type, subjectId: r.subject_id, orderId: r.order_id,
    amountMinor: BigInt(r.amount_minor), resolutionType: r.resolution_type, status: r.status,
    proposedBy: r.proposed_by, proposedAt: r.proposed_at, proposalNote: r.proposal_note,
    thresholdMinor: BigInt(r.threshold_minor), decidedBy: r.decided_by, decidedAt: r.decided_at,
    decisionNote: r.decision_note, appliedAt: r.applied_at,
  };
}

@Injectable()
export class RefundApprovalRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, a: {
    id: string; tenantId: string; subjectType: RefundSubject; subjectId: string; orderId: string;
    amountMinor: bigint; resolutionType: string | null; proposedBy: string; proposalNote: string; thresholdMinor: bigint;
  }): Promise<void> {
    await tx.query(
      `INSERT INTO refund_approvals (id, tenant_id, subject_type, subject_id, order_id, amount_minor,
                                     resolution_type, proposed_by, proposal_note, threshold_minor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [a.id, a.tenantId, a.subjectType, a.subjectId, a.orderId, a.amountMinor.toString(),
       a.resolutionType, a.proposedBy, a.proposalNote, a.thresholdMinor.toString()]);
  }

  /** The proposal a refund would ride, read in the deciding transaction. **ONE ROW, CHOSEN BY THE ORDER THE GATE
   *  CARES ABOUT**: an applied approval outranks everything (it is the double-refund guard), then a pending one,
   *  then the newest decision. Returning "the latest row" instead would let an old rejection hide an application. */
  async currentFor(tx: TxContext, tenantId: string, subjectType: RefundSubject, subjectId: string): Promise<RefundApprovalRow | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM refund_approvals
        WHERE tenant_id=$1 AND subject_type=$2 AND subject_id=$3 AND deleted_at IS NULL
        ORDER BY (status='applied') DESC, (status='pending') DESC, proposed_at DESC
        LIMIT 1`, [tenantId, subjectType, subjectId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<RefundApprovalRow | null> {
    const r = await tx.query(`SELECT ${COLS} FROM refund_approvals WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /** The checker's signature. The WHERE clause carries `status='pending'` so a second concurrent decision updates
   *  zero rows rather than overwriting the first — the caller checks the count and refuses. */
  async decide(tx: TxContext, tenantId: string, id: string, d: { status: 'approved' | 'rejected'; decidedBy: string; note: string | null }): Promise<number> {
    const r = await tx.query(
      `UPDATE refund_approvals
          SET status=$3, decided_by=$4, decided_at=now(), decision_note=$5, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND status='pending' AND deleted_at IS NULL`,
      [id, tenantId, d.status, d.decidedBy, d.note]);
    return r.rowCount ?? 0;
  }

  /** Marked in the SAME transaction as the refund it authorised — so a refund that rolls back leaves its approval
   *  unapplied and usable, and a refund that commits can never be applied twice (uq_refund_approval_applied). */
  async markApplied(tx: TxContext, tenantId: string, id: string): Promise<number> {
    const r = await tx.query(
      `UPDATE refund_approvals SET status='applied', applied_at=now(), updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND status='approved' AND deleted_at IS NULL`, [id, tenantId]);
    return r.rowCount ?? 0;
  }

  /** W140's checker queue: every proposal waiting for a second person. Keyset on (proposed_at, id) — the oldest
   *  first, because a refund waiting three days is the one that matters (this list is a worklist, not a feed). */
  async listPending(tenantId: string, q: { cursor?: { c: string; id: string }; limit: number }): Promise<RefundApprovalRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `tenant_id=$1 AND status='pending' AND deleted_at IS NULL`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (proposed_at > ${cc} OR (proposed_at = ${cc} AND id > ${ci}))`; }
    const lp = p(Math.min(Math.max(q.limit, 1), 100));
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM refund_approvals WHERE ${where} ORDER BY proposed_at ASC, id ASC LIMIT ${lp}`, params);
    return r.rows.map(toRow);
  }

  /** The approvals attached to one subject, newest first — the detail screen's own history. */
  async historyFor(tenantId: string, subjectType: RefundSubject, subjectId: string, limit = 20): Promise<RefundApprovalRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM refund_approvals
        WHERE tenant_id=$1 AND subject_type=$2 AND subject_id=$3 AND deleted_at IS NULL
        ORDER BY proposed_at DESC LIMIT $4`, [tenantId, subjectType, subjectId, Math.min(Math.max(limit, 1), 50)]);
    return r.rows.map(toRow);
  }

  /** The order behind a proposal's subject, read server-side — **THE CLIENT NEVER SUPPLIES IT.** A proposal that
   *  carried its own order id would let a caller attach a signature to a different order's money. Returns null when
   *  the subject does not exist in this tenant (RLS + the tenant predicate), which the service turns into a 404. */
  async subjectOrderId(tx: TxContext, tenantId: string, subjectType: RefundSubject, subjectId: string): Promise<string | null> {
    const sql = subjectType === 'dispute'
      ? `SELECT order_id FROM disputes WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`
      : `SELECT order_id FROM returns  WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`;
    const r = await tx.query(sql, [subjectId, tenantId]);
    return r.rows[0]?.order_id ?? null;
  }

  /** The tenant's checker threshold (0139), or null when the tenant has set none — the caller falls back to the
   *  SHIPPED default and says it did (`thresholdFrom`). Read on the primary inside a deciding transaction: a
   *  threshold read off a lagging replica could let a refund through on one signature seconds after a tenant
   *  tightened the rule. */
  async thresholdSetting(tx: TxContext, tenantId: string, key: string): Promise<unknown | null> {
    const r = await tx.query(`SELECT value FROM tenant_settings WHERE tenant_id=$1 AND key=$2`, [tenantId, key]);
    return r.rows[0] ? r.rows[0].value : null;
  }
}
