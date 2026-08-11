// modules/market-ops/domain/mandi-pulse.ts · W107 view rules (PC-56 ADMIN-SWEEP).
//
// **THE FIGURE THIS PLANE EXISTS FOR IS NOT ON THE SCREEN'S TILE ROW.** W107 prints four counts and one sentence, and
// the sentence was the only false thing on it: "ambassador_manual entries > 20% off modal are quarantined for review
// before feeding farmer alerts — bad data never reaches a selling decision." Nothing quarantined anything;
// `MandiPriceService.ingest` fired farmer alerts off a manual observation in the same transaction that inserted it.
// 0124 and this module are that sentence becoming true, and the quarantine count is the tile that matters.

export type AnomalyState = 'accepted' | 'quarantined' | 'released' | 'rejected';

export interface SourceMix { source: string; n: number }

/* ------------------------------------------------------------------------------------------------ */
/* INGEST LAG — the figure that had no source at all                                                 */
/* ------------------------------------------------------------------------------------------------ */

/**
 * W107: "Ingest lag (p95) · 41 min · target < 60 min".
 *
 * **`mandi_prices` HAD NO `created_at`.** `add_std_columns` was never called on it, so the table recorded when a price
 * APPLIES (`price_date`, a DATE) and never when it ARRIVED. The figure was unanswerable — not wrong, unanswerable — and
 * 0124 adds `ingested_at` without backfilling it, because deriving an arrival time from a date would put a fabricated
 * number on the one column whose purpose is measuring promptness.
 *
 * So this returns null for a window with no stamped rows, and the console says "not measurable before this release"
 * rather than showing a zero that reads like perfect promptness.
 */
export function ingestLagP95Minutes(lagsMinutes: number[]): number | null {
  const xs = lagsMinutes.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  // Nearest-rank p95, the same definition ADMIN-10 used for its latency figures: with n samples the p95 is the
  // ceil(0.95n)-th, which for small n is the largest sample rather than an interpolation nobody can reproduce by hand.
  const rank = Math.ceil(0.95 * xs.length);
  return xs[Math.min(rank, xs.length) - 1];
}

export function lagKey(p95: number | null, targetMinutes = 60): string {
  if (p95 === null) return 'mp11.lag.noSource';
  return p95 <= targetMinutes ? 'mp11.lag.withinTarget' : 'mp11.lag.overTarget';
}

export function lagClass(p95: number | null, targetMinutes = 60): string {
  // **UNKNOWN IS A WARNING, NOT A PASS.** A missing lag figure is a platform that cannot tell how fresh its price
  // intelligence is, which on a selling decision is worse than a slow one.
  if (p95 === null) return 'kv-note is-warn';
  return p95 <= targetMinutes ? 'kv-note' : 'kv-note is-warn';
}

/* ------------------------------------------------------------------------------------------------ */
/* SOURCE MIX                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

/** W107's "61 / 22 / 12 / 5" — shares in whole percent, computed from counts, never stored. */
export function sourceShares(mix: SourceMix[]): { source: string; n: number; pct: number }[] {
  const total = mix.reduce((s, m) => s + m.n, 0);
  if (total === 0) return mix.map((m) => ({ ...m, pct: 0 }));
  return mix.map((m) => ({ ...m, pct: Math.round((m.n / total) * 100) }));
}

/** **THE SHARE THAT IS A RISK MEASURE AND NOT A STATISTIC.** Manual entry is where a typo comes from, so the proportion
 *  of today's price intelligence that a human typed is the number an operator should watch — and it is not one of the
 *  four the canon puts on a tile. */
export function humanEnteredShare(mix: SourceMix[]): number {
  const shares = sourceShares(mix);
  return shares.filter((s) => s.source === 'ambassador_manual').reduce((a, s) => a + s.pct, 0);
}

/* ------------------------------------------------------------------------------------------------ */
/* STALENESS                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

/** W107: "Stale mandis (>48h) · 37 · ambassador nudges queued".
 *
 *  **COMPUTED FROM `price_date`, WHICH IS DAY-GRANULAR, AND THE CONSOLE SAYS SO.** A mandi whose last report is dated
 *  two days ago is stale by any reading; the 48-hour phrasing implies an hour-precision clock the column cannot give,
 *  and pretending otherwise would be a figure that looks measured and is not. */
export function stalenessKey(days: number, thresholdDays = 2): string {
  if (days >= thresholdDays * 3) return 'mp11.stale.severe';
  return days >= thresholdDays ? 'mp11.stale.stale' : 'mp11.stale.fresh';
}

/* ------------------------------------------------------------------------------------------------ */
/* THE QUARANTINE — the plane's reason for existing                                                  */
/* ------------------------------------------------------------------------------------------------ */

export interface QuarantinedRow {
  id: string;
  priceDate: string;
  productId: string;
  productName: string | null;
  regionName: string | null;
  mandiName: string | null;
  source: string;
  modalMinor: string;
  referenceModalMinor: string | null;
  deviationBp: number | null;
  anomalyState: string;
  ingestedAt: string | null;
}

/** How loud a held observation is. A 10× typo and a 25% one are both held and are not the same call. */
export function severityKey(deviationBp: number | null): string {
  if (deviationBp === null) return 'mp11.sev.unknown';
  if (deviationBp >= 10_000) return 'mp11.sev.extreme';   // 100%+ — an order-of-magnitude typo
  return deviationBp >= 5_000 ? 'mp11.sev.high' : 'mp11.sev.moderate';
}

export function severityClass(deviationBp: number | null): string {
  if (deviationBp === null) return 'kv-badge is-warn';
  return deviationBp >= 10_000 ? 'kv-badge is-danger' : 'kv-badge is-warn';
}

/** Whether a reviewer may still decide this row. Absent, not disabled, on a decided one: re-deciding would overwrite
 *  the note the ambassador was shown, which is the feedback this platform gives instead of a reprimand. */
export function canDecide(state: string): boolean {
  return state === 'quarantined';
}

export function decidedNoticeKey(state: string): string | null {
  if (state === 'quarantined') return null;
  if (state === 'released') return 'mp11.decided.released';
  if (state === 'rejected') return 'mp11.decided.rejected';
  return 'mp11.decided.notHeld';
}

/**
 * **WHAT RELEASING ACTUALLY DOES, SPELLED OUT WHERE THE CONTROL IS.** A released observation becomes eligible to feed
 * alerts from that moment — it does NOT retroactively fire the alerts it would have crossed while it was held.
 *
 * That is a deliberate refusal. An alert saying "groundnut crossed your threshold" sent nine hours late, after the mandi
 * has closed, is worse than no alert: it invites a farmer to act on a window that has shut. The queue's job is to be
 * fast, not to time-travel.
 */
export const RELEASE_DOES_NOT_BACKFILL_ALERTS = 'mp11.release.noBackfill';

/** The one-line count that says whether the guard is working or merely present. Zero held observations with a
 *  non-trivial manual share means either clean data or a gate that is not gating, and the console prints both numbers so
 *  a reader can tell which. */
export function guardStateKey(heldToday: number, manualSharePct: number): string {
  if (heldToday > 0) return 'mp11.guard.holding';
  return manualSharePct > 0 ? 'mp11.guard.noneHeldWithManual' : 'mp11.guard.noManual';
}
