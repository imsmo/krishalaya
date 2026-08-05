// modules/fintech/repositories/loan-disbursement.repository.ts · PC-55 A9 (0089). tenant_id in EVERY query.
// Writes per-borrower rows into the EXISTING payouts/payout_batches tables — no new money primitive.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import type { DisbursableApplication } from '../domain/loan-disbursement.rules';

@Injectable()
export class LoanDisbursementRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Candidate applications with everything the eligibility gates need — including the borrower's primary
   *  penny-verified bank account and whether this application was ALREADY disbursed by an earlier run. */
  async candidates(tenantId: string, applicationIds?: string[]): Promise<DisbursableApplication[]> {
    const params: unknown[] = [tenantId];
    let filter = '';
    if (applicationIds?.length) { params.push(applicationIds); filter = ` AND a.id = ANY($2::uuid[])`; }
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT a.id, a.applicant_user_id, a.status::text AS status, a.amount_approved_minor::text AS amount_approved_minor,
              a.cooling_off_until,
              (SELECT b.id FROM bank_accounts b
                WHERE b.user_id = a.applicant_user_id AND b.deleted_at IS NULL AND b.penny_verified_at IS NOT NULL
                ORDER BY b.is_primary DESC, b.created_at ASC LIMIT 1) AS bank_account_id,
              EXISTS (SELECT 1 FROM loan_disbursement_run_items i WHERE i.application_id = a.id) AS already_disbursed
         FROM loan_applications a
        WHERE a.tenant_id=$1 AND a.deleted_at IS NULL AND a.status = 'approved'${filter}
        ORDER BY a.decision_at ASC NULLS LAST LIMIT 2000`, params);
    return r.rows.map((x: any) => ({
      id: x.id, borrowerUserId: x.applicant_user_id, status: x.status,
      amountApprovedMinor: x.amount_approved_minor, bankAccountId: x.bank_account_id,
      coolingOffUntil: x.cooling_off_until ? new Date(x.cooling_off_until).toISOString() : null,
      alreadyDisbursed: !!x.already_disbursed,
    }));
  }

  async insertBatch(tx: TxContext, b: { id: string; tenantId: string; totalMinor: string; count: number }): Promise<void> {
    await tx.query(
      `INSERT INTO payout_batches (id, tenant_id, batch_type, total_minor, count, status)
       VALUES ($1,$2,'loan_disbursement',$3,$4,'open')`, [b.id, b.tenantId, b.totalMinor, b.count]);
  }
  /** idempotency_key is UNIQUE on payouts (0006): run id + application id makes a replay physically impossible. */
  async insertPayout(tx: TxContext, p: { id: string; tenantId: string; userId: string; bankAccountId: string; runId: string; applicationId: string; amountMinor: string; currencyCode: string; batchId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO payouts (id, tenant_id, user_id, bank_account_id, purpose_id, reference_type, reference_id,
            amount_minor, currency_code, status, provider_code, priority, idempotency_key, batch_id)
       VALUES ($1,$2,$3,$4,
               (SELECT id FROM lookup_values WHERE type_code='payout_purpose' AND code='loan_disbursal' AND tenant_id IS NULL LIMIT 1),
               'loan_application', $5, $6, $7, 'queued', 'razorpayx', 50, $8, $9)`,
      [p.id, p.tenantId, p.userId, p.bankAccountId, p.applicationId, p.amountMinor, p.currencyCode,
       `loan-disb:${p.runId}:${p.applicationId}`, p.batchId]);
  }
  async insertRun(tx: TxContext, r0: { id: string; tenantId: string; batchId: string; totalMinor: string; loanCount: number; skippedCount: number; skippedDetail: unknown[]; currencyCode: string; preparedBy: string; confirmedBy: string; idempotencyKey: string }): Promise<{ ok: true } | { ok: false; conflict: 'replay' }> {
    try {
      await tx.query(
        `INSERT INTO loan_disbursement_runs (id, tenant_id, batch_id, total_minor, loan_count, skipped_count,
             skipped_detail, currency_code, status, prepared_by, confirmed_by, confirmed_at, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'queued',$9,$10,now(),$11)`,
        [r0.id, r0.tenantId, r0.batchId, r0.totalMinor, r0.loanCount, r0.skippedCount,
         JSON.stringify(r0.skippedDetail), r0.currencyCode, r0.preparedBy, r0.confirmedBy, r0.idempotencyKey]);
      return { ok: true };
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505') return { ok: false, conflict: 'replay' };
      throw e;
    }
  }
  /** Returns false if ANOTHER run already claimed this application (uq_loan_disb_item_once) — the guard that
   *  makes a double disbursal impossible even under a concurrent request. */
  async insertItem(tx: TxContext, i: { runId: string; applicationId: string; tenantId: string; borrowerUserId: string; amountMinor: string; payoutId: string }): Promise<boolean> {
    try {
      await tx.query(
        `INSERT INTO loan_disbursement_run_items (run_id, application_id, tenant_id, borrower_user_id, amount_minor, payout_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [i.runId, i.applicationId, i.tenantId, i.borrowerUserId, i.amountMinor, i.payoutId]);
      return true;
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505') return false;
      throw e;
    }
  }

  async listRuns(tenantId: string, limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT r.*, b.status AS batch_status, b.executed_at AS batch_executed_at
         FROM loan_disbursement_runs r LEFT JOIN payout_batches b ON b.id = r.batch_id
        WHERE r.tenant_id=$1 AND r.deleted_at IS NULL ORDER BY r.created_at DESC LIMIT $2`, [tenantId, Math.min(limit, 100)]);
    return r.rows.map(this.toRun);
  }
  async getRun(tenantId: string, id: string): Promise<Record<string, unknown> | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT r.*, b.status AS batch_status, b.executed_at AS batch_executed_at
         FROM loan_disbursement_runs r LEFT JOIN payout_batches b ON b.id = r.batch_id
        WHERE r.id=$1 AND r.tenant_id=$2 AND r.deleted_at IS NULL`, [id, tenantId]);
    if (!r.rows[0]) return null;
    const items = await this.replica.forTenant(tenantId).query(
      `SELECT i.application_id, i.borrower_user_id, i.amount_minor::text AS amount_minor, i.loan_id,
              p.status AS payout_status, p.failure_reason
         FROM loan_disbursement_run_items i LEFT JOIN payouts p ON p.id = i.payout_id
        WHERE i.run_id=$1 AND i.tenant_id=$2 ORDER BY i.amount_minor DESC LIMIT 2000`, [id, tenantId]);
    return {
      ...this.toRun(r.rows[0]),
      items: items.rows.map((x: any) => ({ applicationId: x.application_id, borrowerUserId: x.borrower_user_id, amountMinor: x.amount_minor, loanId: x.loan_id, payoutStatus: x.payout_status, failureReason: x.failure_reason })),
    };
  }
  private toRun = (x: any) => ({
    id: x.id, batchId: x.batch_id, totalMinor: String(x.total_minor), loanCount: x.loan_count,
    skippedCount: x.skipped_count, skippedDetail: x.skipped_detail, currencyCode: x.currency_code,
    status: x.status, preparedBy: x.prepared_by, confirmedBy: x.confirmed_by,
    confirmedAt: x.confirmed_at ? new Date(x.confirmed_at).toISOString() : null,
    executedAt: x.executed_at ? new Date(x.executed_at).toISOString() : null,
    batchStatus: x.batch_status, batchExecutedAt: x.batch_executed_at ? new Date(x.batch_executed_at).toISOString() : null,
    createdAt: new Date(x.created_at).toISOString(),
  });
}
