// modules/memberships/domain/coop-payout.rules.ts · PC-55 A8 — PURE dividend/patronage arithmetic.
// This splits a co-op's own money between its members after they voted for it. The two properties that matter:
//   (1) EXACTNESS — integer minor units only, and the sum of the parts EQUALS the pot to the last paisa;
//   (2) EXPLICABILITY — every member's figure is reproducible from the snapshotted formula, so any member can
//       be shown why they got what they got at the next AGM.
export const COOP_PURPOSES = ['dividend', 'patronage_bonus'] as const;
export type CoopPurpose = (typeof COOP_PURPOSES)[number];

/** The two formulas a resolution payload may carry.
 *  • equal_split   → {"mode":"equal_split","potMinor":"…"}                      every member gets the same
 *  • patronage_pro_rata → {"mode":"patronage_pro_rata","potMinor":"…"}          share ∝ each member's business
 *    (the "business" basis is supplied by the caller as basisMinor per member — e.g. milk value, purchases). */
export interface CoopFormula { mode: 'equal_split' | 'patronage_pro_rata'; potMinor: string }

export function parseFormula(payload: Record<string, unknown>): { ok: true; value: CoopFormula } | { ok: false; error: string } {
  const mode = String((payload as { mode?: unknown }).mode ?? '');
  const potMinor = String((payload as { potMinor?: unknown }).potMinor ?? '');
  if (mode !== 'equal_split' && mode !== 'patronage_pro_rata') {
    return { ok: false, error: "resolution payload needs mode 'equal_split' or 'patronage_pro_rata'" };
  }
  if (!/^\d{1,18}$/.test(potMinor) || BigInt(potMinor) === 0n) {
    return { ok: false, error: 'resolution payload needs potMinor as a positive minor-unit integer string' };
  }
  return { ok: true, value: { mode, potMinor } };
}

export interface MemberBasis { userId: string; basisMinor?: string }
export interface Allocation { userId: string; amountMinor: string }

/** Largest-remainder allocation. Integer division leaves a remainder; handing it to the members with the
 *  biggest fractional loss (ties broken by userId for determinism) means:
 *    • Σ allocations === pot, exactly — a co-op never "loses" paisa in rounding;
 *    • the same inputs always produce the same split, so a re-run cannot pay different amounts.
 *  Members whose share rounds to 0 are returned as 0 and are NOT queued — being told "your share was under a
 *  paisa" is honest; a phantom ₹0 payout row is not. */
export function allocate(formula: CoopFormula, members: readonly MemberBasis[]): Allocation[] {
  const pot = BigInt(formula.potMinor);
  if (members.length === 0) return [];
  const weights = members.map((m) => {
    if (formula.mode === 'equal_split') return 1n;
    const b = m.basisMinor ?? '0';
    if (!/^\d{1,18}$/.test(b)) throw new Error(`basisMinor for ${m.userId} must be a minor-unit integer string`);
    return BigInt(b);
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0n);
  if (totalWeight === 0n) return members.map((m) => ({ userId: m.userId, amountMinor: '0' }));

  const base = members.map((m, i) => {
    const exact = pot * weights[i];
    return { userId: m.userId, floor: exact / totalWeight, rem: exact % totalWeight };
  });
  let distributed = base.reduce((a, b) => a + b.floor, 0n);
  const leftover = pot - distributed;
  // Rank by remainder DESC, then userId ASC — deterministic across runs and machines.
  const order = [...base].sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.userId < b.userId ? -1 : 1));
  const bump = new Map<string, bigint>();
  for (let i = 0; i < Number(leftover); i++) bump.set(order[i].userId, 1n);
  return base.map((b) => ({ userId: b.userId, amountMinor: (b.floor + (bump.get(b.userId) ?? 0n)).toString() }));
}

/** The invariant a run must satisfy before ANY payout row is written. */
export function allocationsSumTo(allocations: readonly Allocation[], potMinor: string): boolean {
  return allocations.reduce((s, a) => s + BigInt(a.amountMinor), 0n) === BigInt(potMinor);
}

/** MAKER ≠ CHECKER: whoever prepared a co-op's payout run may not be the one who confirms it. */
export function canConfirmRun(preparedBy: string | null, actorUserId: string): boolean {
  return preparedBy !== actorUserId;
}

/** Only an ACTIVATED dividend/patronage resolution can pay: a draft or open vote has not decided anything. */
export function resolutionPayable(status: string, resolutionType: string): { ok: true; purpose: CoopPurpose } | { ok: false; error: string } {
  if (status !== 'activated' && status !== 'closed') return { ok: false, error: `a ${status} resolution cannot pay — activate it first` };
  if (resolutionType !== 'dividend' && resolutionType !== 'patronage_bonus') {
    return { ok: false, error: `only a dividend or patronage_bonus resolution pays money (this is ${resolutionType})` };
  }
  return { ok: true, purpose: resolutionType };
}
