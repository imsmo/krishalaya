// modules/ambassadors/jobs/payout-run.job.ts · PC-56 TENANT-SW-b · A — THE THURSDAY 23:00 IST WEEKLY RUN, PREPARED (NEVER PAID) BY A CLOCK.
//
// Founder decision (2026-10-03): ambassador pay from the tenant wallet under maker-checker. This job is the MAKER: inside the 24 hours
// after a Thursday 23:00 IST period end it prepares each tenant's weekly run (prepared_by NULL = the job) — the unpaid earnings up to
// the period end + the stipends due + the REAL tenant Main balance as the funding line. It moves NO money: a different tenant_admin
// confirms the run (canon W161 "Maker: member desk (auto-prepared Thu 23:00). Checker: you."). It replaces the 10a
// `weekly-payout-batch.job.ts` that sat deliberately uncalled while F-23 was open (that file is retired).
//
// The kv_app UoW pattern (11b / 13b / SW-a): the runner's kv_relay pool reads only `tenants`; each tenant is prepared in kv_app's unit
// of work under RLS. A tenant with the `ambassadors` flag off, with an open run, or owing nothing is skipped. No grant to kv_relay.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { inPrepareWindow } from '../domain/payout-run';
import { PayoutRunService } from '../services/payout-run.service';

export const AMBASSADOR_RUN_JOB = 'ambassador-weekly-run-prepare';

export class AmbassadorPayoutRunJob implements ScheduledJob {
  readonly name = AMBASSADOR_RUN_JOB;
  private readonly log = new Logger(AmbassadorPayoutRunJob.name);
  constructor(readonly intervalMs: number, private readonly runs: PayoutRunService, private readonly flagOn: (tenantId: string) => Promise<boolean>) {}

  /** One tick. `only` narrows the tenants (a proof's isolation); production passes nothing. */
  async sweep(pool: Pool, now: Date = new Date(), only?: string[]): Promise<{ inWindow: boolean; tenants: number; prepared: number; skipped: number; failed: number }> {
    if (!inPrepareWindow(now)) return { inWindow: false, tenants: 0, prepared: 0, skipped: 0, failed: 0 };
    const r = await pool.query(`SELECT id FROM tenants WHERE deleted_at IS NULL ${only ? 'AND id = ANY($1::uuid[])' : ''} ORDER BY id`, only ? [only] : []);
    let prepared = 0, skipped = 0, failed = 0;
    for (const { id } of r.rows as Array<{ id: string }>) {
      try {
        if (!(await this.flagOn(id))) { skipped++; continue; }
        if (await this.runs.prepareByJob(id, now)) prepared++; else skipped++;
      } catch (e) {
        failed++;
        this.log.warn(`${this.name}: tenant ${id} failed: ${(e as Error).message}`);
      }
    }
    return { inWindow: true, tenants: r.rows.length, prepared, skipped, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.prepared > 0 || r.failed > 0) this.log.log(`${this.name}: ${r.prepared} run(s) prepared, ${r.failed} failed, across ${r.tenants} tenant(s)`);
  }
}
