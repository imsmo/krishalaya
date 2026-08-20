// modules/dairy/jobs/dairy-cycle-close.cadence-job.ts · PC-56 TENANT-6c-1.
//
// THE JOB THAT REPLACES A JOB NOBODY COULD RUN.
//
// `MilkBillCycleCloseJob` shipped with the dairy module and was instantiated NOWHERE. `dairy.module.ts` said it "is
// instantiated by apps/worker"; apps/worker's `JOBS` registry holds twelve pg-native jobs and no dairy job, and by its
// own contract (`WORKER-RUNTIME.md`, "Deferred: domain-handler jobs") it cannot host this one — generating a bill needs
// the module's unit of work, outbox and idempotency, none of which exist in a pg-only process. So W167's "312
// milk_bills building" and W169's "312 bills in draft" were, on every tenant this platform has ever had, zero: nothing
// has ever generated a milk bill except a human calling POST /dairy/milk-bills by hand.
//
// It also could not have worked if it had been wired. Its claim query took no tenant and no payment cycle, so it would
// have billed every tenant's unbilled pours into one window chosen by the caller — paying a MONTHLY member for the
// first half of their month and silently rolling the rest into the next bill.
//
// `core/jobs/jobs.runner.ts` exists for exactly this case, and this module already registers one job through it
// (`D2cDeliveryRunsCadenceJob`). Advisory-locked per tick by the runner, so N pods do not race the same fortnight;
// per-tenant isolation so one cooperative's failure never stops another's; flag-gated per tenant, because switching
// on automatic bill generation is a treasury's decision and not a deployment's.
import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { DairyBillCycleService } from '../services/dairy-bill-cycle.service';

export const CYCLE_CLOSE_FLAG = 'dairy_cycle_close';

const LIVE_TENANT_STATUSES_SQL = `('trial','active','grace')`;

@Injectable()
export class DairyCycleCloseCadenceJob implements ScheduledJob {
  readonly name = 'dairy-cycle-close';
  private readonly log = new Logger(DairyCycleCloseCadenceJob.name);

  constructor(
    readonly intervalMs: number,
    private readonly cycles: DairyBillCycleService,
    private readonly flags: FlagsService,
  ) {}

  async run(pool: Pool): Promise<void> {
    // Driven off tenants that ACTUALLY HAVE DAIRY MEMBERS, not off every live tenant. A platform with ten thousand
    // tenants and twelve cooperatives must not do ten thousand flag lookups an hour to discover that (Law 12: work
    // proportional to work outstanding). The flag is then asked per candidate, so a cooperative can be switched on
    // and off individually and a kill-switch takes effect within the flag cache's 30 seconds.
    const tenants = await pool.query<{ id: string }>(
      `SELECT t.id FROM tenants t
        WHERE t.status IN ${LIVE_TENANT_STATUSES_SQL} AND t.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM dairy_memberships m
                       WHERE m.tenant_id = t.id AND m.is_active = true AND m.deleted_at IS NULL)
        ORDER BY t.id`);

    const now = new Date();
    let onCount = 0, closed = 0, generated = 0, skipped = 0, stranded = 0, failed = 0, tenantFailures = 0;

    for (const t of tenants.rows) {
      try {
        if (!(await this.flags.isEnabled(CYCLE_CLOSE_FLAG, { tenantId: t.id }))) continue;
        onCount += 1;
        const r = await this.cycles.tickForTenant(t.id, now);
        closed += r.closed; generated += r.generated; skipped += r.skipped; stranded += r.stranded; failed += r.failed;
      } catch (e) {
        tenantFailures += 1;
        this.log.error(`dairy-cycle-close failed for tenant ${t.id}: ${(e as Error).message}`);
      }
    }

    // Logged only when something happened or something broke — an hourly "nothing to do" line buries the run that
    // mattered. `failed` and `tenantFailures` are DIFFERENT numbers on purpose: the first is members whose bill threw,
    // the second is cooperatives whose whole tick threw, and collapsing them hides which one is on fire.
    // `stranded` is called out separately from `skipped` because it is the only one that means MONEY IS OWED AND
    // UNPAYABLE: a pour entered after its cycle was billed has no bill it can join (see STRANDED_CODE in the service).
    if (closed > 0 || generated > 0 || stranded > 0 || failed > 0 || tenantFailures > 0) {
      this.log.log(`dairy-cycle-close: ${closed} cycle(s) closed, ${generated} bill(s) drafted, ${skipped} skipped (${stranded} STRANDED — pours in an already-billed window), ${failed} member failure(s) across ${onCount} enabled tenant(s), ${tenantFailures} tenant failure(s)`);
    }
  }
}
