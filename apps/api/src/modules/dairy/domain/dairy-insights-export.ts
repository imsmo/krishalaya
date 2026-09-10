// modules/dairy/domain/dairy-insights-export.ts · W172's figures as the ROWS of a file (PC-56 TENANT-6e-2). Pure.
//
// THE FILE IS THE PAGE, IN LONG FORM. Six columns — `section, metric, value, unit, basis, note` — one row per figure,
// so a spreadsheet can filter on `section` and nobody has to know which of forty columns held the litres. It is built
// from the SAME read model the screen renders (`DairyInsightsView`), so a number in the file cannot disagree with the
// number on the page.
//
// WHAT IS NOT A ROW, AND WHY THE RECEIPT SAYS SO. TENANT-6e-1 refused two of W172's eleven figures by name — the
// on-time payout streak (nothing records when milk money arrived) and spoilage (nothing reduces anybody's litres) —
// and bounded a third (rate card version: 0009 gave the table none). **A refused figure is NOT a row**: a row reading
// `payout_streak,,not recorded` is a cell somebody sums. The refusals go into the receipt's NOTES instead, which is
// where W2554 prints them — a spreadsheet missing a column invites somebody to compute it from the wrong ones
// (TENANT-5d's rule), and the notes are what stop that.
//
// MONEY. Every money cell is the read model's MINOR units rendered at the tenant CURRENCY's own `minor_units` — never a
// guessed two decimals (the yen has none) — as a plain decimal with no grouping (a spreadsheet cannot sum "51,60"),
// and the ISO code sits in its own `unit` column. Litres are the desk's milli-litre convention (0155) to three places.
import type { DairyInsightsView } from '../read-models/dairy-insights.read-model';
import { ChangeVerdict, ratePerLitreText } from './dairy-insights';

export const INSIGHTS_EXPORT_HEADER = ['section', 'metric', 'value', 'unit', 'basis', 'note'] as const;
export type InsightsExportRow = [string, string, string, string, string, string];

/** Minor units → plain major decimal at the currency's scale. `5160` at 2 → `51.60`; `5160` at 0 → `5160`. No grouping. */
export function majorText(minor: bigint, minorUnits: number): string {
  if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 4) throw new Error(`majorText: minor_units out of range (${minorUnits})`);
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const scale = 10n ** BigInt(minorUnits);
  const frac = minorUnits === 0 ? '' : `.${(abs % scale).toString().padStart(minorUnits, '0')}`;
  return `${neg ? '-' : ''}${abs / scale}${frac}`;
}

/** Milli-litres → litres to three places, exact (the column is numeric(8,3) × 1000, so nothing is rounded). */
export function litresText3(milli: bigint): string {
  const neg = milli < 0n;
  const abs = neg ? -milli : milli;
  return `${neg ? '-' : ''}${abs / 1000n}.${String(abs % 1000n).padStart(3, '0')}`;
}

/** Basis points → percent text with two decimals, sign kept: `900` → `9.00`, `-25` → `-0.25`. */
export function pctText(bps: number): string {
  const neg = bps < 0;
  const abs = Math.abs(Math.trunc(bps));
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** A change verdict as a (value, note) pair. The verdicts that are not a movement become WORDS in the value cell, never
 *  a zero — `from_zero` is not 0% and `both_zero` is not "unchanged". */
export function changeCells(c: ChangeVerdict): { value: string; note: string } {
  switch (c.kind) {
    case 'changed': return { value: pctText(c.deltaBps), note: `previous ${c.from} -> current ${c.to} (raw units)` };
    case 'from_zero': return { value: 'no comparable period', note: 'the previous window had nothing; a percentage over zero is undefined' };
    case 'to_zero': return { value: 'fell to zero', note: `previous ${c.from} (raw units)` };
    case 'both_zero': return { value: 'nothing in either period', note: '' };
    case 'no_previous': return { value: 'no previous window', note: '' };
  }
}

/** The receipt's notes for W172 — the things the file admits. The three refusals are ALWAYS present. */
export const INSIGHTS_EXPORT_STANDING_NOTES: readonly string[] = Object.freeze([
  'payout streak: NOT in this file — nothing on this platform records when a milk payment arrived (dairy_bill_cycles.paid_at, milk_bills.paid_at, payouts.settled_at are absent); cycles_closed and cycles_all_bills_approved are the supportable substitutes',
  'spoilage: NOT in this file — no relation reduces anybody\'s litres anywhere in the schema (TENANT-6d-2\'s verdict)',
  'rate card version: NOT in this file — milk_rate_cards has no version column; cards are listed by name and effective date',
  'member rate per litre is the COUNTER rate before feed credit, loan instalments, insurance and share deductions',
  'daily volume is averaged over every CALENDAR day in the window, not over the days that had pours',
  'pourer cohorts are judged against a declared lookback: "new" means first pour within it, not first pour ever',
  'the window ends on today, which is a partial day until midnight',
  'money is in the tenant currency\'s major units at its own number of decimal places; the currency code is in the unit column',
]);

export interface InsightsExportFile { rows: InsightsExportRow[]; notes: string[]; fileSuffix: string }

/** Build the file from a view. Refuses nothing itself: a `not_enabled` or `unavailable` view is the PRODUCER's refusal
 *  (a job failure with a code), and this function is only ever handed a view that has figures to print. */
export function insightsExportRows(view: Exclude<DairyInsightsView, { kind: 'not_enabled' } | { kind: 'unavailable' }>, opts: { lookbackDaysNote?: string } = {}): InsightsExportFile {
  const rows: InsightsExportRow[] = [];
  const notes: string[] = [...INSIGHTS_EXPORT_STANDING_NOTES];
  const R = (section: string, metric: string, value: string | number | bigint, unit = '', basis = '', note = '') => {
    rows.push([section, metric, String(value), unit, basis, note]);
  };
  const win = view.ranges;
  R('window', 'from', win.current.from, 'date');
  R('window', 'to', win.current.to, 'date', '', 'today — a partial day');
  R('window', 'days', win.current.days, 'days');
  R('window', 'previous_from', win.previous.from, 'date');
  R('window', 'previous_to', win.previous.to, 'date');
  R('window', 'cohort_lookback_from', win.lookbackFrom, 'date', 'first_pour_within_lookback', opts.lookbackDaysNote ?? '');

  if (view.kind === 'no_data') {
    R('history', 'state', 'no_data', '', '', 'no pours recorded within the lookback');
    notes.push('no pours were recorded within the lookback window; the file holds the window only');
    return { rows, notes, fileSuffix: `${win.window}d` };
  }
  if (view.kind === 'not_enough_history') {
    const h = view.history;
    R('history', 'state', 'not_enough_history', '', '', h.kind === 'not_enough_history' ? `${h.haveCycles} of 2 ${h.cycle} cycles` : '');
    R('pourers', 'so_far', view.pourersSoFar, 'pourers');
    notes.push('fewer than two full payment cycles of history: comparisons are not made and the file holds the window and the pourer count only');
    return { rows, notes, fileSuffix: `${win.window}d` };
  }

  const cur = view.currencyCode;
  const mu = view.minorUnits;
  const h = view.history;
  if (h.kind === 'ready') {
    R('history', 'cycles', h.haveCycles, `${h.cycle} cycles`, h.atLeast ? 'at_least' : 'exact', h.atLeast ? 'history reaches the lookback floor and may be older' : '');
  }

  // KPI 1
  const v = view.volume;
  R('volume', 'per_day_avg', litresText3(BigInt(v.perDayMilli)), 'L', v.basis, `collected on ${v.daysWithPours} of ${v.days} days`);
  R('volume', 'total', litresText3(BigInt(v.totalMilli)), 'L');
  const vc = changeCells(v.change);
  R('volume', 'change_vs_previous', vc.value, v.change.kind === 'changed' ? '%' : '', v.basis, vc.note);

  // KPI 2
  const r = view.ratePerLitre;
  if (r.kind === 'measured') {
    R('rate', 'member_per_litre', ratePerLitreText(BigInt(r.centiMinorPerLitre), mu), `${cur}/L`, r.basis, 'before deductions; two extra decimals carried from the ratio');
    R('rate', 'gross_paid_at_counter', majorText(BigInt(r.amountMinor), mu), cur, r.basis);
    const rc = changeCells(r.change);
    R('rate', 'change_vs_previous', r.change.kind === 'changed' ? ratePerLitreText(BigInt(r.change.delta), mu) : rc.value, r.change.kind === 'changed' ? `${cur}/L` : '', r.basis, rc.note);
  } else {
    R('rate', 'member_per_litre', 'no pours', '', 'gross_at_counter', 'a rate over zero litres is nothing, not zero');
  }

  // KPI 3
  const p = view.pourers;
  if (p.kind === 'measured') {
    R('pourers', 'active', p.active, 'pourers');
    R('pourers', 'new', p.newcomers, 'pourers', p.basis, `lookback ${p.lookbackDays} days — new to us this year, not new ever`);
    R('pourers', 'win_backs', p.winBacks, 'pourers', p.basis);
    R('pourers', 'continuing', p.continuing, 'pourers', p.basis);
    const pc = changeCells(p.change);
    R('pourers', 'change_vs_previous', pc.value, p.change.kind === 'changed' ? '%' : '', '', pc.note);
  } else if (p.kind === 'inconsistent') {
    R('pourers', 'active', p.active, 'pourers', '', 'cohorts do not partition the active set — refused on the page; raw counts only here');
    notes.push('pourer cohorts were inconsistent (new + win-backs exceeded active); the cohort rows are omitted');
  } else {
    R('pourers', 'active', 0, 'pourers', '', `no pourers within ${p.lookbackDays} days`);
  }

  // KPI 4 — the substitutes for the refused streak. The streak itself is a NOTE, not a row.
  R('cycles', 'closed_in_window', view.payoutStreak.cyclesClosed, 'cycles', 'substitute_for_unrecorded_payout_streak');
  R('cycles', 'all_bills_approved', view.payoutStreak.cyclesAllBillsApproved, 'cycles', 'substitute_for_unrecorded_payout_streak', 'one disputed bill disqualifies a cycle');

  // The chart. One row per (week, shift) and one per week total; the partial first bucket says so.
  const s = view.byShift;
  s.buckets.forEach((b, i) => {
    const partial = i === 0 && s.firstBucketDays < s.bucketDays ? `partial bucket: ${b.days} of ${s.bucketDays} days` : '';
    for (const shift of s.shifts) R('by_shift', shift, litresText3(BigInt(b.byShift[shift] ?? '0')), 'L', `week ${b.from}..${b.to}`, partial);
    R('by_shift', 'total', litresText3(BigInt(b.totalMilli)), 'L', `week ${b.from}..${b.to}`, partial);
  });

  // The explanation panel. The premium count is `earned` or `would_qualify` and the basis column says which.
  const pr = view.premium;
  if (pr.current.kind === 'measured') {
    R('premium', 'qualifying_pourers', pr.current.qualifying, 'pourers', pr.current.basis, `of ${pr.current.pourers}; slabs: ${pr.current.slabs.map((x) => `${x.metric} >= ${x.minCentiPct / 100}`).join(' | ')}`);
    if (pr.comparable && pr.previous.kind === 'measured') {
      R('premium', 'qualifying_pourers_previous', pr.previous.qualifying, 'pourers', pr.previous.basis);
    } else if (pr.previous.kind === 'basis_unknown') {
      R('premium', 'qualifying_pourers_previous', 'not comparable', '', 'basis_unknown', 'nothing was paid then and premiums are paid now; the platform holds no flag history');
    }
  } else {
    R('premium', 'qualifying_pourers', pr.current.kind === 'no_slabs' ? 'no slabs on any card' : 'no pours', '', '', '');
  }
  R('premium', 'paid_in_window', majorText(BigInt(view.bonusMinor), mu), cur, view.slabsApplied ? 'earned' : 'would_qualify', view.slabsApplied ? '' : 'bonus slabs are switched off: nobody was paid a premium');

  for (const g of view.rateCards.byAnimal) {
    for (const c of g.cards) {
      R('rate_card', g.animalType, c.defaultName, '', c.pricingModel, `effective from ${c.effectiveFrom}${g.effectiveId === c.id ? '; pricing now' : ''}${g.ambiguous ? '; MORE THAN ONE CARD IN FORCE' : ''}`);
    }
  }
  if (view.rateCards.ambiguousAnimalTypes.length > 0) {
    notes.push(`more than one rate card is in force for: ${view.rateCards.ambiguousAnimalTypes.join(', ')} — nothing closes a superseded card's effective_to (TENANT-6b-2)`);
  }
  return { rows, notes, fileSuffix: `${win.window}d` };
}
