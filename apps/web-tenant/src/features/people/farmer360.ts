// apps/web-tenant/src/features/people/farmer360.ts · pure presentation logic for W155 (PC-56 TENANT-1b-3).
//
// No React, no I/O — so the three rules that could quietly mislead a farmer are unit-tested rather than clicked.
import type { Farmer360, Farmer360Season, LandByUnit } from '@krishalaya/sdk-js';

/** The translator interface this module needs, declared narrowly so the tests need no i18n setup. */
export interface T { t(key: string, vars?: Record<string, string | number>): string }

/**
 * Land, ordered largest-first WITHIN each unit group, and **never summed across units**.
 *
 * **THIS IS THE ONE FUNCTION ON THIS SCREEN THAT COULD PUT A WRONG NUMBER ON A LOAN APPLICATION.** `land_parcels.area_unit`
 * is an FK into `units`, where both `acre` and `hectare` exist. A hectare is 2.4711 acres, so adding a 2-acre parcel to a
 * 1-hectare parcel gives "3", which is a quantity in no unit at all — and converting silently is worse, because the factor
 * is not in the units table and a 4.2-acre holding would become a 10.4-acre one with nobody the wiser.
 *
 * So the units stay separate and the screen prints "2 acre + 1 hectare". Most smallholders have one unit and see one
 * number; the ones who do not are exactly the ones a wrong number would hurt most.
 */
export function landSummary(byUnit: LandByUnit[]): LandByUnit[] {
  return [...byUnit]
    .filter((l) => Number(l.area) > 0 || l.parcels > 0)
    .sort((a, b) => (Number(b.area) - Number(a.area)) || a.unit.localeCompare(b.unit));
}

/** True when two or more units are in play — the console uses it to explain why there is no single total. */
export function hasMixedUnits(byUnit: LandByUnit[]): boolean {
  return landSummary(byUnit).length > 1;
}

/** "Kharif 2025". The season code is data (`crop_seasons.season`), so an unrecognised one prints itself. */
export function seasonLabel(s: Pick<Farmer360Season, 'season' | 'year'>, t: T): string {
  const known = ['kharif', 'rabi', 'zaid', 'perennial'];
  const name = known.includes(s.season) ? t.t(`f360.season.${s.season}`) : s.season;
  return `${name} ${s.year}`;
}

/**
 * The yield cell.
 *
 * **AN ABSENT ACTUAL YIELD READS "not recorded" AND NEVER FALLS BACK TO THE EXPECTED FIGURE.** W155 states the rule
 * itself — "Yields are his records + FPO weighbridge — never estimated without saying so" — and this is the single most
 * tempting substitution on the screen: the expected number is right there in the same row. Using it would make a failed
 * season look average on a page a banker may be shown, which is the farmer's loss and not the platform's.
 *
 * When only an EXPECTATION exists it is shown, LABELLED as an expectation. That is not the same as substituting it.
 */
export function yieldLabel(s: Pick<Farmer360Season, 'actualYield' | 'expectedYield'>, t: T): string {
  if (s.actualYield !== null && s.actualYield !== undefined) {
    return t.t('f360.yieldActual', { qty: s.actualYield });
  }
  if (s.expectedYield !== null && s.expectedYield !== undefined) {
    return t.t('f360.yieldExpected', { qty: s.expectedYield });
  }
  return t.t('f360.yieldNone');
}

/**
 * Does this organisation know anything at all about this member's farming?
 *
 * **A 360 WITH NOTHING IN IT MUST SAY SO.** A page of dashes and zeroes reads as a broken page, and a field officer would
 * ring the office about it. It also matters the other way: a member with no land, no seasons, no scheme credits and no
 * income is a member this organisation has not actually served, which is a finding rather than an empty screen.
 */
export function hasAnySource(f: Pick<Farmer360, 'income' | 'land' | 'schemesYtd' | 'seasons'>): boolean {
  return f.seasons.length > 0
    || f.schemesYtd.length > 0
    || f.land.byUnit.length > 0
    || f.income.cropPayoutCount > 0
    || f.income.dairyBillCount > 0;
}

/**
 * The credit evidence as a list of facts, in the order a KCC desk asks for them.
 *
 * **REGULARITY BEFORE TOTAL.** Eight settled payouts across nine months is a different story from eight in one month, and
 * the second is the one a lender discounts — so `monthsWithIncome12mo` leads.
 */
export function creditEvidenceOrder(): ('months' | 'payouts' | 'land' | 'kyc')[] {
  return ['months', 'payouts', 'land', 'kyc'];
}
