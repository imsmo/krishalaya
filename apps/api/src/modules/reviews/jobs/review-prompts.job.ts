// modules/reviews/jobs/review-prompts.job.ts
// Worker job (kv_relay): nudges the parties of a recently-COMPLETED order/service-booking to rate their
// counterparty. Both sides of a verified transaction may review (eligibility carries buyer + seller), so
// the prompt fans out to both via the `reviews.review_prompt` outbox event (communication delivers it).
// IDEMPOTENT + BOUNDED: claims only eligibility rows not yet prompted within the window (FOR UPDATE SKIP
// LOCKED, LIMIT), emits one prompt per row, then stamps prompted_at IN THE SAME tx — so a re-run never
// re-nudges (a §4 abuse/DoS guard). NO money, NO PII in the payload.
//
// PC-56 STORE-5a · B3 (founder D3 "one invite, one reminder", survey C-4 / F-10) — THE CLOCK IS SCHEDULED AT LAST, AND IT REMINDS ONCE.
//   • It was "NOT a DI provider — apps/worker instantiates it": nothing ever did (survey C-4). It now runs through the HOTFIX-5 cadence pattern:
//     `ReviewPromptsClock` below is a provider-registered `ScheduledJob` (reviews.module.ts registers it in SCHEDULED_JOB_REGISTRY) whose interval
//     is the registry table's (`core/jobs/clock-cadence.ts` row `review-prompts`, every 60 min); the runner hands it its kv_relay pool and holds
//     an advisory lock per job name.
//   • The INVITE pass is unchanged except that a closed window (`expires_at` past) is never invited.
//   • The REMINDER pass (new): ONE `reviews.review_reminder` per eligibility, `reviews.reminder_after_days` (7) after the invite, while the
//     window is open and NO review of the order exists; `reminded_at` is stamped in the same transaction — a second tick sends none.
//   • `now` is injectable (the live spec moves the instants in the database, never the code); the settings are read on the job's own
//     transaction through `kv_platform_setting` (kv_relay holds SELECT on both settings tables since 0218).
//   • F-11 (found while building — the brief did not ask): the `reviews` flag is seeded OFF everywhere, and an unconditional clock would tell
//     every buyer of every store to "leave a review" for a feature that is switched off. The clock asks each due tenant's `reviews` flag ONCE
//     per tick (`reviewsOn`, the FlagsService — the same rule the API's guard applies) and works only in the tenants where it is ON; a row in
//     an OFF tenant is left untouched (invited later, within its window, if the store switches reviews on).
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { TxContext } from '../../../core/database/unit-of-work';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { ReviewRepository } from '../repositories/review.repository';
import { ReviewEventType } from '../domain/reviews.events';

export const REVIEW_PROMPTS_JOB = 'review-prompts';

export class ReviewPromptsJob {
  /** `reviewsOn` — the per-tenant `reviews` flag (F-11); absent = every tenant (the old behaviour, kept for a direct caller). */
  constructor(private readonly systemPool: Pool, private readonly reviews: ReviewRepository, private readonly reviewsOn?: (tenantId: string) => Promise<boolean>) {}

  /** `windowMins` bounds the invite scan to orders/bookings completed recently (default 7d); `limit` caps the
   *  per-tick fan-out of each pass. Returns how many invites and reminders were emitted. */
  async run(windowMins = 10080, limit = 200, now: Date = new Date()): Promise<{ scanned: number; prompted: number; reminded: number }> {
    const client = await this.systemPool.connect();
    try {
      await client.query('BEGIN');
      const tx: TxContext = { query: (sql, params) => client.query(sql, params as any) as any, tenantId: '', userId: 'system' };   // eslint-disable-line @typescript-eslint/no-explicit-any
      const since = new Date(now.getTime() - windowMins * 60_000);
      let tenants: string[] | null = null;
      if (this.reviewsOn) {
        tenants = [];
        for (const t of await this.reviews.dueTenants(tx, since, now)) if (await this.reviewsOn(t).catch(() => false)) tenants.push(t);   // fail closed
      }
      const due = tenants && tenants.length === 0 ? [] : await this.reviews.findDueForPrompt(tx, since, limit, now, tenants);
      for (const e of due) {
        // both parties may review the counterparty → recipientUserIds drives the notification fan-out
        await client.query(
          `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1,'order',$2,$3,$4::jsonb)`,
          [e.tenantId, e.orderId, ReviewEventType.Prompt,
           JSON.stringify({ v: 1, orderId: e.orderId, recipientUserIds: [e.buyerUserId, e.sellerUserId] })]);
      }
      await this.reviews.markPrompted(tx, due.map((d) => d.id), now);
      // STORE-5a · B3: the ONE reminder (the settings on this transaction; the named fallback when absent — logged by the repository)
      const w = await this.reviews.windows('', tx);
      const remind = tenants && tenants.length === 0 ? [] : await this.reviews.findDueForReminder(tx, now, w.reminderAfterDays, limit, tenants);
      for (const e of remind) {
        await client.query(
          `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1,'order',$2,$3,$4::jsonb)`,
          [e.tenantId, e.orderId, ReviewEventType.Reminder,
           JSON.stringify({ v: 1, orderId: e.orderId, recipientUserIds: [e.buyerUserId, e.sellerUserId] })]);
      }
      await this.reviews.markReminded(tx, remind.map((d) => d.id), now);
      await client.query('COMMIT');
      return { scanned: due.length + remind.length, prompted: due.length, reminded: remind.length };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}

/** PC-56 STORE-5a · B3: the review-prompts clock as a registered `ScheduledJob` (the disputes cadence-jobs shape): the interval is the registry
 *  table's (`cadenceOf('review-prompts')`, never a literal here); `tick` is the testable seam (the live spec passes the relay pool and a `now`). */
export class ReviewPromptsClock implements ScheduledJob {
  readonly name = REVIEW_PROMPTS_JOB;
  private readonly log = new Logger(ReviewPromptsClock.name);
  constructor(readonly intervalMs: number, private readonly reviews: ReviewRepository, private readonly reviewsOn: (tenantId: string) => Promise<boolean>) {}
  async tick(pool: Pool, now: Date = new Date()): Promise<{ scanned: number; prompted: number; reminded: number }> {
    return new ReviewPromptsJob(pool, this.reviews, this.reviewsOn).run(undefined, undefined, now);
  }
  async run(pool: Pool): Promise<void> {
    const r = await this.tick(pool);
    if (r.prompted + r.reminded > 0) this.log.log(`${this.name}: ${r.prompted} invite(s), ${r.reminded} reminder(s)`);
  }
}
