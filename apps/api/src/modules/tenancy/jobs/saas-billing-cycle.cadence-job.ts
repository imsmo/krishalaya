// modules/tenancy/jobs/saas-billing-cycle.cadence-job.ts · PC-56 TENANT-4d-4
//
// Wraps SaasBillingCycleJob as a `ScheduledJob` so `core/jobs/jobs.runner.ts` runs it inside apps/api, under a
// Postgres advisory lock, exactly as `SettlementStatementsCadenceJob` and `PayoutExecutionCadenceJob` already
// are. **This is the host TENANT-4d-2 said the four dead tenancy job classes needed and could not find.**
//
// 4d-2 recorded them as unschedulable because `pending-plan-change.job.ts` had concluded that "this runtime
// deliberately takes only pg-native jobs" — true of apps/worker, and stale as a whole: S4 built the api-side
// cadence host (`SCHEDULED_JOB_REGISTRY` + `ScheduledJobsRunner`) precisely for jobs that need module
// services, and three jobs have run on it since. So the cadence did not need a pg-native rewrite; it needed
// a wrapper and a registration, which is what this file is.
//
// DAILY by default. The unit of this cycle is a DAY — a period ends on a date, a grace window is counted in
// whole days — so a per-minute sweep would run 1,440 times to do nothing 1,439 of them, and a tenant would
// never notice the difference. The tick is idempotent regardless (every phase is), so a manual re-run or an
// overlapping deploy is safe.
import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { SaasBillingCycleJob } from './saas-billing-cycle.job';

@Injectable()
export class SaasBillingCycleCadenceJob implements ScheduledJob {
  readonly name = 'saas-billing-cycle';
  private readonly log = new Logger(SaasBillingCycleCadenceJob.name);

  constructor(readonly intervalMs: number, private readonly job: SaasBillingCycleJob, private readonly batchSize: number) {}

  async run(pool: Pool): Promise<void> {
    const r = await this.job.run(pool, this.batchSize, new Date());
    if (r.refused) {
      // A refused tick is logged at DEBUG, not silence: "the flag is off" is the answer to "why did nothing
      // happen", and an operator should be able to find it without reading this file.
      this.log.debug(`saas-billing-cycle refused: ${r.refused}`);
      return;
    }
    this.log.log(`saas-billing-cycle raised=${r.raised} overdue=${r.overdue} graced=${r.graced} expired=${r.expired} waited=${r.waited} failed=${r.failed}`);
  }
}
