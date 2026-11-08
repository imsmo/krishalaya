// modules/dairy/repositories/milk-rate-card.repository.ts · all SQL for milk_rate_cards. tenant_id in EVERY
// query (Law 1) + RLS. Resolves the ACTIVE effective-dated card for an animal type at collection pricing.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { MilkRateCard, parseBonusSlabs } from '../domain/milk-rate-card.entity';
import { PricingModel, AnimalType } from '../domain/dairy.events';

// [PC-56 HOTFIX-12 · found on the way] the two DAYS are read as TEXT. node-postgres returns a `date` as a JS Date at LOCAL midnight,
// and `d()` below took `toISOString().slice(0, 10)` of it — so in a process running in IST every card's `effectiveFrom` and
// `effectiveTo` came back ONE DAY EARLY (the traps list's µs/TZ class). Harmless while nothing compared them; HOTFIX-12's
// backdate check compares them with the tenant's today, and the live spec caught a card starting today read as yesterday.
const COLS = `id, tenant_id, default_name, animal_type, pricing_model, rate_per_kg_fat_minor, rate_per_kg_snf_minor, base_rate_per_litre_minor, bonus_rules, effective_from::text AS effective_from, effective_to::text AS effective_to, is_active, created_at,
  created_by, approved_by, approved_at, approved_before_rule`;
// [PC-56 HOTFIX-12] The creator and the approval stamp (0234) join the column list: a card prices pours only when approved.
// [PC-56 TENANT-6b-1] `bonus_rules` joins the column list. It was absent — which is the most literal form the defect
// could take: the premium band W168 advertises could not have been applied because the engine never read the column.
const d = (v: any): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const big = (v: any): bigint | null => (v == null ? null : BigInt(v));
function toDomain(r: any): MilkRateCard {
  return MilkRateCard.rehydrate({ id: r.id, tenantId: r.tenant_id, defaultName: r.default_name, animalType: r.animal_type as AnimalType,
    pricingModel: r.pricing_model as PricingModel, ratePerKgFatMinor: big(r.rate_per_kg_fat_minor), ratePerKgSnfMinor: big(r.rate_per_kg_snf_minor),
    baseRatePerLitreMinor: big(r.base_rate_per_litre_minor), bonusSlabs: parseBonusSlabs(r.bonus_rules),
    effectiveFrom: d(r.effective_from)!, effectiveTo: d(r.effective_to), isActive: r.is_active, createdAt: r.created_at,
    createdBy: r.created_by ?? null, approvedBy: r.approved_by ?? null, approvedAt: r.approved_at ?? null, approvedBeforeRule: r.approved_before_rule === true });
}

@Injectable()
export class MilkRateCardRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, c: MilkRateCard): Promise<void> {
    const p = c.toProps();
    await tx.query(
      `INSERT INTO milk_rate_cards (id, tenant_id, default_name, animal_type, pricing_model, rate_per_kg_fat_minor, rate_per_kg_snf_minor, base_rate_per_litre_minor, bonus_rules, effective_from, effective_to, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)`,
      [p.id, p.tenantId, p.defaultName, p.animalType, p.pricingModel, p.ratePerKgFatMinor?.toString() ?? null, p.ratePerKgSnfMinor?.toString() ?? null,
       p.baseRatePerLitreMinor?.toString() ?? null, JSON.stringify(p.bonusSlabs), p.effectiveFrom, p.effectiveTo, p.isActive,
       // [PC-56 HOTFIX-12] the creator, written for the first time (0001's column; 0234's guard refuses a row without it)
       p.createdBy ?? null]);
  }
  async getById(tenantId: string, id: string, tx?: TxContext): Promise<MilkRateCard | null> {
    const sql = `SELECT ${COLS} FROM milk_rate_cards WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [id, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /**
   * The ACTIVE, APPROVED card in effect on `onDate` for an animal type (latest effective_from ≤ date).
   *
   * [PC-56 HOTFIX-12 · founder Q1-A] `approved_at IS NOT NULL` — AN UNAPPROVED CARD PRICES NOTHING. Approved means a
   * second person approved it, or it existed before the rule (Q1-sub, 0234 stamps those). 0234's exclusion keeps at most
   * one approved active card per (tenant, milk type) on any day, so the ORDER BY no longer chooses between two.
   * Callers: `MilkCollectionService.record` (the only pricing read). When nothing approved is in force the pour is
   * refused `NO_ACTIVE_RATE_CARD` (422), unchanged.
   */
  async resolveActive(tenantId: string, animalType: string, onDate: string, tx: TxContext): Promise<MilkRateCard | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM milk_rate_cards
        WHERE tenant_id=$1 AND animal_type=$2 AND is_active=true AND deleted_at IS NULL AND approved_at IS NOT NULL
          AND effective_from <= $3::date AND (effective_to IS NULL OR effective_to >= $3::date)
        ORDER BY effective_from DESC LIMIT 1`, [tenantId, animalType, onDate]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async listFor(tenantId: string, q: { animalType?: string; activeOnly: boolean }): Promise<MilkRateCard[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.animalType) where += ` AND animal_type=${p(q.animalType)}`;
    // [PC-56 HOTFIX-12] "active" means PRICING: an unapproved card is not active (members read this list on the mobile
    // rates page). [PC-56 OPS-3c] activeOnly=false — every card with its approval state — reaches here ONLY for a `dairy.manage`
    // holder (MilkRateCardService.list); until OPS-3c the query read "false" as true, so the console never actually got it.
    if (q.activeOnly) where += ` AND is_active=true AND approved_at IS NOT NULL`;
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM milk_rate_cards WHERE ${where} ORDER BY effective_from DESC, id DESC LIMIT 200`, params);
    return r.rows.map(toDomain);
  }

  /* ------------------------------------------------------------------------------------------------------------- */
  /* [PC-56 HOTFIX-12] THE APPROVAL (founder Q1-A, 2026-11-08; migration 0234)                                       */
  /* ------------------------------------------------------------------------------------------------------------- */

  /** The card, locked for the approval's transaction. */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<MilkRateCard | null> {
    const r = await tx.query(`SELECT ${COLS} FROM milk_rate_cards WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /**
   * The tenant's TODAY, in its own zone (`tenants.country_code → countries.timezone`, the 6c-1 rule) — the DATABASE's
   * clock, never the Node process's. Read through the tenant's replica outside a transaction (the pre-checks), or in one.
   */
  async tenantToday(tenantId: string, tx?: TxContext): Promise<string> {
    const sql = `SELECT to_char(now() AT TIME ZONE co.timezone, 'YYYY-MM-DD') AS today
                   FROM tenants t JOIN countries co ON co.code = t.country_code WHERE t.id = $1`;
    const r = tx ? await tx.query(sql, [tenantId]) : await this.replica.forTenant(tenantId).query(sql, [tenantId]);
    const today = (r.rows[0] as { today?: string } | undefined)?.today;
    if (!today) throw new Error(`rate card: tenant ${tenantId} has no country timezone, so its today is unknown`);
    return today;
  }

  /** Every APPROVED, active card of this milk type whose days meet [from, to] (to NULL = open-ended). */
  async approvedMeeting(tx: TxContext | null, tenantId: string, animalType: string, from: string, to: string | null, exceptId: string): Promise<MilkRateCard[]> {
    const sql = `SELECT ${COLS} FROM milk_rate_cards
        WHERE tenant_id=$1 AND animal_type=$2 AND id <> $5 AND is_active=true AND deleted_at IS NULL AND approved_at IS NOT NULL
          AND daterange(effective_from, effective_to, '[]') && daterange($3::date, $4::date, '[]')
        ORDER BY effective_from, id`;
    const params = [tenantId, animalType, from, to, exceptId];
    // No transaction = the pre-check before the idempotency record (a plain read); in the approval's transaction, locked.
    const r = tx ? await tx.query(`${sql} FOR UPDATE`, params) : await this.replica.forTenant(tenantId).query(sql, params);
    return r.rows.map(toDomain);
  }

  /** Close a predecessor the day before its successor starts. Asserts exactly one row moved. */
  async closeOn(tx: TxContext, tenantId: string, id: string, effectiveTo: string): Promise<void> {
    const r = await tx.query(`UPDATE milk_rate_cards SET effective_to=$3::date WHERE id=$1 AND tenant_id=$2 AND approved_at IS NOT NULL`, [id, tenantId, effectiveTo]);
    if (r.rowCount !== 1) throw new Error(`rate card ${id}: closing the predecessor moved ${r.rowCount} rows`);
  }

  /** Stamp the second person. Asserts exactly one unapproved row moved. */
  async approve(tx: TxContext, tenantId: string, id: string, by: string, at: Date): Promise<void> {
    const r = await tx.query(`UPDATE milk_rate_cards SET approved_by=$3, approved_at=$4 WHERE id=$1 AND tenant_id=$2 AND approved_at IS NULL`, [id, tenantId, by, at]);
    if (r.rowCount !== 1) throw new Error(`rate card ${id}: the approval moved ${r.rowCount} rows`);
  }

  /**
   * The people this card prices: active dairy members of the tenant whose membership's milk type is the card's (a
   * membership with none is priced as `mixed` — `MilkCollectionService.record` — so it is told about a `mixed` card).
   */
  async memberUserIdsPricedBy(tx: TxContext, tenantId: string, animalType: string): Promise<string[]> {
    const r = await tx.query(
      `SELECT DISTINCT farmer_user_id::text AS u FROM dairy_memberships
        WHERE tenant_id=$1 AND is_active=true AND deleted_at IS NULL AND COALESCE(default_animal_type, 'mixed') = $2
        ORDER BY 1`, [tenantId, animalType]);
    return r.rows.map((x: { u: string }) => x.u);
  }
}
