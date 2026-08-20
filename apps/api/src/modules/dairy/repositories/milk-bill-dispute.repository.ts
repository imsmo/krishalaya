// modules/dairy/repositories/milk-bill-dispute.repository.ts · PC-56 TENANT-6c-2 · all SQL for milk_bill_disputes.
// tenant_id in EVERY query (Law 1) + RLS. The testimony columns are not in any UPDATE here and the app role has no
// grant for them (0158): a dispute's reason, raiser, time and window are append-only, and only the resolution moves.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { MilkBillDispute, DisputeStatus } from '../domain/milk-bill-dispute.entity';
import { DisputeNotFoundError } from '../domain/dairy.errors';

const COLS = `id, tenant_id, bill_id, membership_id, raised_by_user_id, raised_at, reason, window_ended_at,
              status, resolved_at, resolved_by, resolution_note, voided_bill, created_at`;

const asDate = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));

function toDomain(r: any): MilkBillDispute {
  return MilkBillDispute.rehydrate({
    id: r.id, tenantId: r.tenant_id, billId: r.bill_id, membershipId: r.membership_id,
    raisedByUserId: r.raised_by_user_id, raisedAt: asDate(r.raised_at), reason: String(r.reason),
    windowEndedAt: asDate(r.window_ended_at), status: r.status as DisputeStatus,
    resolvedAt: r.resolved_at == null ? null : asDate(r.resolved_at),
    resolvedBy: r.resolved_by ?? null, resolutionNote: r.resolution_note ?? null,
    voidedBill: r.voided_bill === true, createdAt: r.created_at,
  });
}

@Injectable()
export class MilkBillDisputeRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, d: MilkBillDispute): Promise<void> {
    const p = d.toProps();
    await tx.query(
      `INSERT INTO milk_bill_disputes (id, tenant_id, bill_id, membership_id, raised_by_user_id, raised_at, reason, window_ended_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.id, p.tenantId, p.billId, p.membershipId, p.raisedByUserId, p.raisedAt, p.reason, p.windowEndedAt, p.status]);
  }

  /** The open dispute on a bill, locked — there can be at most one (0158's partial unique index). */
  async openForBill(tx: TxContext, tenantId: string, billId: string): Promise<MilkBillDispute | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM milk_bill_disputes
        WHERE tenant_id=$1 AND bill_id=$2 AND status='open' AND deleted_at IS NULL FOR UPDATE`, [tenantId, billId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<MilkBillDispute | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM milk_bill_disputes WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /**
   * Write the resolution. ONLY the resolution — the reason, the raiser, the time and the window are not in this
   * statement and the app role holds no grant for them (0158), so a bug here cannot rewrite what a member said.
   *
   * Fails closed, and CONDITIONALLY on `status='open'`: two operators deciding the same query at once must not both
   * succeed, and the loser must learn that rather than believe their note was recorded.
   */
  async resolve(tx: TxContext, d: MilkBillDispute): Promise<void> {
    const p = d.toProps();
    const res = await tx.query(
      `UPDATE milk_bill_disputes
          SET status=$3, resolved_at=$4, resolved_by=$5, resolution_note=$6, voided_bill=$7
        WHERE id=$1 AND tenant_id=$2 AND status='open' AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, p.resolvedAt, p.resolvedBy, p.resolutionNote, p.voidedBill]);
    if (res.rowCount === 0) throw new DisputeNotFoundError(p.id);
  }

  /** The cooperative's queue: what is waiting on a decision, oldest first — a dispute is a family waiting for money. */
  async listOpen(tenantId: string, limit: number): Promise<MilkBillDispute[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM milk_bill_disputes
        WHERE tenant_id=$1 AND status='open' AND deleted_at IS NULL
        ORDER BY raised_at, id LIMIT $2`, [tenantId, limit]);
    return r.rows.map(toDomain);
  }

  /** Every dispute on one bill, newest first — the history a rejected member's second objection joins. */
  async listForBill(tenantId: string, billId: string, limit: number): Promise<MilkBillDispute[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM milk_bill_disputes
        WHERE tenant_id=$1 AND bill_id=$2 AND deleted_at IS NULL
        ORDER BY raised_at DESC, id DESC LIMIT $3`, [tenantId, billId, limit]);
    return r.rows.map(toDomain);
  }

  /**
   * W169's tile: *"Last cycle disputes 2 / 309 · both resolved before payday"* — counted over one CYCLE's bills, by
   * status, with the "resolved before payday" part measured rather than assumed (`resolved_at <= payday` against the
   * cycle's own payday, which 0157 stores).
   */
  async countsForCycle(tenantId: string, cycleId: string): Promise<{ total: number; byStatus: Record<string, number>; resolvedBeforePayday: number }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT d.status, count(*)::int AS n,
              count(*) FILTER (WHERE d.resolved_at IS NOT NULL
                                 AND d.resolved_at < ((c.payday + 1)::timestamp AT TIME ZONE co.timezone))::int AS before_payday
         FROM milk_bill_disputes d
         JOIN milk_bills b ON b.id = d.bill_id AND b.tenant_id = d.tenant_id
         JOIN dairy_bill_cycles c ON c.id = b.cycle_id AND c.tenant_id = d.tenant_id
         JOIN tenants t ON t.id = d.tenant_id
         JOIN countries co ON co.code = t.country_code
        WHERE d.tenant_id=$1 AND b.cycle_id=$2 AND d.deleted_at IS NULL
        GROUP BY d.status`, [tenantId, cycleId]);
    const byStatus: Record<string, number> = {};
    let total = 0, resolvedBeforePayday = 0;
    for (const row of r.rows as any[]) {
      const n = Number(row.n ?? 0);
      byStatus[String(row.status)] = n;
      total += n;
      resolvedBeforePayday += Number(row.before_payday ?? 0);
    }
    return { total, byStatus, resolvedBeforePayday };
  }
}
