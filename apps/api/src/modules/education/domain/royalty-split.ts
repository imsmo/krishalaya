// modules/education/domain/royalty-split.ts · PC-56 TENANT-7d-money · THE SPLIT, THE WINDOW, THE STATES — pure.
//
// W418: *"Gross · Your royalty (80%) · Tenant + platform (20%)"*. Before 0174 the only arithmetic was
// `Course.splitRevenue(priceMinor, royaltyBps)` — instructor floored, the WHOLE remainder to platform fees, in a currency
// the leg never named. This file is the arithmetic the ledger line records, and nothing here does IO, touches a float,
// or knows what a rupee is: bigint minor units in, bigint minor units out, basis points as integers.
//
// WHERE THE PAISA GOES. Three shares of one gross cannot all be floored — 10000 bps of ₹1.00 split 8000/1800/200 is
// 80 + 18 + 2 paise exactly, but ₹1.49 split the same way is 119.2 + 26.82 + 2.98: two floors leave 1 paisa. The
// instructor's share is floored (0012's `applyBpsFloor` convention — every royalty ever paid was floored, and this
// wave does not silently raise anybody's share); the platform's share is floored (the platform never rounds in its own
// favour on a member's money — 6c-4's stance); the TENANT takes the remainder. Why the tenant: it is the party that
// owns the rule, bears the hosting and QA the canon names, and is the residual claimant on its own course sales; and
// because exactly one leg must absorb the rounding for the four legs to net to zero, and it should be the leg whose
// owner set the rule. The remainder is never more than 2 minor units (two floors), which the spec pins.
import { InvalidRoyaltyError } from './education.errors';

export const BPS_WHOLE = 10_000;

export interface ShareBps { instructorBps: number; tenantBps: number; platformBps: number }
export interface RoyaltySplit { grossMinor: bigint; instructorMinor: bigint; tenantMinor: bigint; platformMinor: bigint }

/** Shares must be integers in [0, 10000] and sum to exactly 10000 — a rule that does not is refused, never normalised. */
export function assertWholeShares(s: ShareBps): void {
  for (const k of ['instructorBps', 'tenantBps', 'platformBps'] as const) {
    const v = s[k];
    if (!Number.isInteger(v) || v < 0 || v > BPS_WHOLE) throw new InvalidRoyaltyError(v, k);
  }
  if (s.instructorBps + s.tenantBps + s.platformBps !== BPS_WHOLE) throw new InvalidRoyaltyError(s.instructorBps + s.tenantBps + s.platformBps, 'sum');
}

/** The split of one gross. Instructor and platform FLOORED; the tenant takes the remainder. Nets to zero by construction. */
export function splitRoyalty(grossMinor: bigint, shares: ShareBps): RoyaltySplit {
  if (typeof grossMinor !== 'bigint' || grossMinor <= 0n) throw new InvalidRoyaltyError(Number(grossMinor), 'gross');
  assertWholeShares(shares);
  const whole = BigInt(BPS_WHOLE);
  const instructorMinor = (grossMinor * BigInt(shares.instructorBps)) / whole;
  const platformMinor = (grossMinor * BigInt(shares.platformBps)) / whole;
  const tenantMinor = grossMinor - instructorMinor - platformMinor;
  return { grossMinor, instructorMinor, tenantMinor, platformMinor };
}

/** The shape the pre-0174 code posted, as shares: the row's royalty to the instructor, everything else to the platform. */
export function legacyShares(royaltyBps: number): ShareBps {
  if (!Number.isInteger(royaltyBps) || royaltyBps < 0 || royaltyBps > BPS_WHOLE) throw new InvalidRoyaltyError(royaltyBps, 'royaltyBps');
  return { instructorBps: royaltyBps, tenantBps: 0, platformBps: BPS_WHOLE - royaltyBps };
}

export interface RuleShares extends ShareBps { ruleId: string | null }
export interface AgreementShares extends ShareBps { agreementId: string }

/**
 * Which shares a purchase is split by, and whether the instructor's leg is HELD.
 *   • flag OFF → the legacy shape (the row's royalty_bps), paid to the instructor's MAIN wallet, no rule, no agreement.
 *   • flag ON, an ACCEPTED agreement → the agreement's snapshot, paid to MAIN.
 *   • flag ON, no accepted agreement → the rule in force (tenant's, else platform's), the instructor leg HELD.
 * A missing rule while the flag is ON is refused: a purchase must never be priced by a guess.
 */
export type InstructorLeg = 'main' | 'hold';
export type LineState = 'paid_to_wallet' | 'held_pending_agreement' | 'released';
export interface ResolvedSplit { shares: ShareBps; ruleId: string | null; agreementId: string | null; leg: InstructorLeg; state: Exclude<LineState, 'released'> }

export function resolveSplitShares(input: { flagOn: boolean; royaltyBps: number; rule: RuleShares | null; agreement: AgreementShares | null }): ResolvedSplit {
  if (!input.flagOn) return { shares: legacyShares(input.royaltyBps), ruleId: null, agreementId: null, leg: 'main', state: 'paid_to_wallet' };
  if (input.agreement) {
    assertWholeShares(input.agreement);
    return { shares: { instructorBps: input.agreement.instructorBps, tenantBps: input.agreement.tenantBps, platformBps: input.agreement.platformBps }, ruleId: null, agreementId: input.agreement.agreementId, leg: 'main', state: 'paid_to_wallet' };
  }
  if (!input.rule) throw new InvalidRoyaltyError(0, 'no royalty rule in force');
  assertWholeShares(input.rule);
  return { shares: { instructorBps: input.rule.instructorBps, tenantBps: input.rule.tenantBps, platformBps: input.rule.platformBps }, ruleId: input.rule.ruleId, agreementId: null, leg: 'hold', state: 'held_pending_agreement' };
}

/* ------------------------------------------------------------------------------------------------------------- */
/* WINDOWS — the month the COOPERATIVE is in                                                                     */
/* ------------------------------------------------------------------------------------------------------------- */

/** `YYYY-MM-DD` (the tenant's local day, resolved in SQL `AT TIME ZONE co.timezone` — 7c's rule) → the first day of its month. */
export function monthStartOf(localDay: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDay);
  if (!m) throw new InvalidRoyaltyError(0, `not a local day: ${localDay}`);
  return `${m[1]}-${m[2]}-01`;
}
export type EarningsWindow = 'mtd' | 'lifetime';
export const EARNINGS_WINDOWS: readonly EarningsWindow[] = ['mtd', 'lifetime'];

/* ------------------------------------------------------------------------------------------------------------- */
/* MONEY OUT — what may be requested                                                                              */
/* ------------------------------------------------------------------------------------------------------------- */

export interface RoyaltyBalance {
  currencyCode: string;
  /** Σ instructor_minor over lines paid to the wallet or released — the royalty that reached the MAIN wallet. */
  releasedMinor: bigint;
  /** Σ instructor_minor over lines still held. */
  heldMinor: bigint;
  /** Σ amount over course_royalty payouts not reversed/cancelled/failed (queued · processing · success). */
  paidOutMinor: bigint;
}
/** What the instructor may still ask for in this currency: released − paid out. Signed — a negative reads as a defect, never clamped. */
export function availableMinor(b: RoyaltyBalance): bigint { return b.releasedMinor - b.paidOutMinor; }

export type PayoutRefusal = 'AGREEMENT_NOT_ACCEPTED' | 'AMOUNT_INVALID' | 'CURRENCY_UNKNOWN' | 'ROYALTY_INSUFFICIENT' | 'NOT_INSTRUCTOR';
/** The refusals a royalty payout request meets BEFORE the payment plane's own gates (KYC per role, bank ownership, no overdraw). */
export function royaltyPayoutRefusals(input: { hasInstructor: boolean; hasAcceptedAgreement: boolean; amountMinor: string; balance: RoyaltyBalance | null }): PayoutRefusal[] {
  const out: PayoutRefusal[] = [];
  if (!input.hasInstructor) out.push('NOT_INSTRUCTOR');
  if (!input.hasAcceptedAgreement) out.push('AGREEMENT_NOT_ACCEPTED');
  if (!/^[1-9]\d{0,15}$/.test(input.amountMinor)) out.push('AMOUNT_INVALID');
  if (!input.balance) out.push('CURRENCY_UNKNOWN');
  else if (/^[1-9]\d{0,15}$/.test(input.amountMinor) && BigInt(input.amountMinor) > availableMinor(input.balance)) out.push('ROYALTY_INSUFFICIENT');
  return out;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* STATE MACHINES — the agreement and the rule (Law 5: in one place)                                              */
/* ------------------------------------------------------------------------------------------------------------- */

export type AgreementStatus = 'offered' | 'accepted' | 'declined' | 'superseded';
export type AgreementAct = 'accept' | 'decline' | 'supersede';
const AGREEMENT_TRANSITIONS: Readonly<Record<AgreementStatus, Partial<Record<AgreementAct, AgreementStatus>>>> = Object.freeze({
  offered: { accept: 'accepted', decline: 'declined', supersede: 'superseded' },
  accepted: { supersede: 'superseded' },
  declined: {},
  superseded: {},
});
export function agreementNext(from: AgreementStatus, act: AgreementAct): AgreementStatus | null { return AGREEMENT_TRANSITIONS[from]?.[act] ?? null; }

export type RuleStatus = 'proposed' | 'active' | 'rejected' | 'superseded';
export type RuleAct = 'approve' | 'reject' | 'supersede';
const RULE_TRANSITIONS: Readonly<Record<RuleStatus, Partial<Record<RuleAct, RuleStatus>>>> = Object.freeze({
  proposed: { approve: 'active', reject: 'rejected' },
  active: { supersede: 'superseded' },
  rejected: {},
  superseded: {},
});
export function ruleNext(from: RuleStatus, act: RuleAct): RuleStatus | null { return RULE_TRANSITIONS[from]?.[act] ?? null; }

/** The desk decides a rule the desk did not propose — the CHECK says the same at the wall (ck_crr_maker_ne_checker). */
export function ruleDecisionRefusals(input: { isDesk: boolean; proposedBy: string; deciderUserId: string; status: RuleStatus; act: 'approve' | 'reject'; note: string | null }): string[] {
  const out: string[] = [];
  if (!input.isDesk) out.push('NOT_DESK');
  if (input.proposedBy === input.deciderUserId) out.push('MAKER_IS_CHECKER');
  if (!ruleNext(input.status, input.act)) out.push('ILLEGAL_FROM_STATUS');
  if (input.act === 'reject' && !(input.note && input.note.trim().length >= 3)) out.push('REASON_REQUIRED');
  return out;
}

/** The tenant proposes only its own two shares; the platform's is copied from the platform default and never chosen. */
export function proposalShares(input: { instructorBps: number; platformBps: number }): ShareBps {
  if (!Number.isInteger(input.instructorBps) || input.instructorBps < 0) throw new InvalidRoyaltyError(input.instructorBps, 'instructorBps');
  if (!Number.isInteger(input.platformBps) || input.platformBps < 0) throw new InvalidRoyaltyError(input.platformBps, 'platformBps');
  const tenantBps = BPS_WHOLE - input.instructorBps - input.platformBps;
  if (tenantBps < 0) throw new InvalidRoyaltyError(input.instructorBps, 'instructor share leaves the tenant below zero');
  const s = { instructorBps: input.instructorBps, tenantBps, platformBps: input.platformBps };
  assertWholeShares(s);
  return s;
}
