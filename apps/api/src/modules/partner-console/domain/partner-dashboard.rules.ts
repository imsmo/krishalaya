// modules/partner-console/domain/partner-dashboard.rules.ts · PC-56 PARTNER-1a · founder D1 — THE DASHBOARD'S ARITHMETIC, PURE (no I/O).
//
// Every figure the partner's dashboard prints is computed on the server from the partner's OWN book (the kv_partner axis); this file holds
// the parts that are plain arithmetic so a unit spec can pin them:
//   • a RATE is an integer in BASIS POINTS (1 = 0.01 %), floor(numerator × 10 000 ÷ denominator) in bigint arithmetic — never a float,
//     never NaN: a zero denominator answers null ("nothing decided" / "nothing due");
//   • a money SUM is a bigint minor-unit STRING (the shards' partial sums are added as BigInt, never as Number);
//   • the decision LATENCY is `decision_at − created_at` in whole seconds (an application is born `submitted`, so created_at is the
//     moment it was submitted); median and p90 are NEAREST-RANK percentiles (an observed value, never an interpolation — the
//     percentile_disc semantics), so shards' raw latencies merge exactly;
//   • the SLA PROMISE is `financial_partners.sla.decision_hours` (a whole number ≥ 1) or null — "not published yet". Only the decision
//     promise exists: disbursal (the FPO's act) and first response (no source) are refused by name in the console.
export const BPS_SCALE = 10_000n;

/** floor(n × 10 000 ÷ d) as an integer number of basis points; null when d is 0 (never NaN, never a float). */
export function rateBps(numerator: bigint | number | string, denominator: bigint | number | string): number | null {
  const n = BigInt(numerator); const d = BigInt(denominator);
  if (d <= 0n) return null;
  if (n < 0n) return null;
  return Number((n * BPS_SCALE) / d);
}

/** Σ of bigint minor-unit strings (a shard's partial sum each) → one bigint minor-unit string. */
export function sumMinor(parts: ReadonlyArray<string | bigint | number | null | undefined>): string {
  let s = 0n;
  for (const p of parts) if (p !== null && p !== undefined && String(p) !== '') s += BigInt(p);
  return s.toString();
}

/** Nearest-rank percentile over whole-second latencies: the smallest observed value with at least p % of the values at or below it. */
export function percentileNearestRank(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/** The published decision promise in hours (a whole number ≥ 1), or null when none is published. */
export function slaDecisionHours(sla: unknown): number | null {
  if (!sla || typeof sla !== 'object') return null;
  const v = (sla as Record<string, unknown>).decision_hours;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null;
}

/** How many of the observed latencies were within the promise (≤ promise hours); null when no promise is published. */
export function withinPromise(latenciesSec: readonly number[], promiseHours: number | null): number | null {
  if (promiseHours === null) return null;
  const limit = promiseHours * 3600;
  return latenciesSec.filter((s) => s <= limit).length;
}

/** The dashboard windows, as the SQL computes them (documented here so the report and the spec name ONE definition). */
export const DASHBOARD_WINDOWS = Object.freeze({
  /** decided this month: decision_at in [the first instant of the current calendar month in IST, the first instant of the next one). */
  monthBoundarySql: `date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'`,
  timeZone: 'Asia/Kolkata',
  latencyDays: 30,
  onTimeDays: 90,
  needsYouToday: 5,
});
