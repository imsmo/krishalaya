// apps/worker/src/jobs/retention-enforcer.job.ts · DPDP storage-limitation. For each ACTIVE policy with action='delete', purge rows
// older than the policy's window from that table (bounded batch). Table names come from the policy row but are STILL validated
// against the catalog + required to have a created_at column (no injection, no purging a table that lacks the time column).
// 'anonymise'/'archive' actions are left to their dedicated pipelines (flagged) — we never silently mis-handle them.
//
// PC-56 TENANT-13a — three corrections, found while adding the webhook rule (§B, 90 days):
//   • THE WINDOW. `active_days` (0191) wins when set; otherwise `active_months`. The webhook delivery log keeps 90 DAYS.
//   • A ZERO WINDOW IS NOT "DELETE EVERYTHING". 0107 seeds `users`, `user_devices` and `kyc_documents` as delete / 0 months — rules
//     whose own comment says "deleted outright … once the person is gone", i.e. ERASURE-scoped (the DSR pipeline's job). This sweep
//     read them as `created_at < now() - 0 months` — every row ever written. A rule with no positive window is now SKIPPED (counted
//     `kv_retention_skipped{reason="erasure_scoped"}`), never swept.
//   • PARTITIONED TABLES. `ctid` is unique only WITHIN one partition, so `DELETE … WHERE ctid IN (SELECT ctid …)` on a partitioned
//     parent could delete a young row in one partition whose ctid equals an old row's in another. The batch now matches
//     `(tableoid, ctid)`.
//   • ONE BAD RULE NO LONGER STOPS THE REST: each policy runs in isolation (a failure is counted and logged; the sweep goes on).
import { Job, JobCtx } from './index';

export interface RetentionPolicyRow { table_name: string; active_months: number; active_days: number | null; action: string }

/** The SQL interval a delete rule keeps, or null when the rule is not a time sweep (erasure-scoped / no positive window). */
export function retentionWindow(p: Pick<RetentionPolicyRow, 'active_months' | 'active_days'>): string | null {
  if (p.active_days !== null && p.active_days !== undefined && Number(p.active_days) > 0) return `${Math.trunc(Number(p.active_days))} days`;
  if (Number(p.active_months) > 0) return `${Math.trunc(Number(p.active_months))} months`;
  return null;
}

export const retentionEnforcerJob: Job = {
  name: 'retention-enforcer',
  intervalSec: 86400, // daily
  async run({ client, metrics }: JobCtx) {
    const policies = await client.query<RetentionPolicyRow>(
      `SELECT table_name, active_months, active_days, action FROM data_retention_policies WHERE is_active = true AND action = 'delete' AND deleted_at IS NULL`);
    let purged = 0;
    for (const p of policies.rows) {
      const window = retentionWindow(p);
      if (!window) { metrics.inc('kv_retention_skipped', { table: p.table_name, reason: 'erasure_scoped' }); continue; }
      // validate the identifier against the catalog + require a created_at column (defence in depth)
      const chk = await client.query<{ ok: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name=$1 AND column_name='created_at') AS ok`, [p.table_name]);
      if (!chk.rows[0]?.ok) { metrics.inc('kv_retention_skipped', { table: p.table_name, reason: 'no_created_at' }); continue; }
      try {
        // identifier is catalog-verified → safe to interpolate; delete in a bounded batch; (tableoid, ctid) is unique across partitions
        const res = await client.query(
          `DELETE FROM "${p.table_name}" WHERE (tableoid, ctid) IN (
             SELECT tableoid, ctid FROM "${p.table_name}"
              WHERE created_at < now() - $1::interval
              LIMIT 5000)`, [window]);
        purged += res.rowCount ?? 0;
      } catch (e) {
        metrics.inc('kv_retention_failed', { table: p.table_name });
        // eslint-disable-next-line no-console
        console.error(`[retention-enforcer] ${p.table_name}: ${(e as Error).message}`);
      }
    }
    metrics.inc('kv_retention_purged_total', undefined, purged);
  },
};
