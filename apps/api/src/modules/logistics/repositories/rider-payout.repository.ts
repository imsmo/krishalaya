// modules/logistics/repositories/rider-payout.repository.ts · PC-55 A7 (0087). tenant_id in EVERY query (Law 1).
// Reads only what is already ledgered: the terms series + the rider's own shipments. No new source of truth.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import type { RiderTerms, RiderShipment } from '../domain/rider-payout.rules';
import { pgDate } from '../../../core/database/pg-date';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date. The shape this file used —
// `String(row.some_date).slice(0, 10)` — yields "Mon Jul 13" for the JS Date node-pg hands back for a `date`
// (oid 1082), in EVERY timezone. Verified against the live schema: every column it was applied to here is a
// `date`. `pgDate` returns the calendar day PostgreSQL holds and passes an already-formatted string through.

const toTerms = (x: any): RiderTerms => ({
  id: x.id, riderUserId: x.rider_user_id, termsName: x.terms_name,
  effectiveFrom: pgDate(x.effective_from), perDropMinor: String(x.per_drop_minor),
  pctOfChargeBps: x.pct_of_charge_bps, codHandlingMinor: String(x.cod_handling_minor),
  failedAttemptMinor: String(x.failed_attempt_minor), currencyCode: x.currency_code,
});

@Injectable()
export class RiderPayoutRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insertTerms(tx: TxContext, t: { id: string; tenantId: string; riderUserId?: string; termsName: string; perDropMinor: string; pctOfChargeBps: number; codHandlingMinor: string; failedAttemptMinor: string; currencyCode: string; effectiveFrom: string; notes?: string; createdBy: string }): Promise<{ ok: true } | { ok: false; conflict: 'same_day' }> {
    try {
      await tx.query(
        `INSERT INTO rider_payout_terms (id, tenant_id, rider_user_id, terms_name, per_drop_minor, pct_of_charge_bps,
             cod_handling_minor, failed_attempt_minor, currency_code, effective_from, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [t.id, t.tenantId, t.riderUserId ?? null, t.termsName, t.perDropMinor, t.pctOfChargeBps,
         t.codHandlingMinor, t.failedAttemptMinor, t.currencyCode, t.effectiveFrom, t.notes ?? null, t.createdBy]);
      return { ok: true };
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505') return { ok: false, conflict: 'same_day' };
      throw e;
    }
  }
  /** Soft-retire a future-dated row (history is never edited; see the 0087 header). */
  async retireTerms(tx: TxContext, tenantId: string, id: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE rider_payout_terms SET deleted_at = now()
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL AND effective_from > CURRENT_DATE`, [id, tenantId]);
    return (r.rowCount ?? 0) > 0;
  }
  async listTerms(tenantId: string, riderUserId?: string): Promise<RiderTerms[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT * FROM rider_payout_terms
        WHERE tenant_id=$1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR rider_user_id = $2 OR rider_user_id IS NULL)
        ORDER BY effective_from DESC, rider_user_id NULLS LAST LIMIT 200`, [tenantId, riderUserId ?? null]);
    return r.rows.map(toTerms);
  }
  /** The terms series relevant to ONE rider (personal + tenant defaults) — the statement's pricing input. */
  async termsFor(tenantId: string, riderUserId: string): Promise<RiderTerms[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT * FROM rider_payout_terms
        WHERE tenant_id=$1 AND deleted_at IS NULL AND (rider_user_id = $2 OR rider_user_id IS NULL)
        ORDER BY effective_from ASC LIMIT 500`, [tenantId, riderUserId]);
    return r.rows.map(toTerms);
  }

  /** The rider's own finished work in a period. delivered_at bounds the read; failed attempts come with the
   *  date they were last touched (updated_at) since a failure has no delivered_at. */
  async riderShipments(tenantId: string, riderUserId: string, from: string, to: string): Promise<RiderShipment[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, status, charge_minor::text AS charge_minor, cod_minor::text AS cod_minor,
              delivered_at, updated_at
         FROM shipments
        WHERE tenant_id=$1 AND rider_user_id=$2 AND deleted_at IS NULL
          AND status IN ('delivered','failed')
          AND COALESCE(delivered_at, updated_at) >= $3::date
          AND COALESCE(delivered_at, updated_at) < ($4::date + 1)
        ORDER BY COALESCE(delivered_at, updated_at) ASC LIMIT 2000`,
      [tenantId, riderUserId, from, to]);
    return r.rows.map((x: any) => ({
      id: x.id, status: x.status, chargeMinor: x.charge_minor, codMinor: x.cod_minor,
      deliveredOn: x.delivered_at ? new Date(x.delivered_at).toISOString().slice(0, 10) : null,
      attemptedOn: x.updated_at ? new Date(x.updated_at).toISOString().slice(0, 10) : null,
    }));
  }
}
