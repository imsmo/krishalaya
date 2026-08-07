// apps/admin-api/src/modules/trust-safety/domain/risk-profile.ts · W093's board and W094's profile, PURE (ADMIN-5d).
//
// W094 prints the sentence this whole module is built to keep: **"Every point is traceable to an event — 'the
// computer says no' is never the answer we give anyone."** A risk score decides whether somebody can bid, how long
// their money is held, and whether they can trade at all. If the platform cannot show the arithmetic, it should not
// show the number.
//
// ---------------------------------------------------------------------------------------------------------------
// THE FINDING THAT GOVERNS EVERY FUNCTION BELOW: THE BAND IS ADVISORY AND NOTHING KNOWS IT
// ---------------------------------------------------------------------------------------------------------------
// W094's "Band effects" panel lists what each band does: bids held, payout delayed 48h, bid cap ₹50,000, no
// marketplace access. Verifying against the code:
//   • `RiskScoreRepository.findByUser` — the only read of a stored band — HAS ZERO CALLERS.
//   • `RiskBand` is imported by no file outside the one that declares it.
//   • No guard, interceptor, gateway or policy consults a band. The payout and auction paths have no risk import.
//   • `RiskScoreRecomputeJob.runForTenant` — which produces the score in the first place — is never invoked. It is
//     not in apps/worker's registry and nothing in apps/api schedules it.
// So the ladder is a number in a table, computed by a job that does not run, read by nobody.
//
// The console therefore states it. Drawing W094's panel as though those effects apply would be the most dangerous
// screen on the platform: it tells a safety operator that a suspected fraud ring is under a bid cap, and they stop
// looking. An unenforced restriction shown as enforced does not merely fail to protect anyone — it withdraws the
// attention that was protecting them.
import { maskPhone, maskName } from '../../../core/pii/mask';
import { assertSecondPerson } from '../../../core/approval/two-person-rule';
import { InvalidBandChangeError } from './trust-safety.errors';
import { CANON_BAND_FLOORS, CODE_BAND_FLOORS } from './risk-rules';

export const RISK_BANDS = ['trusted', 'standard', 'caution', 'restricted', 'blocked'] as const;
export type RiskBand = (typeof RISK_BANDS)[number];
export function isRiskBand(v: unknown): v is RiskBand {
  return typeof v === 'string' && (RISK_BANDS as readonly string[]).includes(v);
}

export interface RiskScoreRow {
  userId: string;
  tenantId: string | null;
  score: number | null;
  band: string | null;
  factors: unknown;
  computedAt: string | null;
  fullName: string | null;
  phone: string | null;
}

/* ------------------------------------------------------------------------------------------------ */
/* BANDS                                                                                             */
/* ------------------------------------------------------------------------------------------------ */

function bandFromFloors(floors: readonly { band: string; floor: number }[], score: number): RiskBand | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  for (const f of floors) if (score >= f.floor) return f.band as RiskBand;
  return null;
}
/** What the SPECIFICATION says this score means (W095's band panel). */
export function canonBand(score: number): RiskBand | null { return bandFromFloors(CANON_BAND_FLOORS, score); }
/** What the PLATFORM's `bandFor()` would compute for it. */
export function codeBand(score: number): RiskBand | null { return bandFromFloors(CODE_BAND_FLOORS, score); }

export type BandReading =
  | { kind: 'unknown'; reason: string }
  | { kind: 'agreed'; band: RiskBand; score: number }
  /** The stored band, the band the canon's ladder gives, and the fact that they differ. */
  | { kind: 'ladder_drift'; band: RiskBand; canon: RiskBand; score: number }
  /** The stored band is not what the platform's own ladder computes for the stored score — the row is internally
   *  inconsistent, which means it was written by something other than the current scorer, or by hand. */
  | { kind: 'inconsistent'; band: string; expected: RiskBand; score: number };

/** Read a stored (score, band) pair honestly.
 *
 *  Three failure directions, and collapsing any of them into "caution" or into the stored string would hide the one
 *  thing a person disputing their band needs to see.
 */
export function readBand(row: Pick<RiskScoreRow, 'score' | 'band'>): BandReading {
  const { score, band } = row;
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return { kind: 'unknown', reason: 'no score has been computed for this account' };
  }
  const expected = codeBand(score);
  if (!band || !isRiskBand(band) || !expected) {
    return { kind: 'unknown', reason: 'the stored band is missing or not one of the five' };
  }
  if (band !== expected) return { kind: 'inconsistent', band, expected, score };
  const c = canonBand(score);
  if (c && c !== band) return { kind: 'ladder_drift', band, canon: c, score };
  return { kind: 'agreed', band, score };
}

/* ------------------------------------------------------------------------------------------------ */
/* THE ARITHMETIC — W094's central promise                                                           */
/* ------------------------------------------------------------------------------------------------ */

export interface ScoreFactor { event: string; weight: number; detail?: string }

export type FactorPanel =
  | { kind: 'unavailable'; reason: string }
  /** base + Σweights === score. The equation the canon prints, and it closes. */
  | { kind: 'closed'; base: number; factors: ScoreFactor[]; score: number }
  /** The stored parts do not add up to the stored score. Rendered as a REFUSAL to show an equation, not as an
   *  equation with a wrong answer. */
  | { kind: 'does_not_close'; base: number; factors: ScoreFactor[]; score: number; sum: number };

/** Parse the `factors` jsonb into W094's arithmetic panel — or refuse to.
 *
 *  THE GUARD IS THE LAST BRANCH AND IT IS THE POINT OF THE FUNCTION. W094 renders `base 78 − 30 − 12 + 8 = 44` and
 *  captions it "every point traceable". If the stored parts sum to something other than the stored score, printing
 *  the equation anyway produces a line of arithmetic that is visibly wrong on a page whose entire claim is that the
 *  number can be explained. Worse, the operator reads the total on the right — the one that decides what happens to
 *  the person — and it is not the total of the terms beside it.
 *
 *  TODAY THIS ALMOST ALWAYS RETURNS `unavailable`, and that is correct rather than disappointing: the recompute job
 *  stores `factors: { window_days, weighted_total }` — a summary, not a factor list — so there are no per-event terms
 *  to render for anybody. W094's panel has never had data behind it. Naming that beats inventing a plausible
 *  breakdown, which on this screen would be fabricated evidence for a decision about a named person.
 */
export function factorPanel(score: number | null, factors: unknown): FactorPanel {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return { kind: 'unavailable', reason: 'no score has been computed for this account' };
  }
  if (!factors || typeof factors !== 'object' || Array.isArray(factors)) {
    return { kind: 'unavailable', reason: 'no explanation was recorded with this score' };
  }
  const f = factors as Record<string, unknown>;
  const raw = f.factors;
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      kind: 'unavailable',
      reason: 'the scorer records a weighted total, not the events behind it — this score cannot be explained event by event',
    };
  }
  const parsed: ScoreFactor[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { kind: 'unavailable', reason: 'the recorded explanation could not be read' };
    const o = item as Record<string, unknown>;
    if (typeof o.event !== 'string' || typeof o.weight !== 'number' || !Number.isFinite(o.weight)) {
      return { kind: 'unavailable', reason: 'the recorded explanation could not be read' };
    }
    parsed.push({ event: o.event, weight: o.weight, ...(typeof o.detail === 'string' ? { detail: o.detail } : {}) });
  }
  const base = typeof f.base === 'number' && Number.isFinite(f.base) ? f.base : null;
  if (base === null) return { kind: 'unavailable', reason: 'the carried base score was not recorded, so the arithmetic cannot be checked' };
  const sum = parsed.reduce((a, x) => a + x.weight, base);
  // The stored score is CLAMPED to 0–100 by `RiskScore.of`, so a legitimately clamped total is not a broken one.
  const clamped = Math.max(0, Math.min(100, sum));
  if (clamped !== score) return { kind: 'does_not_close', base, factors: parsed, score, sum };
  return { kind: 'closed', base, factors: parsed, score };
}

/* ------------------------------------------------------------------------------------------------ */
/* BAND EFFECTS — every one of them labelled with whether it happens                                 */
/* ------------------------------------------------------------------------------------------------ */

export interface BandEffect { key: string; enforced: boolean; enforcedBy: string | null }

/** W094's panel, with the truth attached to each line.
 *
 *  `enforced` is FALSE on every entry and that is not a placeholder — it is the verified state of the platform (see
 *  the header). It is modelled per-effect rather than as one banner because these will come true one at a time: the
 *  wave that adds a payout hold flips one flag, and the screen stops overclaiming the same day it stops
 *  underdelivering. A single "nothing is enforced" note would have to be remembered and edited by hand, and the way
 *  those notes fail is by staying up after they stop being true — or coming down before.
 */
export const BAND_EFFECTS: Readonly<Record<RiskBand, readonly BandEffect[]>> = Object.freeze({
  trusted: [{ key: 'fullAccess', enforced: false, enforcedBy: null }],
  standard: [{ key: 'fullAccess', enforced: false, enforcedBy: null }],
  caution: [
    { key: 'browseBuyMessage', enforced: false, enforcedBy: null },
    { key: 'bidsHeldForInvestigation', enforced: false, enforcedBy: null },
  ],
  restricted: [
    { key: 'payoutDelay48h', enforced: false, enforcedBy: null },
    { key: 'bidCap', enforced: false, enforcedBy: null },
  ],
  blocked: [
    { key: 'noMarketplaceAccess', enforced: false, enforcedBy: null },
    // W094, and it is a promise rather than an effect: "wallet funds remain withdrawable (money is never
    // confiscated)". Recorded as an effect so it appears on the panel beside the restrictions — the one line on the
    // screen a blocked person most needs to see.
    { key: 'walletStillWithdrawable', enforced: true, enforcedBy: 'no code path confiscates wallet funds' },
  ],
});

export const LADDER_IS_ADVISORY =
  'no code on the platform reads a risk band: the ladder is recorded, not enforced' as const;

/** True when at least one listed effect actually happens. Used to decide whether the console prints the advisory
 *  banner — computed, so it disappears by itself when the first enforcer ships. */
export function anyEffectEnforced(band: RiskBand): boolean {
  return BAND_EFFECTS[band].some((e) => e.enforced && e.key !== 'walletStillWithdrawable');
}

/* ------------------------------------------------------------------------------------------------ */
/* CHANGING A BAND BY HAND                                                                           */
/* ------------------------------------------------------------------------------------------------ */

export const BAND_CHANGE_REASON_MIN = 20;

/** W093: "freezes/blocks need `risk.act` + checker for blocked band." W095: "Score can propose blocked; only a human
 *  + checker can APPLY it — the band is advisory at the bottom of the scale."
 *
 *  So `blocked` is the one band a human must sign for, and the second signature is required for it specifically. Any
 *  other band change is a single-operator action with a reason and an audit row.
 */
export function assertBandChange(args: {
  from: string | null; to: unknown; reason: unknown; actor: string; previousActor: string | null;
}): { to: RiskBand; reason: string } {
  const { from, to, reason, actor, previousActor } = args;
  if (!isRiskBand(to)) throw new InvalidBandChangeError(`a band must be one of: ${RISK_BANDS.join(', ')}`);
  if (from === to) throw new InvalidBandChangeError('that is the band already in force');
  if (typeof reason !== 'string' || reason.trim().length < BAND_CHANGE_REASON_MIN) {
    throw new InvalidBandChangeError(
      `a reason of at least ${BAND_CHANGE_REASON_MIN} characters is required — it is sent to the person and it is what `
      + 'an appeal is judged against');
  }
  if (reason.trim().length > 1000) throw new InvalidBandChangeError('a reason must be at most 1000 characters');
  if (to === 'blocked') {
    assertSecondPerson(
      'blocking an account', previousActor, actor,
      'Blocking removes marketplace access entirely; it cannot be applied by the same operator who last changed this '
      + "account's band.");
  }
  return { to, reason: reason.trim() };
}

/* ------------------------------------------------------------------------------------------------ */
/* THE BOARD                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

/** W093's band census.
 *
 *  Rows whose band is not one of the five are counted into `unrecognised` rather than dropped or folded into the
 *  nearest band. A stored band nobody has a rule for is exactly the state `ck_risk_scores_band` was added to prevent,
 *  and silently discarding those rows would make the census add up to less than the population while looking
 *  complete — the ADMIN-4b finding (an unknown status stored in the counts) in a new place.
 */
export function bandCensus(rows: readonly Pick<RiskScoreRow, 'band'>[]): Record<RiskBand, number> & { unrecognised: number; total: number } {
  const out = { trusted: 0, standard: 0, caution: 0, restricted: 0, blocked: 0, unrecognised: 0, total: 0 };
  for (const r of rows) {
    out.total += 1;
    if (isRiskBand(r.band)) out[r.band] += 1; else out.unrecognised += 1;
  }
  return out;
}

/** The share of scored users in a band, as a percentage — or NOTHING.
 *
 *  W093 prints "72% of active users" under the trusted count. That denominator is ACTIVE USERS, and this function is
 *  given SCORED users, which is a different and much smaller set: the recompute job never runs, so most accounts have
 *  no row at all. Returning a percentage of the scored population under a label that says active would overstate the
 *  platform's health by whatever fraction of users have never been scored — the most flattering possible error on the
 *  page that answers "is the marketplace safe".
 */
export function bandShare(count: number, scoredTotal: number, activeTotal: number | null): { pct: number; of: 'active' } | null {
  if (!Number.isFinite(count) || count < 0) return null;
  if (activeTotal === null || !Number.isFinite(activeTotal) || activeTotal <= 0) return null;
  // Fewer scored users than the count itself means the two figures came from different reads and cannot be combined.
  if (!Number.isFinite(scoredTotal) || scoredTotal < count) return null;
  return { pct: Math.round((count / activeTotal) * 1000) / 10, of: 'active' };
}

/** Identity on a risk screen is MASKED, and the reason is narrower than the usual PII argument.
 *
 *  These pages are read by operators investigating people who have not been found to have done anything. A full name
 *  and phone number beside the word "fraud" is a fact about a suspicion, and W094's own restricted state gates the
 *  factors behind `risk.read`. Unmasking follows the audited-reason path the oversight plane already has.
 */
export function maskSubject(r: Pick<RiskScoreRow, 'fullName' | 'phone'>): { name: string | null; phone: string | null } {
  // NULL is passed through rather than replaced with the mask glyph, and the two are different facts: `••••••••` says
  // "there is a name and you may not see it", null says "this account has no name recorded". On a risk file the
  // second is itself a signal — an account with no name and a falling score is a different thing to look at.
  return { name: maskName(r.fullName), phone: maskPhone(r.phone) };
}
