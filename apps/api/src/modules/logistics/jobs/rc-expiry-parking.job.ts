// modules/logistics/jobs/rc-expiry-parking.job.ts · PC-56 TENANT-5b
//
// **W229's sentence, given a mechanism: "An expired RC parks the vehicle automatically; safety is not a
// preference."**
//
// Before this wave nothing on the platform had ever read a vehicle's RC. `vehicles.rc_doc_id` (0007) pointed at
// a `kyc_documents` row carrying `status` and `valid_until`; the identity module's `KycExpiryRemindersJob` reads
// that same column to NOTIFY a person about their own document, and an earlier wave made expiry BLOCK the
// payout/bank-account flows — so the precedent for acting on expiry exists. A vehicle was simply never part of
// it, and "parks the vehicle automatically" described nothing.
//
// WHAT PARKS AND WHAT DOES NOT (`domain/fleet-fitness.ts` owns the rule; this job only executes it):
//   • verified-but-EXPIRED, and REJECTED → parked. Both are facts we hold and both mean the vehicle should not
//     be on a road with a farmer's crop on it.
//   • PENDING → not parked. The paperwork is in and our review queue has not reached it; punishing a tenant for
//     our own queue is not a safety rule.
//   • ABSENT → not parked, ever, by this job. `rc_doc_id` is nullable, no form ever asked for one, and no vehicle
//     in production has one — so parking on absence would deactivate every fleet on the platform in a single
//     tick and call it safety. The register names those vehicles instead, and a tenant that wants the strict
//     rule switches on `logistics_require_rc`, which hardens the ASSIGNMENT rather than mass-deactivating.
//
// Cross-tenant by construction (the BYPASSRLS relay pool), because an expired RC is not a tenant's private
// business: it is a lorry on a public road. Bounded, ordered by id, and idempotent — `park()` only touches a
// vehicle that is still active, so two racing ticks park it once.
import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { VehicleRepository } from '../repositories/vehicle.repository';
import { RC_PARKING_FLAG } from '../domain/fleet-fitness';
import { FleetEventType } from '../domain/logistics.events';

export interface RcParkingResult { scanned: number; parked: number; skipped: number; refused?: 'flag_off' }

@Injectable()
export class RcExpiryParkingJob {
  constructor(
    private readonly vehicles: VehicleRepository,
    private readonly flags: FlagsService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  /**
   * One tick. `systemPool` is the runner's kv_relay pool.
   *
   * The flag is read PER TENANT for the vehicles found, not once globally: a platform-wide read would park one
   * tenant's fleet because another tenant switched the feature on (and a global kill switch that stops every
   * tenant's safety rule because one tenant is mid-migration is the mirror of the same mistake). A platform 3PL
   * vehicle (`tenant_id IS NULL`) is governed by the flag's DEFAULT value, which is what a null-tenant flag read
   * returns.
   */
  async run(systemPool: Pool, limit = 500, now: Date = new Date()): Promise<RcParkingResult> {
    void now;
    const client: PoolClient = await systemPool.connect();
    let parked = 0, skipped = 0, scanned = 0;
    try {
      const exec = { query: (sql: string, params?: unknown[]) => client.query(sql, params as never[]) as never };
      const due = await this.vehicles.rcInvalidActive(exec as never, limit);
      scanned = due.length;
      // Per-tenant flag reads, memoised for the batch: a fleet is many vehicles and one tenant.
      const flagCache = new Map<string, boolean>();
      const flagFor = async (tenantId: string | null): Promise<boolean> => {
        const key = tenantId ?? '__platform__';
        const hit = flagCache.get(key);
        if (hit !== undefined) return hit;
        const on = await this.flags.isEnabled(RC_PARKING_FLAG, tenantId ? { tenantId } : {}).catch(() => false);
        flagCache.set(key, on);
        return on;
      };

      for (const v of due) {
        if (!(await flagFor(v.tenantId))) { skipped++; continue; }
        // Each vehicle is its own transaction: one tenant's FK or trigger problem must not roll back the
        // parking of forty other tenants' lorries. The job is idempotent, so a crash mid-batch resumes.
        await client.query('BEGIN');
        try {
          const did = await this.vehicles.park(exec as never, v.id);
          if (!did) { await client.query('ROLLBACK'); skipped++; continue; }
          // The EVENT carries the evidence, not just the verdict: a consumer that is told a vehicle was parked
          // and not WHICH document state did it cannot tell an FPO what to renew.
          await client.query(
            `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
             VALUES ($1,'vehicle',$2,$3,$4::jsonb)`,
            [v.tenantId, v.id, FleetEventType.VehicleParkedRcInvalid,
             JSON.stringify({ v: 1, vehicleId: v.id, regNo: v.regNo, rcStatus: v.rcStatus, rcValidUntil: v.rcValidUntil })]);
          // Audited as the platform, not as a person: no human clicked this, and attributing it to one would be
          // a status recording an act nobody performed. `actor_user_id` stays NULL and the action names the job.
          await client.query(
            `INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, old_value, new_value)
             VALUES ($1, NULL, 'logistics.vehicle_parked_rc_invalid', 'vehicle', $2, $3::jsonb, $4::jsonb)`,
            [v.tenantId, v.id, JSON.stringify({ isActive: true }),
             JSON.stringify({ isActive: false, rcStatus: v.rcStatus, rcValidUntil: v.rcValidUntil })]);
          await client.query('COMMIT');
          parked++;
          this.metrics.inc('logistics.vehicle_parked_rc', { status: v.rcStatus });
        } catch (e) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw e;
        }
      }
      return { scanned, parked, skipped };
    } finally {
      client.release();
    }
  }
}
