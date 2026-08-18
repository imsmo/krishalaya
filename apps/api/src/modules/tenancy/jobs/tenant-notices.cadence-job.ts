// modules/tenancy/jobs/tenant-notices.cadence-job.ts · PC-56 TENANT-4d-5
//
// The cadence hosts for the two tenancy jobs that emit a notice nobody was listening for. 0148's header named
// both and refused to schedule either, with the reason: "the usage alert is TENANT-4d-1's threshold, which needs
// the notification plane TENANT-4d-5 builds. Wiring a job whose notification goes nowhere would be the
// fake-surface shape this programme refuses." The plane exists now, so the refusal expires — and its converse
// binds instead: `saas.trial_ending` and `saas.usage_limit_alert` now have map rows, catalog rows and templates
// in three languages, so leaving their producers unscheduled would be a notification with no event, which is the
// same defect read from the other end.
//
// TWO CLASSES, ONE FILE, because they are one decision: both are daily, both are cross-tenant single-query
// scans on the runner's kv_relay pool, and both exist only to feed the notice plane. Two registry names, though
// — a trial ending and a quota warning fail independently and an operator reading a log wants to know which.
//
// DAILY, and for the same reason the billing cycle is daily: both are counted in whole days (a trial ends on a
// date; the usage alert has an `ops_job_runs` date guard that makes a second run on the same date a no-op), so
// a faster tick would do nothing 1,439 times out of 1,440.
import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { TrialExpiryJob } from './trial-expiry.job';
import { UsageLimitAlertsJob } from './usage-limit-alerts.job';

@Injectable()
export class TrialExpiryCadenceJob implements ScheduledJob {
  readonly name = 'tenancy-trial-expiry';
  private readonly log = new Logger(TrialExpiryCadenceJob.name);

  constructor(readonly intervalMs: number, private readonly job: TrialExpiryJob, private readonly batchSize: number, private readonly noticeDays: number) {}

  async run(pool: Pool): Promise<void> {
    const r = await this.job.run(pool, this.batchSize, this.noticeDays);
    // `silent` is logged next to `notified` on purpose. It counts trials whose tenant has notices switched off
    // OR has nobody holding `tenant.settings` — the second of which is a finding, not a quiet success, and an
    // operator who only ever saw "notified=0" could not tell the two apart from the difference.
    this.log.log(`tenancy-trial-expiry notified=${r.notified} silent=${r.silent}`);
  }
}

@Injectable()
export class UsageLimitAlertsCadenceJob implements ScheduledJob {
  readonly name = 'tenancy-usage-limit-alerts';
  private readonly log = new Logger(UsageLimitAlertsCadenceJob.name);

  constructor(readonly intervalMs: number, private readonly job: UsageLimitAlertsJob, private readonly batchSize: number) {}

  async run(pool: Pool): Promise<void> {
    const r = await this.job.run(pool, this.batchSize);
    if (r.skipped) { this.log.debug('tenancy-usage-limit-alerts already ran for this date'); return; }
    this.log.log(`tenancy-usage-limit-alerts alerted=${r.alerted} silent=${r.silent}`);
  }
}
