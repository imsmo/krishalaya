// modules/dairy/repositories/milk-bill.repository.ts · all SQL for milk_bills. tenant_id in EVERY query
// (Law 1) + RLS. No version column → mutations lock FOR UPDATE. UNIQUE(membership_id, period_start,
// period_end) makes bill generation idempotent per cycle. Reads on replica; keyset lists.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { pgDate } from '../../../core/database/pg-date';
import { numericFromScaled, scaledFromNumeric } from '../../../core/database/pg-numeric';
import { MilkBill, BillDeduction } from '../domain/milk-bill.entity';
import { BillStatus } from '../domain/milk-bill.state';

const COLS = `id, tenant_id, membership_id, cycle_id, period_start, period_end, total_litres, gross_minor, deductions, deductions_minor, net_minor, status, dispute_window_ends, payout_id, created_at`;

/** Litres are stored as `numeric(12,3)` (0157 widened them to match `milk_collections.weight_kg`) and read as a
 *  scaled integer. Never `Number(x) * 1000` — see `core/database/pg-numeric.ts`. */
const LITRE_SCALE = 3;

function toDomain(r: any): MilkBill {
  const deductions: BillDeduction[] = (r.deductions ?? []).map((x: any) => ({ type: x.type, amountMinor: BigInt(x.amount_minor ?? x.amountMinor ?? '0') }));
  return MilkBill.rehydrate({ id: r.id, tenantId: r.tenant_id, membershipId: r.membership_id, cycleId: r.cycle_id ?? null,
    // [PC-56 TENANT-6c-1] `period_start`/`period_end` are `date` columns and were read through `toISOString().slice(0,10)`
    // — a day early in every timezone ahead of UTC, i.e. in the launch market. This repository sat on TENANT-6b-1's
    // "display only" inventory, which was true then and is not any more: 0157 gives a bill a `cycle_id` and the window
    // is now what a bill is GROUPED BY and what a close instant is compared against. A label became a decision.
    periodStart: pgDate(r.period_start), periodEnd: pgDate(r.period_end),
    totalLitresMilli: scaledFromNumeric(r.total_litres, LITRE_SCALE), grossMinor: BigInt(r.gross_minor), deductions, deductionsMinor: BigInt(r.deductions_minor),
    netMinor: BigInt(r.net_minor), status: r.status as BillStatus, disputeWindowEnds: r.dispute_window_ends, payoutId: r.payout_id, createdAt: r.created_at });
}
const serializeDeductions = (ds: BillDeduction[]) => JSON.stringify(ds.map((x) => ({ type: x.type, amount_minor: x.amountMinor.toString() })));

@Injectable()
export class MilkBillRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, b: MilkBill): Promise<void> {
    const p = b.toProps();
    await tx.query(
      `INSERT INTO milk_bills (id, tenant_id, membership_id, cycle_id, period_start, period_end, total_litres, gross_minor, deductions, deductions_minor, net_minor, status, dispute_window_ends)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)`,
      [p.id, p.tenantId, p.membershipId, p.cycleId, p.periodStart, p.periodEnd, numericFromScaled(p.totalLitresMilli, LITRE_SCALE), p.grossMinor.toString(),
       serializeDeductions(p.deductions), p.deductionsMinor.toString(), p.netMinor.toString(), p.status, p.disputeWindowEnds]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<MilkBill | null> {
    const r = await tx.query(`SELECT ${COLS} FROM milk_bills WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<MilkBill | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM milk_bills WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async update(tx: TxContext, b: MilkBill): Promise<void> {
    const p = b.toProps();
    await tx.query(`UPDATE milk_bills SET status=$3, payout_id=$4, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [p.id, p.tenantId, p.status, p.payoutId]);
  }
  async listFor(tenantId: string, q: { membershipIds?: string[]; membershipId?: string; cycleId?: string; status?: string; cursor?: { c: string; id: string }; limit: number }): Promise<MilkBill[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    // [PC-56 TENANT-6c-1] W169 lists ONE cycle's bills. Filtered on the column 0157 added rather than on the
    // (period_start, period_end) pair: two cycles of different length can share a boundary, and a member who moved
    // from weekly to fortnightly mid-month would otherwise appear in both.
    if (q.cycleId) where += ` AND cycle_id=${p(q.cycleId)}`;
    if (q.membershipId) where += ` AND membership_id=${p(q.membershipId)}`;
    if (q.membershipIds) where += ` AND membership_id = ANY(${p(q.membershipIds)})`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM milk_bills WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
