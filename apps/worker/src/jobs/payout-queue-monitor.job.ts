// apps/worker/src/jobs/payout-queue-monitor.job.ts · PC-56 PAY-9 — MONEY WAITING TOO LONG PAGES SOMEBODY.
//
// Moved here from apps/api/src/modules/payments/jobs/payout-queue-monitor.job.ts, which was written, documented in the
// payments README as a "monitoring job", and NEVER SCHEDULED by anything — so a payout stuck 'queued' (the executor is
// not draining) or 'processing' (the gateway never confirmed) rotted silently. It now runs on the worker's leader-locked
// scheduler and exports gauges that ops/alerts/payout-alerts.yml pages on.
//
// TWO CORRECTIONS OVER THE ORIGINAL, both of which would have paged falsely every day once batches exist:
//   • "queued too long" counts only payouts the executor is ALLOWED to claim — the same predicate as
//     PayoutRepository.claimQueued (unbatched and not a rides_batch purpose, or inside an approved/executing batch). A
//     payout waiting for a checker's approval is the 0114 gate working, not a stall; it already has its own gauge
//     (kv_payouts_awaiting_approval). For a batched payout the clock starts at the batch's approval, not its creation.
//   • "processing too long" is measured from when it entered processing (updated_at — set by the claim, and by every
//     later status change), not from created_at, so a payout that legitimately waited for approval is not born stuck.
// Read-only: it MOVES NO MONEY, changes no payout and writes no row. pg-native, bounded (aggregates only).
import { Job, JobCtx } from './index';

/** The executor runs every 5 minutes; three missed ticks means it is not draining. */
export const QUEUED_SLA_MINUTES = 15;
/** RazorpayX confirms by webhook within minutes; two hours without one means the webhook was lost. */
export const PROCESSING_SLA_MINUTES = 120;

export const payoutQueueMonitorJob: Job = {
  name: 'payout-queue-monitor',
  intervalSec: 300,
  async run({ client, metrics }: JobCtx) {
    const r = await client.query<{ queued_stuck: string; processing_stuck: string; oldest_claimable_mins: string }>(
      `WITH claimable AS (
         SELECT GREATEST(p.created_at, COALESCE(b.approved_at, p.created_at)) AS ready_at
           FROM payouts p
           LEFT JOIN payout_batches b ON b.id = p.batch_id
          WHERE p.status = 'queued'
            AND (p.batch_id IS NULL OR b.status IN ('approved','executing'))
            AND (p.batch_id IS NOT NULL
                 OR NOT EXISTS (SELECT 1 FROM lookup_values lv
                                 WHERE lv.id = p.purpose_id AND COALESCE((lv.meta->>'rides_batch')::boolean, false)))
       )
       SELECT
         (SELECT count(*) FROM claimable WHERE ready_at < now() - make_interval(mins => $1))::text AS queued_stuck,
         (SELECT count(*) FROM payouts
           WHERE status = 'processing' AND updated_at < now() - make_interval(mins => $2))::text AS processing_stuck,
         COALESCE((SELECT floor(EXTRACT(EPOCH FROM (now() - min(ready_at))) / 60) FROM claimable), 0)::text AS oldest_claimable_mins`,
      [QUEUED_SLA_MINUTES, PROCESSING_SLA_MINUTES]);
    const row = r.rows[0];
    const queuedStuck = Number(row?.queued_stuck ?? 0);
    const processingStuck = Number(row?.processing_stuck ?? 0);
    const oldest = Number(row?.oldest_claimable_mins ?? 0);

    metrics.setGauge('kv_payout_queued_stuck', queuedStuck);
    metrics.setGauge('kv_payout_processing_stuck', processingStuck);
    metrics.setGauge('kv_payout_oldest_claimable_minutes', oldest);

    // No per-tick row: at one every 5 minutes it would grow ops_job_runs by ~105k rows a year with no reader and no
    // retention rule. The gauges are the signal; Prometheus keeps the trend.
  },
};
