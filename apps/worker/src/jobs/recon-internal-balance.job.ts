// apps/worker/src/jobs/recon-internal-balance.job.ts · the per-account drift check, WIRED AT LAST (PC-56 ADMIN-6).
//
// ---------------------------------------------------------------------------
// THIS QUERY HAS EXISTED TWICE SINCE 0006 AND NEITHER COPY HAS EVER RUN
// ---------------------------------------------------------------------------
// `runInternalBalanceCheck` lives in `apps/wallet-service/src/reconciliation/reconciliation.service.ts` and again in
// `apps/api/src/core/wallet/reconciliation.service.ts`. The wallet-service copy is called by a job function nothing
// invokes (that service boots a gRPC server with no scheduler at all); the apps/api copy is a registered DI provider
// with no production caller. Both are dead code.
//
// **IT IS THE ONLY CHECK THAT CATCHES A DRIFTED BALANCE.** The zero-sum monitor sums the LEGS of each transaction, and
// that sum is invariant to cache drift: `wallet_accounts.cached_balance_minor` could be wrong on every account on the
// platform and every transaction would still sum to zero. So the check that was running proves the ledger is
// internally consistent, and the check that was not proves the balances people are shown match it.
//
// A drifted `cached_balance_minor` is what a farmer sees in the app. The ledger is the truth and the cache is what
// gets read, so drift means somebody is told they have money they do not have, or denied money they do.
//
// ---------------------------------------------------------------------------
// WHY IT LIVES HERE AND NOT IN EITHER PLACE IT WAS WRITTEN
// ---------------------------------------------------------------------------
// It is pure bounded SQL over two tables with no module business logic — exactly what apps/worker is for, and
// `WORKER-RUNTIME.md`'s own line is that domain-handler jobs stay out while pg-native ones belong here. Putting it in
// the worker also means it runs under the leader lock every other integrity job runs under, so two pods cannot both
// walk the accounts table.
//
// The two original copies are deliberately NOT deleted in this wave. They are called by tests that document the
// intended behaviour, and removing a money-safety routine in the same change that first schedules one is two risks
// where one will do. Named as ADMIN-6-Q3.
import { Job, JobCtx } from './index';

/** Accounts examined per tick. The original query was `LIMIT 1000` with no window and no ORDER BY — a full scan of
 *  `ledger_entries` across every partition, joined to every account, on a table designed to reach billions of rows.
 *  That is very likely why nobody ever turned it on.
 *
 *  This version is bounded the other way: it walks accounts in a stable order from a watermark, so a full sweep takes
 *  many ticks and each tick is cheap. A check that cannot run on the real table is not a check. */
const ACCOUNTS_PER_TICK = 2_000;

export const reconInternalBalanceJob: Job = {
  name: 'recon-internal-balance',
  /** Every 15 minutes. Slower than the zero-sum tripwire because drift is a slow fault: it appears when a write path
   *  is wrong, not when a transaction is malformed, and catching it within the hour is soon enough to matter. */
  intervalSec: 900,
  async run({ client, metrics }: JobCtx) {
    // The watermark is the last account this job examined, read from its own previous run row. Cheaper and more honest
    // than a separate cursor table: if no run exists the sweep starts at the beginning, which is also what should
    // happen the first time it ever runs.
    const wm = await client.query<{ mismatches: unknown }>(
      `SELECT mismatches FROM reconciliation_runs
        WHERE run_type = 'internal_balance' ORDER BY created_at DESC LIMIT 1`);
    const prev = wm.rows[0]?.mismatches as { watermark?: string } | Array<unknown> | undefined;
    const after: string | null = !Array.isArray(prev) && prev?.watermark ? prev.watermark : null;

    // ONE ACCOUNT'S ENTRIES AT A TIME, via a lateral sum over the account index. `idx_ledger_account
    // (account_id, created_at DESC)` serves each sum, so this is N index scans rather than one full-table join —
    // which is the difference between a job that runs and the two that did not.
    const drift = await client.query<{ id: string; cached: string; actual: string }>(
      `SELECT a.id, a.cached_balance_minor::text AS cached, s.actual::text AS actual
         FROM (
           SELECT id, cached_balance_minor FROM wallet_accounts
            WHERE ($1::uuid IS NULL OR id > $1) ORDER BY id LIMIT $2
         ) a
         CROSS JOIN LATERAL (
           SELECT COALESCE(SUM(e.amount_minor), 0) AS actual
             FROM ledger_entries e WHERE e.account_id = a.id
         ) s
        WHERE a.cached_balance_minor <> s.actual`,
      [after, ACCOUNTS_PER_TICK]);

    // The last id in the swept page, whether or not it drifted — the watermark must advance over CLEAN accounts too,
    // or the sweep would restart from the same place for ever on a healthy platform.
    const swept = await client.query<{ last: string | null; n: string }>(
      `SELECT max(id)::text AS last, count(*)::text AS n FROM (
         SELECT id FROM wallet_accounts WHERE ($1::uuid IS NULL OR id > $1) ORDER BY id LIMIT $2
       ) q`, [after, ACCOUNTS_PER_TICK]);
    const last = swept.rows[0]?.last ?? null;
    const checked = Number(swept.rows[0]?.n ?? 0);

    // A page that swept nothing means the sweep reached the end. The watermark resets so the next tick starts over,
    // and the run is still RECORDED — "we completed a full pass and found nothing" is the most useful row this table
    // can hold, and the one an auditor asks for.
    const nextWatermark = checked === 0 ? null : last;

    await client.query(
      `INSERT INTO reconciliation_runs (run_type, period_start, period_end, status, checked_count, mismatches, finished_at)
       VALUES ('internal_balance', now(), now(), $1, $2, $3::jsonb, now())`,
      [drift.rowCount ? 'mismatch' : 'ok', checked,
        JSON.stringify({
          watermark: nextWatermark,
          sweepComplete: checked === 0,
          // Each drifted account with BOTH figures, so a responder sees the size and direction without re-querying.
          // Capped by ACCOUNTS_PER_TICK, and `checked_count` is the honest denominator.
          drift: drift.rows.map((r) => ({
            account_id: r.id, cached_minor: r.cached, ledger_minor: r.actual,
            delta_minor: (BigInt(r.cached) - BigInt(r.actual)).toString(),
          })),
        })]);

    // A separate gauge from the zero-sum one, because they mean different things and an operator paged at 3am needs to
    // know which. Zero-sum failing means a transaction is malformed; this failing means a balance somebody is being
    // SHOWN disagrees with the ledger.
    metrics.setGauge('kv_recon_balance_drift', drift.rowCount ?? 0);
  },
};
