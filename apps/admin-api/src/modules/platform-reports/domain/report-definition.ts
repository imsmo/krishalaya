// apps/admin-api/src/modules/platform-reports/domain/report-definition.ts · W111 (PC-56 ADMIN-10).
//
// **THE BUILDER SAVES A KEY, NEVER A QUERY — and that is the load-bearing decision of this file.** W111 offers a
// dataset, dimensions, measures and a date range, and DELTA-028 asks for "saved report definitions". The obvious build
// is a JSON tree that compiles to SQL. The first person to save `SELECT * FROM users` under a friendly name would have
// built themselves an exfiltration tool inside the god-mode realm, and every later reviewer would see a saved report.
//
// So a definition is a KEY from the frozen whitelist the read model already owns, plus a bucket, a relative window and
// filters. Everything a saved definition can express, an ad-hoc run can already express; nothing new becomes reachable
// by saving one.
//
// The canon's vocabulary and the code's do not match, and the gap is recorded rather than papered over: W111 lists five
// datasets (Orders, GMV by tenant, Mandi prices, Payouts, Support tickets) and four measures; PC-54's whitelist has five
// METRICS (orders, gmv_minor, new_tenants, new_users, dbt_minor). Three of the canon's datasets have no metric behind
// them, and the console says which — see `CANON_DATASETS_NOT_YET_AVAILABLE`.
import { InvalidReportInputError } from './platform-reports.errors';

/** The frozen whitelist. Mirrors `SRC` in the read model, and a metric absent here is unbuildable by construction. */
export const REPORT_METRICS = ['orders', 'gmv_minor', 'new_tenants', 'new_users', 'dbt_minor'] as const;
export type ReportMetric = (typeof REPORT_METRICS)[number];

export const REPORT_BUCKETS = ['day', 'week', 'month'] as const;
export type ReportBucket = (typeof REPORT_BUCKETS)[number];

/**
 * W111's dataset list, mapped to what exists. **Named, not silently dropped**: a builder whose dataset dropdown quietly
 * contains three fewer options than the design is a builder somebody will file a bug against; one that lists them as
 * unavailable with a reason is a builder that tells the truth about the platform.
 */
export const CANON_DATASETS_NOT_YET_AVAILABLE: readonly { dataset: string; reason: string }[] = Object.freeze([
  {
    dataset: 'Mandi prices',
    reason: 'mandi_prices is a tenant-realm table with no cross-tenant rollup in the reporting plane; a raw per-mandi '
      + 'series is a different object from a platform aggregate and belongs to the Mandi Pulse surface (W107)',
  },
  {
    dataset: 'Payouts',
    reason: 'the payout figures this plane can compute are a SUCCESS RATE and a count, built for the dashboard in this '
      + 'wave; a payout dataset with dimensions needs the settlement plane\'s vocabulary (ADMIN-6b) and is ADMIN-10-Q3',
  },
  {
    dataset: 'Support tickets',
    reason: 'support_tickets is per-tenant and the oversight plane (ADMIN-2) already answers the cross-tenant questions '
      + 'with its own counts; a second path to the same rows would be two answers to one question',
  },
]);

/** The measure names W111 shows, and which metric key each maps to. `dispute rate` and `avg order value` are DERIVED
 *  rather than stored, and are listed as such: a measure dropdown that offers a ratio the series cannot produce is the
 *  same defect as a dataset that does not exist. */
export const CANON_MEASURES: readonly { measure: string; metric: ReportMetric | null; note?: string }[] = Object.freeze([
  { measure: 'GMV (INR)', metric: 'gmv_minor' },
  { measure: 'order count', metric: 'orders' },
  {
    measure: 'avg order value', metric: null,
    note: 'derived from GMV ÷ orders — available on the dashboard and on the GMV report, not as a standalone series',
  },
  {
    measure: 'dispute rate', metric: null,
    note: 'needs a disputes series beside the orders series; the ratio of two whitelisted metrics is not itself a '
      + 'whitelisted metric (ADMIN-10-Q3)',
  },
]);

export function isReportMetric(v: string): v is ReportMetric {
  return (REPORT_METRICS as readonly string[]).includes(v);
}

export function assertMetric(v: string): ReportMetric {
  if (!isReportMetric(v)) {
    throw new InvalidReportInputError(
      `'${v}' is not a reportable metric. The builder runs whitelisted metrics only — a saved definition that carried a `
      + 'query would be a stored-query engine in the god-mode realm.',
    );
  }
  return v;
}

/* ------------------------------------------------------------------------------------------------ */
/* THE CAPS — the canon's own numbers, and they are TIGHTER than the code's                          */
/* ------------------------------------------------------------------------------------------------ */
//
// W111's fine print: "Max range 92 days · results capped at 50,000 rows · queries run on the analytics replica, never
// the primary." The existing window guard allows 366 days, which is right for a dashboard and wrong for an ad-hoc
// builder — a 14-day chart and a 92-day export are different risks against the same partitioned table. The tighter
// bound wins HERE and the dashboard keeps the wider one.

export const BUILDER_MAX_RANGE_DAYS = 92;
export const BUILDER_MAX_ROWS = 50_000;
/** W111: "the 60s replica limit protects everyone." The limit is real from this wave; the replica is not — see
 *  `READS_FROM_REPLICA`. */
export const BUILDER_STATEMENT_TIMEOUT_MS = 60_000;

/**
 * **FALSE, AND THE CONSOLE SAYS SO.** `grep -rn replica apps/admin-api/src` finds no pool selection: admin-api holds one
 * pool on `DATABASE_ADMIN_URL`. W111 tells an operator their heavy query runs on a replica and never the primary, which
 * is exactly the sentence somebody relies on when deciding whether to run a 92-day report at 6 p.m. on a Friday.
 *
 * The value lives in `report_query_policy.reads_from_replica` so that when a replica pool lands the console's sentence
 * changes with the infrastructure rather than needing an edit to stop being wrong.
 */
export const READS_FROM_REPLICA = false;
export const REPLICA_GAP_OWNER = 'ADMIN-10-Q4' as const;

export function assertBuilderWindow(fromIso: string, toIso: string, maxDays = BUILDER_MAX_RANGE_DAYS): { from: Date; to: Date } {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new InvalidReportInputError('from and to must be valid ISO timestamps');
  }
  if (from.getTime() >= to.getTime()) throw new InvalidReportInputError('from must be strictly before to');
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (days > maxDays) {
    // The message names the fix, because "range too large" leaves an operator guessing whether to halve it or drop a
    // dimension — and W111's own error copy tells them which lever to pull.
    throw new InvalidReportInputError(
      `this range is ${Math.ceil(days)} days and the builder's limit is ${maxDays}. Narrow the range: the cap exists so `
      + 'no report can hurt production.',
    );
  }
  return { from, to };
}

/* ------------------------------------------------------------------------------------------------ */
/* SAVED DEFINITIONS                                                                                 */
/* ------------------------------------------------------------------------------------------------ */

export const SLUG_RE = /^[a-z][a-z0-9-]{1,59}$/;

export function assertSlug(v: string): string {
  const s = v.trim();
  if (!SLUG_RE.test(s)) {
    throw new InvalidReportInputError(
      'a report slug is lower-case letters, digits and hyphens, starting with a letter — it is what a schedule points '
      + 'at, so it has to be typeable and stable.',
    );
  }
  return s;
}

export function assertWindowDays(v: number): number {
  if (!Number.isInteger(v) || v < 1 || v > 366) {
    throw new InvalidReportInputError('a saved report\'s window is a whole number of days between 1 and 366');
  }
  return v;
}

/**
 * **A SAVED DEFINITION IS RELATIVE; AN AD-HOC RUN IS ABSOLUTE.** W111's date inputs are two dates, which is right for a
 * run you are about to make and wrong for a definition a schedule will execute every Monday for a year: absolute dates
 * make a saved report wrong the day after it is saved, and nobody notices because it keeps producing a file.
 */
export function windowFor(windowDays: number, now = new Date()): { from: Date; to: Date } {
  const to = now;
  const from = new Date(to.getTime() - windowDays * 86_400_000);
  return { from, to };
}

/** Whether a schedule may point at this definition. `scheduled_reports.report` is a varchar of the export vocabulary
 *  (0095), so the join is by NAME — and an archived definition must break its schedule LOUDLY rather than cascade away,
 *  because a board pack that silently stops arriving is discovered a quarter later. */
export function isSchedulable(d: { archivedAt: Date | null; isShared: boolean }): boolean {
  return d.archivedAt === null;
}

/** The two objects DELTA-028 asked for, and where each one is. Quoted by the console so the banner can be replaced with
 *  a statement of fact rather than removed. */
export const DELTA_028_STATUS = Object.freeze({
  savedDefinitions: 'built in 0120 (saved_report_definitions) — a whitelisted metric key, never a stored query',
  schedules: 'already existed: scheduled_reports + scheduled_report_runs (0095, ADMIN-1e), with a worker that claims them',
  note: 'the banner asked for two tables and one of them had been in the database since ADMIN-1e; a delta is closed by '
    + 'reading the schema, not by adding to it',
});
