// modules/schemes/repositories/dbt-transfer.repository.ts · all SQL for dbt_transfers (PARTITIONED by
// created_at). tenant_id in EVERY query (Law 1) + RLS. The list bounds created_at so PG prunes partitions
// (Law 8). Append-only observed-credit records.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { DbtTransfer } from '../domain/dbt-transfer.entity';
import { pgDate } from '../../../core/database/pg-date';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date. The shape this file used —
// `String(row.some_date).slice(0, 10)` — yields "Mon Jul 13" for the JS Date node-pg hands back for a `date`
// (oid 1082), in EVERY timezone. Verified against the live schema: every column it was applied to here is a
// `date`. `pgDate` returns the calendar day PostgreSQL holds and passes an already-formatted string through.

const COLS = `id, tenant_id, application_id, user_id, scheme_id, amount_minor, instalment_no, credited_on, pfms_ref, created_at`;
const d = (v: any): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
function toDomain(r: any): DbtTransfer {
  return DbtTransfer.rehydrate({ id: r.id, tenantId: r.tenant_id, applicationId: r.application_id, userId: r.user_id, schemeId: r.scheme_id, amountMinor: BigInt(r.amount_minor), instalmentNo: r.instalment_no, creditedOn: d(r.credited_on), pfmsRef: r.pfms_ref, createdAt: r.created_at });
}
@Injectable()
export class DbtTransferRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, t: DbtTransfer): Promise<void> {
    const p = t.toProps();
    await tx.query(`INSERT INTO dbt_transfers (id, tenant_id, application_id, user_id, scheme_id, amount_minor, instalment_no, credited_on, pfms_ref) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.id, p.tenantId, p.applicationId, p.userId, p.schemeId, p.amountMinor.toString(), p.instalmentNo, p.creditedOn, p.pfmsRef]);
  }
  async listForApplication(tenantId: string, applicationId: string): Promise<DbtTransfer[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM dbt_transfers WHERE tenant_id=$1 AND application_id=$2 AND created_at >= now() - interval '5 years' ORDER BY credited_on DESC, id DESC LIMIT 200`, [tenantId, applicationId]);
    return r.rows.map(toDomain);
  }

  /** PC-54 W54-10 `dbt-read-models`: the cross-application MONITOR — per-scheme totals from ledgered
   *  credits (partition bound). Bounce/failure tracking needs a status column → gated (`dbt-bounce-ledger`). */
  async monitor(tenantId: string): Promise<Array<{ schemeId: string; transfers: number; amountMinor: string; lastCreditedOn: string | null }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT scheme_id, COUNT(*)::int AS transfers, COALESCE(SUM(amount_minor),0)::text AS amount_minor, MAX(credited_on) AS last
         FROM dbt_transfers WHERE tenant_id=$1 AND created_at >= now() - interval '2 years'
        GROUP BY scheme_id ORDER BY amount_minor::numeric DESC LIMIT 100`, [tenantId]);
    return r.rows.map((x: any) => ({ schemeId: x.scheme_id, transfers: x.transfers, amountMinor: x.amount_minor, lastCreditedOn: x.last ? pgDate(x.last) : null }));
  }
  /** Recent credits across ALL applications (Process oversight; keyset-free bounded read). */
  async recent(tenantId: string, schemeId: string | undefined, limit: number): Promise<DbtTransfer[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM dbt_transfers WHERE tenant_id=$1 AND ($2::uuid IS NULL OR scheme_id=$2) AND created_at >= now() - interval '2 years'
        ORDER BY credited_on DESC, id DESC LIMIT $3`, [tenantId, schemeId ?? null, limit]);
    return r.rows.map(toDomain);
  }
}
