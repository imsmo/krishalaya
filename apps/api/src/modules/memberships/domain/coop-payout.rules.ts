// modules/memberships/domain/coop-payout.rules.ts · PC-55 A8 — PURE dividend/patronage arithmetic.
// This splits a co-op's own money between its members after they voted for it. The two properties that matter:
//   (1) EXACTNESS — integer minor units only, and the sum of the parts EQUALS the pot to the last paisa;
//   (2) EXPLICABILITY — every member's figure is reproducible from the snapshotted formula, so any member can
//       be shown why they got what they got at the next AGM.
//
// [PC-56 TENANT-9b · F-14] TWO RATE FORMULAS THE CANON DRAWS, AND A PAYABILITY RULE THAT ASKS WHAT THE VOTE DECIDED.
//   • W198's past row "Dividend 8% FY 2024-25" is a PER-SHARE RATE (8% of each member's paid-up holding), and its open card
//     "1.2% of member's FY sales, cap ₹2,500/member" is a PATRONAGE PERCENTAGE with a per-member cap over a FISCAL YEAR.
//     Neither could be written: the formula knew only a fixed pot split equally or pro rata, and the console's create form
//     had no payload at all. Both are modes now; a rate pays floor(basis × rateBp / 10000) per member (a cap applied after),
//     so the total is the SUM of the parts by construction — there is no pot for a rate to miss.
//   • `resolutionPayable` asked `status IN ('activated','closed')` — `activated` is a status no code writes, and `closed`
//     included a resolution that FAILED. Now: closed AND dividend-class AND the recorded outcome is `passed` (0182 holds the
//     same rule as `coop_resolution_payable`, under the run's own insert).
export const COOP_PURPOSES = ['dividend', 'patronage_bonus'] as const;
export type CoopPurpose = (typeof COOP_PURPOSES)[number];

export const FORMULA_MODES = ['equal_split', 'patronage_pro_rata', 'per_share_rate', 'patronage_pct'] as const;
export type FormulaMode = (typeof FORMULA_MODES)[number];

/** The formulas a resolution payload may carry.
 *  • equal_split        → {"mode":"equal_split","potMinor":"…"}                         every member gets the same
 *  • patronage_pro_rata → {"mode":"patronage_pro_rata","potMinor":"…"}                  share ∝ each member's business
 *  • per_share_rate     → {"mode":"per_share_rate","rateBp":800}                         8% of each member's holding value
 *  • patronage_pct      → {"mode":"patronage_pct","rateBp":120,"capMinor":"250000","fiscalYear":2025}
 *                                                                                        1.2% of the member's business in the
 *                                                                                        cooperative's FY 2025, capped */
export type CoopFormula =
  | { mode: 'equal_split' | 'patronage_pro_rata'; potMinor: string }
  | { mode: 'per_share_rate'; rateBp: number }
  | { mode: 'patronage_pct'; rateBp: number; capMinor: string | null; fiscalYear: number };

export type FormulaError = 'FORMULA_MODE' | 'FORMULA_POT' | 'FORMULA_RATE' | 'FORMULA_CAP' | 'FORMULA_FISCAL_YEAR';

const MINOR = /^\d{1,18}$/;
/** A rate above 100% of somebody's business or holding is not a dividend anybody voted for. */
export const MAX_RATE_BP = 10_000;

export function parseFormula(payload: Record<string, unknown>): { ok: true; value: CoopFormula } | { ok: false; error: string; code: FormulaError } {
  const p = payload as Record<string, unknown>;
  const mode = String(p.mode ?? '');
  if (!(FORMULA_MODES as readonly string[]).includes(mode)) {
    return { ok: false, code: 'FORMULA_MODE', error: `resolution payload needs mode ${FORMULA_MODES.map((m) => `'${m}'`).join(', ')}` };
  }
  if (mode === 'equal_split' || mode === 'patronage_pro_rata') {
    const potMinor = String(p.potMinor ?? '');
    if (!MINOR.test(potMinor) || BigInt(potMinor) === 0n) {
      return { ok: false, code: 'FORMULA_POT', error: 'resolution payload needs potMinor as a positive minor-unit integer string' };
    }
    return { ok: true, value: { mode, potMinor } };
  }
  const rateBp = typeof p.rateBp === 'number' ? p.rateBp : Number.NaN;
  if (!Number.isInteger(rateBp) || rateBp < 1 || rateBp > MAX_RATE_BP) {
    return { ok: false, code: 'FORMULA_RATE', error: `resolution payload needs rateBp as an integer from 1 to ${MAX_RATE_BP}` };
  }
  if (mode === 'per_share_rate') return { ok: true, value: { mode, rateBp } };
  const cap = p.capMinor === undefined || p.capMinor === null || p.capMinor === '' ? null : String(p.capMinor);
  if (cap !== null && (!MINOR.test(cap) || BigInt(cap) === 0n)) {
    return { ok: false, code: 'FORMULA_CAP', error: 'resolution payload capMinor, when given, is a positive minor-unit integer string' };
  }
  const fy = typeof p.fiscalYear === 'number' ? p.fiscalYear : Number.NaN;
  if (!Number.isInteger(fy) || fy < 2000 || fy > 2100) {
    return { ok: false, code: 'FORMULA_FISCAL_YEAR', error: 'resolution payload needs fiscalYear — the calendar year the cooperative\'s fiscal year STARTS in' };
  }
  return { ok: true, value: { mode: 'patronage_pct', rateBp, capMinor: cap, fiscalYear: fy } };
}

/** Does this formula split a fixed pot (Σ must equal it) or pay a rate (Σ IS the total)? */
export function hasPot(f: CoopFormula): f is { mode: 'equal_split' | 'patronage_pro_rata'; potMinor: string } {
  return f.mode === 'equal_split' || f.mode === 'patronage_pro_rata';
}

export interface MemberBasis { userId: string; basisMinor?: string }
export interface Allocation { userId: string; amountMinor: string }

/** Largest-remainder allocation for a POT; per-member floor for a RATE. A pot split means:
 *    • Σ allocations === pot, exactly — a co-op never "loses" paisa in rounding;
 *    • the same inputs always produce the same split, so a re-run cannot pay different amounts.
 *  A rate pays floor(basis × rateBp / 10000) to each member (then the cap) — rounding down is stated, never hidden: the
 *  paisa under a member's exact share stays with the co-op.
 *  Members whose share rounds to 0 are returned as 0 and are NOT queued — being told "your share was under a
 *  paisa" is honest; a phantom ₹0 payout row is not. */
export function allocate(formula: CoopFormula, members: readonly MemberBasis[]): Allocation[] {
  if (members.length === 0) return [];
  const basisOf = (m: MemberBasis) => {
    const b = m.basisMinor ?? '0';
    if (!/^\d{1,18}$/.test(b)) throw new Error(`basisMinor for ${m.userId} must be a minor-unit integer string`);
    return BigInt(b);
  };
  if (!hasPot(formula)) {
    const cap = formula.mode === 'patronage_pct' && formula.capMinor !== null ? BigInt(formula.capMinor) : null;
    return members.map((m) => {
      let amt = (basisOf(m) * BigInt(formula.rateBp)) / 10_000n;
      if (cap !== null && amt > cap) amt = cap;
      return { userId: m.userId, amountMinor: amt.toString() };
    });
  }
  const pot = BigInt(formula.potMinor);
  const weights = members.map((m) => (formula.mode === 'equal_split' ? 1n : basisOf(m)));
  const totalWeight = weights.reduce((a, b) => a + b, 0n);
  if (totalWeight === 0n) return members.map((m) => ({ userId: m.userId, amountMinor: '0' }));

  const base = members.map((m, i) => {
    const exact = pot * weights[i];
    return { userId: m.userId, floor: exact / totalWeight, rem: exact % totalWeight };
  });
  const distributed = base.reduce((a, b) => a + b.floor, 0n);
  const leftover = pot - distributed;
  // Rank by remainder DESC, then userId ASC — deterministic across runs and machines.
  const order = [...base].sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.userId < b.userId ? -1 : 1));
  const bump = new Map<string, bigint>();
  for (let i = 0; i < Number(leftover); i++) bump.set(order[i].userId, 1n);
  return base.map((b) => ({ userId: b.userId, amountMinor: (b.floor + (bump.get(b.userId) ?? 0n)).toString() }));
}

/** The invariant a POT run must satisfy before ANY payout row is written. */
export function allocationsSumTo(allocations: readonly Allocation[], potMinor: string): boolean {
  return allocations.reduce((s, a) => s + BigInt(a.amountMinor), 0n) === BigInt(potMinor);
}

export function allocationsTotal(allocations: readonly Allocation[]): string {
  return allocations.reduce((s, a) => s + BigInt(a.amountMinor), 0n).toString();
}

/** MAKER ≠ CHECKER: whoever prepared a co-op's payout run may not be the one who confirms it. */
export function canConfirmRun(preparedBy: string | null, actorUserId: string): boolean {
  return preparedBy !== null && preparedBy !== actorUserId;
}

export type NotPayableReason = 'not_closed' | 'not_dividend_class' | 'not_passed' | 'outcome_not_recorded';

/** Only a CLOSED dividend-class resolution whose recorded outcome is PASSED can pay: a draft or open vote has decided
 *  nothing, and a failed one decided NOT to pay. `outcome` is the database's (0182), never recomputed here. */
export function resolutionPayable(status: string, resolutionType: string, outcome: string | null):
  { ok: true; purpose: CoopPurpose } | { ok: false; reason: NotPayableReason; error: string } {
  if (resolutionType !== 'dividend' && resolutionType !== 'patronage_bonus') {
    return { ok: false, reason: 'not_dividend_class', error: `only a dividend or patronage_bonus resolution pays money (this is ${resolutionType})` };
  }
  if (status !== 'closed') return { ok: false, reason: 'not_closed', error: `a ${status} resolution cannot pay — voting must be closed and the result recorded` };
  if (outcome === 'not_recorded' || outcome === null) return { ok: false, reason: 'outcome_not_recorded', error: 'this resolution closed before its result was recorded — it cannot pay on a recomputed number' };
  if (outcome !== 'passed') return { ok: false, reason: 'not_passed', error: 'this resolution did not pass — the members decided not to pay' };
  return { ok: true, purpose: resolutionType };
}
