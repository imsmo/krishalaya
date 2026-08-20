// apps/web-tenant/src/features/dairy/counter.ts · W167's rules as PURE functions (PC-56 TENANT-6a).
// No React, no I/O — unit- and mutation-tested; the API computes every verdict server-side and this file only decides
// how each one READS.
//
// W167: *"312 pourers · 2 shifts/day · Lactoscan-metered fat/SNF at the counter · every drop rated by the active rate
// card."* Four claims, and the console's job is to print the two that hold, qualify the one that half holds, and
// refuse the one that does not — on a screen about 312 families' milk money.

import type {
  DairyAccrual, DairyAnalyzer, DairyBmcTemp, DairyCounterCentre, DairyCoverage, DairyCycleWindow, DairyFlagSummary,
  DairyPayday, DairyShift, DairyShiftClock,
} from '@krishalaya/sdk-js';

/* ------------------------------------------------------------------------------------------------------- */
/* THE SHIFT                                                                                               */
/* ------------------------------------------------------------------------------------------------------- */

export const SHIFTS = ['morning', 'evening'] as const;

export function shiftOf(raw: string | undefined): DairyShift {
  return raw === 'evening' ? 'evening' : 'morning';
}
export function shiftKey(s: DairyShift): string { return `dairy.shift.${s}`; }

export function boardHref(shift: DairyShift, day?: string | null): string {
  const qs = new URLSearchParams();
  if (shift !== 'morning') qs.set('shift', shift);
  if (day) qs.set('day', day);
  const s = qs.toString();
  return s ? `/dairy?${s}` : '/dairy';
}

/** W167 prints "evening starts 17:00" and its empty state "Morning shift opens 06:00". No shift clock exists on this
 *  platform, and those are the hours a farmer walks to the centre for — so the screen names the shift and says the
 *  hours are not recorded, rather than printing a time nobody set. */
export function shiftClockKey(_c: DairyShiftClock): string { void _c; return 'dairy.shift.clockNotRecorded'; }

/* ------------------------------------------------------------------------------------------------------- */
/* THE CENTRE ROW                                                                                          */
/* ------------------------------------------------------------------------------------------------------- */

/** W167's Analyzer column. A tick is only ever about the CENTRE having an analyzer on file — `device_payload`, the
 *  column built to hold the reading itself, is dead — and the row says which, because W168 hangs an adulteration flag
 *  and a member's money on that reading. */
export function analyzerKey(a: DairyAnalyzer): string {
  return a.kind === 'on_file' ? 'dairy.analyzer.onFile' : 'dairy.analyzer.none';
}
export function analyzerText(a: DairyAnalyzer): string | null {
  if (a.kind !== 'on_file') return null;
  return a.serial ? `${a.model} · ${a.serial}` : a.model;
}
/** Never a tick: the platform cannot say this reading came from that device. */
export function analyzerVerified(a: DairyAnalyzer): boolean { void a; return false; }

/** W167's BMC-temp column: 3.8°C, 4.1°C, "6.9°C ↑". `bmc_units` has had no code since 0007 and no reading has ever
 *  been written, so the honest cell is a sentence rather than a blank — a blank reads as "cold enough to not mention". */
export function bmcKey(b: DairyBmcTemp): string {
  if (b.kind === 'no_unit') return 'dairy.bmc.noUnit';
  if (b.kind === 'no_readings') return 'dairy.bmc.noReadings';
  return b.overTarget ? 'dairy.bmc.overTarget' : 'dairy.bmc.inRange';
}
export function bmcTone(b: DairyBmcTemp): 'ok' | 'bad' | 'muted' {
  if (b.kind !== 'reading') return 'muted';
  return b.overTarget ? 'bad' : 'ok';
}
export function bmcText(b: DairyBmcTemp): string | null {
  return b.kind === 'reading' ? `${b.tempC}°C` : null;
}

/** A centre that has collected nothing this shift is a row an operator must SEE (it is 09:00 and Keshod is empty),
 *  so it is never dropped — and it is marked, because zero litres and no data are different facts. */
export function centreQuietKey(c: Pick<DairyCounterCentre, 'pours'>): string | null {
  return c.pours === 0 ? 'dairy.centre.noPoursYet' : null;
}

/** The share of a centre's own roll that has poured this shift, as a display string. Computed from counts, never from
 *  a stored percentage. */
export function centreCoverageText(c: Pick<DairyCounterCentre, 'pourers' | 'membershipsEnrolled'>): string | null {
  if (c.membershipsEnrolled <= 0) return null;
  return `${c.pourers}/${c.membershipsEnrolled}`;
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE TILES                                                                                               */
/* ------------------------------------------------------------------------------------------------------- */

/** W167's "287 of 312 pourers". The COUNT first: an operator chasing the twenty-five who have not come needs the
 *  number, and the share is what tells them whether today is unusual. */
export function coverageKey(c: DairyCoverage): string {
  return c.kind === 'measured' ? 'dairy.coverage.measured' : 'dairy.coverage.noMemberships';
}
export function coverageShareText(c: DairyCoverage): string | null {
  return c.kind === 'measured' ? `${(c.shareBps / 100).toFixed(1)}%` : null;
}

/** W167's quality tile ("6.4 fat · 8.9 SNF"). Null when nothing was poured — a centre with no pours has no quality,
 *  and "0.0 fat" would read as water. */
export function qualityText(fatPct: string | null, snfPct: string | null): string | null {
  if (fatPct === null && snfPct === null) return null;
  return `${fatPct ?? '—'} / ${snfPct ?? '—'}`;
}

/**
 * W167's *"Value accrued (cycle to date) ₹24,88,200 · 312 milk_bills building"*.
 *
 * Two sentences, because they are two different facts. The money is real and priced at the counter in bigint — and it
 * is an ACCRUAL: W169's bills subtract feed credit, loan EMI and insurance from it, so calling it a payable would
 * overstate what 312 families are about to receive. And the bills are NOT building: nothing generates them on a clock
 * (`MilkBillCycleCloseJob` is instantiated nowhere), so the screen prints members-who-poured beside bills-that-exist
 * and lets the gap speak.
 */
export function accrualKey(_a: DairyAccrual): string { void _a; return 'dairy.accrual.beforeDeductions'; }

export function billsGapKey(a: DairyAccrual): string | null {
  if (a.membersWithPours === 0) return null;
  return a.billsExisting === 0 ? 'dairy.accrual.noBillsYet' : 'dairy.accrual.billsPartial';
}

/** The premium the canon promises and the engine never applied. Shown wherever the accrual is shown, because a total
 *  that silently excludes a bonus a member believes they earned is the worst kind of correct number. */
export function bonusIgnoredKey(a: DairyAccrual): string | null {
  return a.bonusRulesIgnored ? 'dairy.accrual.bonusIgnored' : null;
}

/** W167's window line ("Cycle 01–15 Jul"), labelled as DERIVED from the members' own preference — because no cycle
 *  record, close or payday exists on this platform. */
export function windowKey(w: DairyCycleWindow): string { return `dairy.window.${w.cycle}`; }
export function windowBasisKey(w: DairyCycleWindow): string { void w; return 'dairy.window.derived'; }

/** "closes Wed 15, pays Fri 17 Jul" — the close is the window's last day; the payday is refused by name. */
/**
 * [PC-56 TENANT-6c-6] THIS RETURNED `notRecorded` UNCONDITIONALLY, AND HAD BEEN WRONG FOR FIVE WAVES.
 *
 * TENANT-6a wrote it when nothing on this platform recorded a dairy payday — true then. TENANT-6c-1 gave the cycle a
 * row with a `payday` from the cooperative's own setting (0157), and this board went on telling every operator the
 * platform could not say when they would be paid. A screen that keeps refusing after the thing was built is the same
 * defect as one that claims something that was never built.
 *
 * `notRecorded` now means what it says: no cycle row exists for this window, so the scheduled run has not reached this
 * tenant. Either way the canon's *"one bank trip"* stays unclaimed — see W169, which is where the cycle is worked.
 */
export function paydayKey(p: DairyPayday): string {
  return p.kind === 'recorded' ? 'dairy.payday.recorded' : 'dairy.payday.notRecorded';
}

/** W167's flag tile. The count and its kinds are real; everything the canon promises AFTER the flag — the retained
 *  sample, the re-test, the decision, the member's notification in Gujarati — is not recorded anywhere. */
export function flagsKey(f: DairyFlagSummary): string {
  return f.total === 0 ? 'dairy.flags.none' : 'dairy.flags.some';
}
export function flagKindKey(kind: string): string {
  const known = ['water_flag', 'urea', 'starch', 'detergent'];
  return known.includes(kind) ? `dairy.flagKind.${kind}` : 'dairy.flagKind.other';
}
export function flagWorkflowKey(f: DairyFlagSummary): string | null {
  return f.total > 0 ? 'dairy.flags.workflowNotBuilt' : null;
}

/** The one promise on this screen that IS enforced end to end — UNIQUE(membership_id, collected_on, shift) plus the
 *  service's typed refusal. Stated as a fact because it is one. */
export function uniquenessKey(): string { return 'dairy.pour.unique'; }

/** W167's own foot-of-table check ("3 MCCs · 2,148 L morning total ✓"): the centre rows must sum to the total the
 *  header printed. Recomputed here from the rows rather than trusted, in tenths of a litre so the comparison is
 *  integer — a tick that is not a check is decoration. */
export function totalsFoot(centres: readonly Pick<DairyCounterCentre, 'litres'>[], totalLitres: string): { centres: number; litres: string; foots: boolean } {
  const tenths = (s: string) => {
    const [i, f = '0'] = s.split('.');
    return BigInt(i) * 10n + BigInt((f + '0').slice(0, 1));
  };
  const sum = centres.reduce((a, c) => a + tenths(c.litres), 0n);
  return { centres: centres.length, litres: totalLitres, foots: sum === tenths(totalLitres) };
}

/* ------------------------------------------------------------------------------------------------------- */
/* STATES, AND THE CHAIN THIS SCREEN DOES NOT HAVE                                                          */
/* ------------------------------------------------------------------------------------------------------- */

/** The same split TENANT-5c/5d established: the flag guard throws 404 by design (invisible when disabled, Law 10), a
 *  403 is the restricted state, anything else is the load error — whose copy carries W167's own promise that counter
 *  devices buffer offline and no pour is lost (Law 12). */
export type DairyViewState = 'ok' | 'flaggedOff' | 'restricted' | 'error';

export function dairyState(code: string | null | undefined, status?: number): DairyViewState {
  if (!code && status === undefined) return 'ok';
  if (code === 'FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'NOT_FOUND' || status === 404) return 'flaggedOff';
  return 'error';
}
export function dairyStateKey(s: DairyViewState): string { return `dairy.state.${s}`; }

/**
 * W2559–W2561 are the dairy MUTATE chain, and their shared pattern names the action they host: **"Retry"**.
 *
 * A retry of a read is a page load. This console does not invent a route, a confirm step or an audit row for it — the
 * fifth time this programme has made that call, and for the same reason each time: a mutate row that records an act
 * nobody performed is a lie in an audit trail. The refusal is exported so the panel's own test can assert it rather
 * than it being an absence nobody notices.
 */
export const MUTATE_CHAIN_IS_RETRY = true;
export function retryChainKey(): string { return 'dairy.retryIsReload'; }
