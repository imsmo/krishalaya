// modules/dairy/repositories/dairy-member-credit.repository.ts · PC-56 TENANT-6c-4 · all SQL for dairy_member_credits.
// tenant_id in EVERY query (Law 1) + RLS. What was sold, to whom, for how much and by whom is append-only by GRANT
// (0160); the only UPDATE is the recovery, and it fails closed.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { pgDate } from '../../../core/database/pg-date';
import { DairyMemberCredit } from '../domain/dairy-member-credit.entity';
import { MemberCreditNotFoundError } from '../domain/dairy.errors';

const COLS = `id, tenant_id, membership_id, mcc_id, description, value_minor, recovered_minor, issued_on, issued_by, status, created_at`;

function toDomain(r: any): DairyMemberCredit {
  return DairyMemberCredit.rehydrate({
    id: r.id, tenantId: r.tenant_id, membershipId: r.membership_id, mccId: r.mcc_id ?? null,
    description: String(r.description),
    valueMinor: BigInt(r.value_minor), recoveredMinor: BigInt(r.recovered_minor),
    // `issued_on` is a `date` column. TENANT-6c-1's mapper: node-pg parses oid 1082 at LOCAL midnight, so
    // `toISOString().slice(0,10)` is a day early everywhere east of UTC — including the launch market.
    issuedOn: pgDate(r.issued_on), issuedBy: r.issued_by, status: r.status, createdAt: r.created_at,
  });
}

@Injectable()
export class DairyMemberCreditRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, c: DairyMemberCredit): Promise<void> {
    const p = c.toProps();
    await tx.query(
      `INSERT INTO dairy_member_credits (id, tenant_id, membership_id, mcc_id, description, value_minor, recovered_minor, issued_on, issued_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10)`,
      [p.id, p.tenantId, p.membershipId, p.mccId, p.description, p.valueMinor.toString(), p.recoveredMinor.toString(), p.issuedOn, p.issuedBy, p.status]);
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<DairyMemberCredit | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM dairy_member_credits WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /**
   * Persist a recovery. Fails closed: this runs in the same transaction as the ledger movement that took the money,
   * so a row that did not move means a member paid for feed and the cooperative's books still show it owing.
   *
   * The WHERE clause carries `recovered_minor=$4` — the value we READ — so two concurrent recoveries against one
   * credit cannot both succeed on a stale read. The row is already locked by `getForUpdate`; this is the second lock
   * for the case where a future caller forgets it, which is how the 5d/6b-1/6c-2 defects all started.
   */
  async updateRecovered(tx: TxContext, c: DairyMemberCredit, previousRecoveredMinor: bigint): Promise<void> {
    const p = c.toProps();
    const res = await tx.query(
      `UPDATE dairy_member_credits
          SET recovered_minor=$3, status=$5, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND recovered_minor=$4 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.recoveredMinor.toString(), previousRecoveredMinor.toString(), p.status]);
    if (res.rowCount === 0) throw new MemberCreditNotFoundError(p.id);
  }

  async getById(tenantId: string, id: string): Promise<DairyMemberCredit | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM dairy_member_credits WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** A member's outstanding credits, oldest first — what TENANT-6c-5's assembler will read, and what the desk shows. */
  async listOutstanding(tenantId: string, membershipId: string, limit = 100): Promise<DairyMemberCredit[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM dairy_member_credits
        WHERE tenant_id=$1 AND membership_id=$2 AND status='outstanding' AND deleted_at IS NULL
        ORDER BY issued_on, id LIMIT $3`, [tenantId, membershipId, limit]);
    return r.rows.map(toDomain);
  }

  async listFor(tenantId: string, q: { membershipId?: string; status?: string; limit: number }): Promise<DairyMemberCredit[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.membershipId) where += ` AND membership_id=${p(q.membershipId)}`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM dairy_member_credits WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /** A member's total outstanding — the figure a desk needs before it deducts anything. */
  async outstandingTotal(tenantId: string, membershipId: string): Promise<bigint> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT COALESCE(SUM(value_minor - recovered_minor),0)::text AS total FROM dairy_member_credits
        WHERE tenant_id=$1 AND membership_id=$2 AND status='outstanding' AND deleted_at IS NULL`, [tenantId, membershipId]);
    return BigInt((r.rows[0] as { total: string }).total);
  }
}
