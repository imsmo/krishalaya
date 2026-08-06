// apps/web-tenant/src/features/governance/agm.ts · PURE cooperative-governance rules (PC-55 B8, on W54-7).
// Framework-free mirror of modules/memberships/services/governance.service.ts.
//
// A RESOLUTION IS A BALLOT, AND A BALLOT HAS RULES THAT MUST BE VISIBLE:
//   • draft → open → closed, one direction only. A closed vote cannot be re-opened here, because re-opening a ballot
//     after members have seen the tally is how a cooperative's trust dies.
//   • votes land only while OPEN and inside the window (server clock). The console therefore separates "open" from
//     "open and actually accepting votes" — a resolution whose window has not started looks live but is not, and a
//     member who taps and is refused will assume the platform is broken.
//   • ONE BALLOT PER MEMBER, enforced by the DB. A second vote is a 409, so the console says "you have voted" rather
//     than offering a form that cannot succeed.
//   • the TALLY is the server's count. Nothing here recomputes it, and a resolution with zero votes shows zero
//     rather than a hidden section — an unattended AGM is a fact members should see.
export const RESOLUTION_TYPES = ['agm_vote', 'dividend', 'patronage_bonus', 'board_election'] as const;
export type ResolutionType = (typeof RESOLUTION_TYPES)[number];
export const RESOLUTION_STATUSES = ['draft', 'open', 'closed'] as const;
export type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number];

export function isResolutionType(v: string | undefined | null): v is ResolutionType {
  return !!v && (RESOLUTION_TYPES as readonly string[]).includes(v);
}
export function isResolutionStatus(v: string | undefined | null): v is ResolutionStatus {
  return !!v && (RESOLUTION_STATUSES as readonly string[]).includes(v);
}

/** The only transitions the API accepts, in the only direction it accepts them. */
export function offeredTransition(status: string | null | undefined): 'open' | 'closed' | null {
  if (status === 'draft') return 'open';
  if (status === 'open') return 'closed';
  return null;   // closed is final
}

export interface ResolutionRow {
  id?: string; title?: string; status?: string | null; resolutionType?: string | null;
  votingOpens?: string | null; votingCloses?: string | null; body?: string | null;
}

/** Whether a ballot is ACTUALLY accepting votes right now — status open AND inside the window. `nowIso` is passed in
 *  so this is testable and so the page never trusts a clock it does not control for anything but display. */
export function votingLive(r: ResolutionRow, nowIso: string): boolean {
  if (r.status !== 'open') return false;
  const opens = (r.votingOpens ?? '').trim();
  const closes = (r.votingCloses ?? '').trim();
  if (opens && nowIso < opens) return false;
  if (closes && nowIso > closes) return false;
  return true;
}

/** Why a member cannot vote, so the page can say it plainly instead of hiding the form.
 *  'not_open' — still a draft, or already closed.
 *  'not_started' / 'window_closed' — open, but outside its own window (the case that looks live and is not).
 *  'already_voted' — the ballot box has their vote; a second one is refused by the DB.
 *  'none' — go ahead. */
export function voteBlockedReason(r: ResolutionRow, nowIso: string, alreadyVoted: boolean): 'none' | 'not_open' | 'not_started' | 'window_closed' | 'already_voted' {
  if (alreadyVoted) return 'already_voted';
  if (r.status !== 'open') return 'not_open';
  const opens = (r.votingOpens ?? '').trim();
  if (opens && nowIso < opens) return 'not_started';
  const closes = (r.votingCloses ?? '').trim();
  if (closes && nowIso > closes) return 'window_closed';
  return 'none';
}

export type ResolutionResult =
  | { ok: true; value: { title: string; resolutionType: ResolutionType; body?: string; votingOpens?: string; votingCloses?: string } }
  | { ok: false; error: 'title' | 'type' | 'body' | 'opens' | 'closes' | 'windowOrder' };

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** Build a resolution. The window is optional, but if BOTH ends are given the close must be after the open — the API
 *  refuses otherwise, and a window that closes before it opens is a ballot nobody can vote in. */
export function buildResolution(raw: { title: string; resolutionType: string; body: string; votingOpens: string; votingCloses: string }): ResolutionResult {
  const title = raw.title.trim();
  if (title.length < 3 || title.length > 200) return { ok: false, error: 'title' };
  if (!isResolutionType(raw.resolutionType)) return { ok: false, error: 'type' };

  const value: { title: string; resolutionType: ResolutionType; body?: string; votingOpens?: string; votingCloses?: string } = {
    title, resolutionType: raw.resolutionType,
  };
  const body = raw.body.trim();
  if (body) {
    if (body.length > 8000) return { ok: false, error: 'body' };
    value.body = body;
  }
  const opens = raw.votingOpens.trim();
  if (opens) {
    if (!ISO_DATETIME.test(opens)) return { ok: false, error: 'opens' };
    value.votingOpens = opens;
  }
  const closes = raw.votingCloses.trim();
  if (closes) {
    if (!ISO_DATETIME.test(closes)) return { ok: false, error: 'closes' };
    value.votingCloses = closes;
  }
  if (value.votingOpens && value.votingCloses && value.votingCloses <= value.votingOpens) return { ok: false, error: 'windowOrder' };
  return { ok: true, value };
}

export const VOTE_CHOICES = ['for', 'against', 'abstain'] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];
/** The API accepts any short string as a choice (board elections name candidates), so the console offers the standard
 *  three for a motion and validates length only — it must not narrow a vocabulary the cooperative owns. */
export function buildVote(raw: { choice: string }): { ok: true; value: { choice: string } } | { ok: false; error: 'choice' } {
  const choice = raw.choice.trim();
  if (!choice || choice.length > 20) return { ok: false, error: 'choice' };
  return { ok: true, value: { choice } };
}

export interface TallyRow { choice?: string; votes?: number | null }

/** Total ballots cast, from the server's tally only. */
export function totalVotes(tally: readonly TallyRow[]): number {
  return tally.reduce((n, t) => n + (Number.isFinite(Number(t.votes)) ? Number(t.votes) : 0), 0);
}
/** Share of the vote in BASIS POINTS (integer maths — a percentage is displayed, never used to decide anything).
 *  Returns null when nobody has voted: 0 % of nothing is not a result, and a bar chart of zeroes reads as consensus. */
export function shareBps(votes: number | null | undefined, total: number): number | null {
  if (total <= 0) return null;
  const v = Number.isFinite(Number(votes)) ? Number(votes) : 0;
  return Math.round((v * 10000) / total);
}
/** Highest first, then alphabetically so a tie renders in a stable order rather than shuffling between loads. */
export function sortTally(tally: readonly TallyRow[]): TallyRow[] {
  return [...tally].sort((a, b) => (Number(b.votes ?? 0) - Number(a.votes ?? 0)) || String(a.choice ?? '').localeCompare(String(b.choice ?? '')));
}
/** A dividend or patronage-bonus vote that CARRIED has money behind it — the payout run (PC-55 A8) is a separate,
 *  separately-gated act, and the page says so rather than implying the vote paid anybody. */
export function hasPayoutConsequence(resolutionType: string | null | undefined): boolean {
  return resolutionType === 'dividend' || resolutionType === 'patronage_bonus';
}
