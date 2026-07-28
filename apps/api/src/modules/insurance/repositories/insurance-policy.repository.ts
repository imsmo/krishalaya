// modules/insurance/repositories/insurance-policy.repository.ts · all SQL for insurance_policies. tenant_id
// in EVERY query (Law 1) + RLS (already applied — see DEV-22 STATE block grounding: 0011 predates 0014's
// generic tenant-RLS backfill). No version column → mutations lock FOR UPDATE (mirrors loan_applications).
// Lists are keyset (Law 11, never OFFSET), mirrors modules/listings/repositories/listing.repository.ts.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { InsurancePolicy } from '../domain/insurance-policy.entity';
import { PolicyStatus } from '../domain/insurance-policy.state';
import { SubjectType } from '../domain/insurance.events';
import { InsurancePolicyNotFoundError } from '../domain/insurance.errors';

const COLS = `id, tenant_id, holder_user_id, product_id, policy_no, subject_type, subject_id,
  sum_insured_minor, premium_minor, premium_payment_id, status, valid_from, valid_until,
  parametric_triggers, created_at`;

function toDomain(r: any): InsurancePolicy {
  return InsurancePolicy.rehydrate({
    id: r.id, tenantId: r.tenant_id, holderUserId: r.holder_user_id, productId: r.product_id,
    policyNo: r.policy_no, subjectType: r.subject_type as SubjectType, subjectId: r.subject_id,
    sumInsuredMinor: BigInt(r.sum_insured_minor), premiumMinor: BigInt(r.premium_minor),
    premiumPaymentId: r.premium_payment_id, status: r.status as PolicyStatus,
    validFrom: r.valid_from instanceof Date ? r.valid_from.toISOString().slice(0, 10) : r.valid_from,
    validUntil: r.valid_until instanceof Date ? r.valid_until.toISOString().slice(0, 10) : r.valid_until,
    parametricTriggers: r.parametric_triggers, createdAt: r.created_at,
  });
}

export interface PolicyListQuery { holderUserId?: string; status?: PolicyStatus; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class InsurancePolicyRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, policy: InsurancePolicy): Promise<void> {
    const p = policy.toProps();
    await tx.query(
      `INSERT INTO insurance_policies
        (id, tenant_id, holder_user_id, product_id, policy_no, subject_type, subject_id,
         sum_insured_minor, premium_minor, premium_payment_id, status, valid_from, valid_until,
         parametric_triggers, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$3)`,
      [p.id, p.tenantId, p.holderUserId, p.productId, p.policyNo, p.subjectType, p.subjectId,
       p.sumInsuredMinor.toString(), p.premiumMinor.toString(), p.premiumPaymentId, p.status,
       p.validFrom, p.validUntil, p.parametricTriggers ? JSON.stringify(p.parametricTriggers) : null],
    );
  }

  async update(tx: TxContext, policy: InsurancePolicy): Promise<void> {
    const p = policy.toProps();
    await tx.query(
      `UPDATE insurance_policies SET status=$3, premium_payment_id=$4, updated_at=now()
       WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, p.premiumPaymentId],
    );
  }

  /** Read for a write — locked within the caller's transaction (Law 1: tenant_id bound). */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<InsurancePolicy> {
    const r = await tx.query(`SELECT ${COLS} FROM insurance_policies WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    if (!r.rows[0]) throw new InsurancePolicyNotFoundError(id);
    return toDomain(r.rows[0]);
  }

  async getById(tenantId: string, id: string): Promise<InsurancePolicy | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM insurance_policies WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Keyset list (Law 11 — never OFFSET), off the replica. Used for "My policies" (screen 287). */
  async listFor(tenantId: string, q: PolicyListQuery): Promise<InsurancePolicy[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.holderUserId) where += ` AND holder_user_id=${p(q.holderUserId)}`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lim = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM insurance_policies WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lim}`, params);
    return r.rows.map(toDomain);
  }
}
