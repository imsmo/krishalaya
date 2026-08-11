// modules/market-intel/domain/price-anomaly.ts · the gate W107 promises (PC-56 ADMIN-SWEEP).
//
// **THE DEFECT THIS FILE EXISTS TO CLOSE.** `MandiPriceService.ingest` inserted an observation and, in the SAME
// transaction, fired every matching farmer price alert off it — with no anomaly check anywhere on the path. W107 says
// the opposite: "ambassador_manual entries > 20% off modal are quarantined for review before feeding farmer alerts —
// bad data never reaches a selling decision."
//
// So an ambassador who typed ₹64,200 instead of ₹6,420 sent "groundnut is above your threshold" to every subscribed
// farmer in that region, in Gujarati. W109's own timeline shows what happens next: "Price alert hit: groundnut above
// ₹6,300 · alerted in Gujarati, **listed same day**." A typo became a selling decision.
//
// Everything here is a pure function over bigints. No I/O, no float arithmetic on money (Law 2), and the threshold
// arrives as a parameter because it is a platform setting (0121) rather than a constant — a control on somebody's income
// should be tightenable without a deploy.

export type AnomalyState = 'accepted' | 'quarantined' | 'released' | 'rejected';

/** W107's own list. `agmarknet` and `enam` are the REFERENCE, not the suspects: gating a government feed would
 *  quarantine a whole day's ingest the first time a market moved, and there is nobody to review 48,000 rows. */
export const DEFAULT_GATED_SOURCES = ['ambassador_manual', 'platform_txn'] as const;

/** 20%, in basis points, integer. W107 prints 20% and this is that number in the unit the rest of the platform
 *  measures ratios in (ADMIN-10's basis points, ADMIN-11c's success rate). */
export const DEFAULT_THRESHOLD_BP = 2_000;

export interface GateInput {
  source: string;
  modalMinor: bigint;
  /** The recent modal for this product × region, from accepted observations only. NULL when there is no history. */
  referenceModalMinor: bigint | null;
  thresholdBp: number;
  gatedSources: readonly string[];
}

export interface GateVerdict {
  state: Extract<AnomalyState, 'accepted' | 'quarantined'>;
  /** Absolute deviation from the reference, in basis points. NULL when there was nothing to compare against. */
  deviationBp: number | null;
  referenceModalMinor: bigint | null;
  /** Why — carried so the queue row and the console can say it rather than making a reviewer infer it. */
  reason: 'not_gated_source' | 'no_reference' | 'within_threshold' | 'deviation_exceeds_threshold';
}

/** Absolute deviation in basis points, computed in BIGINT and rounded once at the end.
 *
 *  **NO FLOAT DIVISION ON MONEY.** `Number(a) / Number(b)` on paise loses precision at exactly the magnitudes that
 *  matter here (a quintal of cumin is ₹24,850 = 2,485,000 paise), and this number decides whether a farmer is told a
 *  price. The multiplication happens first, in bigint, so the only rounding is the final integer conversion. */
export function deviationBp(observed: bigint, reference: bigint): number {
  if (reference <= 0n) return 0;
  const diff = observed > reference ? observed - reference : reference - observed;
  return Number((diff * 10_000n) / reference);
}

/**
 * Should this observation feed farmer alerts, or wait for a human?
 *
 * **UNKNOWN DOES NOT MEAN SAFE, AND HERE THAT CUTS THE OTHER WAY — deliberately.** With no reference modal there is
 * nothing to deviate from, and the ADMIN-8b/ADMIN-11 instinct (unknown excludes) would quarantine every first-ever
 * price for a product×region. That would hold the FIRST report from every new mandi the platform reaches — the exact
 * districts an expanding agri platform is trying to serve — behind a queue nobody has staffed there yet, and a farmer in
 * a newly-covered district would get no price signal at all.
 *
 * So a first observation is ACCEPTED, and the reason is recorded as `no_reference` so the console can show how many of
 * today's accepts had nothing to check against. That is the honest shape: the number is visible rather than the
 * judgement being hidden.
 */
export function gate(input: GateInput): GateVerdict {
  if (!input.gatedSources.includes(input.source)) {
    return { state: 'accepted', deviationBp: null, referenceModalMinor: input.referenceModalMinor, reason: 'not_gated_source' };
  }
  if (input.referenceModalMinor === null || input.referenceModalMinor <= 0n) {
    return { state: 'accepted', deviationBp: null, referenceModalMinor: null, reason: 'no_reference' };
  }
  const bp = deviationBp(input.modalMinor, input.referenceModalMinor);
  // `>=` and not `>`: a threshold of exactly 20% should hold a 20% deviation. The canon says "> 20% off modal", and the
  // stricter reading is the right one for a control whose failure mode is a farmer selling on a wrong number.
  if (bp >= input.thresholdBp) {
    return { state: 'quarantined', deviationBp: bp, referenceModalMinor: input.referenceModalMinor, reason: 'deviation_exceeds_threshold' };
  }
  return { state: 'accepted', deviationBp: bp, referenceModalMinor: input.referenceModalMinor, reason: 'within_threshold' };
}

/**
 * **THE ONE-LINE RULE THE WHOLE WAVE TURNS ON.** Only an accepted or released observation may feed a farmer alert.
 *
 * Written as its own named function rather than inlined into the service, because `ingest` evaluates alerts a few lines
 * after the insert and the next person to touch that loop must trip over this name. An unrecognised state does NOT feed
 * alerts — the fourth wave running in which a state this code cannot describe is a state whose safety it cannot assert.
 */
export function mayFeedFarmerAlerts(state: string): boolean {
  return state === 'accepted' || state === 'released';
}

/** Whether a reviewer's decision is a legal one from where the row is. A quarantined row can be released or rejected;
 *  an accepted row is not under review; a decided row is decided (re-deciding would overwrite the reviewer's note that
 *  the ambassador was shown). */
export function canDecide(from: string, to: 'released' | 'rejected'): boolean {
  void to;
  return from === 'quarantined';
}

/** Parse the threshold from the platform setting, refusing nonsense rather than defaulting silently.
 *
 *  **A ZERO OR NEGATIVE THRESHOLD WOULD QUARANTINE EVERY GATED OBSERVATION**, which is not a stricter guard — it is a
 *  queue nobody can clear and, in practice, a price feed switched off. An unusable value falls back to the shipped
 *  default and says so through the caller's metric rather than taking the platform down quietly. */
export function thresholdFrom(value: unknown): { bp: number; usedDefault: boolean } {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 10_000) return { bp: DEFAULT_THRESHOLD_BP, usedDefault: true };
  return { bp: n, usedDefault: false };
}

/** Parse the gated-source list, refusing a shape that would silently open the gate.
 *
 *  An empty array is legitimate configuration ("gate nothing") and is honoured — a founder may decide that. A
 *  MALFORMED value is not, and falls back to the default: the failure mode of guessing "gate nothing" from a broken
 *  setting is every manual price reaching farmers unreviewed. */
export function gatedSourcesFrom(value: unknown): { sources: string[]; usedDefault: boolean } {
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return { sources: value as string[], usedDefault: false };
  }
  return { sources: [...DEFAULT_GATED_SOURCES], usedDefault: true };
}
