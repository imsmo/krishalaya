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
import { BillNotFoundError } from '../domain/dairy.errors';

// [PC-56 TENANT-6c-4] `deductions` (the jsonb blob) is GONE — 0160 backfilled it into `milk_bill_deductions` rows and
// dropped the column. A bill's lines are loaded explicitly, by the callers that need them, through
// `MilkBillDeductionRepository`; a bill read without them carries `null` and refuses to answer for them, because `[]`
// and "not loaded" are different facts and the difference is a member's money.
const COLS = `id, tenant_id, membership_id, cycle_id, period_start, period_end, total_litres, gross_minor, deductions_minor, net_minor, status,
              dispute_window_ends, previewed_at, voided_at, voided_by, void_reason, payout_id, created_at`;

/** Litres are stored as `numeric(12,3)` (0157 widened them to match `milk_collections.weight_kg`) and read as a
 *  scaled integer. Never `Number(x) * 1000` — see `core/database/pg-numeric.ts`. */
const LITRE_SCALE = 3;

function toDomain(r: any, deductions: BillDeduction[] | null = null): MilkBill {
  return MilkBill.rehydrate({ id: r.id, tenantId: r.tenant_id, membershipId: r.membership_id, cycleId: r.cycle_id ?? null,
    // [PC-56 TENANT-6c-1] `period_start`/`period_end` are `date` columns and were read through `toISOString().slice(0,10)`
    // — a day early in every timezone ahead of UTC, i.e. in the launch market. This repository sat on TENANT-6b-1's
    // "display only" inventory, which was true then and is not any more: 0157 gives a bill a `cycle_id` and the window
    // is now what a bill is GROUPED BY and what a close instant is compared against. A label became a decision.
    periodStart: pgDate(r.period_start), periodEnd: pgDate(r.period_end),
    totalLitresMilli: scaledFromNumeric(r.total_litres, LITRE_SCALE), grossMinor: BigInt(r.gross_minor), deductions, deductionsMinor: BigInt(r.deductions_minor),
    netMinor: BigInt(r.net_minor), status: r.status as BillStatus, disputeWindowEnds: r.dispute_window_ends,
    previewedAt: r.previewed_at ?? null, voidedAt: r.voided_at ?? null, voidedBy: r.voided_by ?? null, voidReason: r.void_reason ?? null,
    payoutId: r.payout_id, createdAt: r.created_at });
}

@Injectable()
export class MilkBillRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, b: MilkBill): Promise<void> {
    const p = b.toProps();
    await tx.query(
      `INSERT INTO milk_bills (id, tenant_id, membership_id, cycle_id, period_start, period_end, total_litres, gross_minor, deductions_minor, net_minor, status, dispute_window_ends)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [p.id, p.tenantId, p.membershipId, p.cycleId, p.periodStart, p.periodEnd, numericFromScaled(p.totalLitresMilli, LITRE_SCALE), p.grossMinor.toString(),
       p.deductionsMinor.toString(), p.netMinor.toString(), p.status, p.disputeWindowEnds]);
  }
  /**
   * Lock a bill.
   *
   * `deductions` is the LINES, passed in by the caller that loaded them (the pay path always does) and left `null`
   * otherwise. Loading them here would put a second query on every transition — approve, dispute, void — that has no
   * use for them, and defaulting them to `[]` is the silent zero this wave refuses.
   */
  async getForUpdate(tx: TxContext, tenantId: string, id: string, deductions: BillDeduction[] | null = null): Promise<MilkBill | null> {
    const r = await tx.query(`SELECT ${COLS} FROM milk_bills WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0], deductions) : null;
  }
  async getById(tenantId: string, id: string, deductions: BillDeduction[] | null = null): Promise<MilkBill | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM milk_bills WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0], deductions) : null;
  }
  /**
   * Persist a bill's state.
   *
   * [PC-56 TENANT-6c-2] Now writes the WINDOW and the VOID stamps as well, and FAILS CLOSED on a zero-row update.
   * Before this wave the statement wrote `status` and `payout_id` only, which is why `dispute_window_ends` — a column
   * with a reader in apps/mobile since 0009 — could never have been set even if something had tried: the only UPDATE
   * path on this table did not mention it. And a silent zero-row update here is the shape TENANT-5d and 6b-1 both
   * closed: a bill the caller believes it just previewed, whose row did not move, leaves 312 members holding an SMS
   * about a window the database says does not exist.
   *
   * `deleted_at IS NULL` is deliberately still in the predicate: a VOIDED bill's soft-delete is written by `void()`
   * below, in the same transaction and before this is reached, so a caller trying to move a bill that another
   * transaction has already voided gets the refusal rather than resurrecting it.
   */
  async update(tx: TxContext, b: MilkBill): Promise<void> {
    const p = b.toProps();
    const res = await tx.query(
      `UPDATE milk_bills
          SET status=$3, payout_id=$4, dispute_window_ends=$5, previewed_at=$6, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, p.payoutId, p.disputeWindowEnds, p.previewedAt]);
    if (res.rowCount === 0) throw new BillNotFoundError(p.id);
  }

  /**
   * Void a bill: soft-delete it and record who, when and why, in one statement so a voided row can never exist without
   * its reason. The partial unique index 0158 created (`WHERE deleted_at IS NULL`) is what makes this recoverable —
   * under the old total UNIQUE constraint a voided bill kept its place forever and the member could never be rebuilt
   * one for that fortnight.
   */
  async void(tx: TxContext, b: MilkBill): Promise<void> {
    const p = b.toProps();
    const res = await tx.query(
      `UPDATE milk_bills
          SET status=$3, voided_at=$4, voided_by=$5, void_reason=$6, deleted_at=$4, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, p.voidedAt, p.voidedBy, p.voidReason]);
    if (res.rowCount === 0) throw new BillNotFoundError(p.id);
  }

  /**
   * [PC-56 TENANT-6c-3] The approval pass's claim: this cycle's PREVIEWED bills, bounded and oldest first.
   *
   * `disputed` bills are excluded by the predicate, which is W169's *"disputed pauses one bill, never the cycle"* made
   * literal: the cycle approves, and a member's open objection keeps their own bill out of it. Re-callable for the same
   * reason `draftsForCycle` is — an approved bill is no longer `previewed`.
   */
  async previewedForCycle(tx: TxContext, tenantId: string, cycleId: string, limit: number): Promise<MilkBill[]> {
    const r = await tx.query(
      `SELECT ${COLS} FROM milk_bills
        WHERE tenant_id=$1 AND cycle_id=$2 AND status='previewed' AND deleted_at IS NULL
        ORDER BY created_at, id LIMIT $3`, [tenantId, cycleId, limit]);
    return r.rows.map((row) => toDomain(row));
  }

  /** The preview pass's claim: this cycle's DRAFT bills, bounded and oldest first. Re-callable — a bill that has
   *  already been previewed is no longer `draft`, so a second pass simply finds fewer. */
  async draftsForCycle(tx: TxContext, tenantId: string, cycleId: string, limit: number): Promise<MilkBill[]> {
    const r = await tx.query(
      `SELECT ${COLS} FROM milk_bills
        WHERE tenant_id=$1 AND cycle_id=$2 AND status='draft' AND deleted_at IS NULL
        ORDER BY created_at, id LIMIT $3`, [tenantId, cycleId, limit]);
    return r.rows.map((row) => toDomain(row));
  }

  /**
   * [PC-56 TENANT-6c-2] How many bills have EVER existed for each of these memberships in one window — voided ones
   * included, which is the whole point.
   *
   * This exists because the cycle's idempotency key defeated the void. The key was `dairycycle:<cycle>:<membership>`,
   * so after a bill was voided the rebuild presented the SAME key, `IdempotencyService.remember` replayed the original
   * bill's stored response, and the pass reported a cheerful "generated 1" while no bill was created — leaving the
   * member with a voided fortnight and nothing to replace it. Found by a live test. The count makes the key identify
   * the ATTEMPT rather than the pair, so a retry still replays (Law 3) and a rebuild after a void does not.
   *
   * No `deleted_at` filter, deliberately: a voided bill is exactly what increments the attempt.
   */
  async billAttemptsByMembership(tx: TxContext, tenantId: string, periodStart: string, periodEnd: string, membershipIds: string[]): Promise<Map<string, number>> {
    if (membershipIds.length === 0) return new Map();
    const r = await tx.query(
      `SELECT membership_id, count(*)::int AS n FROM milk_bills
        WHERE tenant_id=$1 AND period_start=$2::date AND period_end=$3::date AND membership_id = ANY($4)
        GROUP BY membership_id`, [tenantId, periodStart, periodEnd, membershipIds]);
    const out = new Map<string, number>();
    for (const row of r.rows as any[]) out.set(String(row.membership_id), Number(row.n ?? 0));
    return out;
  }

  /** How many of a cycle's bills sit in each status — W169's "312 bills in draft" and "2 / 309 disputes", MEASURED
   *  rather than stored, because the bills already hold the fact and a counter would drift the first time one moved. */
  async statusCountsForCycle(tenantId: string, cycleId: string): Promise<Record<string, number>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT status, count(*)::int AS n FROM milk_bills
        WHERE tenant_id=$1 AND cycle_id=$2 AND deleted_at IS NULL GROUP BY status`, [tenantId, cycleId]);
    const out: Record<string, number> = {};
    for (const row of r.rows as any[]) out[String(row.status)] = Number(row.n ?? 0);
    return out;
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
    return r.rows.map((row) => toDomain(row));
  }
}
