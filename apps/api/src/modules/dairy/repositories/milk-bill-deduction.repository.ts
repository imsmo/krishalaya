// modules/dairy/repositories/milk-bill-deduction.repository.ts · PC-56 TENANT-6c-4 · all SQL for milk_bill_deductions.
// tenant_id in EVERY query (Law 1) + RLS. The amount, the type and the source are append-only by GRANT (0160), so the
// only UPDATE here is the application stamp — and it FAILS CLOSED, because a line the caller believes it just posted
// whose row did not move is a member's money moved with no record of it.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { MilkBillDeduction } from '../domain/milk-bill-deduction.entity';
import { BillDeduction } from '../domain/milk-bill.entity';
import { BillDeductionNotFoundError } from '../domain/dairy.errors';

const COLS = `d.id, d.tenant_id, d.bill_id, d.membership_id, d.type_id, lv.code AS type_code, d.amount_minor,
              d.source_type, d.source_id, d.status, d.applied_at, d.wallet_txn_id, d.created_by, d.created_at`;
const FROM = `FROM milk_bill_deductions d JOIN lookup_values lv ON lv.id = d.type_id`;

function toDomain(r: any): MilkBillDeduction {
  return MilkBillDeduction.rehydrate({
    id: r.id, tenantId: r.tenant_id, billId: r.bill_id, membershipId: r.membership_id,
    typeId: r.type_id, typeCode: String(r.type_code), amountMinor: BigInt(r.amount_minor),
    sourceType: String(r.source_type), sourceId: r.source_id, status: r.status,
    appliedAt: r.applied_at ?? null, walletTxnId: r.wallet_txn_id ?? null, createdBy: r.created_by ?? null, createdAt: r.created_at,
  });
}

/** The bill aggregate's view of a line — the same row, without the plumbing. */
const toBillLine = (d: MilkBillDeduction): BillDeduction => {
  const p = d.toProps();
  return { id: p.id, type: p.typeCode, amountMinor: p.amountMinor, sourceType: p.sourceType, sourceId: p.sourceId, status: p.status };
};

@Injectable()
export class MilkBillDeductionRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, d: MilkBillDeduction): Promise<void> {
    const p = d.toProps();
    await tx.query(
      `INSERT INTO milk_bill_deductions (id, tenant_id, bill_id, membership_id, type_id, amount_minor, source_type, source_id, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [p.id, p.tenantId, p.billId, p.membershipId, p.typeId, p.amountMinor.toString(), p.sourceType, p.sourceId, p.status, p.createdBy]);
  }

  /** This bill's lines, LOCKED, oldest first — the pay path's claim. */
  async listForUpdate(tx: TxContext, tenantId: string, billId: string): Promise<MilkBillDeduction[]> {
    const r = await tx.query(
      `SELECT ${COLS} ${FROM}
        WHERE d.tenant_id=$1 AND d.bill_id=$2 AND d.deleted_at IS NULL
        ORDER BY d.created_at, d.id FOR UPDATE OF d`, [tenantId, billId]);
    return r.rows.map(toDomain);
  }

  /** This bill's lines for the AGGREGATE — the shape `MilkBill.rehydrate` wants. */
  async linesForBill(tx: TxContext, tenantId: string, billId: string): Promise<BillDeduction[]> {
    const r = await tx.query(
      `SELECT ${COLS} ${FROM}
        WHERE d.tenant_id=$1 AND d.bill_id=$2 AND d.deleted_at IS NULL ORDER BY d.created_at, d.id`, [tenantId, billId]);
    return r.rows.map(toDomain).map(toBillLine);
  }

  /** A read-side list (replica) — the member's own "what was taken, and for what". */
  async listForBill(tenantId: string, billId: string): Promise<MilkBillDeduction[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} ${FROM}
        WHERE d.tenant_id=$1 AND d.bill_id=$2 AND d.deleted_at IS NULL ORDER BY d.created_at, d.id`, [tenantId, billId]);
    return r.rows.map(toDomain);
  }

  /**
   * The application stamp, and NOTHING else — the grant permits nothing else either (0160).
   *
   * Fails closed on a zero-row update, which here is not defensive theatre: this statement runs immediately after a
   * ledger movement in the same transaction, so a row that did not move means money left a member's wallet with no
   * line claiming it. The refusal rolls the whole payment back.
   */
  async markApplied(tx: TxContext, d: MilkBillDeduction): Promise<void> {
    const p = d.toProps();
    const res = await tx.query(
      `UPDATE milk_bill_deductions
          SET status=$3, applied_at=$4, wallet_txn_id=$5, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, p.appliedAt, p.walletTxnId]);
    if (res.rowCount === 0) throw new BillDeductionNotFoundError(p.id);
  }

  /**
   * Everything ever recovered against ONE source — the reconciliation direction a jsonb blob could not answer:
   * "this ₹500 of feed, or this loan — which bills paid it, and when?" This is what
   * `idx_milk_bill_deduction_source` exists for.
   */
  async listForSource(tenantId: string, sourceType: string, sourceId: string, limit = 200): Promise<MilkBillDeduction[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} ${FROM}
        WHERE d.tenant_id=$1 AND d.source_type=$2 AND d.source_id=$3 AND d.deleted_at IS NULL
        ORDER BY d.created_at, d.id LIMIT $4`, [tenantId, sourceType, sourceId, limit]);
    return r.rows.map(toDomain);
  }

  /**
   * W169's header tile: *"Deductions this cycle ₹1,84,300"*, MEASURED, and broken down by type because the tile's own
   * subtitle names the types (*"feed credit + loan EMI + insurance"*).
   *
   * Counted over the cycle's live bills only: a voided bill's lines are somebody's cancelled arithmetic, and including
   * them would make the tile disagree with the sum of the rows underneath it.
   */
  async cycleTotals(tenantId: string, cycleId: string): Promise<{ totalMinor: bigint; byType: Record<string, string> }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT lv.code, SUM(d.amount_minor)::text AS total
         FROM milk_bill_deductions d
         JOIN lookup_values lv ON lv.id = d.type_id
         JOIN milk_bills b ON b.id = d.bill_id AND b.deleted_at IS NULL
        WHERE d.tenant_id=$1 AND b.cycle_id=$2 AND d.deleted_at IS NULL
        GROUP BY lv.code ORDER BY lv.code`, [tenantId, cycleId]);
    const byType: Record<string, string> = {};
    let total = 0n;
    for (const row of r.rows as Array<{ code: string; total: string }>) {
      byType[row.code] = row.total;
      total += BigInt(row.total);
    }
    return { totalMinor: total, byType };
  }
}
