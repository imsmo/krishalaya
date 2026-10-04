// modules/schemes/jobs/eligibility-sweep.job.ts · PC-56 TENANT-SW-b · D — THE ELIGIBILITY SWEEP, RUN BY A CLOCK (every minute).
// A desk member queues a sweep (scheme.desk, reason; once per scheme per IST day); this job evaluates it: the scheme's eligibility_rules over
// the tenant's members through the per-person evaluator, batched, in kv_app's unit of work. It writes verdict rows — a CALL LIST — and never
// an application. The kv_app UoW pattern: the kv_relay pool reads only `tenants`; the `schemes` flag gates each tenant. No kv_relay grant.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { SchemeDeskService } from '../services/scheme-desk.service';

export const ELIGIBILITY_SWEEP_JOB = 'schemes-eligibility-sweep';

export class EligibilitySweepJob implements ScheduledJob {
  readonly name = ELIGIBILITY_SWEEP_JOB;
  private readonly log = new Logger(EligibilitySweepJob.name);
  constructor(readonly intervalMs: number, private readonly desk: SchemeDeskService, private readonly flagOn: (tenantId: string) => Promise<boolean>) {}

  async sweep(pool: Pool, now: Date = new Date(), only?: string[]): Promise<{ tenants: number; sweeps: number; members: number; failed: number }> {
    const r = await pool.query(`SELECT id FROM tenants WHERE deleted_at IS NULL ${only ? 'AND id = ANY($1::uuid[])' : ''} ORDER BY id`, only ? [only] : []);
    let sweeps = 0, members = 0, failed = 0;
    for (const { id } of r.rows as Array<{ id: string }>) {
      try {
        if (!(await this.flagOn(id))) continue;
        const out = await this.desk.processQueued(id, now);
        sweeps += out.sweeps; members += out.members;
      } catch (e) { failed++; this.log.warn(`${this.name}: tenant ${id} failed: ${(e as Error).message}`); }
    }
    return { tenants: r.rows.length, sweeps, members, failed };
  }
  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.sweeps > 0 || r.failed > 0) this.log.log(`${this.name}: ${r.sweeps} sweep(s), ${r.members} member verdict(s), ${r.failed} failure(s)`);
  }
}
