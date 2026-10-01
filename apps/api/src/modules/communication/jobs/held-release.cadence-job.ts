// modules/communication/jobs/held-release.cadence-job.ts · PC-56 TENANT-8b · THE MORNING HALF OF QUIET HOURS (F-4).
//
// W432: *"During quiet hours … those items sit at queued in the outbox and appear the moment the window opens; nothing
// was silently dropped."* Before this wave that sentence was false twice over: a quiet-hours channel was a metric
// increment (no row), and nothing anywhere would have sent it later. The fan-out now writes the channel as a HELD row
// (`suppressed`, `suppressed_reason = quiet_hours`, `held_until` = the end of the member's window), and this job is what
// makes "held" mean held rather than dropped.
//
// WHERE IT LIVES, AND THE FOUR PROPERTIES (copied from the moderation-notice executor, ADMIN-5f, because it earned them):
//   • apps/api's ScheduledJobsRunner (6c-1's pattern), not apps/worker: releasing a row re-runs module business logic —
//     template resolution in the reader's language, the address and device checks, the notifier — that the pg-only
//     worker cannot import.
//   1. CLAIM-THEN-SETTLE, ONE ROW PER TRANSACTION, `FOR UPDATE SKIP LOCKED` (a second pod moves on), with the hold
//      re-checked inside the lock — one member's failed release never rolls back another's.
//   2. THE ROW IS THE TRUTH. `suppressed → queued → sent | failed` in the claiming transaction, with `released_at`; the
//      reason stays `quiet_hours` so W434 draws "held → released → sent". Re-asked at release (`releaseDecision`): opted
//      out overnight → never sent; the window widened → held again.
//   3. IDEMPOTENT. The row id is the same deterministic id the fan-out derived (the gateway dedups on it), and the claim
//      moves the row out of `suppressed` in the delivering transaction, so a crash cannot double-send.
//   4. BOUNDED, CHUNKED, PRUNED. At most CLAIM_LIMIT rows a tick, oldest hold first, scanned only within
//      HOLD_LOOKBACK_DAYS of `created_at` (Law 8 — two monthly partitions).
//
// ITS EMERGENCY STOP is `notification.held_release_kill_switch` (0121's kill_switch tier: ON = stop). Fired, nothing is
// released and nothing is lost — the rows wait, and the bell and W434 say "held — the release is switched off".
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { TxContext } from '../../../core/database/unit-of-work';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { NotificationService, ReleaseOutcome } from '../services/notification.service';
import { NotificationRepository } from '../repositories/notification.repository';

/** Rows examined per tick: a village's held pushes at 06:00 are ~100; the next tick (a minute later) takes the rest. */
export const CLAIM_LIMIT = 200;
/** A minute: W432 promises the items "appear the moment the window opens". */
export const HELD_RELEASE_TICK_MS = 60_000;

export interface ReleaseTally { examined: number; sent: number; failed: number; reheld: number; optedOut: number; skipped: number; errors: number; stopped: boolean }

@Injectable()
export class HeldReleaseCadenceJob implements ScheduledJob {
  readonly name = 'notification-held-release';
  readonly intervalMs = HELD_RELEASE_TICK_MS;
  private readonly log = new Logger(HeldReleaseCadenceJob.name);

  constructor(
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly notifications: NotificationService,
    private readonly repo: NotificationRepository,
  ) {}

  /** `pool` is the runner's shared kv_relay (BYPASSRLS) pool — the scan is cross-tenant by nature; each row then gets
   *  its own transaction with `app.tenant_id` set to the row's tenant before the spine touches anything. */
  async run(pool: Pool, now: Date = new Date()): Promise<void> { await this.tick(pool, now); }

  async tick(pool: Pool, now: Date = new Date()): Promise<ReleaseTally> {
    const t: ReleaseTally = { examined: 0, sent: 0, failed: 0, reheld: 0, optedOut: 0, skipped: 0, errors: 0, stopped: false };
    if (await this.notifications.releaseStopped()) { t.stopped = true; return t; }
    const due = await this.repo.heldDue(pool, now, CLAIM_LIMIT);
    for (const d of due) {
      t.examined += 1;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [d.tenantId ?? '']);
        const tx: TxContext = { query: (sql, params) => client.query(sql, params as unknown[]) as never, tenantId: d.tenantId ?? '', userId: 'system' };
        const n = await this.repo.claimHeld(tx, d.id, d.createdAt, now);
        if (!n) { t.skipped += 1; await client.query('ROLLBACK'); continue; }   // released by another pod, or no longer due
        const outcome: ReleaseOutcome = await this.notifications.releaseHeld(tx, n);
        await client.query('COMMIT');
        if (outcome === 'sent') t.sent += 1; else if (outcome === 'failed') t.failed += 1; else if (outcome === 'reheld') t.reheld += 1; else t.optedOut += 1;
      } catch (e) {
        t.errors += 1;
        await client.query('ROLLBACK').catch(() => undefined);
        // The row stays held and the next tick re-asks it; the error is logged, never swallowed silently.
        this.log.warn(`held notification ${d.id} release failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        client.release();
      }
    }
    if (t.examined > 0) {
      this.metrics.inc('comm.held_release.tick', { sent: String(t.sent), failed: String(t.failed), errors: String(t.errors) });
      this.log.log(`notification-held-release: ${t.sent} sent, ${t.failed} failed at release, ${t.reheld} held again, ${t.optedOut} opted out overnight, ${t.skipped} skipped, ${t.errors} error(s)`);
    }
    return t;
  }
}
