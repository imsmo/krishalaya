// modules/logistics/jobs/ops-alerts.cadence-job.ts · PC-55 A6.
// Evaluates every live tenant's active alert rules on a cadence, mirroring KycExpiryRemindersCadenceJob:
// advisory-locked by ScheduledJobsRunner (one pod per tick), per-tenant isolation so one tenant's failure never
// silences another's alerts, and NO delivery of its own — firing writes one outbox event and the notification
// spine does the rest.
import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { OpsAlertService } from '../services/ops-alert.service';

const LIVE_TENANT_STATUSES_SQL = `('trial','active','grace')`;

@Injectable()
export class OpsAlertsCadenceJob implements ScheduledJob {
  readonly name = 'ops-alerts-evaluate';
  private readonly log = new Logger(OpsAlertsCadenceJob.name);

  constructor(readonly intervalMs: number, private readonly svc: OpsAlertService) {}

  async run(pool: Pool): Promise<void> {
    const tenants = await pool.query<{ id: string }>(
      `SELECT id FROM tenants WHERE status IN ${LIVE_TENANT_STATUSES_SQL} AND deleted_at IS NULL`);
    let fired = 0, suppressed = 0, failures = 0;
    for (const t of tenants.rows) {
      try {
        const r = await this.svc.evaluateTenant(t.id);
        fired += r.fired; suppressed += r.suppressed;
      } catch (e) {
        failures++;
        this.log.error(`ops-alerts evaluation failed for tenant ${t.id}: ${(e as Error).message}`);
      }
    }
    if (fired > 0 || failures > 0) {
      this.log.log(`ops-alerts: ${fired} alert(s) fired, ${suppressed} suppressed by cooldown, ${failures} tenant failure(s)`);
    }
  }
}
