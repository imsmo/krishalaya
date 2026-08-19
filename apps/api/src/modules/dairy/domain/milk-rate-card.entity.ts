// modules/dairy/domain/milk-rate-card.entity.ts · the milk_rate_cards aggregate + THE PRICING ENGINE.
// Quality-based milk pricing (PRD §19.4). Money is bigint minor units and the computation is FLOAT-FREE:
// weight/fat/snf arrive as SCALED INTEGERS (weight ×1000 = milli-kg; fat/snf ×100 = centi-percent) so the
// price is exact integer arithmetic — never floating point (Law: money correctness).
//   two_axis  : fatKg×rateFat + snfKg×rateSnf
//   fat_pooled: fatKg×rateFat
//   snf_pooled: snfKg×rateSnf
//   (+ base_rate_per_litre × weight, if a base rate is set — a flat floor on top of quality premiums)
//   (+ BONUS SLABS, PC-56 TENANT-6b-1 — see below)
import { PricingModel, AnimalType } from './dairy.events';
import { InvalidRateCardError } from './dairy.errors';

/** Round-half-up integer division for positive bigints (banker-free, deterministic). */
function roundDiv(num: bigint, den: bigint): bigint { return (num + den / 2n) / den; }

/* --------------------------------------------------------------------------------------------------------- */
/* THE PREMIUM BAND — read for the first time in PC-56 TENANT-6b-1                                            */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W168 advertises *"Bonus slab: fat ≥ 6.5 → +₹0.50/L"* and *"premium band pourers 184 / 312"*.
 *
 * **`milk_rate_cards.bonus_rules` was read by NOTHING from 0007 until this wave.** The column was not in the rate-card
 * repository's `COLS` list, this entity had no property for it, and the header of this very file called the slabs
 * "DEFERRED" — so 184 of 312 members were shown a premium band that no pour has ever been paid. TENANT-6a could only
 * name it (the counter board says the accrual EXCLUDES any bonus); this wave makes the engine read it.
 *
 * The shape is deliberately small and integer-only:
 *   • `metric`             — which axis the slab tests, `fat` or `snf`. Two axes exist; a slab on a third would be a
 *                            claim about a measurement this platform does not take.
 *   • `minCentiPct`        — the threshold in CENTI-PERCENT (6.5% → 650), because that is how the reading is stored
 *                            and compared. A decimal threshold would reintroduce float into a money path.
 *   • `bonusMinorPerLitre` — the premium in MINOR UNITS PER LITRE (₹0.50 → 50). Per litre, not per kg of fat: that is
 *                            what the canon says and what a member is told at the counter.
 *
 * Slabs are additive and INDEPENDENT: a pour clearing a fat slab and an SNF slab earns both, because they are two
 * separate promises the card made. Multiple slabs on the SAME metric all apply if all are cleared — a card with
 * "fat ≥ 6.0 → +25" and "fat ≥ 6.5 → +50" pays 75 on a 6.8 pour. That is a real modelling choice and the wrong one for
 * some cooperatives, so `create()` refuses duplicate thresholds on one metric and the desk prints the worked example
 * for the actual card rather than a formula, so a treasurer can see what their own slabs do before switching them on.
 */
export interface BonusSlab { metric: 'fat' | 'snf'; minCentiPct: number; bonusMinorPerLitre: number }

export const BONUS_METRICS = ['fat', 'snf'] as const;

/** Parse whatever the jsonb column holds into slabs, dropping nothing silently: a malformed slab THROWS, because a
 *  premium a member was promised must not disappear into a `filter`. */
export function parseBonusSlabs(raw: unknown): BonusSlab[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new InvalidRateCardError('bonus_rules must be an array of slabs');
  return raw.map((r, i) => {
    const o = r as Record<string, unknown>;
    const metric = String(o?.metric ?? '');
    if (metric !== 'fat' && metric !== 'snf') throw new InvalidRateCardError(`bonus slab ${i}: metric must be 'fat' or 'snf'`);
    const min = Number(o?.minCentiPct);
    const bonus = Number(o?.bonusMinorPerLitre);
    if (!Number.isInteger(min) || min <= 0 || min > 10_000) throw new InvalidRateCardError(`bonus slab ${i}: minCentiPct must be an integer in 1..10000 (6.5% is 650)`);
    if (!Number.isInteger(bonus) || bonus <= 0) throw new InvalidRateCardError(`bonus slab ${i}: bonusMinorPerLitre must be a positive integer (₹0.50 is 50)`);
    return { metric, minCentiPct: min, bonusMinorPerLitre: bonus };
  });
}

export interface MilkRateCardProps {
  id: string;
  tenantId: string;
  defaultName: string;
  animalType: AnimalType;
  pricingModel: PricingModel;
  ratePerKgFatMinor: bigint | null;
  ratePerKgSnfMinor: bigint | null;
  baseRatePerLitreMinor: bigint | null;
  /** The premium slabs the card promises. Empty is the honest default: most cards have none. */
  bonusSlabs: BonusSlab[];
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  createdAt?: Date;
}

export class MilkRateCard {
  private constructor(private readonly props: MilkRateCardProps) {}

  static create(input: Omit<MilkRateCardProps, 'isActive' | 'createdAt' | 'bonusSlabs'> & { isActive?: boolean; bonusSlabs?: BonusSlab[] }): MilkRateCard {
    const { pricingModel, ratePerKgFatMinor, ratePerKgSnfMinor, baseRatePerLitreMinor } = input;
    if ((pricingModel === 'two_axis' || pricingModel === 'fat_pooled') && (ratePerKgFatMinor == null || ratePerKgFatMinor <= 0n))
      throw new InvalidRateCardError('fat rate required (and positive) for this pricing model');
    if ((pricingModel === 'two_axis' || pricingModel === 'snf_pooled') && (ratePerKgSnfMinor == null || ratePerKgSnfMinor <= 0n))
      throw new InvalidRateCardError('snf rate required (and positive) for this pricing model');
    if (baseRatePerLitreMinor != null && baseRatePerLitreMinor < 0n) throw new InvalidRateCardError('base rate cannot be negative');
    const bonusSlabs = input.bonusSlabs ?? [];
    // A slab on an axis the card does not price is a promise the engine cannot keep: an `snf` slab on a `fat_pooled`
    // card would pay a premium for a measurement the card ignores. Refused at creation rather than ignored at pricing.
    for (const s of bonusSlabs) {
      if (s.metric === 'fat' && pricingModel === 'snf_pooled') throw new InvalidRateCardError('a fat bonus slab needs a card that prices fat');
      if (s.metric === 'snf' && pricingModel === 'fat_pooled') throw new InvalidRateCardError('an snf bonus slab needs a card that prices snf');
    }
    // Two slabs at the same threshold on the same metric are almost certainly a mistake (an edit that meant to replace
    // one), and because slabs are additive the mistake would silently DOUBLE a premium.
    const seen = new Set<string>();
    for (const s of bonusSlabs) {
      const k = `${s.metric}:${s.minCentiPct}`;
      if (seen.has(k)) throw new InvalidRateCardError(`duplicate bonus slab at ${s.metric} ≥ ${s.minCentiPct / 100}`);
      seen.add(k);
    }
    return new MilkRateCard({ ...input, bonusSlabs, isActive: input.isActive ?? true });
  }
  static rehydrate(props: MilkRateCardProps): MilkRateCard { return new MilkRateCard(props); }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get animalType() { return this.props.animalType; }
  get bonusSlabs(): readonly BonusSlab[] { return this.props.bonusSlabs; }
  /** Whether this card PROMISES a premium — asked by the desk so it can say "configured but not applied" honestly. */
  get hasBonusSlabs(): boolean { return this.props.bonusSlabs.length > 0; }
  toProps(): Readonly<MilkRateCardProps> { return Object.freeze({ ...this.props }); }
  toJSON() { const v = this.props; return { id: v.id, defaultName: v.defaultName, animalType: v.animalType, pricingModel: v.pricingModel,
    ratePerKgFatMinor: v.ratePerKgFatMinor?.toString() ?? null, ratePerKgSnfMinor: v.ratePerKgSnfMinor?.toString() ?? null,
    baseRatePerLitreMinor: v.baseRatePerLitreMinor?.toString() ?? null, bonusSlabs: v.bonusSlabs,
    effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, isActive: v.isActive }; }

  /**
   * EXACT price in minor units for one collection. Inputs are scaled integers:
   * weightMilliKg = kg×1000, fatCentiPct = fat%×100, snfCentiPct = snf%×100. No floating point.
   *
   * `applyBonusSlabs` is passed IN rather than read from a flag service here, because a domain entity that reaches for
   * a feature flag cannot be reasoned about — and because the caller's answer must be recorded with the pour: the
   * premium a member was paid has to be reconstructible from the card and one boolean, not from what a flag happened
   * to say that morning.
   */
  priceMinor(weightMilliKg: bigint, fatCentiPct: bigint, snfCentiPct: bigint, applyBonusSlabs = false): bigint {
    const p = this.props;
    let total = 0n;
    // fatKg×rateFat = (weightMilliKg/1000) × (fatCentiPct/10000) × rateFat = weightMilliKg×fatCentiPct×rateFat / 1e7
    if ((p.pricingModel === 'two_axis' || p.pricingModel === 'fat_pooled') && p.ratePerKgFatMinor)
      total += roundDiv(weightMilliKg * fatCentiPct * p.ratePerKgFatMinor, 10_000_000n);
    if ((p.pricingModel === 'two_axis' || p.pricingModel === 'snf_pooled') && p.ratePerKgSnfMinor)
      total += roundDiv(weightMilliKg * snfCentiPct * p.ratePerKgSnfMinor, 10_000_000n);
    // base × weight (kg) = weightMilliKg × base / 1000
    if (p.baseRatePerLitreMinor) total += roundDiv(weightMilliKg * p.baseRatePerLitreMinor, 1000n);
    if (applyBonusSlabs) total += this.bonusMinor(weightMilliKg, fatCentiPct, snfCentiPct);
    return total;
  }

  /**
   * The premium this pour earns, in minor units — W168's *"fat ≥ 6.5 → +₹0.50/L"*.
   *
   * Per LITRE and float-free: bonusMinorPerLitre × weightMilliKg / 1000, rounded half up, per slab. Computed slab by
   * slab rather than by summing rates first, so the desk can show a member WHICH promise paid them what — a farmer
   * told "you earned a premium" and shown one number cannot check it against the card on the wall.
   */
  bonusMinor(weightMilliKg: bigint, fatCentiPct: bigint, snfCentiPct: bigint): bigint {
    let bonus = 0n;
    for (const s of this.props.bonusSlabs) {
      const reading = s.metric === 'fat' ? fatCentiPct : snfCentiPct;
      // `>=` is the canon's own wording ("fat ≥ 6.5"), and the boundary matters: a 6.50 pour is IN the band, and a
      // member whose milk reads exactly the threshold being refused the premium is the complaint this decides.
      if (reading >= BigInt(s.minCentiPct)) bonus += roundDiv(weightMilliKg * BigInt(s.bonusMinorPerLitre), 1000n);
    }
    return bonus;
  }

  /** Which slabs this pour cleared — the evidence behind the number, for the counter slip and the desk. */
  slabsEarned(fatCentiPct: bigint, snfCentiPct: bigint): BonusSlab[] {
    return this.props.bonusSlabs.filter((s) => (s.metric === 'fat' ? fatCentiPct : snfCentiPct) >= BigInt(s.minCentiPct));
  }
}
