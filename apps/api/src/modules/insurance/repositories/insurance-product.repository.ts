// modules/insurance/repositories/insurance-product.repository.ts · READ-ONLY insurance_products.
// GLOBAL reference data (no tenant_id), admin/platform-authored (Law 11). Mirrors
// modules/fintech/repositories/loan-product.repository.ts exactly (same table family, same convention).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { InsuranceProduct } from '../domain/insurance-product.entity';

const COLS = `id, partner_id, product_kind_id, default_name, premium_calc, sum_insured_rules,
  govt_subsidy_bps, our_commission_bps, is_parametric, is_active, created_at`;

function toDomain(r: any): InsuranceProduct {
  return InsuranceProduct.rehydrate({
    id: r.id, partnerId: r.partner_id, productKindId: r.product_kind_id, defaultName: r.default_name,
    premiumCalcRaw: r.premium_calc, sumInsuredRules: r.sum_insured_rules ?? {},
    govtSubsidyBps: r.govt_subsidy_bps, ourCommissionBps: r.our_commission_bps,
    isParametric: r.is_parametric, isActive: r.is_active, createdAt: r.created_at,
  });
}

@Injectable()
export class InsuranceProductRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async getById(tenantId: string, id: string, tx?: TxContext): Promise<InsuranceProduct | null> {
    const sql = `SELECT ${COLS} FROM insurance_products WHERE id=$1 AND deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [id]) : await this.replica.forTenant(tenantId).query(sql, [id]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async list(tenantId: string, q: { partnerId?: string; productKindId?: string; activeOnly: boolean; afterId: string | null; limit: number }): Promise<InsuranceProduct[]> {
    const params: unknown[] = [];
    let where = `deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.partnerId) where += ` AND partner_id=${p(q.partnerId)}`;
    if (q.productKindId) where += ` AND product_kind_id=${p(q.productKindId)}`;
    if (q.activeOnly) where += ` AND is_active=true`;
    where += ` AND ($${params.length + 1}::uuid IS NULL OR id > $${params.length + 1})`;
    params.push(q.afterId);
    const limitIdx = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM insurance_products WHERE ${where} ORDER BY id ASC LIMIT ${limitIdx}`, params);
    return r.rows.map(toDomain);
  }
}
