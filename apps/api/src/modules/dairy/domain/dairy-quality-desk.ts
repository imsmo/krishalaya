// modules/dairy/domain/dairy-quality-desk.ts · W168 (Milk quality desk) as PURE rules (PC-56 TENANT-6b-2).
//
// 6b-1 built what the platform DOES to a flagged pour's money. This file is what the desk may SAY about it — and the
// two halves of W168 that turned out to be claims about software rather than about milk:
//
//   • *"rate cards are owner + checker"* — there is NO second approver on a rate card. One `dairy.manage` holder can
//     change what every member of the cooperative is paid, alone, in one call. The platform HAS the maker-checker
//     pattern (TENANT-4b built it for payouts, migration 0143); the dairy rate card simply does not use it.
//   • *"Effective 01 Jul → (v3 archived, history kept)"* — nothing archives anything. `MilkRateCardService` is
//     CREATE-ONLY: no deactivate, no supersede, and nothing closes the previous card's `effective_to`. So two cards for
//     the same animal type can be in force at once, and `resolveActive`'s `ORDER BY effective_from DESC LIMIT 1` picks
//     one SILENTLY. History is indeed kept (the old row persists, and every pour records the `rate_card_id` that priced
//     it) — but "archived" describes an act nobody performs, and the ambiguity is invisible today.
//
// Everything here is integer arithmetic over scaled values, for the same reason as the counter board: this desk decides
// what 312 families are told they earned.
import { BonusSlab } from './milk-rate-card.entity';
import { AnimalType, PricingModel } from './dairy.events';

/* --------------------------------------------------------------------------------------------------------- */
/* THE CYCLE'S QUALITY, AND THE STABILITY CLAIM                                                              */
/* --------------------------------------------------------------------------------------------------------- */

/** One day of the cycle, as the database can produce it: litre-weighted quality for that day. */
export interface DailyQuality {
  day: string;
  weightMilliKg: bigint;
  fatCentiPctWeighted: bigint | null;
  snfCentiPctWeighted: bigint | null;
}

/**
 * W168's first two tiles: *"Cycle avg fat 6.4"* and *"Cycle avg SNF 8.9 · stable ±0.1 across 13 days"*.
 *
 * The averages are litre-weighted across the WHOLE window (not a mean of daily means — the same rule TENANT-6a's board
 * follows, and for the same reason: a 900-litre day and a 90-litre day do not carry equal votes).
 *
 * The stability claim is the interesting one, because it is checkable and the canon states it as a fact. It is the
 * SPREAD of the daily averages — max minus min, in centi-percent — against the ±0.1 the canon claims. Reported with the
 * number of days it saw, because "stable across 13 days" and "stable across 1 day" are different statements and only
 * one of them means anything. Under two days of data there is no spread to report at all, and the desk says so rather
 * than printing a reassuring 0.0.
 */
export type StabilityVerdict =
  | { kind: 'measured'; days: number; fatSpreadCentiPct: bigint; snfSpreadCentiPct: bigint; withinTolerance: boolean; toleranceCentiPct: number }
  | { kind: 'insufficient_days'; days: number; needed: number };

/** W168's own tolerance: "stable ±0.1" — one tenth of a percentage point, which is 10 centi-percent. */
export const STABILITY_TOLERANCE_CENTI_PCT = 10;
export const STABILITY_MIN_DAYS = 2;

export interface CycleQuality {
  fatCentiPctWeighted: bigint | null;
  snfCentiPctWeighted: bigint | null;
  weightMilliKg: bigint;
  days: number;
  stability: StabilityVerdict;
}

export function cycleQuality(rows: readonly DailyQuality[]): CycleQuality {
  let weight = 0n, fatNum = 0n, fatDen = 0n, snfNum = 0n, snfDen = 0n;
  const fats: bigint[] = [];
  const snfs: bigint[] = [];
  for (const r of rows) {
    weight += r.weightMilliKg;
    if (r.fatCentiPctWeighted !== null) { fatNum += r.fatCentiPctWeighted * r.weightMilliKg; fatDen += r.weightMilliKg; fats.push(r.fatCentiPctWeighted); }
    if (r.snfCentiPctWeighted !== null) { snfNum += r.snfCentiPctWeighted * r.weightMilliKg; snfDen += r.weightMilliKg; snfs.push(r.snfCentiPctWeighted); }
  }
  // Days COUNTED are days that actually carried milk — a centre closed on Sunday is not an unstable Sunday.
  const days = rows.filter((r) => r.weightMilliKg > 0n).length;
  const spread = (xs: bigint[]) => (xs.length === 0 ? 0n : xs.reduce((a, b) => (b > a ? b : a)) - xs.reduce((a, b) => (b < a ? b : a)));
  const fatSpread = spread(fats);
  const snfSpread = spread(snfs);
  const tol = BigInt(STABILITY_TOLERANCE_CENTI_PCT);
  return {
    fatCentiPctWeighted: fatDen > 0n ? (fatNum + fatDen / 2n) / fatDen : null,
    snfCentiPctWeighted: snfDen > 0n ? (snfNum + snfDen / 2n) / snfDen : null,
    weightMilliKg: weight,
    days,
    stability: days < STABILITY_MIN_DAYS
      ? { kind: 'insufficient_days', days, needed: STABILITY_MIN_DAYS }
      : {
        kind: 'measured', days,
        fatSpreadCentiPct: fatSpread, snfSpreadCentiPct: snfSpread,
        // Both axes must hold: W168 puts the claim on the SNF tile, but a cooperative reading "stable" beside a fat
        // average that swung half a point has been told something false about the thing it is paid on.
        withinTolerance: fatSpread <= tol && snfSpread <= tol,
        toleranceCentiPct: STABILITY_TOLERANCE_CENTI_PCT,
      },
  };
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE PREMIUM BAND                                                                                          */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W168's fourth tile: *"Premium band pourers 184 / 312 · fat ≥ 6.5 earns the bonus slab"*.
 *
 * The canon says **earns**, present tense, and until TENANT-6b-1 nothing on this platform applied a slab to anything.
 * So the count has two entirely different meanings depending on one flag, and conflating them would be the same lie in
 * a new place:
 *
 *   • `basis: 'earned'`        — `dairy_bonus_slabs` is ON, so these members were actually PAID a premium in the
 *                                window (counted from `milk_collections.bonus_minor > 0`, i.e. from money).
 *   • `basis: 'would_qualify'` — the flag is OFF. Nobody was paid anything. These are the members whose best pour in
 *                                the window would have cleared the card's lowest fat slab, and the desk must say
 *                                "would" out loud.
 *
 * `no_slabs` is its own verdict rather than a zero: a cooperative whose card promises no premium is not a cooperative
 * whose members all missed one.
 */
export type PremiumBandVerdict =
  | { kind: 'measured'; basis: 'earned' | 'would_qualify'; qualifying: number; pourers: number; shareBps: number; slabs: readonly BonusSlab[] }
  | { kind: 'no_slabs' }
  | { kind: 'no_pours'; slabs: readonly BonusSlab[] };

export function premiumBand(i: {
  slabs: readonly BonusSlab[];
  slabsApplied: boolean;
  pourers: number;
  earnedCount: number;
  wouldQualifyCount: number;
}): PremiumBandVerdict {
  if (i.slabs.length === 0) return { kind: 'no_slabs' };
  if (i.pourers <= 0) return { kind: 'no_pours', slabs: i.slabs };
  const qualifying = i.slabsApplied ? i.earnedCount : i.wouldQualifyCount;
  return {
    kind: 'measured',
    basis: i.slabsApplied ? 'earned' : 'would_qualify',
    qualifying,
    pourers: i.pourers,
    shareBps: Math.round((qualifying * 10_000) / i.pourers),
    slabs: i.slabs,
  };
}

/** The lowest FAT threshold on a card — the band a member has to clear to be "in the premium band" at all. */
export function lowestFatSlabCentiPct(slabs: readonly BonusSlab[]): number | null {
  const fat = slabs.filter((s) => s.metric === 'fat').map((s) => s.minCentiPct);
  return fat.length === 0 ? null : Math.min(...fat);
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE RATE CARDS IN FORCE                                                                                   */
/* --------------------------------------------------------------------------------------------------------- */

export interface RateCardSummary {
  id: string;
  defaultName: string;
  animalType: AnimalType;
  pricingModel: PricingModel;
  ratePerKgFatMinor: string | null;
  ratePerKgSnfMinor: string | null;
  baseRatePerLitreMinor: string | null;
  slabs: readonly BonusSlab[];
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * W168's *"Active rate card — Buffalo two_axis v4 … Effective 01 Jul → (v3 archived, history kept)"*.
 *
 * **Two claims, and the software supports neither the way the sentence reads.**
 *
 * `ambiguous` — `MilkRateCardService` is CREATE-ONLY. Nothing closes the previous card's `effective_to`, so a
 * cooperative that adds "v4" without editing v3 has TWO cards in force for that animal type, and
 * `MilkRateCardRepository.resolveActive` quietly prices every pour with whichever has the later `effective_from`.
 * Nothing warns anybody. The desk shows every in-force card and names which one is winning, because the alternative is
 * a screen that says "Active rate card" in the singular over a database that disagrees.
 *
 * `supersedeRecorded: false` — history IS kept (the old row persists and every pour records the `rate_card_id` that
 * priced it), so the canon is right about the important half. What does not exist is an ARCHIVE: no act, no column,
 * nobody's name against it. Stated rather than implied.
 *
 * `checkerRequired: false` — one `dairy.manage` holder can create the card that changes what every member is paid, in
 * one call, with no second approver, while W168's restricted state promises "owner + checker". This platform HAS the
 * pattern (TENANT-4b's payout approval gate, 0143). Naming it, not faking it: a screen that displayed a checker who
 * does not exist would be worse than one that says the gate is missing.
 */
export interface RateCardsInForce {
  byAnimal: Array<{
    animalType: AnimalType;
    cards: RateCardSummary[];
    /** The one `resolveActive` would pick for a pour today: latest `effective_from`, ties broken as SQL breaks them. */
    effectiveId: string | null;
    ambiguous: boolean;
  }>;
  ambiguousAnimalTypes: AnimalType[];
  supersedeRecorded: false;
  checkerRequired: false;
}

export function rateCardsInForce(cards: readonly RateCardSummary[]): RateCardsInForce {
  const groups = new Map<AnimalType, RateCardSummary[]>();
  for (const c of cards) {
    const g = groups.get(c.animalType) ?? [];
    g.push(c);
    groups.set(c.animalType, g);
  }
  const byAnimal = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([animalType, list]) => {
      const sorted = [...list].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0));
      return { animalType, cards: sorted, effectiveId: sorted[0]?.id ?? null, ambiguous: sorted.length > 1 };
    });
  return {
    byAnimal,
    ambiguousAnimalTypes: byAnimal.filter((g) => g.ambiguous).map((g) => g.animalType),
    supersedeRecorded: false,
    checkerRequired: false,
  };
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE WORKED EXAMPLE                                                                                        */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W168: *"Example: 7.1 L @ fat 6.8 / SNF 9.1 → fat 0.483 kg × ₹720 + SNF 0.646 kg × ₹340 + bonus ≈ ₹571 — the counter
 * shows this arithmetic to the farmer, line by line."*
 *
 * Computed from the TENANT'S OWN card rather than printed from the canon, and line by line as promised, because the
 * point of the sentence is that a farmer can check it. `bonusMinor` is separated and carries whether the slabs are
 * actually being applied — an example that silently includes a premium the tenant has not switched on would teach a
 * member to expect money they will not receive.
 */
export interface WorkedExample {
  litres: string;
  fatPct: string;
  snfPct: string;
  fatKgMilli: bigint;
  snfKgMilli: bigint;
  fatMinor: bigint;
  snfMinor: bigint;
  baseMinor: bigint;
  bonusMinor: bigint;
  bonusApplied: boolean;
  slabsEarned: readonly BonusSlab[];
  totalMinor: bigint;
}

const roundDiv = (num: bigint, den: bigint): bigint => (num + den / 2n) / den;

export function workedExample(i: {
  card: Pick<RateCardSummary, 'pricingModel' | 'ratePerKgFatMinor' | 'ratePerKgSnfMinor' | 'baseRatePerLitreMinor' | 'slabs'>;
  weightMilliKg: bigint;
  fatCentiPct: bigint;
  snfCentiPct: bigint;
  slabsApplied: boolean;
}): WorkedExample {
  const { card } = i;
  const fatRate = card.ratePerKgFatMinor === null ? 0n : BigInt(card.ratePerKgFatMinor);
  const snfRate = card.ratePerKgSnfMinor === null ? 0n : BigInt(card.ratePerKgSnfMinor);
  const baseRate = card.baseRatePerLitreMinor === null ? 0n : BigInt(card.baseRatePerLitreMinor);
  const usesFat = card.pricingModel === 'two_axis' || card.pricingModel === 'fat_pooled';
  const usesSnf = card.pricingModel === 'two_axis' || card.pricingModel === 'snf_pooled';

  // kg of fat, in milli-kg: weightMilliKg × fatCentiPct / 10000
  const fatKgMilli = usesFat ? roundDiv(i.weightMilliKg * i.fatCentiPct, 10_000n) : 0n;
  const snfKgMilli = usesSnf ? roundDiv(i.weightMilliKg * i.snfCentiPct, 10_000n) : 0n;
  // The money is computed the way the ENGINE computes it (one division from the raw scaled inputs), not from the
  // rounded kg above — otherwise the desk's arithmetic and the counter's would drift by a paisa and the farmer would be
  // right to distrust both.
  const fatMinor = usesFat && fatRate > 0n ? roundDiv(i.weightMilliKg * i.fatCentiPct * fatRate, 10_000_000n) : 0n;
  const snfMinor = usesSnf && snfRate > 0n ? roundDiv(i.weightMilliKg * i.snfCentiPct * snfRate, 10_000_000n) : 0n;
  const baseMinor = baseRate > 0n ? roundDiv(i.weightMilliKg * baseRate, 1000n) : 0n;

  const slabsEarned = card.slabs.filter((s) => (s.metric === 'fat' ? i.fatCentiPct : i.snfCentiPct) >= BigInt(s.minCentiPct));
  const bonusMinor = i.slabsApplied
    ? slabsEarned.reduce((a, s) => a + roundDiv(i.weightMilliKg * BigInt(s.bonusMinorPerLitre), 1000n), 0n)
    : 0n;

  return {
    litres: litresOf(i.weightMilliKg),
    fatPct: pctOf(i.fatCentiPct),
    snfPct: pctOf(i.snfCentiPct),
    fatKgMilli, snfKgMilli, fatMinor, snfMinor, baseMinor,
    bonusMinor, bonusApplied: i.slabsApplied, slabsEarned,
    totalMinor: fatMinor + snfMinor + baseMinor + bonusMinor,
  };
}

/** Litres to one decimal from milli-kg (round half up) — the same convention TENANT-6a stated on the counter board. */
export function litresOf(weightMilliKg: bigint): string {
  const tenths = (weightMilliKg + 50n) / 100n;
  return `${tenths / 10n}.${tenths % 10n}`;
}
/** Percent to two decimals from centi-percent, because a rate card's own precision is 2dp. */
export function pctOf(centiPct: bigint): string {
  return `${centiPct / 100n}.${String(centiPct % 100n).padStart(2, '0')}`;
}
/** kg to three decimals from milli-kg — W168 prints "0.483 kg". */
export function kgOf(milliKg: bigint): string {
  return `${milliKg / 1000n}.${String(milliKg % 1000n).padStart(3, '0')}`;
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE OPEN FLAG PANEL                                                                                       */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W168's protocol, and which of its three steps this platform can actually witness after TENANT-6b-1.
 *
 * Steps 1 and 2 are now RECORDED — the re-test with the member's presence, and the decision with its decider. Step 3 is
 * not: a *"dairy committee"* is a governance body this platform does not model (there is no committee, no membership,
 * no quorum, no minute), and *"platform risk desk only for organised adulteration"* is an admin-api concern by Law 11 —
 * tenant code may not reach it and must not pretend to. So the desk reports that a committee review is OWED, by whose
 * count, and refuses to imply one happened.
 */
export type ProtocolStepState = 'recorded' | 'not_modelled';

export interface FlagProtocol {
  retest: ProtocolStepState;
  decision: ProtocolStepState;
  committee: ProtocolStepState;
  /** The one claim on this screen that 6b-1 made true end to end, stated as a fact because it is one. */
  pourLevelHold: true;
  /** …and the one it made true by CONSTRUCTION: nothing in the flag path touches a wallet. */
  walletUntouched: true;
}

export function flagProtocol(): FlagProtocol {
  return { retest: 'recorded', decision: 'recorded', committee: 'not_modelled', pourLevelHold: true, walletUntouched: true };
}

/**
 * W168 prints the member as *"AND2-••87"* — masked on a screen about somebody's honesty.
 *
 * Kept, and kept in the DOMAIN rather than in a template, so the API never ships the full code to a browser that only
 * needs to show it. First and last two characters, the middle replaced with a fixed-width mask so a long code cannot
 * be inferred from the width. A code too short to mask is returned whole: masking "A1" into "••" would tell a reader
 * nothing and would not protect anybody either.
 */
export function maskMemberCode(code: string): string {
  const c = code.trim();
  if (c.length <= 4) return c;
  return `${c.slice(0, 4)}••${c.slice(-2)}`;
}

/**
 * W168's subtitle: *"adulteration test hits (urea | starch | detergent) quarantine the pour, never the person —
 * investigation first, dignity always."*
 *
 * True as of TENANT-6b-1, and true structurally rather than by policy: the hold lives on `milk_collections.hold_state`,
 * so the member's other pours bill and pay normally, and nothing in the flag path touches a wallet or a membership.
 * The desk may therefore state it. Before 6b-1 the same sentence was false in the worse direction — the flagged pour
 * was PAID — which is why this is a function with a reason rather than a string in a template.
 */
export const QUARANTINE_SCOPE = 'pour' as const;
