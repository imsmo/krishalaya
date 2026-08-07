// modules/ai-governance/jobs/moderation-notice-delivery.cadence-job.ts · DELIVERS a moderation decision notice to the
// farmer and to the reporter (PC-56 ADMIN-5f).
//
// **WITHOUT THIS JOB THE WAVE WOULD HAVE SHIPPED ITS OWN DEFECT.** ADMIN-5f exists because handling a report as
// `removed` wrote a status column and emitted an event nothing consumed — a record of an act no code performed. A
// notice table that admin-api fills with `queued` rows and nothing ever settles is the same shape: W089's second
// principle ("every action explains itself in the farmer's language, with the appeal path") would be a row, not a
// message. The precedent is ADMIN-2d, which built its executor in the same wave that added its queue, and it was
// right to.
//
// WHERE IT LIVES IS THE DECISION, and the reasoning is 0101's verbatim:
//   • THE pg-ONLY apps/worker CANNOT DO IT. `NotificationService.fanout` resolves a template, applies per-user channel
//     preferences and quiet hours, and dispatches through the notifier gateway. That is module business logic and
//     apps/worker is pg-native by contract; `core/jobs/jobs.runner.ts` exists for exactly this case.
//   • IT IS NOT AN OUTBOX HANDLER. The outbox is an EVENT log where every row means "this already happened". A notice
//     admin-api has just queued has NOT happened. A command in the event log changes what that log means for every
//     module consuming it, and a handler that refused would mark the event `failed` in a table the admin realm never
//     reads — so the operator would assume the farmer was told.
//   • NO CROSS-REALM CREDENTIAL EXISTS OR IS CREATED. admin-api writes a row and reads a status; this job never holds
//     an admin token. The two realms communicate through a table, which is the only thing they already share.
//
// FOUR PROPERTIES, EACH DELIBERATE AND EACH COPIED FROM THE REPLY EXECUTOR BECAUSE IT EARNED THEM:
//   1. CLAIM-THEN-SETTLE, ONE ROW PER TRANSACTION. `FOR UPDATE SKIP LOCKED`, so one farmer's undeliverable notice can
//      never roll back another farmer's delivered one.
//   2. THE STATUS IS THE TRUTH. A row becomes `delivered` only after the spine has written its per-recipient
//      notifications IN THE SAME TRANSACTION. A refusal records WHY, so an operator learns instead of watching a row
//      sit still.
//   3. IDEMPOTENT. The notice's own key is passed down and the claim moves the row out of `queued` inside the
//      delivering transaction, so a crash mid-delivery cannot double-notify.
//   4. BOUNDED RETRIES. `attempts` is incremented on every try, whatever the outcome, and a row that has failed
//      MAX_ATTEMPTS times is left `failed` for a human. A notice that retries for ever is a loop nobody watches.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { TxContext } from '../../../core/database/unit-of-work';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { NotificationService } from '../../communication/services/notification.service';

/** Catalogued and templated by migration 0112 — NOT by db/seeds. `fanout` is fail-closed on an unknown event code, and
 *  `dispatchOne` renders an EMPTY BODY when no template row matches: a farmer would get a real notification from
 *  Krishalaya containing nothing while the row said `delivered`. A seed can be skipped; a migration cannot. */
export const MODERATION_NOTICE_EVENT = 'moderation.decision_notice';

/** Notices examined per tick. Bounded so a backlog cannot hold the advisory lock for minutes. */
const CLAIM_LIMIT = 25;
export const MAX_ATTEMPTS = 5;

@Injectable()
export class ModerationNoticeDeliveryCadenceJob implements ScheduledJob {
  readonly name = 'moderation-notice-delivery';
  /** A minute. A farmer whose listing has been stopped is not waiting on a reporting cadence — W090's whole argument
   *  is that the produce underneath is priced by the hour. */
  readonly intervalMs = 60_000;

  private readonly log = new Logger(ModerationNoticeDeliveryCadenceJob.name);

  constructor(
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly notifications: NotificationService,
  ) {}

  /** `pool` is the runner's shared kv_relay (BYPASSRLS) pool — this scan is cross-tenant by nature. The advisory lock
   *  is taken by ScheduledJobsRunner around this call, so two pods never run the same tick. */
  async run(pool: Pool): Promise<void> {
    // Oldest first: a seller must not wait behind newer traffic. Ids only; each notice then gets its own transaction.
    const queued = await pool.query(
      `SELECT id FROM moderation_action_notices
        WHERE status IN ('queued', 'failed') AND deleted_at IS NULL AND attempts < $2
        ORDER BY queued_at
        LIMIT $1`, [CLAIM_LIMIT, MAX_ATTEMPTS]);

    let delivered = 0; let refused = 0; let failed = 0;

    for (const row of queued.rows as Array<{ id: string }>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // CLAIM. SKIP LOCKED so a second pod moves on rather than waiting, and the status re-check inside the lock
        // means a row settled since the scan is simply skipped.
        const claim = await client.query(
          `SELECT id, tenant_id, order_id, report_id, recipient_kind, recipient_user_id,
                  body, language_code, appeal_path, idempotency_key, attempts
             FROM moderation_action_notices
            WHERE id = $1 AND status IN ('queued', 'failed') AND deleted_at IS NULL
            FOR UPDATE SKIP LOCKED`, [row.id]);
        const n = claim.rows[0] as Record<string, any> | undefined;
        if (!n) { await client.query('ROLLBACK'); continue; }

        // Every attempt is counted whatever the outcome — otherwise a row failing in a way that escapes the catch
        // below would retry for ever.
        await client.query(
          `UPDATE moderation_action_notices SET attempts = attempts + 1, updated_at = now() WHERE id = $1`, [n.id]);

        // ---- REFUSALS: recorded with the reason, never left queued ----
        // A system-filed report has no reporter, and a listing can have no seller recorded. Both are real states and
        // both must read as "there was nobody to tell" rather than as a delivery.
        if (!n.recipient_user_id) {
          await this.settle(client, n.id, 'refused',
            n.recipient_kind === 'reporter'
              ? 'the report has no reporter recorded (system-filed), so there is nobody to notify'
              : 'the listing has no seller recorded, so there is nobody to notify');
          refused += 1;
          await client.query('COMMIT');
          continue;
        }

        // ---- DELIVER through the REAL spine, in THIS transaction ----
        // Running fanout inside the claim's transaction is what makes the delivery and the status change atomic: there
        // is no window in which the farmer has been notified while the row still says queued. `app.tenant_id` is set
        // first because the spine's own writes go through RLS-scoped tables.
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [n.tenant_id]);
        const tx: TxContext = {
          query: (sql, params) => client.query(sql, params as any) as any,
          tenantId: n.tenant_id,
          userId: 'system',
        };
        await this.notifications.fanout(tx, {
          tenantId: n.tenant_id,
          eventCode: MODERATION_NOTICE_EVENT,
          recipients: [n.recipient_user_id],
          languageCode: n.language_code,
          payload: {
            // The operator's words, verbatim, with the appeal path appended rather than woven in — W089 promises the
            // appeal path "in one tap", and a template that buried it in prose could not be relied on to carry it.
            body: `${n.body}\n\n${n.appeal_path}`,
            appealPath: n.appeal_path,
          },
          // The spine derives a deterministic notification id from this, so a relay retry dedupes at the
          // gateway rather than double-notifying somebody about their own listing.
          dedupeKey: n.idempotency_key,
        });

        await this.settle(client, n.id, 'delivered', null);
        delivered += 1;
        await client.query('COMMIT');
      } catch (e) {
        // The attempt count was incremented inside the rolled-back transaction, so it is re-applied here on its own —
        // otherwise a row that always throws would be retried for ever with attempts stuck at its old value.
        try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
        try {
          await client.query(
            `UPDATE moderation_action_notices
                SET attempts = attempts + 1,
                    status = CASE WHEN attempts + 1 >= $2 THEN 'failed' ELSE status END,
                    settled_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE settled_at END,
                    detail = $3, updated_at = now()
              WHERE id = $1`,
            [row.id, MAX_ATTEMPTS, (e instanceof Error ? e.message : 'delivery failed').slice(0, 500)]);
        } catch { /* the row stays queued and the next tick retries it */ }
        failed += 1;
        this.log.warn(`moderation notice ${row.id} delivery failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        client.release();
      }
    }

    if (delivered) this.metrics.inc('moderation.notice.delivered', { n: String(delivered) });
    if (refused) this.metrics.inc('moderation.notice.refused', { n: String(refused) });
    if (failed) this.metrics.inc('moderation.notice.failed', { n: String(failed) });
  }

  /** `ck_man_detail` refuses a non-delivering status with no reason and `ck_man_settled` requires a settle time on
   *  anything that is not queued, so this one statement is the only shape the database accepts. */
  private async settle(client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, id: string, status: 'delivered' | 'refused', detail: string | null): Promise<void> {
    await client.query(
      `UPDATE moderation_action_notices
          SET status = $2, detail = $3, settled_at = now(),
              notification_event_code = CASE WHEN $2 = 'delivered' THEN $4 ELSE notification_event_code END,
              updated_at = now()
        WHERE id = $1`,
      [id, status, detail, MODERATION_NOTICE_EVENT]);
  }
}
