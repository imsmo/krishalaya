// modules/insurance/domain/premium-calc.ts
// Pure, framework-free interpreter for `insurance_products.premium_calc` (jsonb; DDL comment sketch:
// "{pct_of_sum_insured} | {flat_minor} | parametric trigger terms"). This does NOT add a DB column — it
// defines how the app reads the two supported shapes of an EXISTING jsonb column, exactly as
// `loan_products.eligibility_rules` is interpreted app-side elsewhere. No float ever touches money (Law 2):
// all arithmetic is bigint, government-subsidy split truncates toward zero and the farmer share absorbs the
// remainder so total premium is always farmerShare + govtShare, never off by a paisa.
import { InvalidPremiumCalcError } from './insurance.errors';
import { applyBpsFloor } from '../../../core/money/rounding';

export type PremiumCalc =
  | { kind: 'pct_of_sum_insured'; bps: number }   // premium = sumInsuredMinor * bps / 10000
  | { kind: 'flat_minor'; amountMinor: string };  // premium = amountMinor, independent of sum insured

export interface PremiumSplit {
  totalPremiumMinor: bigint;
  govtShareMinor: bigint;   // subsidised portion (govt_subsidy_bps of total), 0 when the product has none
  farmerShareMinor: bigint; // what is actually collected from the farmer (== insurance_policies.premium_minor)
}

/** Parses the raw jsonb into a typed PremiumCalc, or throws — never silently guesses a shape. */
export function parsePremiumCalc(raw: unknown): PremiumCalc {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (r.kind === 'pct_of_sum_insured' && typeof r.bps === 'number' && r.bps >= 0 && r.bps <= 10000) {
      return { kind: 'pct_of_sum_insured', bps: r.bps };
    }
    if (r.kind === 'flat_minor' && typeof r.amountMinor === 'string' && /^\d{1,15}$/.test(r.amountMinor)) {
      return { kind: 'flat_minor', amountMinor: r.amountMinor };
    }
  }
  throw new InvalidPremiumCalcError();
}

/** Computes the total premium for a given sum insured under the product's premium_calc. */
export function computeTotalPremiumMinor(calc: PremiumCalc, sumInsuredMinor: bigint): bigint {
  if (calc.kind === 'flat_minor') return BigInt(calc.amountMinor);
  return applyBpsFloor(sumInsuredMinor, calc.bps);
}

/** Splits the total premium into the govt-subsidised share and the farmer's collectible share (Law 2: exact,
 *  no drift — farmerShare = total - govtShare, never independently rounded; govtShare via the platform's
 *  canonical `applyBpsFloor`, DEV-26/Q15). */
export function splitPremium(totalPremiumMinor: bigint, govtSubsidyBps: number): PremiumSplit {
  if (totalPremiumMinor < 0n) throw new InvalidPremiumCalcError();
  const govtShareMinor = applyBpsFloor(totalPremiumMinor, govtSubsidyBps);
  const farmerShareMinor = totalPremiumMinor - govtShareMinor;
  return { totalPremiumMinor, govtShareMinor, farmerShareMinor };
}
