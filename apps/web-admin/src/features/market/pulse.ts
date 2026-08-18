// apps/web-admin/src/features/market/pulse.ts · W107 view logic (PC-56 ADMIN-SWEEP).
//
// **THE PAIR THIS SCREEN MUST KEEP APART, AND IT IS THE MOST CONSEQUENTIAL ONE IN THE PANEL:** an empty anomaly queue
// because the data is clean, and an empty anomaly queue because nothing is checking. Before this wave the second was
// always the answer — `MandiPriceService.ingest` fired farmer price alerts off a manually-typed observation in the same
// transaction that inserted it, with no anomaly check anywhere, while W107 promised "bad data never reaches a selling
// decision."
//
// DEV-60 (UI Port Program batch 3, Part 1, slice B): `moveClass` (the one `kv-badge`-returning helper below) now
// returns `moveTone(): StatusTone | null` — disposition (c), SPECIAL CASE disclosed in `spec_dev60.md`: the old
// function returned `''` (no badge at all) when `changeBp === null`, so the tone-returning version returns `null`
// for that branch and the call site conditionally skips rendering `<StatusPill>` entirely rather than remapping an
// empty string to a tone that doesn't exist. `guardClass` in this file is `kv-note`-returning and OUT OF SCOPE.

import type { StatusTone } from '@krishalaya/ui';

export interface Pulse {
  pointsToday: number;
  activeMandis: number;
  sourceMix: { source: string; n: number; pct: number }[];
  ingestLagP95Minutes: number | null;
  ingestLagSampleSize: number;
  stampedToday: number;
  staleMandis: number;
  heldToday: number;
  heldOpen: number;
  manualSharePct: number;
  movers: { productId: string; productName: string | null; regionName: string | null; modalMinor: string; prevModalMinor: string | null; changeBp: number | null; arrivalsQty: string | null }[];
}

/** Rupees from bigint minor units, formatted for display only. **NO CLIENT-SIDE MONEY MATH** — the value arrives as a
 *  string of paise and is divided by 100 for rendering and nothing else. */
export function rupees(minor: string): string {
  const n = BigInt(minor);
  const whole = n / 100n;
  return `₹${whole.toLocaleString('en-IN')}`;
}

/** A day-over-day move, in basis points from the server, rendered as a percentage with its sign. */
export function moveKey(changeBp: number | null): string {
  if (changeBp === null) return 'mp11.move.noPrior';
  if (changeBp === 0) return 'mp11.move.flat';
  return changeBp > 0 ? 'mp11.move.up' : 'mp11.move.down';
}

export function moveTone(changeBp: number | null): StatusTone | null {
  if (changeBp === null) return null;
  // **NEITHER DIRECTION IS "GOOD".** A price rise is good for a seller and bad for a buyer, and this platform serves
  // both — so the colour marks MAGNITUDE (a >10% daily move is worth a look either way) rather than sentiment.
  return Math.abs(changeBp) >= 1_000 ? 'warning' : 'neutral';
}

export function pctFromBp(bp: number): string {
  const sign = bp > 0 ? '+' : '';
  return `${sign}${(bp / 100).toFixed(1)}%`;
}

/** The guard tile. Its three states are the wave's whole finding, rendered. */
export function guardClass(key: string): string {
  if (key === 'mp11.guard.holding') return 'kv-note is-warn';
  // "No manual entries today" is genuinely fine. "Manual entries and nothing held" is the state that needs a second
  // look — it is either clean reporting or a threshold set too wide.
  return key === 'mp11.guard.noneHeldWithManual' ? 'kv-note' : 'kv-note';
}

/** Whether the ingest-lag tile can show a number at all, and why not when it cannot. */
export function lagCellKey(p95: number | null, sampleSize: number): string {
  if (p95 === null) return sampleSize === 0 ? 'mp11.lag.noSource' : 'mp11.lag.noSamples';
  return 'mp11.lag.value';
}
