// apps/admin-api/src/modules/platform-reports/domain/dashboard-figures.ts · W001 (PC-56 ADMIN-10).
//
// **THE DASHBOARD'S FOUR HEADLINE TILES, AND WHICH OF THEM THIS PLATFORM CAN HONESTLY COMPUTE.** W001 promises "GMV
// today · Active tenants · Orders / min · Payout success (24h)", each with a delta ("▲ 8.2% vs last Monday", "▲ peak
// 1,190"). The canon states no formula for any of them, so every one is a derivation decision — and three of the four
// are computable from tables that exist while one is not.
//
// This file is where those decisions live, as pure functions, because a dashboard figure with an unstated basis is the
// shape of defect this programme has found six times: a number that looks like diligence and measures something else.
// Every function below either returns a figure WITH its basis, or returns `unavailable` with a reason.
export type FigureBasis =
  /** Computed in SQL from a table named in the payload. The only basis a tile may claim without qualification. */
  | 'computed'
  /** Computed, and the comparison window is shorter than the one asked for (a partial day, an incomplete week). The
   *  figure is real and the DELTA is not comparable — shown as a figure with the comparison suppressed rather than as a
   *  delta computed against a stub. */
  | 'partial_window'
  /** No source exists. Never rendered as zero: zero is a measurement and this is an absence. */
  | 'unavailable';

export interface Figure {
  basis: FigureBasis;
  /** Minor units as a string for money, a plain integer as a string otherwise. Never a float, never a number for money
   *  (Law 2) — and a string for both so a caller cannot accidentally add a count to a rupee amount. */
  value: string | null;
  /** Why, when the basis is not `computed`. Rendered on the tile, so an operator never has to guess whether a blank
   *  means "nothing happened" or "we cannot tell". */
  note?: string;
}

export const UNAVAILABLE: Figure = Object.freeze({ basis: 'unavailable', value: null });

export function computed(value: string | bigint | number): Figure {
  return { basis: 'computed', value: typeof value === 'string' ? value : String(value) };
}

export function unavailable(note: string): Figure {
  return { basis: 'unavailable', value: null, note };
}

/* ------------------------------------------------------------------------------------------------ */
/* DELTAS                                                                                           */
/* ------------------------------------------------------------------------------------------------ */

export type Delta =
  | { kind: 'up' | 'down' | 'flat'; bps: number; comparedWith: string }
  /** The previous window has no data — a first day, a new platform, or a window that predates the table. **NOT a 0%
   *  delta**: "unchanged" and "nothing to compare with" are different statements and the first is a claim. */
  | { kind: 'no_baseline'; comparedWith: string };

/**
 * The change between two windows, in integer BASIS POINTS (1% = 100bps) — float-free, like every other ratio on this
 * plane (`bps()` in metrics.ts).
 *
 * **A ZERO BASELINE IS `no_baseline`, NOT AN INFINITE RISE.** W001 renders "▲ 8.2% vs last Monday"; the day after
 * launch the honest answer is that there is nothing to compare with, and a tile reading "▲ ∞%" or "▲ 100%" would be
 * inventing a trend out of the first data point.
 */
export function deltaBps(current: bigint, previous: bigint, comparedWith: string): Delta {
  if (previous <= 0n) {
    // A negative previous is impossible for the figures this is used on (money and counts) and is treated the same way:
    // whatever it is, it is not a baseline anybody should divide by.
    return { kind: 'no_baseline', comparedWith };
  }
  const diff = current - previous;
  // Scaled BEFORE the division, so a 0.01% change on a large figure is not floored away to zero.
  const scaled = (diff * 10_000n) / previous;
  const bps = Number(scaled);
  if (bps === 0) return { kind: 'flat', bps: 0, comparedWith };
  return { kind: bps > 0 ? 'up' : 'down', bps: Math.abs(bps), comparedWith };
}

/* ------------------------------------------------------------------------------------------------ */
/* ORDERS PER MINUTE — the tile with no source, and the honest version of it                        */
/* ------------------------------------------------------------------------------------------------ */

/**
 * W001: "Orders / min · 642 · ▲ peak 1,190".
 *
 * **THE RATE IS COMPUTABLE AND THE PEAK IS NOT.** A rate is one count over one window (orders in the last hour ÷ 60).
 * A PEAK is the maximum of a per-minute series, which needs minute-granularity history — and the only source is the
 * partitioned `orders` table, so producing it means bucketing every order in the period by minute and taking a max. No
 * rollup exists. That query is affordable for one hour and is not something a dashboard should run every load, and a
 * "peak" over the last hour is not what the tile means anyway.
 *
 * So the rate ships, the peak is `unavailable` with its reason on the tile, and ADMIN-10-Q2 owns the rollup. The
 * alternative — showing the hour's maximum minute and labelling it "peak" — is the exact defect shape this programme
 * keeps finding: a plausible number under a label that means something else.
 */
export const ORDERS_RATE_WINDOW_MINUTES = 60;

export function ordersPerMinute(ordersInWindow: number, windowMinutes = ORDERS_RATE_WINDOW_MINUTES): Figure {
  if (!Number.isFinite(ordersInWindow) || ordersInWindow < 0 || windowMinutes <= 0) {
    return unavailable('the order count for the window could not be read');
  }
  // Floored: a dashboard claiming 6.7 orders a minute invites a precision the source does not have, and rounding UP
  // would overstate throughput on a quiet platform.
  return computed(Math.floor(ordersInWindow / windowMinutes));
}

export function ordersPeakPerMinute(): Figure {
  return unavailable('a per-minute peak needs minute-granularity history and no rollup exists (ADMIN-10-Q2)');
}

/* ------------------------------------------------------------------------------------------------ */
/* PAYOUT SUCCESS — computable, and the denominator is the interesting decision                     */
/* ------------------------------------------------------------------------------------------------ */

export interface PayoutOutcomeCounts {
  succeeded: number;
  failed: number;
  /** Still moving. **EXCLUDED FROM THE DENOMINATOR**, and that is the whole decision: a payout that has not finished is
   *  not a failure, and counting it as one would make the rate dip every time a batch was mid-flight — which is exactly
   *  when somebody is looking at this tile. */
  pending: number;
  /** Succeeded and came back. **ALSO EXCLUDED**, and this one is arguable: the money did leave, so the rail worked. It
   *  is reported beside the rate instead, because a reversal is a fact about the beneficiary's bank rather than about
   *  this platform's payout success, and folding it either way would answer a different question than the tile asks. */
  reversed: number;
  /** Never attempted. Excluded from both sides — a cancelled payout is not evidence about anything. */
  cancelled: number;
}

/**
 * Payout success as integer basis points over FINISHED payouts only.
 *
 * Returns `partial_window` when nothing finished in the window: a rate over an empty denominator is not 100% and it is
 * not 0%.
 *
 * **THE RETRY COUNT W001 SHOWS DOES NOT EXIST.** "99.4% · ▼ 0.2 pt · 41 retries" — and `payouts` has no attempt or
 * retry column and no attempts table. The tile reports the rate it can compute and names the retry count as
 * unavailable (ADMIN-10-Q5); a retry figure inferred from failure rows would be a number nobody could reproduce.
 */
export function payoutSuccessBps(c: PayoutOutcomeCounts): Figure {
  const finished = c.succeeded + c.failed;
  if (!Number.isFinite(finished) || finished <= 0) {
    return { basis: 'partial_window', value: null, note: 'no payout finished in this window, so there is no rate to report' };
  }
  return computed(Math.floor((c.succeeded * 10_000) / finished));
}

/* ------------------------------------------------------------------------------------------------ */
/* STALENESS — the contract W001's own error state writes down                                      */
/* ------------------------------------------------------------------------------------------------ */

export type Freshness =
  | { kind: 'live'; asOf: string }
  /** W001's error state, verbatim: "Metrics service timed out. Cached figures from 14:28 are shown above — retry to
   *  refresh." So a failure must keep the figures AND name the moment they were true. */
  | { kind: 'cached'; asOf: string; reason: string }
  | { kind: 'unavailable'; reason: string };

/** Every dashboard payload carries one of these. A screen that prints a figure without saying when it was true is a
 *  screen an operator will read at 18:20 and believe about 18:20. */
export function live(asOf: Date): Freshness {
  return { kind: 'live', asOf: asOf.toISOString() };
}

export function cached(asOf: Date, reason: string): Freshness {
  return { kind: 'cached', asOf: asOf.toISOString(), reason };
}

/**
 * **THE WORD "LIVE" IS A CLAIM, AND THIS IS WHERE IT IS EARNED OR DROPPED.** W001 labels its lifecycle band "(live)" and
 * offers a "Live revenue ticker" button. A figure read once when the page rendered is not live; it is a point in time.
 * This plane serves point-in-time reads with an `asOf`, so the console says "as of 18:20" and the word "live" appears
 * only where a stream actually exists (ADMIN-1e built one for revenue).
 */
export const LIVE_MEANS_STREAM = 'a figure is only "live" where a stream feeds it; everything else carries an asOf' as const;
