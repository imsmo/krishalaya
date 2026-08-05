// modules/insurance/repositories/authoring.repository.ts · PC-54 W54-9 `insurance-authoring`. SQL for the
// INSURER side: product create/update (premium_calc jsonb is the pricing contract — set here, executed by
// the enrolment path), issuance (policy_no + activate), the book, and the loss-ratio insight aggregates.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

@Injectable()
export class AuthoringRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insertProduct(tx: TxContext, p: { id: string; partnerId: string; productKindId: string; defaultName: string; premiumCalc: Record<string, unknown>; sumInsuredRules?: Record<string, unknown>; govtSubsidyBps?: number; ourCommissionBps?: number; isParametric?: boolean }): Promise<void> {
    await tx.query(
      `INSERT INTO insurance_products (id, partner_id, product_kind_id, default_name, premium_calc, sum_insured_rules, govt_subsidy_bps, our_commission_bps, is_parametric)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.id, p.partnerId, p.productKindId, p.defaultName, JSON.stringify(p.premiumCalc), JSON.stringify(p.sumInsuredRules ?? {}), p.govtSubsidyBps ?? 0, p.ourCommissionBps ?? 0, p.isParametric ?? false]);
  }
  async updateProduct(tx: TxContext, id: string, patch: { defaultName?: string; premiumCalc?: Record<string, unknown>; sumInsuredRules?: Record<string, unknown>; isActive?: boolean }): Promise<boolean> {
    const r = await tx.query(
      `UPDATE insurance_products SET
         default_name = COALESCE($2, default_name),
         premium_calc = COALESCE($3::jsonb, premium_calc),
         sum_insured_rules = COALESCE($4::jsonb, sum_insured_rules),
         is_active = COALESCE($5, is_active)
       WHERE id=$1 AND deleted_at IS NULL`,
      [id, patch.defaultName ?? null, patch.premiumCalc ? JSON.stringify(patch.premiumCalc) : null, patch.sumInsuredRules ? JSON.stringify(patch.sumInsuredRules) : null, patch.isActive ?? null]);
    return (r.rowCount ?? 0) > 0;
  }

  async lockPolicy(tx: TxContext, tenantId: string, id: string): Promise<{ id: string; status: string; premiumPaymentId: string | null } | null> {
    const r = await tx.query(`SELECT id, status, premium_payment_id FROM insurance_policies WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? { id: r.rows[0].id, status: r.rows[0].status, premiumPaymentId: r.rows[0].premium_payment_id } : null;
  }
  async issuePolicy(tx: TxContext, tenantId: string, id: string, policyNo: string, parametricTriggers?: Record<string, unknown>): Promise<void> {
    await tx.query(`UPDATE insurance_policies SET status='active', policy_no=$3, parametric_triggers=COALESCE($4::jsonb, parametric_triggers) WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId, policyNo, parametricTriggers ? JSON.stringify(parametricTriggers) : null]);
  }

  /** The insurer's BOOK: policies by status with premium/sum-insured as minor strings. */
  async book(tenantId: string, status: string | undefined, limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, holder_user_id, product_id, policy_no, subject_type, status, sum_insured_minor::text, premium_minor::text, valid_from, valid_until
         FROM insurance_policies WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2::policy_status) AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT $3`, [tenantId, status ?? null, limit]);
    return r.rows.map((x: any) => ({ id: x.id, holderUserId: x.holder_user_id, productId: x.product_id, policyNo: x.policy_no, subjectType: x.subject_type, status: x.status, sumInsuredMinor: x.sum_insured_minor, premiumMinor: x.premium_minor, validFrom: String(x.valid_from).slice(0, 10), validUntil: String(x.valid_until).slice(0, 10) }));
  }
  /** Loss-ratio insight: written premium vs approved claims — from ledgered rows, never fabricated. */
  async insights(tenantId: string): Promise<Record<string, unknown>> {
    const p = await this.replica.forTenant(tenantId).query(
      `SELECT status::text, COUNT(*)::int AS n, COALESCE(SUM(premium_minor),0)::text AS premium FROM insurance_policies WHERE tenant_id=$1 AND deleted_at IS NULL GROUP BY status`, [tenantId]);
    const c = await this.replica.forTenant(tenantId).query(
      `SELECT status::text, COUNT(*)::int AS n, COALESCE(SUM(approved_minor),0)::text AS approved FROM insurance_claims WHERE tenant_id=$1 AND deleted_at IS NULL GROUP BY status`, [tenantId]);
    return { policies: p.rows, claims: c.rows };
  }
}
