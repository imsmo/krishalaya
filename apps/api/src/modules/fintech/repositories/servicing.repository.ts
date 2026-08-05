// modules/fintech/repositories/servicing.repository.ts · PC-54 W54-8 `fintech-servicing`. SQL for the
// post-disbursal book: DPD buckets + collections queue (aggregates over loans — ledgered rows, never
// fabricated), the KCC drawl ledger (0069: signed entries, running balance computed HERE in one tx),
// restructures (0069: maker-checker chain), and write-offs (status-guarded). Money bigint minor (Law 2).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

@Injectable()
export class ServicingRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async dpdBuckets(tenantId: string): Promise<Array<{ bucket: string; loans: number; outstandingMinor: string }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT CASE WHEN dpd BETWEEN 1 AND 30 THEN '1-30' WHEN dpd BETWEEN 31 AND 60 THEN '31-60'
                   WHEN dpd BETWEEN 61 AND 90 THEN '61-90' ELSE '90+' END AS bucket,
              COUNT(*)::int AS loans, COALESCE(SUM(outstanding_minor),0)::text AS outstanding_minor
         FROM (SELECT outstanding_minor, (CURRENT_DATE - next_due_date) AS dpd FROM loans
                WHERE tenant_id=$1 AND status IN ('active','overdue') AND next_due_date < CURRENT_DATE AND deleted_at IS NULL) t
        GROUP BY 1 ORDER BY 1`, [tenantId]);
    return r.rows.map((x: any) => ({ bucket: x.bucket, loans: x.loans, outstandingMinor: x.outstanding_minor }));
  }
  async collectionsQueue(tenantId: string, limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, borrower_user_id, partner_id, outstanding_minor::text, next_due_date, (CURRENT_DATE - next_due_date)::int AS dpd, status
         FROM loans WHERE tenant_id=$1 AND status IN ('active','overdue') AND next_due_date < CURRENT_DATE AND deleted_at IS NULL
        ORDER BY next_due_date ASC LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x: any) => ({ loanId: x.id, borrowerUserId: x.borrower_user_id, partnerId: x.partner_id, outstandingMinor: x.outstanding_minor, nextDueDate: String(x.next_due_date).slice(0, 10), dpd: x.dpd, status: x.status }));
  }

  /** KCC entry: running balance read FOR UPDATE via the loan row (serialises concurrent entries). */
  async lastKccBalance(tx: TxContext, tenantId: string, loanId: string): Promise<bigint> {
    const r = await tx.query(`SELECT balance_after_minor FROM kcc_drawl_ledger WHERE tenant_id=$1 AND loan_id=$2 ORDER BY created_at DESC, id DESC LIMIT 1`, [tenantId, loanId]);
    return r.rows[0] ? BigInt(r.rows[0].balance_after_minor) : 0n;
  }
  async insertKccEntry(tx: TxContext, e: { tenantId: string; loanId: string; entryKind: string; amountMinor: bigint; balanceAfterMinor: bigint; narrative: string; destinationKind?: string; repaymentChannel?: string; createdBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO kcc_drawl_ledger (tenant_id, loan_id, entry_kind, amount_minor, balance_after_minor, narrative, destination_kind, repayment_channel, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [e.tenantId, e.loanId, e.entryKind, e.amountMinor.toString(), e.balanceAfterMinor.toString(), e.narrative, e.destinationKind ?? null, e.repaymentChannel ?? null, e.createdBy]);
  }
  async kccLedger(tenantId: string, loanId: string): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT entry_kind, amount_minor::text, balance_after_minor::text, entry_date, narrative, purpose_check_status, repayment_channel
         FROM kcc_drawl_ledger WHERE tenant_id=$1 AND loan_id=$2 AND created_at >= now() - interval '3 years'
        ORDER BY created_at DESC, id DESC LIMIT 200`, [tenantId, loanId]);
    return r.rows.map((x: any) => ({ entryKind: x.entry_kind, amountMinor: x.amount_minor, balanceAfterMinor: x.balance_after_minor, entryDate: String(x.entry_date).slice(0, 10), narrative: x.narrative, purposeCheckStatus: x.purpose_check_status, repaymentChannel: x.repayment_channel }));
  }

  async lockLoan(tx: TxContext, tenantId: string, loanId: string): Promise<{ id: string; status: string; outstandingMinor: bigint } | null> {
    const r = await tx.query(`SELECT id, status, outstanding_minor FROM loans WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [loanId, tenantId]);
    return r.rows[0] ? { id: r.rows[0].id, status: r.rows[0].status, outstandingMinor: BigInt(r.rows[0].outstanding_minor) } : null;
  }
  async setLoanStatus(tx: TxContext, tenantId: string, loanId: string, status: string): Promise<void> {
    await tx.query(`UPDATE loans SET status=$3::loan_status WHERE id=$1 AND tenant_id=$2`, [loanId, tenantId, status]);
  }

  async insertRestructure(tx: TxContext, r0: { id: string; tenantId: string; loanId: string; caseRef?: string; reasonCode: string; evidenceMediaId?: string; oldInstalmentMinor: bigint; newInstalmentMinor: bigint; oldTenorMonths: number; newTenorMonths: number; rateAprBps: number; holidayMonths: number; holidayStartsOn?: string; penalInterestWaived: boolean; totalInterestDeltaMinor: bigint; proposedBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO loan_restructures (id, tenant_id, loan_id, case_ref, reason_code, evidence_media_id, old_instalment_minor, new_instalment_minor, old_tenor_months, new_tenor_months, rate_apr_bps, holiday_months, holiday_starts_on, penal_interest_waived, total_interest_delta_minor, proposed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [r0.id, r0.tenantId, r0.loanId, r0.caseRef ?? null, r0.reasonCode, r0.evidenceMediaId ?? null, r0.oldInstalmentMinor.toString(), r0.newInstalmentMinor.toString(), r0.oldTenorMonths, r0.newTenorMonths, r0.rateAprBps, r0.holidayMonths, r0.holidayStartsOn ?? null, r0.penalInterestWaived, r0.totalInterestDeltaMinor.toString(), r0.proposedBy]);
  }
  async listRestructures(tenantId: string, loanId: string): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT * FROM loan_restructures WHERE tenant_id=$1 AND loan_id=$2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`, [tenantId, loanId]);
    return r.rows;
  }
  async getRestructureForUpdate(tx: TxContext, tenantId: string, id: string): Promise<{ id: string; loanId: string; status: string; proposedBy: string | null } | null> {
    const r = await tx.query(`SELECT id, loan_id, status, proposed_by FROM loan_restructures WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? { id: r.rows[0].id, loanId: r.rows[0].loan_id, status: r.rows[0].status, proposedBy: r.rows[0].proposed_by } : null;
  }
  async setRestructureStatus(tx: TxContext, tenantId: string, id: string, status: string, extra: { checkerId?: string } = {}): Promise<void> {
    if (status === 'checker_approved') await tx.query(`UPDATE loan_restructures SET status=$3, checker_id=$4, checker_approved_at=now() WHERE id=$1 AND tenant_id=$2`, [id, tenantId, status, extra.checkerId]);
    else if (status === 'accepted') await tx.query(`UPDATE loan_restructures SET status=$3, accepted_at=now() WHERE id=$1 AND tenant_id=$2`, [id, tenantId, status]);
    else await tx.query(`UPDATE loan_restructures SET status=$3 WHERE id=$1 AND tenant_id=$2`, [id, tenantId, status]);
  }
}
