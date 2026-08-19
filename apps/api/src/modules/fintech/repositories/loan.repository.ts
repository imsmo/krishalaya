// modules/fintech/repositories/loan.repository.ts · all SQL for loans. tenant_id in EVERY query (Law 1) +
// RLS. No version column → mutations lock FOR UPDATE. application_id is UNIQUE (one loan per application).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Loan } from '../domain/loan.entity';
import { LoanStatus } from '../domain/loan.state';
import { pgDateOrNull } from '../../../core/database/pg-date';
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
  async update(tx: TxContext, l: Loan): Promise<void> {
    const p = l.toProps();
    await tx.query(`UPDATE loans SET status=$3, outstanding_minor=$4, next_due_date=$5, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [p.id, p.tenantId, p.status, p.outstandingMinor.toString(), p.nextDueDate]);
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
