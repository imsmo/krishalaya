// modules/requirements/jobs/match-notifications.job.ts · PC-56 TENANT-11d · F-1 / F-9 — THE NEED-BY REMINDER, ACTUALLY SCHEDULED.
//
// The periodic backstop to the event-driven ListingPublishedHandler (which nudges a buyer the moment a matching listing is
// published — the only automatic MATCHER on the platform, and it is rule-based: same product or category). This job's role is
// the reminder: a buyer whose OPEN requirement approaches its need-by and is not filled hears "your requirement is still open"
// (`requirements.requirement_reminder`, recipient = the buyer). Before this wave it was instantiated nowhere and claimed across
// tenants on the kv_relay pool. It is now registered in `SCHEDULED_JOB_REGISTRY` and, like the expiry sweep, reads only `tenants`
// as kv_relay; each tenant's claim, its reminders and the `reminded_at` stamp are ONE kv_app transaction (FOR UPDATE SKIP LOCKED,
// bounded), so a re-run never re-nudges. No AI matching exists here and none is implied.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { RequirementRepository } from '../repositories/requirement.repository';
import { RequirementService } from '../services/requirement.service';

export const MATCH_NOTIFICATIONS_JOB = 'requirements-need-by-reminder';

export class MatchNotificationsJob implements ScheduledJob {
  readonly name = MATCH_NOTIFICATIONS_JOB;
  private readonly log = new Logger(MatchNotificationsJob.name);
  constructor(readonly intervalMs: number, private readonly repo: RequirementRepository, private readonly requirements: RequirementService,
    private readonly horizonDays = 3, private readonly limit = 200) {}

  async sweep(pool: Pool, now: Date = new Date()): Promise<{ tenants: number; reminded: number; failed: number }> {
    const tenants = await this.repo.activeTenants(pool);
    let reminded = 0, failed = 0;
    for (const tenantId of tenants) {
      try { reminded += await this.requirements.remindDue(tenantId, now, this.horizonDays, this.limit); } catch { failed++; }
    }
    return { tenants: tenants.length, reminded, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.reminded > 0 || r.failed > 0) this.log.log(`${this.name}: ${r.reminded} reminder(s), ${r.failed} failed, across ${r.tenants} tenant(s)`);
  }
}
