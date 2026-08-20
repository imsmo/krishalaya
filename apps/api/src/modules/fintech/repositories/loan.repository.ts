// modules/fintech/repositories/loan.repository.ts · all SQL for loans. tenant_id in EVERY query (Law 1) +
// RLS. No version column → mutations lock FOR UPDATE. application_id is UNIQUE (one loan per application).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Loan } from '../domain/loan.entity';
import { LoanStatus } from '../domain/loan.state';
import { pgDateOrNull } from '../../../core/database/pg-date';
import { LoanNotFoundError } from '../domain/fintech.errors';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date — node-pg hands back LOCAL midnight and
// `toISOString()` is a DAY EARLY anywhere ahead of UTC (see that file's header; the dairy double-payment proved it).

const COLS = `id, application_id, tenant_id, borrower_user_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, maturity_date, status, outstanding_minor, next_due_date, created_at`;
const d = pgDateOrNull;
function toDomain(r: any): Loan {
  return Loan.rehydrate({ id: r.id, applicationId: r.application_id, tenantId: r.tenant_id, borrowerUserId: r.borrower_user_id, partnerId: r.partner_id,
    principalMinor: BigInt(r.principal_minor), interestAprBps: r.interest_apr_bps, disbursedAt: d(r.disbursed_at)!, maturityDate: d(r.maturity_date), status: r.status as LoanStatus, outstandingMinor: BigInt(r.outstanding_minor), nextDueDate: d(r.next_due_date), createdAt: r.created_at });
}
@Injectable()
export class LoanRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, l: Loan): Promise<void> {
    const p = l.toProps();
    await tx.query(`INSERT INTO loans (id, application_id, tenant_id, borrower_user_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, maturity_date, status, outstanding_minor, next_due_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$4)`,
      [p.id, p.applicationId, p.tenantId, p.borrowerUserId, p.partnerId, p.principalMinor.toString(), p.interestAprBps, p.disbursedAt, p.maturityDate, p.status, p.outstandingMinor.toString(), p.nextDueDate]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Loan | null> {
    const r = await tx.query(`SELECT ${COLS} FROM loans WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<Loan | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM loans WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /**
   * Persist a loan's servicing state.
   *
   * [PC-56 TENANT-6c-5] **FAILS CLOSED on a zero-row update**, which it did not before. Every caller passes a loan it
   * has just locked with `getForUpdate`, so a row that does not move means the loan was deleted or the tenant is wrong
   * — and the consequence is specific and bad: TENANT-6c-4 made a milk bill's `loan_emi` line post a real wallet
   * movement (member → cooperative) and then reduce the outstanding here. A silently lost update there means **the
   * family pays the instalment and still owes it**, with a ledger entry to prove they paid. Same ruling as
   * `COLLECTION_STAMP_LOST` (5d), `BillNotFoundError` (6c-2) and the deduction-line stamp (6c-4); this is the sixth
   * table in this programme to get it, and it was found by asking what my own new caller does if this returns 0.
   */
  async update(tx: TxContext, l: Loan): Promise<void> {
    const p = l.toProps();
    const res = await tx.query(`UPDATE loans SET status=$3, outstanding_minor=$4, next_due_date=$5, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [p.id, p.tenantId, p.status, p.outstandingMinor.toString(), p.nextDueDate]);
    if (res.rowCount === 0) throw new LoanNotFoundError(p.id);
  }

  /**
   * [PC-56 TENANT-6c-5] The loans a MILK BILL may recover against, for one borrower, oldest first.
   *
   * `repayment_style` lives on `loan_products` (0011), not on the loan, so this is the join that answers "did this
   * family agree that this loan comes out of their milk cheque?" — `milk_bill_deduction` is the style 0011's own
   * comment named and nothing has ever selected on. Servicing statuses only: a `closed` loan has nothing to recover
   * and a `written_off` one is not a debt this platform should quietly resurrect from a milk bill.
   *
   * Ordered oldest-disbursed first, deliberately and stated: when a fortnight's cap cannot cover every arrangement,
   * this platform recovers the OLDEST debt rather than the largest or the bank's before the cooperative's. A
   * per-type priority is a policy the canon does not state, so it is not invented here.
   */
  async listMilkDeductible(tx: TxContext, tenantId: string, borrowerUserId: string, limit = 50): Promise<Loan[]> {
    const r = await tx.query(
      `SELECT ${COLS.split(', ').map((c) => `l.${c}`).join(', ')}
         FROM loans l
         JOIN loan_products p ON p.id = (SELECT product_id FROM loan_applications a WHERE a.id = l.application_id)
        WHERE l.tenant_id=$1 AND l.borrower_user_id=$2
          AND p.repayment_style = 'milk_bill_deduction'
          AND l.status IN ('active','overdue')
          AND l.outstanding_minor > 0
          AND l.deleted_at IS NULL
        ORDER BY l.disbursed_at, l.id LIMIT $3`, [tenantId, borrowerUserId, limit]);
    return r.rows.map((row) => toDomain(row));
  }
  async listFor(tenantId: string, q: { borrowerUserId?: string; status?: string; cursor?: { c: string; id: string }; limit: number }): Promise<Loan[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.borrowerUserId) where += ` AND borrower_user_id=${p(q.borrowerUserId)}`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM loans WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
