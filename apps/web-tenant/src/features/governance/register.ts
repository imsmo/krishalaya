// apps/web-tenant/src/features/governance/register.ts · pure presentation rules for W197 and W198's tally (TENANT-1e).
//
// No React, no I/O. Every rule here is about **not printing a democratic claim the data does not support** — a turnout with no
// denominator, a quorum tick nothing computed, a face value over a mixed-price register, or an "eligible" beside a member
// whose ballot the API will refuse.
import type { CoopBylaws, ResolutionTally, ShareRegisterRow, ShareRegisterTiles, VotingVerdict } from '@krishalaya/sdk-js';

export interface T { t(key: string, vars?: Record<string, string | number>): string }

/**
 * How a member's voting cell reads.
 *
 * W197 prints "eligible" and "not yet · 6-month tenure rule · eligible Nov 2026". **THE REASON TRAVELS WITH THE REFUSAL**,
 * because a register that says only "not yet" for 26 members gives a secretary no way to answer any of them.
 */
export function verdictLabel(v: VotingVerdict, t: T): { label: string; detail: string | null; tone: 'ok' | 'wait' | 'stop' } {
  if (v.eligible) return { label: t.t('reg.verdict.eligible'), detail: null, tone: 'ok' };
  switch (v.reason) {
    case 'too_few_shares':
      return { label: t.t('reg.verdict.notYet'), detail: t.t('reg.verdict.sharesShort', { n: v.sharesShort }), tone: 'wait' };
    case 'too_new':
      return { label: t.t('reg.verdict.notYet'), detail: t.t('reg.verdict.tenure'), tone: 'wait' };
    // **A SUSPENSION IS NOT A "NOT YET".** It is a decision somebody made and can lift, and collapsing it into the tenure
    // wording would send a secretary to allot shares to a member whose participation is paused (TENANT-1b-2).
    case 'suspended':
      return { label: t.t('reg.verdict.suspended'), detail: null, tone: 'stop' };
    case 'not_a_member':
      return { label: t.t('reg.verdict.notMember'), detail: null, tone: 'stop' };
    default:
      return { label: t.t('reg.verdict.unknown'), detail: null, tone: 'wait' };
  }
}

/**
 * W197's face-value line: "12,120 shares × ₹200 face value".
 *
 * **RETURNS null WHEN THE API COULD NOT DIVIDE EXACTLY**, and the screen then prints the share count alone. A register
 * holding shares issued in 2019 at ₹100 and in 2025 at ₹200 has no single face value, and rounding one into existence would
 * put a number on the legal document that the legal document contradicts.
 */
export function faceValueLine(tiles: ShareRegisterTiles): { shares: number; faceMinor: string } | { shares: number; faceMinor: null } {
  return { shares: tiles.totalShares, faceMinor: tiles.faceValueMinor };
}

/**
 * The turnout tile.
 *
 * Three states, not two. **"not recorded" IS AN ANSWER AND "0%" IS A LIE** — a resolution closed before 0130 has no snapshot
 * of who could have voted, and no honest way to reconstruct one, so the tile says so rather than reporting a well-attended
 * AGM as nobody having turned up (unknown ≠ zero).
 */
export function turnoutTile(tiles: ShareRegisterTiles): { state: 'none' | 'unrecorded' | 'known'; pct: number | null; cast: number | null } {
  const a = tiles.lastAgm;
  if (!a) return { state: 'none', pct: null, cast: null };
  if (a.turnoutBp === null) return { state: 'unrecorded', pct: null, cast: a.cast };
  return { state: 'known', pct: Math.round(a.turnoutBp / 100), cast: a.cast };
}

/** Eligible as a share of shareholders — W197's "98% of shareholders". null rather than 0% when there are no shareholders. */
export function eligiblePct(tiles: ShareRegisterTiles): number | null {
  return tiles.eligibleOfShareholdersBp === null ? null : Math.round(tiles.eligibleOfShareholdersBp / 100);
}

/**
 * The bylaw panel's three rows.
 *
 * The first two come from settings; **THE THIRD IS NOT A SETTING AND MUST NEVER BECOME ONE.** W197: "One member, one vote —
 * shares add capital, never extra votes (coop principle, enforced)." It carries no toggle because it is what makes a
 * co-operative a co-operative, and it is true in the code for a structural reason: the API's tally receives counts of
 * members and has no access to shareholdings at all.
 */
export function bylawRows(b: CoopBylaws, t: T): Array<{ text: string; configurable: boolean }> {
  return [
    { text: b.minShares > 0 ? t.t('reg.bylaw.shares', { n: b.minShares }) : t.t('reg.bylaw.noShareRule'), configurable: true },
    { text: b.minMembershipMonths > 0 ? t.t('reg.bylaw.tenure', { n: b.minMembershipMonths }) : t.t('reg.bylaw.noTenureRule'), configurable: true },
    { text: t.t('reg.bylaw.oneVote'), configurable: false },
  ];
}

/* ------------------------------------------------------------------------------------------------------------ */
/* W198's TALLY                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------ */

/**
 * How the quorum line reads — W198's "618 / 1,186 · 52% · quorum 33% ✓ met".
 *
 * **`quorumMet` COMES FROM THE API AND IS NOT RECOMPUTED HERE.** Two implementations of the same threshold is how a console
 * ends up ticking a quorum the backend would fail; this function only decides the wording.
 */
export function quorumLine(tally: ResolutionTally, t: T): { text: string; met: boolean; state: 'no_roll' | 'ready' } {
  if (tally.eligible <= 0) {
    // A register with nobody eligible cannot carry a resolution, and saying "quorum not met" implies people declined to vote.
    return { text: t.t('reg.quorum.noRoll'), met: false, state: 'no_roll' };
  }
  return {
    text: t.t('reg.quorum.line', {
      cast: tally.cast,
      eligible: tally.eligible,
      turnout: Math.round(tally.turnoutBp / 100),
      quorum: Math.round(tally.quorumBp / 100),
    }),
    met: tally.quorumMet,
    state: 'ready',
  };
}

/**
 * Whether the screen may say a resolution carried.
 *
 * **THREE STATES, BECAUSE "NOT PASSED" AND "NOT DECIDABLE YET" ARE DIFFERENT SENTENCES.** `passed` is null while no ballot
 * has been cast; printing "did not pass" over an untouched resolution would announce a defeat nobody voted for.
 */
export function outcomeLabel(tally: ResolutionTally, status: string, t: T): string | null {
  if (tally.passed === null) return null;
  if (status !== 'closed') return t.t(tally.passed ? 'reg.outcome.leadingFor' : 'reg.outcome.leadingAgainst');
  return t.t(tally.passed ? 'reg.outcome.carried' : 'reg.outcome.failed');
}

/**
 * May this member still change their ballot?
 *
 * W198: "changeable until close, final at 18:00 Sunday". The console offers the change only while the API would accept it —
 * the same window, read from the same resolution — because a form that submits into a refusal teaches members the platform
 * is broken.
 */
export function mayChange(status: string, votingCloses: string | null, nowIso: string): boolean {
  if (status !== 'open') return false;
  if (!votingCloses) return true;
  return nowIso <= votingCloses;
}

/** Rows sorted the way W197 sorts them: shares descending, and stably by name so two 10-share members do not swap on reload. */
export function sortRegister(rows: readonly ShareRegisterRow[]): ShareRegisterRow[] {
  return [...rows].sort((a, b) => b.sharesHeld - a.sharesHeld || (a.fullName ?? '').localeCompare(b.fullName ?? ''));
}

/** W197's caption: "3 highlighted of 1,212 shareholders". */
export function registerCaption(shown: number, tiles: ShareRegisterTiles, t: T): string {
  return t.t('reg.caption', { shown, total: tiles.shareholders });
}
