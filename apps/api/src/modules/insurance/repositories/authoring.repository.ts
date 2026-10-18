// modules/insurance/repositories/authoring.repository.ts · PC-54 W54-9 `insurance-authoring`. PC-56 PARTNER-2a (survey F-1 / F-5): the
// product INSERT / UPDATE and the policy "issue" UPDATE (a raw status write outside the state machine) are REMOVED — no authoring write
// survives from the tenant realm (founder Q5 + Q7; the platform's admin-realm writer, when it is built, lives in apps/admin-api, Law 11).
// What is left: the tenant's own book and the loss-ratio aggregates, read under tenant RLS behind the `insurance` flag.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { pgDate } from '../../../core/database/pg-date';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date. The shape this file used —
// `String(row.some_date).slice(0, 10)` — yields "Mon Jul 13" for the JS Date node-pg hands back for a `date`
// (oid 1082), in EVERY timezone. Verified against the live schema: every column it was applied to here is a
// `date`. `pgDate` returns the calendar day PostgreSQL holds and passes an already-formatted string through.

@Injectable()
export class AuthoringRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** The insurer's BOOK: policies by status with premium/sum-insured as minor strings. */
  async book(tenantId: string, status: string | undefined, limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, holder_user_id, product_id, policy_no, subject_type, status, sum_insured_minor::text, premium_minor::text, valid_from, valid_until
         FROM insurance_policies WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2::policy_status) AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT $3`, [tenantId, status ?? null, limit]);
    return r.rows.map((x: any) => ({ id: x.id, holderUserId: x.holder_user_id, productId: x.product_id, policyNo: x.policy_no, subjectType: x.subject_type, status: x.status, sumInsuredMinor: x.sum_insured_minor, premiumMinor: x.premium_minor, validFrom: pgDate(x.valid_from), validUntil: pgDate(x.valid_until) }));
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
