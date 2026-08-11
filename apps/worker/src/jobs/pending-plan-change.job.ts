// apps/worker/src/jobs/pending-plan-change.job.ts · the day a scheduled downgrade actually happens (PC-56 TENANT-1d-2).
//
// **0126 CREATED THE POINTER AND NOTHING EVER FOLLOWED IT.** The migration added `pending_plan_id`,
// `pending_effective_date`, `pending_price_minor`, `pending_reason` and an index whose own comment reads "the worker's
// sweep: which subscriptions have a change due today". There was no worker. So a downgrade a tenant was SHOWN a date for
// ("Downgrade takes effect 01 Aug") would have sat on the row for ever — still on Growth in October, still charged Growth's
// price, with a console cheerfully repeating the August date.
//
// That is the "status column recording an act no code performs" shape again, and it is worse here than usual because the
// tenant was given a date and a price.
//
// **THIS IS A WORKER JOB, NOT AN api-SIDE ONE, BECAUSE THE api-SIDE JOBS DO NOT RUN.** `apps/api/src/modules/tenancy/jobs/`
// holds four classes — trial expiry, grace period, renewal invoices, usage alerts — and none of them is registered
// anywhere: this runtime deliberately takes only pg-native jobs (see WORKER-RUNTIME.md "Deferred: domain-handler jobs").
// Writing a fifth unregistered class would have produced a scheduled downgrade that still never applied, which is exactly
// the defect being fixed. The trade is real and stated: this job speaks SQL rather than reusing the repository.
import { Job, JobCtx } from './index';

/** Subscriptions per tick. Bounded so a backlog cannot hold the leader lock. */
const CLAIM_LIMIT = 200;

export const pendingPlanChangeJob: Job = {
  name: 'pending-plan-change',
  // Hourly. The unit of a scheduled change is a DAY, so a few minutes' latency on the first of the month is invisible to
  // the tenant, while a per-minute sweep would run 1,440 times a day to do nothing 1,439 of them.
  intervalSec: 3600,

  async run({ client, metrics }: JobCtx): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);

    // The partial index 0126 created is exactly this predicate, so the scan costs nothing on the 99.9% of subscriptions
    // with nothing scheduled.
    const due = await client.query<{ id: string; tenant_id: string; pending_plan_id: string; price: string; eff: string }>(
      `SELECT id, tenant_id, pending_plan_id, pending_price_minor::text AS price,
              pending_effective_date::text AS eff
         FROM subscriptions
        WHERE pending_plan_id IS NOT NULL
          AND pending_effective_date <= $1::date
          AND deleted_at IS NULL
        ORDER BY pending_effective_date
        LIMIT $2`, [today, CLAIM_LIMIT]);

    let applied = 0; let failed = 0;

    for (const d of due.rows) {
      try {
        await client.query('BEGIN');

        // **THE MOVE AND THE CLEARING ARE ONE STATEMENT.** If the plan moved and the pointer survived, the next tick would
        // apply it again and stamp a second audit row telling the tenant it happened twice. If the pointer cleared and the
        // plan did not move, the downgrade is lost silently — the failure a tenant finds in their next invoice. And
        // `pending_plan_id IS NOT NULL` in the WHERE is what makes two overlapping ticks safe: the loser updates nothing.
        const moved = await client.query(
          `UPDATE subscriptions
              SET plan_id = pending_plan_id,
                  price_minor = pending_price_minor,
                  pending_plan_id = NULL, pending_price_minor = NULL,
                  pending_effective_date = NULL, pending_reason = NULL,
                  updated_at = now()
            WHERE id = $1 AND pending_plan_id IS NOT NULL AND pending_effective_date <= $2::date`,
          [d.id, today]);

        if ((moved.rowCount ?? 0) === 0) { await client.query('ROLLBACK'); continue; }

        // The change row stops being "waiting" and becomes "applied, on this date". Scoped to `applied_at IS NULL` so a
        // re-run cannot re-stamp it, and to `downgrade` because an upgrade was stamped applied when it was invoiced.
        await client.query(
          `UPDATE subscription_plan_changes
              SET applied_at = now()
            WHERE tenant_id = $1 AND subscription_id = $2 AND applied_at IS NULL AND direction = 'downgrade'`,
          [d.tenant_id, d.id]);

        // Law 4: the audit row is inside the same transaction as the act. `actor_user_id` is NULL and `actor_role` is
        // 'system' — the honest answer, because nobody was at a keyboard. The tenant's own decision is in the earlier
        // `subscription.plan_change_scheduled` row, with the reason they were shown.
        await client.query(
          `INSERT INTO audit_log (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, old_value, new_value, reason)
           VALUES ($1, NULL, 'system', 'subscription.plan_change_applied', 'subscription', $2, $3::jsonb, $4::jsonb, $5)`,
          [d.tenant_id, d.id,
            JSON.stringify({ pendingPlanId: d.pending_plan_id, effectiveDate: d.eff }),
            JSON.stringify({ planId: d.pending_plan_id, priceMinor: d.price }),
            'scheduled plan change reached its effective date']);

        // **THE TENANT IS TOLD.** A plan whose capabilities change overnight is how an FPO discovers on Monday morning that
        // auctions are gone. The event is the notification plane's input; this job sends nothing itself and claims nothing
        // about delivery.
        await client.query(
          `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1,'subscription',$2,'tenancy.plan_change_applied',$3::jsonb)`,
          [d.tenant_id, d.id, JSON.stringify({
            v: 1, subscriptionId: d.id, tenantId: d.tenant_id, planId: d.pending_plan_id,
            priceMinor: d.price, effectiveDate: d.eff,
            dedupeKey: `plan_change_applied:${d.id}:${d.eff}`,
          })]);

        await client.query('COMMIT');
        applied++;
      } catch {
        // One tenant's failure must not strand the other 199 (Law 12). Counted for the metric, never rethrown: the sweep
        // runs again in an hour, and the pointer is still there because the transaction rolled back.
        await client.query('ROLLBACK').catch(() => undefined);
        failed++;
      }
    }

    metrics.inc('worker_plan_changes_applied_total', undefined, applied);
    // A non-zero value here means a scheduled downgrade did NOT happen on the day the tenant was told it would.
    metrics.inc('worker_plan_changes_failed_total', undefined, failed);
  },
};
