// modules/identity/jobs/kyc-expiry-reminders.cadence-job.ts
// KV-BL-P0-9-follow-on — wraps the existing (previously-unwired) KycExpiryRemindersJob as a
// `ScheduledJob` so `core/jobs/jobs.runner.ts` can run it on a nightly cadence inside apps/api,
// mirroring `SettlementStatementsCadenceJob` (modules/payments/jobs/settlement-statements.cadence-job.ts).
// See `kyc-expiry-reminders.job.ts` for the job itself — unchanged, this class only wires it in.
//
// THE CROSS-TENANT DRIVER LOOP (wave-1 flagged this as the blocker: "needs a cross-tenant driver loop
// that doesn't exist yet"): unlike SettlementStatementsJob, which scans every tenant's un-statemented
// lines in ONE query against the runner's shared BYPASSRLS pool, KycExpiryRemindersJob.runForTenant
// is RLS-scoped PER TENANT — it goes through UnitOfWork.run(tenantId, ...), which sets app.tenant_id
// as a local GUC and routes to that tenant's shard writer pool (see core/database/unit-of-work.pg.ts).
// There is no single cross-tenant SQL query that can do this job's work. So this driver:
//   1. enumerates every live tenant (status trial|active|grace, not soft-deleted) from the runner's
//      kv_relay (BYPASSRLS) pool — the only pool this class ever touches directly, purely to LIST
//      tenant ids (tenants itself carries no tenant_id column, so BYPASSRLS is just the pool this
//      runner happens to hold, not a security-relevant escalation);
//   2. calls KycExpiryRemindersJob.runForTenant(tenantId, days) once per tenant, via its own
//      DI-injected UnitOfWork/OutboxWriter (unrelated to the pool param — same as any other
//      request-path caller of this job would);
//   3. isolates one tenant's failure from the rest (same isolation guarantee ScheduledJobsRunner
//      gives one JOB relative to another — this extends it to one TENANT relative to another within
//      a single job's tick).
//
// [PC-56 TENANT-9a] The claim this header used to make — that the bank-KYC gate "BLOCKS payout/bank-account flows on
// expiry" — was FALSE until 0180 (F-3: `expired` was written by nothing). It is true now: `KycDocumentExpiryCadenceJob`
// writes `expired` and re-derives the roles, and the payout gate reads validity itself (`kyc_role_effective_status`).
// WHY THIS IS PILOT-RELEVANT (not GA-deferred): the money gate closes on expiry —
// without this reminder job, a seller's KYC silently lapses with no nudge until a gated action fails
// outright. The domain logic already existed (KycExpiryRemindersJob, idempotent per due-document via
// the outbox) and was simply never scheduled.
import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { KycExpiryRemindersJob } from './kyc-expiry-reminders.job';

/** Non-terminal tenant lifecycle states (mirrors TenantSlugResolver's live-tenant check). */
const LIVE_TENANT_STATUSES_SQL = `('trial','active','grace')`;

@Injectable()
export class KycExpiryRemindersCadenceJob implements ScheduledJob {
  readonly name = 'kyc-expiry-reminders';
  private readonly log = new Logger(KycExpiryRemindersCadenceJob.name);

  constructor(
    readonly intervalMs: number,
    private readonly job: KycExpiryRemindersJob,
    private readonly reminderWindowDays = 30,
  ) {}

  /** `pool` is the runner's shared kv_relay (BYPASSRLS) pool — used ONLY to list live tenant ids;
   *  the actual per-tenant reminder work goes through KycExpiryRemindersJob's own DI-injected
   *  UnitOfWork (tenant-shard-routed, RLS-scoped), exactly as any other caller would drive it. */
  async run(pool: Pool): Promise<void> {
    const tenants = await pool.query<{ id: string }>(
      `SELECT id FROM tenants WHERE status IN ${LIVE_TENANT_STATUSES_SQL} AND deleted_at IS NULL`);
    let queued = 0;
    let failedTenants = 0;
    for (const t of tenants.rows) {
      try {
        queued += await this.job.runForTenant(t.id, this.reminderWindowDays);
      } catch (err) {
        // One tenant's failure must never stop the rest of the cycle (same isolation guarantee the
        // runner gives across DIFFERENT jobs — this applies it across tenants WITHIN this one job).
        failedTenants++;
        this.log.error(`kyc-expiry-reminders failed for tenant ${t.id}: ${(err as Error)?.message ?? String(err)}`);
      }
    }
    this.log.log(`kyc-expiry-reminders cycle: tenants=${tenants.rows.length} queued=${queued} failedTenants=${failedTenants}`);
  }
}
