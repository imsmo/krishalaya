// modules/fintech/repositories/loan-application.repository.ts · all SQL for loan_applications. tenant_id in
// EVERY query (Law 1) + RLS. No version column → mutations lock FOR UPDATE. Keyset lists.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { LoanApplication } from '../domain/loan-application.entity';
import { AppStatus } from '../domain/loan-application.state';

// partner_id is not a column on loan_applications — it travels via the product; we carry it on the entity from the service.
function toDomain(r: any, partnerId: string): LoanApplication {
  return LoanApplication.rehydrate({ id: r.id, tenantId: r.tenant_id, applicantUserId: r.applicant_user_id, productId: r.product_id, partnerId,
    amountRequestedMinor: BigInt(r.amount_requested_minor), purposeText: r.purpose_text, status: r.status as AppStatus, nwrId: r.nwr_id,
    decisionAt: r.decision_at, decisionNote: r.decision_note, amountApprovedMinor: r.amount_approved_minor != null ? BigInt(r.amount_approved_minor) : null, coolingOffUntil: r.cooling_off_until, createdAt: r.created_at });
}
export interface AppListQuery { applicantUserId?: string; reviewQueue?: boolean; status?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class LoanApplicationRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, a: LoanApplication): Promise<void> {
    const p = a.toProps();
    await tx.query(
      `INSERT INTO loan_applications (id, tenant_id, applicant_user_id, product_id, amount_requested_minor, purpose_text, status, nwr_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$3)`,
      [p.id, p.tenantId, p.applicantUserId, p.productId, p.amountRequestedMinor.toString(), p.purposeText, p.status, p.nwrId]);
  }
  /** Read for a write; partnerId is resolved from the product (join) so the entity carries it. */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<LoanApplication | null> {
    const r = await tx.query(`SELECT a.*, lp.partner_id AS _partner_id FROM loan_applications a JOIN loan_products lp ON lp.id = a.product_id WHERE a.id=$1 AND a.tenant_id=$2 AND a.deleted_at IS NULL FOR UPDATE OF a`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0], r.rows[0]._partner_id) : null;
  }
  async getById(tenantId: string, id: string): Promise<LoanApplication | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT a.*, lp.partner_id AS _partner_id FROM loan_applications a JOIN loan_products lp ON lp.id = a.product_id WHERE a.id=$1 AND a.tenant_id=$2 AND a.deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0], r.rows[0]._partner_id) : null;
  }
  /**
   * PC-56 PARTNER-4b · founder 4b-2 (survey F-3): is this application already claimed by a bank-payout
   * disbursement run? The run rail's own candidate query asks the same question of the same table
   * (`loan-disbursement.repository.ts:24` → the `already_disbursed` skip reason); the wallet rail asked nothing,
   * which is the one-way double-pay hole. Read INSIDE the caller's transaction, after the application row is
   * locked, so a run cannot claim it between the check and the wallet posting.
   */
  async queuedForDisbursal(tx: TxContext, tenantId: string, applicationId: string): Promise<boolean> {
    const r = await tx.query<{ v: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM loan_disbursement_run_items i WHERE i.application_id=$1 AND i.tenant_id=$2) AS v`,
      [applicationId, tenantId]);
    return r.rows[0]?.v === true;
  }
  /** PC-56 PARTNER-0 (founder D3): does this financial partner decide its own applications (≥ 1 active partner-console member)? A DEFINER
   *  oracle (0225) — the tenant transaction holds no read on partner_memberships, so a plain SELECT would answer "no" and fail OPEN. */
  async partnerHasConsoleMembers(tx: TxContext, partnerId: string): Promise<boolean> {
    const r = await tx.query<{ v: boolean }>(`SELECT partner_has_console_members($1::uuid) AS v`, [partnerId]);
    return r.rows[0]?.v === true;
  }
  async update(tx: TxContext, a: LoanApplication): Promise<void> {
    const p = a.toProps();
    await tx.query(`UPDATE loan_applications SET status=$3, decision_at=$4, decision_note=$5, amount_approved_minor=$6, cooling_off_until=$7, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, p.decisionAt, p.decisionNote, p.amountApprovedMinor?.toString() ?? null, p.coolingOffUntil]);
  }
  async listFor(tenantId: string, q: AppListQuery): Promise<LoanApplication[]> {
    const params: unknown[] = [tenantId];
    let where = `a.tenant_id=$1 AND a.deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.applicantUserId) where += ` AND a.applicant_user_id=${p(q.applicantUserId)}`;
    if (q.reviewQueue) where += ` AND a.status IN ('submitted','under_review')`;
    if (q.status) where += ` AND a.status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (a.created_at < ${cc} OR (a.created_at=${cc} AND a.id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT a.*, lp.partner_id AS _partner_id FROM loan_applications a JOIN loan_products lp ON lp.id = a.product_id WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ${lp}`, params);
    return r.rows.map((row: any) => toDomain(row, row._partner_id));
  }
}
