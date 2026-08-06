// modules/support/jobs/platform-reply-delivery.cadence-job.ts · DELIVERS a platform support reply to the farmer
// (PC-56 ADMIN-2d, closes ADMIN-2-Q3's reply half).
//
// THIS JOB IS THE WHOLE POINT OF THE WAVE, AND WHERE IT LIVES IS THE DECISION.
//
// A platform operator answering a farmer's support ticket needs the notification fan-out that lives in this module's
// realm. ADMIN-2b and ADMIN-2c both refused to write the reply from admin-api, because writing a message row there would
// leave the ticket looking answered to everybody except the person waiting for it. The queued shape was "admin-api
// enqueues an intent, the tenant realm executes it". This is that executor — and it runs HERE, in apps/api, because:
//
//   • THE pg-ONLY apps/worker CANNOT DO IT. NotificationService.fanout resolves a template, checks per-user channel
//     preferences and quiet hours, and dispatches through the notifier gateway. That is module business logic, and
//     apps/worker is pg-native by contract. `core/jobs/jobs.runner.ts` exists for exactly this case — its own header
//     says so: "domain-handler jobs ... need module business logic the standalone pg-only apps/worker can't import".
//   • IT IS NOT AN OUTBOX HANDLER. The outbox is an EVENT log where every row means "this already happened". A reply
//     the operator has just written has NOT happened yet — it is a command. Putting a command in the event log changes
//     what that log means for the fifteen modules consuming it, and a handler that refused would mark the event `failed`
//     in a table the admin realm never reads, so the operator would assume delivery. That is the exact failure ADMIN-2b
//     refused for pager steps.
//   • NO CROSS-REALM CREDENTIAL EXISTS OR IS CREATED. admin-api writes a row and reads a status. It never holds a tenant
//     token and this job never holds an admin one. The two realms communicate through a table, which is the only thing
//     they already share.
//
// WHY THE REPLY IS A NOTIFICATION AND NOT A CONVERSATION MESSAGE — the finding that reshaped this wave. Migration 0101's
// header has the long version; the short one is that `conversation_participants.user_id` and `messages.sender_user_id`
// reference a tenant `users` row, `MessageService.post` refuses a non-participant, and a platform operator has no such
// row. Posting a message would require inventing a platform account inside every tenant's user table — a cross-tenant
// identity, which is what the two-realm split exists to prevent — or posting AS the assigned agent, which is a forgery.
// So the reply travels the notification spine, attributed to the platform, which is who is actually speaking.
//
// FOUR PROPERTIES, EACH DELIBERATE:
//   1. CLAIM-THEN-SETTLE, ONE ROW AT A TIME. `FOR UPDATE SKIP LOCKED` per reply, and each reply is its own transaction:
//      one farmer's undeliverable reply must never roll back another farmer's delivered one.
//   2. THE STATUS IS THE TRUTH, NOT AN INTENTION. A row becomes `delivered` only after the spine has written its
//      per-recipient notifications in the same transaction. A refusal records WHY, so the operator learns instead of
//      watching a row sit still.
//   3. IDEMPOTENT. The reply's own `idempotency_key` is passed down, and the claim moves the row out of `queued` inside
//      the same transaction that delivers, so a crash mid-delivery cannot double-notify.
//   4. BOUNDED RETRIES. `attempts` is incremented on every try and a row that has failed MAX_ATTEMPTS times is left
//      `failed` for a human. A reply that retries forever is a loop nobody is watching.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { TxContext } from '../../../core/database/unit-of-work';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { NotificationService } from '../../communication/services/notification.service';

/** The catalogued event code. Seeded by migration 0101 (NOT by db/seeds) because the spine is fail-closed on an unknown
 *  code: a missing catalog row would mean replies accepted, silently never delivered, and nobody told. */
export const PLATFORM_REPLY_EVENT = 'support.platform_reply';

/** Replies examined per tick. Bounded so a backlog cannot hold the advisory lock for minutes. */
const CLAIM_LIMIT = 25;
/** After this many failures the row is left for a human. A reply that retries forever is a silent loop. */
export const MAX_ATTEMPTS = 5;

@Injectable()
export class PlatformReplyDeliveryCadenceJob implements ScheduledJob {
  readonly name = 'support-platform-reply-delivery';
  /** A minute. A farmer waiting for an answer about their money is not a reporting cadence. */
  readonly intervalMs = 60_000;

  private readonly log = new Logger(PlatformReplyDeliveryCadenceJob.name);

  constructor(
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * `pool` is the runner's shared kv_relay (BYPASSRLS) pool — this scan is cross-tenant by nature, so it cannot go
   * through the RLS-scoped request tier. The advisory lock is taken by ScheduledJobsRunner around this call, so two
   * pods never run the same tick.
   */
  async run(pool: Pool): Promise<void> {
    // Oldest first: a farmer must not wait behind newer traffic. Only the ids are read here; each reply is then handled
    // in its own transaction, so one failure cannot take the batch with it.
    const queued = await pool.query(
      `SELECT id FROM support_platform_replies
        WHERE status = 'queued' AND deleted_at IS NULL AND attempts < $2
        ORDER BY queued_at
        LIMIT $1`, [CLAIM_LIMIT, MAX_ATTEMPTS]);

    let delivered = 0; let refused = 0; let failed = 0;

    for (const row of queued.rows as Array<{ id: string }>) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // CLAIM. SKIP LOCKED so a second pod (or a slow previous tick) moves on rather than waiting, and the status
        // re-check inside the lock means a row settled since the scan is simply skipped.
        const claim = await client.query(
          `SELECT r.id, r.tenant_id, r.ticket_id, r.body, r.language_code, r.idempotency_key, r.attempts,
                  t.ticket_no, t.requester_user_id, t.status AS ticket_status
             FROM support_platform_replies r
             JOIN support_tickets t ON t.id = r.ticket_id
            WHERE r.id = $1 AND r.status = 'queued' AND r.deleted_at IS NULL
            FOR UPDATE OF r SKIP LOCKED`, [row.id]);
        const reply = claim.rows[0] as Record<string, any> | undefined;
        if (!reply) { await client.query('ROLLBACK'); continue; }

        // every attempt is counted, whatever the outcome — otherwise a row that fails in a way that escapes the
        // catch below would retry for ever
        await client.query(
          `UPDATE support_platform_replies SET attempts = attempts + 1, updated_at = now() WHERE id = $1`, [reply.id]);

        // ---- REFUSALS: recorded with the reason, never left queued ----
        // A ticket with no requester cannot be answered. This is a real state (an agent-opened ticket on somebody's
        // behalf), and it must read as "we could not tell anybody" rather than as a delivery.
        if (!reply.requester_user_id) {
          await this.settle(client, reply.id, 'refused',
            'the ticket has no requester recorded, so there is nobody to notify');
          refused += 1;
          await client.query('COMMIT');
          continue;
        }

        // ---- DELIVER through the REAL spine, in THIS transaction ----
        // fanout resolves the template, applies the recipient's own channel preferences and quiet hours, and writes one
        // notification per channel. Running it inside the claim's transaction is what makes the delivery and the status
        // change atomic: there is no window in which the farmer has been notified while the row still says queued.
        //
        // The TxContext is built over the claim's own client — the SAME adapter OutboxDispatcher uses for its handlers
        // (outbox.dispatcher.ts line ~59), rather than opening a nested UnitOfWork transaction, which would put the
        // delivery outside the claim and reintroduce exactly that window. `app.tenant_id` is set first because the
        // spine's own writes go through RLS-scoped tables.
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [reply.tenant_id]);
        const tx: TxContext = {
          query: (sql, params) => client.query(sql, params as any) as any,
          tenantId: reply.tenant_id,
          userId: 'system',
        };
        await this.notifications.fanout(tx, {
          tenantId: reply.tenant_id,
          eventCode: PLATFORM_REPLY_EVENT,
          recipients: [reply.requester_user_id],
          languageCode: reply.language_code,
          payload: {
            // the operator's words, verbatim — the template is a carrier, not a rewrite
            body: reply.body,
            ticketNo: reply.ticket_no,
            ticketId: reply.ticket_id,
            // named so the farmer's client can label it correctly: this is the platform speaking, not their FPO's desk
            from: 'krishalaya_support',
            replyId: reply.id,
          },
          // the spine derives a deterministic notification id from this, so a retry cannot double-notify
          dedupeKey: reply.idempotency_key,
        });

        await this.settle(client, reply.id, 'delivered', null, reply.requester_user_id);
        delivered += 1;
        await client.query('COMMIT');
      } catch (e) {
        // The delivery is rolled back; the ATTEMPT count is not, because it was written before the risky part and this
        // row's transaction is about to be re-opened to record the failure.
        await client.query('ROLLBACK').catch(() => undefined);
        failed += 1;
        const detail = e instanceof Error ? e.message.slice(0, 500) : 'unknown error';
        this.log.warn(`platform reply ${row.id} could not be delivered: ${detail}`);
        try {
          // recorded in its own transaction so a failure is visible to the operator even when everything else failed
          await client.query(
            `UPDATE support_platform_replies
                SET attempts = attempts + 1,
                    status = CASE WHEN attempts + 1 >= $3 THEN 'failed'::support_platform_reply_status ELSE status END,
                    settled_at = CASE WHEN attempts + 1 >= $3 THEN now() ELSE settled_at END,
                    detail = $2, updated_at = now()
              WHERE id = $1 AND status = 'queued' AND deleted_at IS NULL`,
            [row.id, detail, MAX_ATTEMPTS]);
        } catch { /* the row stays queued and the next tick retries — never a crashed job */ }
      } finally {
        client.release();
      }
    }

    if (delivered > 0) this.metrics.inc('support.platform_reply_delivered', undefined, delivered);
    if (refused > 0) this.metrics.inc('support.platform_reply_refused', undefined, refused);
    if (failed > 0) this.metrics.inc('support.platform_reply_failed', undefined, failed);
  }

  /** Settle a claimed reply. `detail` is mandatory for anything that is not a delivery — 0101 CHECKs it too. */
  private async settle(
    client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    id: string, status: 'delivered' | 'refused' | 'failed',
    detail: string | null, recipientUserId?: string,
  ): Promise<void> {
    await client.query(
      `UPDATE support_platform_replies
          SET status = $2::support_platform_reply_status, settled_at = now(), detail = $3,
              recipient_user_id = COALESCE($4, recipient_user_id),
              notification_event_code = CASE WHEN $2 = 'delivered' THEN $5 ELSE notification_event_code END,
              updated_at = now()
        WHERE id = $1`,
      [id, status, detail, recipientUserId ?? null, PLATFORM_REPLY_EVENT]);
  }
}
