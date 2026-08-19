// modules/dairy/repositories/milk-rate-card.repository.ts · all SQL for milk_rate_cards. tenant_id in EVERY
// query (Law 1) + RLS. Resolves the ACTIVE effective-dated card for an animal type at collection pricing.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { MilkRateCard, parseBonusSlabs } from '../domain/milk-rate-card.entity';
import { PricingModel, AnimalType } from '../domain/dairy.events';

const COLS = `id, tenant_id, default_name, animal_type, pricing_model, rate_per_kg_fat_minor, rate_per_kg_snf_minor, base_rate_per_litre_minor, bonus_rules, effective_from, effective_to, is_active, created_at`;
// [PC-56 TENANT-6b-1] `bonus_rules` joins the column list. It was absent — which is the most literal form the defect
// could take: the premium band W168 advertises could not have been applied because the engine never read the column.
const d = (v: any): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const big = (v: any): bigint | null => (v == null ? null : BigInt(v));
function toDomain(r: any): MilkRateCard {
  return MilkRateCard.rehydrate({ id: r.id, tenantId: r.tenant_id, defaultName: r.default_name, animalType: r.animal_type as AnimalType,
    pricingModel: r.pricing_model as PricingModel, ratePerKgFatMinor: big(r.rate_per_kg_fat_minor), ratePerKgSnfMinor: big(r.rate_per_kg_snf_minor),
    baseRatePerLitreMinor: big(r.base_rate_per_litre_minor), bonusSlabs: parseBonusSlabs(r.bonus_rules),
    effectiveFrom: d(r.effective_from)!, effectiveTo: d(r.effective_to), isActive: r.is_active, createdAt: r.created_at });
}

@Injectable()
export class MilkRateCardRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, c: MilkRateCard): Promise<void> {
    const p = c.toProps();
    await tx.query(
      `INSERT INTO milk_rate_cards (id, tenant_id, default_name, animal_type, pricing_model, rate_per_kg_fat_minor, rate_per_kg_snf_minor, base_rate_per_litre_minor, bonus_rules, effective_from, effective_to, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)`,
      [p.id, p.tenantId, p.defaultName, p.animalType, p.pricingModel, p.ratePerKgFatMinor?.toString() ?? null, p.ratePerKgSnfMinor?.toString() ?? null,
       p.baseRatePerLitreMinor?.toString() ?? null, JSON.stringify(p.bonusSlabs), p.effectiveFrom, p.effectiveTo, p.isActive]);
  }
  async getById(tenantId: string, id: string, tx?: TxContext): Promise<MilkRateCard | null> {
    const sql = `SELECT ${COLS} FROM milk_rate_cards WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [id, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** The ACTIVE card in effect on `onDate` for an animal type (latest effective_from ≤ date). */
  async resolveActive(tenantId: string, animalType: string, onDate: string, tx: TxContext): Promise<MilkRateCard | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM milk_rate_cards
        WHERE tenant_id=$1 AND animal_type=$2 AND is_active=true AND deleted_at IS NULL
          AND effective_from <= $3::date AND (effective_to IS NULL OR effective_to >= $3::date)
        ORDER BY effective_from DESC LIMIT 1`, [tenantId, animalType, onDate]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async listFor(tenantId: string, q: { animalType?: string; activeOnly: boolean }): Promise<MilkRateCard[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.animalType) where += ` AND animal_type=${p(q.animalType)}`;
    if (q.activeOnly) where += ` AND is_active=true`;
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM milk_rate_cards WHERE ${where} ORDER BY effective_from DESC, id DESC LIMIT 200`, params);
    return r.rows.map(toDomain);
  }
}
