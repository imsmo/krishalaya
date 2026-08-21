// modules/dairy/domain/dairy-diversion.ts · PC-56 TENANT-6d-6 · W170's playbook step 2, as decisions.
//
// PURE. Three acts (request · approve · cancel) and ONE RULE that matters more than all of them:
//
//   **WHERE MAY THIS POUR BE RECORDED?**
//
// Until this wave the answer was never asked. `MilkCollectionService.record` stamped the membership's CURRENT route
// onto the pour, and TENANT-6d-3's header called that column *"stamped at the counter … a pour knows where it
// happened"* — true, and true only because no pour could happen anywhere else. A diversion falsifies it: 87 families
// carry their evening milk to Bhesan and every row says Vanthali.
//
// So the counter may now NAME the centre, and this file decides whether the platform believes it:
//   • unnamed, or named as the membership's route FOR THAT DAY → ordinary pour, no diversion cited;
//   • named as somewhere else, with a live approved diversion from that route, for that day and that shift → accepted,
//     and the pour carries the diversion's id;
//   • anything else → REFUSED. An operator must not be able to record a member's milk at another village quietly, and
//     a cooperative must be able to answer *"who allowed this?"* with a name and a reason.
//
// AND THE DAY IS THE POUR'S DAY, NOT TODAY. A pour entered on Monday for Saturday's shift belongs to Saturday's route —
// TENANT-6d-3 repaired three reads to answer as-of and left the WRITE reading the current value. Same defect, other
// side of the seam.
import { MilkShift } from './dairy.events';

/* --------------------------------------------------------------------------------------------------------- */
/* THE ACTS                                                                                                  */
/* --------------------------------------------------------------------------------------------------------- */

export const DIVERSION_REFUSALS = [
  'NO_MANAGE', 'NO_OVERRIDE', 'SAME_CENTRE', 'FROM_NOT_FOUND', 'TO_NOT_FOUND', 'TO_INACTIVE',
  'IN_THE_PAST', 'TOO_FAR_AHEAD', 'ALREADY_DIVERTED', 'REASON_REQUIRED', 'REASON_TOO_LONG',
  'MAKER_IS_CHECKER', 'NOT_FOUND', 'ALREADY_APPROVED', 'ALREADY_CANCELLED', 'POURS_ALREADY_IN',
] as const;
export type DiversionRefusal = (typeof DIVERSION_REFUSALS)[number];

/** A diversion may be recorded for today or the days ahead — never for a shift whose milk is already in. */
export const MAX_DAYS_AHEAD = 7;
export const MIN_REASON = 3;
export const MAX_REASON = 500;

export interface RequestInput {
  canManage: boolean;
  /** The centre whose shift is being sent away — the membership route the pours belong to. */
  from: { id: string; isActive: boolean } | null;
  /** Where the milk will actually be taken. */
  to: { id: string; isActive: boolean } | null;
  divertedOn: string;
  /** Today, in the cooperative's own calendar — read from the database, never from the process clock. */
  today: string;
  /** True when a live (uncancelled) diversion already exists for this centre, day and shift. */
  alreadyDiverted: boolean;
  reason: string;
}

export interface DiversionVerdict {
  allowed: boolean;
  refusals: DiversionRefusal[];
}

const verdict = (refusals: DiversionRefusal[]): DiversionVerdict => ({ allowed: refusals.length === 0, refusals });

/**
 * May this diversion be REQUESTED?
 *
 * Ordered nobody-can → you-cannot → not-this → not-yet, as every verdict in this module has been since TENANT-6c-6.
 *
 * **NEVER BACKDATED.** A diversion recorded for a day whose pours are already in would retro-authorise an attribution
 * nobody agreed to at the time — and an audit trail whose authority arrives after the act is not an audit trail. The
 * bound the other way is a week: a cooperative planning a month of diversions is planning a route change, which is
 * TENANT-6d-3's act and rewrites the member's card properly.
 */
export function requestVerdict(i: RequestInput): DiversionVerdict {
  const refusals: DiversionRefusal[] = [];
  if (!i.canManage) refusals.push('NO_MANAGE');
  if (i.from === null) refusals.push('FROM_NOT_FOUND');
  if (i.to === null) refusals.push('TO_NOT_FOUND');
  else if (!i.to.isActive) refusals.push('TO_INACTIVE');
  // The receiving centre must be live; the SENDING one need not be, because a centre being switched off mid-shift is
  // one of the reasons a cooperative diverts in the first place.
  if (i.from !== null && i.to !== null && i.from.id === i.to.id) refusals.push('SAME_CENTRE');
  assertDay(i.divertedOn); assertDay(i.today);
  if (i.divertedOn < i.today) refusals.push('IN_THE_PAST');
  else if (daysBetween(i.today, i.divertedOn) > MAX_DAYS_AHEAD) refusals.push('TOO_FAR_AHEAD');
  if (i.alreadyDiverted) refusals.push('ALREADY_DIVERTED');
  const reason = (i.reason ?? '').trim();
  if (reason.length < MIN_REASON) refusals.push('REASON_REQUIRED');
  else if (reason.length > MAX_REASON) refusals.push('REASON_TOO_LONG');
  return verdict(refusals);
}

export interface ApproveInput {
  canOverride: boolean;
  row: { requestedBy: string; approvedAt: string | null; cancelledAt: string | null; divertedOn: string } | null;
  actorUserId: string;
  today: string;
  /** Pours already recorded against this diversion's centre-shift-day. Approving after the milk is in is signing a
   *  decision the counter has already had to make without it. */
  poursAlreadyIn: number;
}

/**
 * May this diversion be SIGNED?
 *
 * **THE SECOND SIGNATURE IS A DIFFERENT PERSON WITH A DIFFERENT VERB.** `dairy.override` (0166) rather than
 * `settlement.close`: W170 says *"operator + dairy lead together"*, and borrowing the money permission would let a
 * cooperative's treasurer move a village's milk because they can close a settlement.
 *
 * `MAKER_IS_CHECKER` is ordered before the state refusals for TENANT-6c-6's reason: *"somebody else must press this"*
 * is the more useful sentence when both are true.
 */
export function approveVerdict(i: ApproveInput): DiversionVerdict {
  const refusals: DiversionRefusal[] = [];
  if (!i.canOverride) refusals.push('NO_OVERRIDE');
  if (i.row === null) { refusals.push('NOT_FOUND'); return verdict(refusals); }
  if (i.row.requestedBy === i.actorUserId) refusals.push('MAKER_IS_CHECKER');
  if (i.row.cancelledAt !== null) refusals.push('ALREADY_CANCELLED');
  if (i.row.approvedAt !== null) refusals.push('ALREADY_APPROVED');
  if (i.row.divertedOn < i.today) refusals.push('IN_THE_PAST');
  if (i.poursAlreadyIn > 0) refusals.push('POURS_ALREADY_IN');
  return verdict(refusals);
}

export interface CancelInput {
  canManage: boolean;
  row: { approvedAt: string | null; cancelledAt: string | null } | null;
  /** Pours already recorded UNDER this diversion. Cancelling then would orphan them: the rows would cite a cancelled
   *  authority, and the trigger in 0166 would refuse the next one — so the honest answer is that it is too late. */
  poursUnderIt: number;
  reason: string;
}

export function cancelVerdict(i: CancelInput): DiversionVerdict {
  const refusals: DiversionRefusal[] = [];
  if (!i.canManage) refusals.push('NO_MANAGE');
  if (i.row === null) { refusals.push('NOT_FOUND'); return verdict(refusals); }
  if (i.row.cancelledAt !== null) refusals.push('ALREADY_CANCELLED');
  if (i.poursUnderIt > 0) refusals.push('POURS_ALREADY_IN');
  const reason = (i.reason ?? '').trim();
  if (reason.length < MIN_REASON) refusals.push('REASON_REQUIRED');
  else if (reason.length > MAX_REASON) refusals.push('REASON_TOO_LONG');
  return verdict(refusals);
}

/** Live means: signed, not cancelled. An unsigned diversion is a request, and a request moves no milk. */
export function isLive(row: { approvedAt: string | null; cancelledAt: string | null }): boolean {
  return row.approvedAt !== null && row.cancelledAt === null;
}

export type DiversionState = 'requested' | 'live' | 'cancelled';
export function diversionState(row: { approvedAt: string | null; cancelledAt: string | null }): DiversionState {
  if (row.cancelledAt !== null) return 'cancelled';
  return row.approvedAt !== null ? 'live' : 'requested';
}

/* --------------------------------------------------------------------------------------------------------- */
/* WHERE MAY THIS POUR BE RECORDED — the rule this wave exists for                                           */
/* --------------------------------------------------------------------------------------------------------- */

export const POUR_PLACE_VERDICTS = ['own_centre', 'diverted', 'before_record', 'no_route', 'not_permitted'] as const;
export type PourPlaceVerdict = (typeof POUR_PLACE_VERDICTS)[number];

export interface PourPlaceInput {
  /** The membership's route AS OF THE POUR'S OWN DAY (`dairy_route_asof`), or null when the record does not reach it. */
  routeMccId: string | null;
  /** What the counter said. Null/absent means *"where this member belongs"* — the overwhelming majority of rows. */
  enteredMccId: string | null;
  /** A live approved diversion of `routeMccId` for this day and shift, if there is one. */
  diversion: { id: string; toMccId: string } | null;
  /**
   * The EARLIEST centre this membership's route history records, whatever day that starts on.
   *
   * Needed for the case the live suite found: a cooperative onboarding onto this platform enrols its members today and
   * then enters LAST fortnight's pours. Their route history starts today, so `routeAsOf` answers null for every one of
   * those days — and refusing them all would make the single most common migration path impossible. That is a Rule Zero
   * failure dressed as rigour.
   *
   * Null only when the membership has no route rows at all, which is the genuinely unattributable case.
   */
  earliestRouteMccId: string | null;
}

export interface PourPlace {
  verdict: PourPlaceVerdict;
  /** The centre the row will actually carry. Null when the pour is refused. */
  mccId: string | null;
  /** The authority for an exception, stamped on the row. Null for an ordinary pour. */
  diversionId: string | null;
}

/**
 * THE ATTRIBUTION DECISION, in one function, so the writer and the screen cannot disagree.
 *
 * FIVE ANSWERS, and the middle one exists because the live suite refused half of this platform's own fixtures:
 *
 *   • `own_centre` — nothing named, or the member's own route for that day. Almost every row ever written.
 *   • `diverted` — another village, with a live signed diversion sending that route there for that shift.
 *   • `before_record` — the pour predates the route history (a cooperative onboarding enters last fortnight's pours
 *     for members it enrolled today). The EARLIEST recorded route answers, because that is what the cooperative means
 *     and it is still derived from the history rather than from the mutable current column. Named as its own verdict so
 *     the inference is visible instead of silent.
 *   • `no_route` — no route rows at all: genuinely unattributable, and refused.
 *   • `not_permitted` — a named centre with no authority. Refused, always, whatever the history says.
 *
 * The distinction that matters: an UNNAMED centre is a question the platform may answer from what it knows; a NAMED one
 * is a claim that needs a signature.
 */
export function pourPlace(i: PourPlaceInput): PourPlace {
  const entered = (i.enteredMccId ?? '').trim();
  const named = entered.length > 0;
  if (i.routeMccId === null) {
    if (i.earliestRouteMccId === null) return { verdict: 'no_route', mccId: null, diversionId: null };
    // A named centre that AGREES with the earliest recorded route is not a claim — it is the counter sending what it
    // knows, exactly as on an ordinary day. One that DIFFERS cannot be authorised at all: a diversion is keyed to a
    // route and there is none for that day, so nobody could have signed it.
    if (named && entered !== i.earliestRouteMccId) return { verdict: 'not_permitted', mccId: null, diversionId: null };
    return { verdict: 'before_record', mccId: i.earliestRouteMccId, diversionId: null };
  }
  if (!named || entered === i.routeMccId) {
    return { verdict: 'own_centre', mccId: i.routeMccId, diversionId: null };
  }
  if (i.diversion !== null && i.diversion.toMccId === entered) {
    return { verdict: 'diverted', mccId: entered, diversionId: i.diversion.id };
  }
  return { verdict: 'not_permitted', mccId: null, diversionId: null };
}

/* --------------------------------------------------------------------------------------------------------- */
/* WHAT THE BOARD HAS TO SAY ABOUT IT                                                                        */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * A diversion makes two of TENANT-6a's numbers disagree ON PURPOSE.
 *
 * The receiving centre takes pours from members who are not on its roll; the sending centre has a roll and no pours.
 * Before this wave those two could only disagree because something was wrong, so the board must now say which it is —
 * otherwise the honest state of a diverted evening looks exactly like a broken counter.
 */
export interface DiversionSides { divertedIn: number; divertedOut: number }

export function diversionNoteKey(s: DiversionSides): string | null {
  if (s.divertedIn > 0 && s.divertedOut > 0) return 'dairy.counter.diversion.both';
  if (s.divertedIn > 0) return 'dairy.counter.diversion.in';
  if (s.divertedOut > 0) return 'dairy.counter.diversion.out';
  return null;
}

/**
 * How many members are affected — W170's *"route notice to 87 pourers"*.
 *
 * Counted from the route history AS OF THE DIVERTED DAY, not from today's routing: a member who moved last week is not
 * on tonight's list, and a member who moved TO this centre is. TENANT-6d-3's whole argument, applied to a count nobody
 * has made before.
 *
 * NOT SENT. This wave counts them and the confirm screen says they are not told; the notice is TENANT-6d-7.
 */
export function noticeGapKey(): string { return 'dairy.diversion.noticeNotSent'; }

/** W170's playbook step 3 — no union, no pickup, no batch test on this platform. Still true, still said. */
export function unionPickupGapKey(): string { return 'dairy.bmc.playbook.unionPickupUnbuilt'; }

/* --------------------------------------------------------------------------------------------------------- */
/* WHOLE DAYS                                                                                                */
/* --------------------------------------------------------------------------------------------------------- */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** TENANT-6d-3's discipline: a day is a `YYYY-MM-DD` string compared lexicographically, never a Date. */
export function assertDay(d: string): void {
  const m = DAY.exec(d ?? '');
  if (!m) throw new Error(`dairy diversion: not a calendar day: ${JSON.stringify(d)}`);
  const iso = new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10);
  if (iso !== `${m[1]}-${m[2]}-${m[3]}`) throw new Error(`dairy diversion: no such calendar day: ${JSON.stringify(d)}`);
}

export function daysBetween(from: string, to: string): number {
  assertDay(from); assertDay(to);
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The shifts a diversion can name — the same vocabulary the counter uses, not a second copy. */
export function isShift(s: string): s is MilkShift {
  return s === 'morning' || s === 'evening';
}
