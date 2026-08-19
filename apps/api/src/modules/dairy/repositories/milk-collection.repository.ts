// modules/dairy/repositories/milk-collection.repository.ts · all SQL for milk_collections (PARTITIONED by
// collected_on). tenant_id in EVERY query (Law 1) + RLS. EVERY query carries collected_on so PG prunes to
// one/few partitions (Law 8). UNIQUE(membership_id, collected_on, shift) is the idempotent natural key.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { MilkCollection } from '../domain/milk-collection.entity';
import { MilkShift } from '../domain/dairy.events';
import { HoldState, BILLABLE_HOLD_STATES } from '../domain/milk-quality.state';
import { pgDate } from '../../../core/database/pg-date';
import { CollectionStampLostError } from '../domain/dairy.errors';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date — node-pg hands back LOCAL midnight and
// `toISOString()` is a DAY EARLY anywhere ahead of UTC (see that file's header; the dairy double-payment proved it).

const COLS = `id, tenant_id, mcc_id, membership_id, shift, collected_on, weight_kg, fat_pct, snf_pct, density, water_flag, adulteration_flags, rate_card_id, amount_minor, bonus_minor, bonus_applied, hold_state, entered_by, milk_bill_id, created_at`;
// scaled-integer <-> decimal helpers (no float): kg×1000, pct×100
const toMilli = (v: any): bigint => BigInt(Math.round(Number(v) * 1000));
const toCenti = (v: any): bigint => BigInt(Math.round(Number(v) * 100));
function toDomain(r: any): MilkCollection {
  return MilkCollection.rehydrate({ id: r.id, tenantId: r.tenant_id, mccId: r.mcc_id, membershipId: r.membership_id, shift: r.shift as MilkShift,
    collectedOn: pgDate(r.collected_on),
    weightMilliKg: toMilli(r.weight_kg), fatCentiPct: toCenti(r.fat_pct), snfCentiPct: toCenti(r.snf_pct),
    density: r.density == null ? null : String(r.density), waterFlag: r.water_flag,
    adulterationFlags: r.adulteration_flags ?? [], rateCardId: r.rate_card_id, amountMinor: BigInt(r.amount_minor),
    bonusMinor: BigInt(r.bonus_minor ?? 0), bonusApplied: r.bonus_applied === true, holdState: (r.hold_state ?? 'none') as HoldState,
    enteredBy: r.entered_by, milkBillId: r.milk_bill_id, createdAt: r.created_at });
}
// scaled integer → numeric string for the DB columns (weight 3dp, pct 2dp)
const milliToKg = (m: bigint) => (Number(m) / 1000).toFixed(3);
const centiToPct = (c: bigint) => (Number(c) / 100).toFixed(2);

@Injectable()
export class MilkCollectionRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Insert; relies on UNIQUE(membership_id, collected_on, shift). Throws on duplicate (23505). */
  async insert(tx: TxContext, c: MilkCollection): Promise<void> {
    const p = c.toProps();
    await tx.query(
      `INSERT INTO milk_collections (id, tenant_id, mcc_id, membership_id, shift, collected_on, weight_kg, fat_pct, snf_pct, density, water_flag, adulteration_flags, rate_card_id, amount_minor, bonus_minor, bonus_applied, hold_state, entered_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18)`,
      [p.id, p.tenantId, p.mccId, p.membershipId, p.shift, p.collectedOn, milliToKg(p.weightMilliKg), centiToPct(p.fatCentiPct), centiToPct(p.snfCentiPct),
       p.density, p.waterFlag, JSON.stringify(p.adulterationFlags), p.rateCardId, p.amountMinor.toString(),
       p.bonusMinor.toString(), p.bonusApplied, p.holdState, p.enteredBy]);
  }
  /**
   * Aggregate a membership's BILLABLE unbilled collections in [from,to] (partition-pruned). Locks them for billing.
   *
   * [PC-56 TENANT-6b-1] **THIS QUERY USED TO PAY FOR WATER.** It had no reference to `water_flag`, `adulteration_flags`
   * or any hold, so a pour the operator flagged at the counter went into the next bill at full price and could be
   * approved and PAID before anybody re-tested the sealed sample — while W168 told the operator "Rate card holds this
   * pour's payment only; the member's other pours pay normally." Only `none` and `released` pours are billable now.
   *
   * The held ones are COUNTED and returned rather than silently skipped: a bill that comes back empty because three
   * pours are under review is a different fact from a member who did not pour, and the caller must be able to say which.
   */
  async aggregateUnbilledForUpdate(tx: TxContext, tenantId: string, membershipId: string, from: string, to: string):
    Promise<{ count: number; totalWeightMilliKg: bigint; grossMinor: bigint; bonusMinor: bigint; heldCount: number; heldMinor: bigint; ids: Array<{ id: string; collectedOn: string }> }> {
    const r = await tx.query(
      `SELECT id, collected_on, weight_kg, amount_minor, bonus_minor, hold_state FROM milk_collections
        WHERE tenant_id=$1 AND membership_id=$2 AND collected_on >= $3::date AND collected_on <= $4::date AND milk_bill_id IS NULL
        ORDER BY collected_on FOR UPDATE`, [tenantId, membershipId, from, to]);
    let totalWeightMilliKg = 0n, grossMinor = 0n, bonusMinor = 0n, heldMinor = 0n, heldCount = 0;
    const ids: Array<{ id: string; collectedOn: string }> = [];
    for (const row of r.rows as any[]) {
      if (!BILLABLE_HOLD_STATES.includes((row.hold_state ?? 'none') as HoldState)) {
        heldCount += 1;
        heldMinor += BigInt(row.amount_minor);
        continue;
      }
      totalWeightMilliKg += toMilli(row.weight_kg);
      grossMinor += BigInt(row.amount_minor);
      bonusMinor += BigInt(row.bonus_minor ?? 0);
      ids.push({ id: row.id, collectedOn: pgDate(row.collected_on) });
    }
    return { count: ids.length, totalWeightMilliKg, grossMinor, bonusMinor, heldCount, heldMinor, ids };
  }

  /** Move a pour's hold state, failing closed if the row is not there to move (see attachToBill's own note). */
  async setHoldState(tx: TxContext, tenantId: string, ref: { id: string; collectedOn: string }, to: HoldState, from: HoldState): Promise<void> {
    const res = await tx.query(
      `UPDATE milk_collections SET hold_state=$5 WHERE id=$1 AND collected_on=$2::date AND tenant_id=$3 AND hold_state=$4`,
      [ref.id, ref.collectedOn, tenantId, from, to]);
    if (res.rowCount === 0) throw new CollectionStampLostError(ref.id, ref.collectedOn);
  }

  /** One pour, by id and its partition day — the quality desk's own read. */
  async getByIdOn(tenantId: string, id: string, collectedOn: string, tx?: TxContext): Promise<MilkCollection | null> {
    const sql = `SELECT ${COLS} FROM milk_collections WHERE tenant_id=$1 AND id=$2 AND collected_on=$3::date`;
    const r = tx ? await tx.query(sql, [tenantId, id, collectedOn]) : await this.replica.forTenant(tenantId).query(sql, [tenantId, id, collectedOn]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Stamp the bill id onto the collections it settled (partition-pruned by collected_on). */
  async attachToBill(tx: TxContext, tenantId: string, refs: Array<{ id: string; collectedOn: string }>, billId: string): Promise<void> {
    for (const ref of refs) {
      // DEV-49 (2026-07-29): milk_collections deliberately carries NO updated_at
      // column (partitioned daily-scale table, excluded from add_std_columns() by
      // design — see 0009_livestock_dairy.sql). The previous `updated_at=now()`
      // made every bill-attach UPDATE throw 42703 at runtime: a live P0 on the
      // dairy money path (DEV-47 QA escalation). Regression guard:
      // dairy/__tests__/updated-at-schema-truth.spec.ts sweeps the whole class.
      //
      // [PC-56 TENANT-6b-1] FAILS CLOSED. This predicate carries `collected_on` because it is the partition key, and
      // it silently missed every row on any box ahead of UTC (the mapper above returned the previous day) — the bill
      // was inserted, approved and PAID while these collections stayed `milk_bill_id IS NULL`, so the next cycle
      // billed and paid them AGAIN. A zero-row UPDATE here is a double payment in the making, not a no-op.
      const res = await tx.query(`UPDATE milk_collections SET milk_bill_id=$4 WHERE id=$1 AND collected_on=$2::date AND tenant_id=$3`, [ref.id, ref.collectedOn, tenantId, billId]);
      if (res.rowCount === 0) throw new CollectionStampLostError(ref.id, ref.collectedOn);
    }
  }
  /** Worker job (cross-tenant; kv_relay): distinct memberships with UNBILLED collections in [from,to].
   *  Bounded + partition-pruned by collected_on. Drives the per-cycle bill generation. */
  async findMembershipsToBill(tx: TxContext, from: string, to: string, limit: number): Promise<Array<{ tenantId: string; membershipId: string }>> {
    const r = await tx.query(
      `SELECT DISTINCT tenant_id, membership_id FROM milk_collections
        WHERE collected_on >= $1::date AND collected_on <= $2::date AND milk_bill_id IS NULL
        ORDER BY tenant_id, membership_id LIMIT $3`, [from, to, limit]);
    return r.rows.map((row: any) => ({ tenantId: row.tenant_id, membershipId: row.membership_id }));
  }

  async listFor(tenantId: string, q: { membershipId: string; from: string; to: string; cursor?: { c: string; id: string }; limit: number }): Promise<MilkCollection[]> {
    const params: unknown[] = [tenantId, q.membershipId, q.from, q.to];
    let where = `tenant_id=$1 AND membership_id=$2 AND collected_on >= $3::date AND collected_on <= $4::date`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (collected_on < ${cc}::date OR (collected_on=${cc}::date AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM milk_collections WHERE ${where} ORDER BY collected_on DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
