// apps/worker/src/jobs/payout-gateway-recon.job.ts · PC-56 PAY-9 — THE DAILY PAYOUT RECONCILIATION, ACTUALLY RUN.
//
// Moved here from apps/api/src/modules/payments/jobs/daily-gateway-recon.job.ts, which was written, listed in the
// payments README, given its own `run_type` ('daily_gateway', 0006/0113) and a row on the admin reconciliation board —
// and NEVER SCHEDULED by anything. The board's "daily gateway" line could only ever be empty.
//
// ONCE PER UTC DAY (the tick is hourly; a run already recorded today makes the tick re-export its gauges and stop), it
// records a `reconciliation_runs` row of run_type 'daily_gateway' listing every payout in one of these states:
//   PAGE (money path broken — ops/alerts/payout-alerts.yml):
//     • reservation_missing     — a live payout with no reservation ledger txn, created by a path that promises one
//                                 (PayoutService.request reserves the user's balance in the same transaction);
//     • settled_without_gateway — 'success'/'processing' with no gateway payout id: money recorded as sent that the
//                                 gateway has no record of sending;
//     • stuck_processing        — 'processing' for more than a day: the confirming webhook never arrived.
//   WARN (a known, recorded gap — never a page):
//     • unreserved_batch_payout — a loan-disbursement or co-operative-run payout. Those paths queue payouts WITHOUT a
//                                 reservation by design today; the founder-signed money wave that changes it is still
//                                 open (KRISHALAYA_MASTER_CONTEXT, PARTNER-4b D-9 / TENANT-9b). Counting them as
//                                 "reservation_missing" would page every day for a decision, not a fault.
// The run's status is 'mismatch' only when a PAGE reason is present. Read-only over money: it MOVES NOTHING.
import { Job, JobCtx } from './index';

export const PAGE_REASONS = ['reservation_missing', 'settled_without_gateway', 'stuck_processing'] as const;
export const WARN_REASONS = ['unreserved_batch_payout'] as const;
const ALL_REASONS = [...PAGE_REASONS, ...WARN_REASONS];
/** Reference types whose payouts are queued without a reservation today (see header). */
const UNRESERVED_BY_DESIGN = ['loan_application', 'coop_payout_run'];
const STUCK_PROCESSING_HOURS = 24;
const LISTED_MAX = 1000;
/** No run recorded at all is not "fresh": report two days so the staleness alert fires on an empty history. */
const NO_RUN_AGE_SECONDS = 172_800;

export const payoutGatewayReconJob: Job = {
  name: 'payout-gateway-recon',
  intervalSec: 3600,
  async run({ client, metrics }: JobCtx) {
    const today = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM reconciliation_runs
        WHERE run_type = 'daily_gateway' AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`);
    if (Number(today.rows[0]?.n ?? 0) === 0) {
      // One statement, so every reason is counted over the same snapshot. Exact counts per reason; the listed
      // payouts are capped (checked_count + the counts stay the honest totals).
      const found = await client.query<{ id: string; tenant_id: string; reason: string }>(
        `SELECT id, tenant_id,
                CASE WHEN reference_type = ANY($1::text[]) THEN 'unreserved_batch_payout' ELSE 'reservation_missing' END AS reason
           FROM payouts WHERE status NOT IN ('cancelled','failed','reversed') AND ledger_txn_id IS NULL
         UNION ALL
         SELECT id, tenant_id, 'settled_without_gateway' FROM payouts
          WHERE status IN ('success','processing') AND gateway_payout_id IS NULL
         UNION ALL
         SELECT id, tenant_id, 'stuck_processing' FROM payouts
          WHERE status = 'processing' AND updated_at < now() - make_interval(hours => $2)`,
        [UNRESERVED_BY_DESIGN, STUCK_PROCESSING_HOURS]);
      const counts: Record<string, number> = Object.fromEntries(ALL_REASONS.map((r) => [r, 0]));
      for (const row of found.rows) counts[row.reason] = (counts[row.reason] ?? 0) + 1;
      const paging = PAGE_REASONS.reduce((n, r) => n + counts[r], 0);
      const checked = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM payouts`);

      await client.query(
        `INSERT INTO reconciliation_runs (run_type, period_start, period_end, status, checked_count, mismatches, finished_at)
         VALUES ('daily_gateway', now() - interval '1 day', now(), $1, $2, $3::jsonb, now())`,
        [paging > 0 ? 'mismatch' : 'ok', Number(checked.rows[0]?.n ?? 0),
          JSON.stringify(found.rows.slice(0, LISTED_MAX).map((r) => ({ payout_id: r.id, tenant_id: r.tenant_id, reason: r.reason })))]);
    }

    // Gauges come from the NEWEST RECORDED RUN (today's, or the last one if today's has not been written), never from
    // this process's memory — so a restarted worker re-exports the truth, and a job that stops shows up as age.
    const latest = await client.query<{ mismatches: unknown; age: string }>(
      `SELECT mismatches, EXTRACT(EPOCH FROM (now() - COALESCE(finished_at, created_at)))::text AS age
         FROM reconciliation_runs WHERE run_type = 'daily_gateway' ORDER BY created_at DESC LIMIT 1`);
    const row = latest.rows[0];
    const listed = Array.isArray(row?.mismatches) ? (row!.mismatches as Array<{ reason?: string }>) : [];
    for (const reason of ALL_REASONS) {
      metrics.setGauge('kv_payout_recon_mismatches', listed.filter((m) => m.reason === reason).length, { reason });
    }
    metrics.setGauge('kv_payout_recon_age_seconds', row ? Math.max(0, Math.round(Number(row.age))) : NO_RUN_AGE_SECONDS);
  },
};
