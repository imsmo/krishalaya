// modules/disputes/jobs/disputes.cadence-jobs.ts · PC-56 HOTFIX-7 · B23 (survey STORE-5 C-6 / F-10) — THE TWO DISPUTE CLOCKS, ACTUALLY SCHEDULED.
//
// `SellerResponseTimeoutJob` (the respondent's 48 h, `disputes.seller_respond_by`) and `SlaEscalationJob` (the platform's 7-day SLA,
// `disputes.sla_due_at`) were written and registered NOWHERE: the deadlines were stored and never acted on. Read before registering (the brief's
// rule): neither moves money (each flips a dispute's status and writes ONE outbox event in the same transaction) and neither sends a notice
// (`disputes.dispute_under_review` has no consumer; `disputes.dispute_escalated` is consumed by the support module, which opens a P1 ticket —
// idempotent per dispute — no notification template is involved). Both are bounded (200 per tick), claim with FOR UPDATE SKIP LOCKED and are
// idempotent by their status guard (a moved dispute no longer matches), so a second tick changes nothing. They run on the runner's kv_relay pool
// (cross-tenant; kv_relay holds UPDATE on disputes and INSERT on outbox_events). The interval is the registry's table
// (core/jobs/clock-cadence.ts), never a literal here; the runner holds an advisory lock per job name.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { SellerResponseTimeoutJob } from './seller-response-timeout.job';
import { SlaEscalationJob } from './sla-escalation.job';

export const DISPUTE_SELLER_RESPONSE_TIMEOUT_JOB = 'dispute-seller-response-timeout';
export const DISPUTE_SLA_ESCALATION_JOB = 'dispute-sla-escalation';

export class DisputeSellerResponseTimeoutClock implements ScheduledJob {
  readonly name = DISPUTE_SELLER_RESPONSE_TIMEOUT_JOB;
  private readonly log = new Logger(DisputeSellerResponseTimeoutClock.name);
  constructor(readonly intervalMs: number) {}
  async tick(pool: Pool): Promise<{ advanced: number }> { return new SellerResponseTimeoutJob(pool).run(); }
  async run(pool: Pool): Promise<void> {
    const r = await this.tick(pool);
    if (r.advanced > 0) this.log.log(`${this.name}: ${r.advanced} dispute(s) past the respondent's window moved to under_review`);
  }
}

export class DisputeSlaEscalationClock implements ScheduledJob {
  readonly name = DISPUTE_SLA_ESCALATION_JOB;
  private readonly log = new Logger(DisputeSlaEscalationClock.name);
  constructor(readonly intervalMs: number) {}
  async tick(pool: Pool): Promise<{ escalated: number }> { return new SlaEscalationJob(pool).run(); }
  async run(pool: Pool): Promise<void> {
    const r = await this.tick(pool);
    if (r.escalated > 0) this.log.log(`${this.name}: ${r.escalated} dispute(s) past the SLA escalated`);
  }
}
