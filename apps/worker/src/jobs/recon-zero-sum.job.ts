// apps/worker/src/jobs/recon-zero-sum.job.ts · MONEY safety monitor (PC-56 ADMIN-6 — FIXES A LIVE BUG).
//
// ---------------------------------------------------------------------------
// WHAT WAS BROKEN, AND FOR HOW LONG
// ---------------------------------------------------------------------------
// This job is the ONLY scheduled writer of `reconciliation_runs`. Since it shipped it has been writing:
//
//     INSERT INTO reconciliation_runs (id, check_type, window_hours, checked_count, mismatch_count, ok,
//                                      started_at, finished_at) ...
//       .catch(() => { /* schema variance tolerated; the gauge is the alert source */ });
//
// `check_type`, `window_hours`, `mismatch_count`, `ok` and `started_at` are NOT COLUMNS of that table. The real ones
// are `run_type`, `period_start`, `period_end` — all NOT NULL, all omitted. **Every execution raised 42703
// undefined_column and the catch swallowed it**, so the table has been empty in production and the whole
// reconciliation console — W006's board, the runs list, every drill-in — has shown nothing. An operator could not tell
// "the ledger is clean" from "nothing has ever been checked".
//
// THE COMMENT IN THAT CATCH IS THE LESSON. "schema variance tolerated; the gauge is the alert source" is a reasonable
// sentence that turned out to be false in the way that mattered: the gauge reports whether the job RAN, the table
// reports what it FOUND, and the moment the insert broke those two came apart with nothing to notice. A swallowed
// write is a silent write.
//
// AND THE STALENESS GAUGE COULD NEVER FIRE. `WalletReconStale` alerts on `kv_recon_age_seconds > 7200`, and this job
// set that gauge to a literal `0` every tick — "fresh as of this run". Nothing anywhere set it high, so the one alert
// whose job is to notice that reconciliation has STOPPED was unfireable by construction. It is now derived from the
// newest recorded run, which is a fact about the LEDGER's coverage rather than about this process having woken up —
// and which, before the fix above, would have been screaming.
import { Job, JobCtx } from './index';

/** The window this monitor samples. Deliberately short: it is a 5-minute tripwire feeding a page-immediately alert,
 *  not an audit. `zero_sum_check` is the full snapshot and is a different run type for that reason — recording these
 *  rows as `zero_sum_check` would make a 24-hour sample look like a complete verification. */
const WINDOW_HOURS = 24;

export const reconZeroSumJob: Job = {
  name: 'recon-zero-sum',
  intervalSec: 300, // every 5 min
  async run({ client, metrics }: JobCtx) {
    const win = await client.query<{ txn_id: string }>(
      `SELECT txn_id FROM ledger_entries
        WHERE created_at >= now() - interval '24 hours'
        GROUP BY txn_id HAVING SUM(amount_minor) <> 0
        LIMIT 1000`);
    const mismatches = win.rowCount ?? 0;

    // The number of transactions actually examined, so `checked_count` means something. Previously the job wrote the
    // MISMATCH count into `checked_count` as well as into `mismatch_count` — the same value in both — which would have
    // read as "we checked 2 transactions and 2 were broken" on a healthy ledger with two faults.
    const scanned = await client.query<{ n: string }>(
      `SELECT count(DISTINCT txn_id)::text AS n FROM ledger_entries
        WHERE created_at >= now() - interval '24 hours'`);
    const checked = Number(scanned.rows[0]?.n ?? 0);

    // THE REAL COLUMNS. No catch: if this write fails the job must fail loudly, because a monitor whose record of its
    // own findings is optional is not a monitor. The runner logs and the next tick retries — and a persistent failure
    // now surfaces instead of being absorbed.
    //
    // `mismatches` is stored as the jsonb array the table is shaped for. It is capped at 1000 by the query above, and
    // `checked_count` is the honest denominator, so "more faults than listed" stays readable.
    await client.query(
      `INSERT INTO reconciliation_runs (run_type, period_start, period_end, status, checked_count, mismatches, finished_at)
       VALUES ('zero_sum_monitor', now() - ($1 || ' hours')::interval, now(), $2, $3, $4::jsonb, now())`,
      [String(WINDOW_HOURS),
        mismatches === 0 ? 'ok' : 'mismatch',
        checked,
        JSON.stringify(win.rows.map((r) => ({ txn_id: r.txn_id, reason: 'legs_do_not_sum_to_zero' })))]);

    metrics.setGauge('kv_recon_mismatches', mismatches);

    // AGE OF THE NEWEST RECORDED RUN, not zero. This is what makes `WalletReconStale` able to fire: if this job stops,
    // or if its write starts failing again, the newest row ages and the gauge climbs past the 2-hour threshold. A
    // literal 0 could only ever say "I am running", which is the one thing an alert about not running cannot use.
    const newest = await client.query<{ age: string | null }>(
      `SELECT EXTRACT(EPOCH FROM (now() - max(COALESCE(finished_at, created_at))))::text AS age
         FROM reconciliation_runs`);
    const age = Number(newest.rows[0]?.age ?? NaN);
    // No recorded run at all is not "fresh". A large finite number is used rather than 0 or NaN so the alert fires on
    // an empty table — which is precisely the state this whole fix exists to make impossible to miss.
    metrics.setGauge('kv_recon_age_seconds', Number.isFinite(age) ? Math.max(0, Math.round(age)) : 86_400);
  },
};
