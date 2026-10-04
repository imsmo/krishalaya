// modules/labour/jobs/wage-run.job.ts · PC-56 TENANT-SW-b · C1 — THE DAILY 18:00 IST WAGE RUN + ITS 16:00 IST RETRY LADDER, ON A CLOCK.
//
// Registered in SCHEDULED_JOB_REGISTRY (every 5 minutes, advisory-locked by the runner). The kv_app UoW pattern (11b / 13b / SW-a): the
// runner's kv_relay pool reads only `tenants`; each tenant's retry pass and daily run happen in kv_app's unit of work under RLS — the
// relay holds no grant on any labour table (the HOTFIX-2 gate sweeps this job on a kv_relay pool). A tenant with `labour` off is skipped.
// The retry pass runs first, so a line whose 16:00 retry succeeds is not also considered by the 18:00 run (which skips laddered bookings).
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { WageRunService } from '../services/wage-run.service';

export const WAGE_RUN_JOB = 'labour-daily-wage-run';

export class WageRunJob implements ScheduledJob {
  readonly name = WAGE_RUN_JOB;
  private readonly log = new Logger(WageRunJob.name);
  constructor(readonly intervalMs: number, private readonly runs: WageRunService, private readonly flagOn: (tenantId: string) => Promise<boolean>) {}

  /** One tick. `only` narrows the tenants (a proof's isolation); production passes nothing. */
  async sweep(pool: Pool, now: Date = new Date(), only?: string[]): Promise<{ tenants: number; runs: number; retried: number; failed: number }> {
    const r = await pool.query(`SELECT id FROM tenants WHERE deleted_at IS NULL ${only ? 'AND id = ANY($1::uuid[])' : ''} ORDER BY id`, only ? [only] : []);
    let runs = 0, retried = 0, failed = 0;
    for (const { id } of r.rows as Array<{ id: string }>) {
      try {
        if (!(await this.flagOn(id))) continue;
        retried += (await this.runs.retryDue(id, now)).retried;
        if (await this.runs.runDaily(id, now)) runs++;
      } catch (e) {
        failed++;
        this.log.warn(`${this.name}: tenant ${id} failed: ${(e as Error).message}`);
      }
    }
    return { tenants: r.rows.length, runs, retried, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.runs > 0 || r.retried > 0 || r.failed > 0) this.log.log(`${this.name}: ${r.runs} run(s), ${r.retried} line(s) retried, ${r.failed} tenant failure(s)`);
  }
}
