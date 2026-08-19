// apps/web-tenant/src/features/dairy/quality.ts · W168's rules as PURE functions (PC-56 TENANT-6b-2).
// No React, no I/O — unit- and mutation-tested. The API computes every verdict server-side; this file only decides how
// each one READS, and refuses to let a claim the software cannot keep reach the screen as a plain sentence.
//
// W168's subtitle sets the standard the whole file works to: *"adulteration test hits quarantine the pour, never the
// person — investigation first, dignity always."*

import type {
  DairyFlagProtocol, DairyPremiumBand, DairyQualityFlagRow, DairyRateCardsInForce, DairyStabilityVerdict,
  DairyWorkedExample,
} from '@krishalaya/sdk-js';

/* ------------------------------------------------------------------------------------------------------- */
/* THE CYCLE'S QUALITY                                                                                     */
/* ------------------------------------------------------------------------------------------------------- */

/** W168's *"Cycle avg fat 6.4"*. Null when the cycle carried no milk — "0.00" would read as water, the same call the
 *  counter board makes for the same reason. */
export function avgText(pct: string | null): string | null { return pct; }

/**
 * W168 prints *"stable ±0.1 across 13 days"* as a statement of fact on the SNF tile.
 *
 * It is measurable, so it is measured — and the reading has to carry the day count, because "stable across 13 days" and
 * "stable across 1 day" are different claims and only one means anything. Under two days there is no spread at all and
 * the desk says so instead of printing a reassuring zero.
 */
export function stabilityKey(s: DairyStabilityVerdict): string {
  if (s.kind === 'insufficient_days') return 'dairy.quality.stability.tooFewDays';
  return s.withinTolerance ? 'dairy.quality.stability.stable' : 'dairy.quality.stability.swinging';
}
export function stabilityTone(s: DairyStabilityVerdict): 'ok' | 'bad' | 'muted' {
  if (s.kind === 'insufficient_days') return 'muted';
  return s.withinTolerance ? 'ok' : 'bad';
}
/**
 * The spread itself, in percentage points — the number behind the word.
 *
 * TWO decimals, not one, and the reason is the tolerance: W168's claim is ±0.1, so a spread of 0.08 rounded to one
 * decimal prints as "0.1" and reads as *exactly at* the limit while actually being inside it — and 0.04 and 0.14 would
 * print the same. A reader has to be able to tell a comfortable cycle from a marginal one.
 *
 * Formatted from the INTEGER, never through a float: `(605/100).toFixed(1)` is "6.0" in JavaScript, because 6.05 is not
 * representable — which is how a threshold silently displays lower than it is.
 */
export function spreadText(centiPct: string): string {
  const n = BigInt(centiPct);
  const sign = n < 0n ? '-' : '';
  const abs = n < 0n ? -n : n;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
export function stabilityToleranceText(s: DairyStabilityVerdict): string | null {
  if (s.kind !== 'measured') return null;
  return `±${(s.toleranceCentiPct / 100).toFixed(1)}`;
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE FLAGS TILE                                                                                          */
/* ------------------------------------------------------------------------------------------------------- */

/** W168: *"Flags this cycle 4 · 3 water_flag · 1 starch — all resolved or in review"*. The last clause is a CLAIM, and
 *  it is only true while nothing is sitting untouched — so it is checked rather than printed. */
export function flagsClaimKey(f: { total: number; allResolvedOrInReview: boolean; openCount: number }): string {
  if (f.total === 0) return 'dairy.quality.flags.none';
  return f.allResolvedOrInReview ? 'dairy.quality.flags.allHandled' : 'dairy.quality.flags.awaiting';
}
export function flagsTone(f: { total: number; allResolvedOrInReview: boolean }): 'ok' | 'bad' | 'muted' {
  if (f.total === 0) return 'muted';
  return f.allResolvedOrInReview ? 'ok' : 'bad';
}
/** The kinds, in the canon's own order of prominence: water first, then the named adulterants, then anything a tenant
 *  invented. Reuses the counter board's key convention so one flag reads the same on both dairy screens. */
export function reasonKey(kind: string): string {
  const known = ['water_flag', 'urea', 'starch', 'detergent'];
  return known.includes(kind) ? `dairy.flagKind.${kind}` : 'dairy.flagKind.other';
}
export function reasonOrder(kinds: readonly string[]): string[] {
  const rank = (k: string) => (k === 'water_flag' ? 0 : ['urea', 'starch', 'detergent'].includes(k) ? 1 : 2);
  return [...kinds].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE PREMIUM BAND                                                                                        */
/* ------------------------------------------------------------------------------------------------------- */

/**
 * W168's *"Premium band pourers 184 / 312 · fat ≥ 6.5 earns the bonus slab"* — present tense, and until TENANT-6b-1
 * nothing on this platform applied a slab to anything.
 *
 * So the tile has to say WHICH of two things it means. `earned` is money that moved. `would_qualify` is a forecast while
 * the tenant's slabs are switched off, and the copy says "would" — a cooperative reading this as paid, and a member
 * hearing it from them, is the exact harm 6b-1 was fixing.
 */
export function premiumBandKey(b: DairyPremiumBand): string {
  if (b.kind === 'no_slabs') return 'dairy.quality.premium.noSlabs';
  if (b.kind === 'no_pours') return 'dairy.quality.premium.noPours';
  return b.basis === 'earned' ? 'dairy.quality.premium.earned' : 'dairy.quality.premium.wouldQualify';
}
export function premiumBandPairText(b: DairyPremiumBand): string | null {
  return b.kind === 'measured' ? `${b.qualifying} / ${b.pourers}` : null;
}
export function premiumBandShareText(b: DairyPremiumBand): string | null {
  return b.kind === 'measured' ? `${(b.shareBps / 100).toFixed(1)}%` : null;
}
/**
 * The band a member has to clear, printed from the card rather than from the canon's 6.5.
 *
 * Formatted from the integer centi-percent, NOT via `(minCentiPct / 100).toFixed(1)` — that returns "6.0" for 605,
 * because 6.05 has no exact float representation, and a member told the band is 6.0 when the card says 6.05 has been
 * told the wrong thing about their own pay. Found by a test, which is the only way this class of bug ever is.
 */
export function slabText(slab: { metric: 'fat' | 'snf'; minCentiPct: number; bonusMinorPerLitre: number }): string {
  const whole = Math.trunc(slab.minCentiPct / 100);
  const cents = Math.abs(slab.minCentiPct % 100);
  const frac = cents % 10 === 0 ? String(cents / 10) : String(cents).padStart(2, '0');
  return `${slab.metric === 'fat' ? 'fat' : 'SNF'} ≥ ${whole}.${frac}`;
}
export function slabMetricKey(slab: { metric: 'fat' | 'snf' }): string { return `dairy.quality.metric.${slab.metric}`; }

/** Shown wherever the band is: the slabs are configured and the engine is not applying them. TENANT-6a's counter board
 *  says the same thing about the accrual; the two must not disagree. */
export function slabsNotAppliedKey(slabsApplied: boolean, b: DairyPremiumBand): string | null {
  if (slabsApplied) return null;
  return b.kind === 'no_slabs' ? null : 'dairy.quality.premium.notApplied';
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE RATE CARDS                                                                                          */
/* ------------------------------------------------------------------------------------------------------- */

/**
 * W168: *"Active rate card — Buffalo two_axis v4 … Effective 01 Jul → (v3 archived, history kept)"*.
 *
 * Three separate things, and the software supports one and a half of them:
 *   • ONE active card per animal type — **not guaranteed.** Nothing closes a superseded card's `effective_to`, so two
 *     can be in force and the pricing path silently takes whichever starts later. When that happens the desk says which
 *     one is winning, because "Active rate card" in the singular over a database holding two is how a cooperative comes
 *     to believe it changed a rate it did not change.
 *   • *"history kept"* — TRUE. The old row persists and every pour records the `rate_card_id` that priced it.
 *   • *"v3 archived"* — describes an act nobody performs. There is no archive, no supersede, no deactivate.
 */
export function cardAmbiguityKey(r: DairyRateCardsInForce): string | null {
  return r.ambiguousAnimalTypes.length > 0 ? 'dairy.quality.card.ambiguous' : null;
}
export function cardSupersedeKey(r: DairyRateCardsInForce): string {
  void r; return 'dairy.quality.card.noArchive';
}
/** W168's restricted state promises "rate cards are owner + checker". There is no second approver anywhere on this
 *  path — one `dairy.manage` holder changes what every member is paid, alone. Stated on the panel that shows the card. */
export function cardCheckerKey(r: DairyRateCardsInForce): string {
  void r; return 'dairy.quality.card.noChecker';
}
export function cardEffectiveKey(cardId: string, effectiveId: string | null): string | null {
  if (effectiveId === null) return null;
  return cardId === effectiveId ? 'dairy.quality.card.pricingWith' : 'dairy.quality.card.shadowed';
}
export function pricingModelKey(model: string): string { return `dairy.model.${model}`; }
export function animalTypeKey(animalType: string): string { return `dairy.animal.${animalType}`; }

/* ------------------------------------------------------------------------------------------------------- */
/* THE WORKED EXAMPLE                                                                                      */
/* ------------------------------------------------------------------------------------------------------- */

/** W168: *"the counter shows this arithmetic to the farmer, line by line."* So it is lines, not a total — and each line
 *  is only shown when the card actually charges for it, because a "SNF ₹0" line on a fat-pooled card teaches a farmer
 *  the wrong thing about their own pay. */
export function exampleLines(e: DairyWorkedExample): Array<{ key: string; qty: string | null; amountMinor: string }> {
  const lines: Array<{ key: string; qty: string | null; amountMinor: string }> = [];
  if (e.fatMinor !== '0') lines.push({ key: 'dairy.quality.example.fat', qty: e.fatKg, amountMinor: e.fatMinor });
  if (e.snfMinor !== '0') lines.push({ key: 'dairy.quality.example.snf', qty: e.snfKg, amountMinor: e.snfMinor });
  if (e.baseMinor !== '0') lines.push({ key: 'dairy.quality.example.base', qty: e.litres, amountMinor: e.baseMinor });
  if (e.bonusApplied && e.bonusMinor !== '0') lines.push({ key: 'dairy.quality.example.bonus', qty: e.litres, amountMinor: e.bonusMinor });
  return lines;
}
/** The premium a pour EARNED but is not being paid — the line the example must not silently include, and must not
 *  silently omit either. */
export function exampleWithheldBonusKey(e: DairyWorkedExample): string | null {
  if (e.bonusApplied) return null;
  return e.slabsEarned.length > 0 ? 'dairy.quality.example.bonusNotApplied' : null;
}
/** Whether the example came from a real pour in this cycle, said out loud when it did not. */
export function exampleBasisKey(e: DairyWorkedExample): string {
  return e.fromRealPour ? 'dairy.quality.example.fromPour' : 'dairy.quality.example.illustrative';
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE OPEN FLAG PANEL                                                                                     */
/* ------------------------------------------------------------------------------------------------------- */

/** The panel's own title: *"Open flag — today, MCC-AND-02, morning"*. */
export function flagTitleParts(f: DairyQualityFlagRow): { mcc: string | null; shiftKey: string } {
  return { mcc: f.mccCode, shiftKey: `dairy.shift.${f.shift}` };
}

/** W168 prints the member as *"AND2-••87"*. The API masks it; this asserts the console never has the whole thing to
 *  leak, and gives a name to the absence when a membership has been removed. */
export function memberLabel(f: DairyQualityFlagRow): { text: string | null; key: string | null } {
  return f.memberCodeMasked ? { text: f.memberCodeMasked, key: null } : { text: null, key: 'dairy.quality.flag.memberGone' };
}

/** The evidence line: *"6.2 L · density 1.024 (low) + water_flag"*. Density is shown when it was recorded and named as
 *  absent when it was not — the column was DEAD until TENANT-6b-1, so most historical flags have none, and a blank
 *  would read as "nothing unusual about the density". */
export function densityKey(f: DairyQualityFlagRow): string {
  return f.densityAtFlag === null ? 'dairy.quality.flag.densityNotRecorded' : 'dairy.quality.flag.density';
}

/** Where the pour's money stands. The hold is the whole point of the screen, so it is a badge and not a footnote. */
export function holdKey(f: DairyQualityFlagRow): string { return `dairy.hold.${f.holdState}`; }
export function holdTone(f: DairyQualityFlagRow): 'ok' | 'bad' | 'muted' {
  if (f.holdState === 'released') return 'ok';
  if (f.holdState === 'rejected') return 'bad';
  return 'muted';
}

/**
 * W168's three steps, and what the platform can witness of each after TENANT-6b-1.
 *
 * Steps 1 and 2 are recorded. Step 3 is not: a dairy committee is a governance body with no representation here, and
 * *"platform risk desk only for organised adulteration"* is admin-api by Law 11 — tenant code may not reach it and must
 * not imply it did. So the third step reads as what is OWED, never as what happened.
 */
export function protocolStepKey(step: 'retest' | 'decision' | 'committee', p: DairyFlagProtocol): string {
  return p[step] === 'recorded' ? `dairy.quality.protocol.${step}.recorded` : `dairy.quality.protocol.${step}.notModelled`;
}
export function protocolStepTone(step: 'retest' | 'decision' | 'committee', p: DairyFlagProtocol): 'ok' | 'muted' {
  return p[step] === 'recorded' ? 'ok' : 'muted';
}

/** Where this flag has actually got to, per row — so the operator sees the next act rather than a status word. */
export function nextActKey(f: DairyQualityFlagRow): string {
  if (f.status === 'open') return 'dairy.quality.flag.needsRetest';
  if (f.status === 'retested') return 'dairy.quality.flag.needsDecision';
  return 'dairy.quality.flag.decided';
}

/** W168 step 3's count, shown only when it is actually owed. */
export function committeeKey(f: DairyQualityFlagRow): string | null {
  return f.committeeReviewRequired ? 'dairy.quality.flag.committeeOwed' : null;
}

/** *"Sample retained & sealed"* — an assertion by whoever ticked it, so its absence is stated rather than assumed. */
export function sealedKey(f: DairyQualityFlagRow): string {
  return f.sampleSealed ? 'dairy.quality.flag.sealed' : 'dairy.quality.flag.notSealed';
}
/** *"with member present"* — recorded as given, never defaulted; `null` means the re-test has not happened yet. */
export function memberPresentKey(f: DairyQualityFlagRow): string | null {
  if (f.retestAt === null) return null;
  return f.memberPresent ? 'dairy.quality.flag.memberPresent' : 'dairy.quality.flag.memberAbsent';
}

/* ------------------------------------------------------------------------------------------------------- */
/* STATES                                                                                                  */
/* ------------------------------------------------------------------------------------------------------- */

/** The same split every wave since TENANT-5c has used: the flag guard throws 404 by design (invisible when disabled,
 *  Law 10), 403 is the restricted state, anything else is the load error — whose copy carries W168's own promise that
 *  analyzer readings buffer at the MCC (Law 12). */
export type QualityViewState = 'ok' | 'flaggedOff' | 'restricted' | 'error';

export function qualityState(code: string | null | undefined, status?: number): QualityViewState {
  if (!code && status === undefined) return 'ok';
  if (code === 'FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'NOT_FOUND' || status === 404) return 'flaggedOff';
  return 'error';
}
export function qualityStateKey(s: QualityViewState): string { return `dairy.quality.state.${s}`; }

/** W168's empty states are two DIFFERENT facts and the canon draws both: no flag open right now, versus no flag in the
 *  whole cycle. A desk that showed one message for both would lose the distinction the canon bothered to make. */
export function emptyKey(total: number, openCount: number): string | null {
  if (total === 0) return 'dairy.quality.empty.cycleClean';
  if (openCount === 0) return 'dairy.quality.empty.noneOpen';
  return null;
}

/** W168's own header buttons: "Rate cards" and "Review flags (n)". Both are `data-decor` in the canon — they name
 *  destinations rather than linking them — so the console points them at what exists: the rate cards live on the
 *  pre-canon operator console (the only surface that can write one), and the flags are on this page. */
export const RATE_CARDS_HREF = '/dairy/console';
export function reviewFlagsCountText(openCount: number): string | null {
  return openCount > 0 ? String(openCount) : null;
}
