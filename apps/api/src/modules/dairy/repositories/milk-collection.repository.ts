// modules/dairy/repositories/milk-collection.repository.ts · all SQL for milk_collections (PARTITIONED by
// collected_on). tenant_id in EVERY query (Law 1) + RLS. EVERY query carries collected_on so PG prunes to
// one/few partitions (Law 8). UNIQUE(membership_id, collected_on, shift) is the idempotent natural key.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { MilkCollection } from '../domain/milk-collection.entity';
import { MilkShift } from '../domain/dairy.events';

const COLS = `id, tenant_id, mcc_id, membership_id, shift, collected_on, weight_kg, fat_pct, snf_pct, water_flag, adulteration_flags, rate_card_id, amount_minor, entered_by, milk_bill_id, created_at`;
// scaled-integer <-> decimal helpers (no float): kg×1000, pct×100
const toMilli = (v: any): bigint => BigInt(Math.round(Number(v) * 1000));
const toCenti = (v: any): bigint => BigInt(Math.round(Number(v) * 100));
function toDomain(r: any): MilkCollection {
  return MilkCollection.rehydrate({ id: r.id, tenantId: r.tenant_id, mccId: r.mcc_id, membershipId: r.membership_id, shift: r.shift as MilkShift,
    collectedOn: r.collected_on instanceof Date ? r.collected_on.toISOString().slice(0, 10) : String(r.collected_on),
    weightMilliKg: toMilli(r.weight_kg), fatCentiPct: toCenti(r.fat_pct), snfCentiPct: toCenti(r.snf_pct), waterFlag: r.water_flag,
    adulterationFlags: r.adulteration_flags ?? [], rateCardId: r.rate_card_id, amountMinor: BigInt(r.amount_minor), enteredBy: r.entered_by,
    milkBillId: r.milk_bill_id, createdAt: r.created_at });
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
      `INSERT INTO milk_collections (id, tenant_id, mcc_id, membership_id, shift, collected_on, weight_kg, fat_pct, snf_pct, water_flag, adulteration_flags, rate_card_id, amount_minor, entered_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14)`,
      [p.id, p.tenantId, p.mccId, p.membershipId, p.shift, p.collectedOn, milliToKg(p.weightMilliKg), centiToPct(p.fatCentiPct), centiToPct(p.snfCentiPct),
       p.waterFlag, JSON.stringify(p.adulterationFlags), p.rateCardId, p.amountMinor.toString(), p.enteredBy]);
  }
  /** Aggregate a membership's UNBILLED collections in [from,to] (partition-pruned). Locks them for billing. */
  async aggregateUnbilledForUpdate(tx: TxContext, tenantId: string, membershipId: string, from: string, to: string):
    Promise<{ count: number; totalWeightMilliKg: bigint; grossMinor: bigint; ids: Array<{ id: string; collectedOn: string }> }> {
    const r = await tx.query(
      `SELECT id, collected_on, weight_kg, amount_minor FROM milk_collections
        WHERE tenant_id=$1 AND membership_id=$2 AND collected_on >= $3::date AND collected_on <= $4::date AND milk_bill_id IS NULL
        ORDER BY collected_on FOR UPDATE`, [tenantId, membershipId, from, to]);
    let totalWeightMilliKg = 0n, grossMinor = 0n;
    const ids = r.rows.map((row: any) => {
      totalWeightMilliKg += toMilli(row.weight_kg);
      grossMinor += BigInt(row.amount_minor);
      return { id: row.id, collectedOn: row.collected_on instanceof Date ? row.collected_on.toISOString().slice(0, 10) : String(row.collected_on) };
    });
    return { count: r.rows.length, totalWeightMilliKg, grossMinor, ids };
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
      await tx.query(`UPDATE milk_collections SET milk_bill_id=$4 WHERE id=$1 AND collected_on=$2::date AND tenant_id=$3`, [ref.id, ref.collectedOn, tenantId, billId]);
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
