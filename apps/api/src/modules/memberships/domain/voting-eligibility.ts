// modules/memberships/domain/voting-eligibility.ts · who may vote, and why the tally cannot be weighted (PC-56 TENANT-1e).
//
// **THE DEFECT THIS FILE CLOSES IS ON THE DEMOCRATIC MACHINERY.** `POST /v1/governance/:id/vote` carried no permission
// decorator and no eligibility check: `GovernanceService.vote` asked whether the resolution was open, whether the window was
// current, and whether this user had already voted. It never asked whether they were a MEMBER, whether they held a share, or
// how long they had belonged. So any authenticated user in the tenant — a staff member, a delivery partner, a buyer with a
// `customer` role, somebody imported by a bulk file that morning — could cast a ballot in an FPO's annual general meeting.
//
// W197 prints "Voting eligibility (bylaws, as data)" with three ticked rules and the word "enforced" beside the third.
//
// Pure functions. The rules arrive as DATA (0130's tenant settings) because a co-operative's bylaws are its own: a
// Bangladeshi society's minimum shareholding is not Gujarat's, and a threshold compiled into TypeScript is a rule a founder
// cannot see or change. Rule zero — a hard-coded bylaw is a shortcut that blocks a country.
import { DomainError } from '../../../shared/errors/app-error';

/** W197's own defaults: 10 shares (₹2,000 at ₹200 face value) and a six-month tenure. */
export const DEFAULT_MIN_SHARES = 10;
export const DEFAULT_MIN_MONTHS = 6;
/** W198: "quorum 33% ✓ met". */
export const DEFAULT_QUORUM_BP = 3300;

export interface Bylaws {
  minShares: number;
  minMembershipMonths: number;
  quorumBp: number;
}

/**
 * Read the bylaws out of tenant settings.
 *
 * **A MALFORMED OR MISSING SETTING FALLS BACK TO THE CANON'S DEFAULT, NEVER TO ZERO.** A `minShares` of 0 read from a
 * corrupt value would enfranchise every non-shareholder in the tenant, which is precisely the defect this file exists to
 * close — so an unreadable bylaw is treated as the stricter published rule rather than as "no rule". Same direction as
 * ADMIN-SWEEP's price-anomaly threshold: a broken setting must never open a gate.
 */
export function bylawsFrom(raw: Record<string, unknown> | null | undefined): Bylaws {
  const int = (v: unknown, fallback: number) => {
    const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : Number.NaN;
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  return {
    minShares: int(raw?.['governance.min_shares_to_vote'], DEFAULT_MIN_SHARES),
    minMembershipMonths: int(raw?.['governance.min_membership_months'], DEFAULT_MIN_MONTHS),
    // A quorum of 0 would mean one vote carries a resolution for 1,284 members. Refused the same way.
    quorumBp: (() => {
      const n = int(raw?.['governance.quorum_bp'], DEFAULT_QUORUM_BP);
      return n > 0 && n <= 10_000 ? n : DEFAULT_QUORUM_BP;
    })(),
  };
}

export interface VoterFacts {
  /** Does this person hold an ACTIVE role of any member kind in this tenant? Staff-only roles are not membership. */
  isMember: boolean;
  /** Their earliest active role grant in this tenant, ISO. null when they are not a member. */
  memberSince: string | null;
  /** Shares on the register. 0 when they have no register row — a pending allotment is not a holding. */
  sharesHeld: number;
  /** Suspended by this tenant (0127)? A suspended member's participation is paused, and that includes their vote. */
  suspended: boolean;
}

export type IneligibleReason =
  | 'not_a_member'
  | 'suspended'
  | 'too_few_shares'
  | 'too_new';

export interface EligibilityVerdict {
  eligible: boolean;
  reason: IneligibleReason | null;
  /** What the member would need — so the console can say "eligible Nov 2026" rather than only "not yet". */
  sharesShort: number;
  eligibleFrom: string | null;
}

export class NotEligibleToVoteError extends DomainError {
  constructor(reason: IneligibleReason, detail?: Record<string, unknown>) {
    super('COOP_NOT_ELIGIBLE_TO_VOTE', `not eligible to vote: ${reason}`, 403, { reason, ...(detail ?? {}) });
  }
}

/**
 * May this person vote?
 *
 * **THE ORDER OF THE CHECKS IS THE ORDER OF THE ANSWERS SOMEBODY CAN ACT ON.** "You are not a member" is a different
 * conversation from "you need four more shares", and a verdict that reported the shareholding shortfall of a delivery
 * partner would send staff to allot shares to somebody who should never have been asked.
 *
 * A SUSPENDED MEMBER CANNOT VOTE, and that is a judgement worth stating: TENANT-1b-2 established that a tenant suspension
 * pauses participation while never touching money owed. A vote is participation, not money — so it pauses. The member keeps
 * their shares, their register row and their dividend; what they lose while suspended is the ballot.
 */
export function eligibility(f: VoterFacts, b: Bylaws, now = new Date()): EligibilityVerdict {
  const none = { sharesShort: 0, eligibleFrom: null };
  if (!f.isMember) return { eligible: false, reason: 'not_a_member', ...none };
  if (f.suspended) return { eligible: false, reason: 'suspended', ...none };

  if (f.sharesHeld < b.minShares) {
    return { eligible: false, reason: 'too_few_shares', sharesShort: b.minShares - f.sharesHeld, eligibleFrom: null };
  }

  const from = eligibleFrom(f.memberSince, b.minMembershipMonths);
  if (from && new Date(from).getTime() > now.getTime()) {
    // W197's own row: "Kanji Bhai R. · 10 shares · not yet · 6-month tenure rule · eligible Nov 2026". The DATE is the
    // useful part — "not yet" alone tells a field officer nothing they can plan around.
    return { eligible: false, reason: 'too_new', sharesShort: 0, eligibleFrom: from };
  }
  return { eligible: true, reason: null, sharesShort: 0, eligibleFrom: from };
}

/**
 * When the tenure rule is satisfied.
 *
 * **MONTHS ARE ADDED CALENDRICALLY, NOT AS 30-DAY BLOCKS.** A member who joined on 31 May reaches six months on 30 November
 * rather than on some floating day, which is how a bylaw reads and how a board will check it. `setMonth` handles the
 * short-month clamp, so 31 August + 6 becomes 28/29 February rather than rolling into March.
 */
export function eligibleFrom(memberSince: string | null, months: number): string | null {
  if (!memberSince) return null;
  const t = Date.parse(memberSince);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + Math.max(0, Math.floor(months)));
  // Clamp: adding 6 months to 31 August must not land in March.
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d.toISOString();
}

export function assertEligible(v: EligibilityVerdict): void {
  if (!v.eligible) {
    throw new NotEligibleToVoteError(v.reason as IneligibleReason, {
      ...(v.sharesShort > 0 ? { sharesShort: v.sharesShort } : {}),
      ...(v.eligibleFrom ? { eligibleFrom: v.eligibleFrom } : {}),
    });
  }
}

/* ------------------------------------------------------------------------------------------------------------ */
/* ONE MEMBER, ONE VOTE                                                                                          */
/* ------------------------------------------------------------------------------------------------------------ */

export interface VoteRow { choice: string; votes: number }

export interface Tally {
  cast: number;
  eligible: number;
  turnoutBp: number;
  quorumBp: number;
  quorumMet: boolean;
  byChoice: VoteRow[];
  /** Share of CAST votes in favour, basis points. W198: "574 · 93% of cast". */
  inFavourBp: number | null;
  passed: boolean | null;
}

/**
 * The tally.
 *
 * **THIS FUNCTION TAKES COUNTS OF MEMBERS AND HAS NO ACCESS TO SHAREHOLDINGS, AND THAT IS THE ENFORCEMENT.** W197: "One
 * member, one vote — shares add capital, never extra votes (coop principle, enforced)." That is not a product preference; it
 * is what makes a co-operative a co-operative rather than a company. It is protected in the only place it can be — the tally
 * counts ROWS of `coop_votes`, which holds at most one row per member by primary key, and nothing in this signature could
 * weight them even if a future caller wanted to.
 *
 * **TURNOUT IS AGAINST ELIGIBLE MEMBERS, NEVER ALL MEMBERS.** W197 shows 1,212 shareholders of 1,284 members with 72 pending
 * allotment; measuring quorum against 1,284 would mean a co-operative could never reach 33% while it was still allotting
 * shares, and the resolutions that matter most happen in exactly that period.
 */
export function tally(byChoice: VoteRow[], eligible: number, quorumBp: number): Tally {
  const cast = byChoice.reduce((n, r) => n + r.votes, 0);
  const turnoutBp = eligible > 0 ? Math.floor((cast * 10_000) / eligible) : 0;
  const inFavour = byChoice.find((r) => r.choice === 'for')?.votes ?? 0;
  return {
    cast,
    eligible,
    turnoutBp,
    quorumBp,
    // **QUORUM IS false WHEN THERE ARE NO ELIGIBLE MEMBERS**, not vacuously true. A register with nobody eligible cannot
    // carry a resolution, and `0 >= 3300` being false is the right answer rather than an accident.
    quorumMet: eligible > 0 && turnoutBp >= quorumBp,
    byChoice: [...byChoice].sort((a, b) => b.votes - a.votes || a.choice.localeCompare(b.choice)),
    // null rather than 0 when nobody has voted: "0% in favour" reads as a rejection, and no votes is not a rejection.
    inFavourBp: cast > 0 ? Math.floor((inFavour * 10_000) / cast) : null,
    passed: cast > 0 && eligible > 0 ? (turnoutBp >= quorumBp && inFavour * 2 > cast) : null,
  };
}

/**
 * May this vote still be changed?
 *
 * **W198 PROMISES IT TWICE AND THE CODE KEPT NEITHER HALF**: "changeable until close, final at 18:00 Sunday" and "votes
 * immutable after close". `castVote` was a bare INSERT whose unique-violation surfaced to the member as "you have already
 * voted on this resolution" — so a farmer who tapped the wrong button on a feature phone was stuck with it, on a resolution
 * deciding how their own patronage bonus is distributed.
 */
export function mayChangeVote(status: string, votingCloses: string | null, now = new Date()): boolean {
  if (status !== 'open') return false;
  if (!votingCloses) return true;                       // an open resolution with no close date stays changeable
  return now.getTime() <= Date.parse(votingCloses);
}
