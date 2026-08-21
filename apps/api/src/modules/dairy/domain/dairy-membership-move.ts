// modules/dairy/domain/dairy-membership-move.ts · PC-56 TENANT-6d-3 · W171's other sentence, and its arithmetic.
//
// W171: *"A membership is a route + a card + a cycle preference. Moving house? The membership moves centres without
// losing history — the member_code changes, the person's record never resets."*
//
// TENANT-6d-2 built the board and shipped no transfer button on purpose: the move is trivial and the promise is not.
// THREE RULES live here, and each of them exists because a move that broke it would leave a cooperative unable to
// reconstruct what it paid:
//
//   • **A ROUTE IS A PERIOD, AND PERIODS DO NOT OVERLAP.** *"Which centre and which card on 14 June"* must have one
//     answer. Inclusive at both ends, in whole days, matching 0164's `daterange(…, '[]')` exclusion constraints — a
//     half-open convention here and an inclusive one in the database would leave one day attributable to two centres.
//   • **A MOVE MAY NOT CONTRADICT A SLIP.** A pour carries its own `mcc_id` and `collected_on`. If a member poured at
//     Vanthali this morning, a move effective today would make the route say Bhesan on a day the printed slip says
//     Vanthali. The move is refused with the earliest date that does not lie, rather than the pour being re-dated.
//   • **THE CARD IS THE DESTINATION'S.** The code changes because the destination's numbering is the destination's
//     (and `UNIQUE (tenant_id, mcc_id, member_code)` would refuse a duplicate anyway) — but this file never INVENTS
//     one. A member code is a cooperative's own numbering scheme (Law 6); a generated "next" code is a decision about
//     a physical card printed in a village.
import { PaymentCycle } from './dairy.events';

/* --------------------------------------------------------------------------------------------------------- */
/* DATES, IN WHOLE DAYS                                                                                      */
/* --------------------------------------------------------------------------------------------------------- */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar day as the cooperative writes it. Validated, because every comparison below is a string comparison. */
export function assertDay(d: string): string {
  const m = DATE_RE.exec(d.trim());
  if (!m) throw new Error(`dairy move: not a calendar day this platform can compare: ${JSON.stringify(d)}`);
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Round-tripped through UTC so 2026-02-30 is refused rather than silently becoming March. UTC, not local: a day is
  // a label here, not an instant, and the process's timezone must not decide whether a label is legal.
  const iso = new Date(Date.UTC(y, mo - 1, da)).toISOString().slice(0, 10);
  if (iso !== `${m[1]}-${m[2]}-${m[3]}`) throw new Error(`dairy move: no such calendar day: ${JSON.stringify(d)}`);
  return iso;
}

/**
 * The day after. Whole days only, and via UTC for the same reason `assertDay` uses it.
 *
 * `YYYY-MM-DD` strings compare correctly with `<` and `>` — that is the whole reason dates stay strings through this
 * file rather than becoming `Date`s that carry a zone nobody chose.
 */
export function nextDay(d: string): string {
  const day = assertDay(d);
  const t = Date.parse(`${day}T00:00:00Z`) + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days between two calendar days, `to - from`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${assertDay(to)}T00:00:00Z`) - Date.parse(`${assertDay(from)}T00:00:00Z`)) / 86_400_000);
}

/* --------------------------------------------------------------------------------------------------------- */
/* A ROUTE, AND THE AS-OF QUESTION                                                                           */
/* --------------------------------------------------------------------------------------------------------- */

export interface Route {
  mccId: string;
  memberCode: string;
  validFrom: string;
  /** Null = still current. */
  validTo: string | null;
}

/**
 * Which route covered a given day — the TypeScript twin of 0164's `dairy_route_asof`.
 *
 * Both ends inclusive. Returns null for a day BEFORE the first route, which is a real answer rather than a fallback:
 * a back-dated pour predates the record, and attributing it to the earliest route would invent a fact about where a
 * member was standing.
 */
export function routeAsOf(routes: readonly Route[], on: string): Route | null {
  const day = assertDay(on);
  let best: Route | null = null;
  for (const r of routes) {
    if (r.validFrom > day) continue;
    if (r.validTo !== null && r.validTo < day) continue;
    if (best === null || r.validFrom > best.validFrom) best = r;
  }
  return best;
}

/** Every centre a membership has ever poured at, oldest first — the *"moved from Vanthali in March"* trail. */
export function routeTrail(routes: readonly Route[]): Route[] {
  return [...routes].sort((a, b) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0));
}

/**
 * Do these routes tile the timeline without gaps or overlaps?
 *
 * 0164 forbids overlaps with an exclusion constraint; a GAP is legal in the database and is a real state (a membership
 * that was dormant between two centres), so it is REPORTED rather than refused. A read that lands in a gap gets no
 * route, and the screen must say "not recorded" instead of guessing the nearer neighbour.
 */
export function routeGaps(routes: readonly Route[]): Array<{ after: string; before: string }> {
  const sorted = routeTrail(routes);
  const gaps: Array<{ after: string; before: string }> = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    if (prev.validTo === null) continue;              // an open route cannot precede a gap
    const expected = nextDay(prev.validTo);
    if (sorted[i].validFrom > expected) gaps.push({ after: prev.validTo, before: sorted[i].validFrom });
  }
  return gaps;
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE MOVE                                                                                                  */
/* --------------------------------------------------------------------------------------------------------- */

export const MOVE_REFUSALS = [
  'FLAG_OFF', 'NO_MANAGE', 'MEMBERSHIP_INACTIVE', 'SAME_CENTRE', 'CENTRE_INACTIVE',
  'CODE_TAKEN', 'CODE_HELD_AT_DESTINATION', 'BEFORE_LAST_POUR', 'BEFORE_ROUTE_START', 'NO_CURRENT_ROUTE',
] as const;
export type MoveRefusal = (typeof MOVE_REFUSALS)[number];

export const MOVE_CAUTIONS = ['SPLITS_OPEN_CYCLE', 'UNBILLED_POURS_AT_OLD_CENTRE', 'DEBT_FOLLOWS_MEMBER'] as const;
export type MoveCaution = (typeof MOVE_CAUTIONS)[number];

export interface MoveVerdict {
  can: boolean;
  /** Exactly one reason, the FIRST that applies — a list of five tells an operator nothing. */
  refusal: MoveRefusal | null;
  /** Allowed, but something the operator should know before the card is re-issued. */
  caution: MoveCaution | null;
  /** The earliest date the move could legally take effect, so a refusal comes with the fix. */
  earliestFrom: string | null;
}

export interface MoveInput {
  flagOn: boolean;
  canManage: boolean;
  membershipActive: boolean;
  /** The route in force today. Absent means the record is incomplete and the move must not guess. */
  current: Route | null;
  toMccId: string;
  destinationActive: boolean;
  /** The card the member will carry at the destination. */
  newMemberCode: string;
  /** Is that code already the CURRENT card of another membership at the destination? */
  codeTakenNow: boolean;
  /** Was that code held by anybody at the destination on or after `effectiveFrom`? (0164's history guard.) */
  codeHeldInPeriod: boolean;
  /** The day the move takes effect, inclusive. */
  effectiveFrom: string;
  /** The member's last pour at the CURRENT centre, if any — the slip the route may not contradict. */
  lastPourAtCurrent: string | null;
  /** Does an OPEN payout cycle already cover `effectiveFrom`? Then this fortnight spans two centres. */
  openCycleCovers: boolean;
  /** Pours at the old centre with no bill yet — they will be billed to this same membership, correctly. */
  unbilledAtCurrent: number;
  /** Live deduction instructions or member credits: the debt follows the person, which is worth saying out loud. */
  liveDebts: number;
}

/**
 * Can this membership move, and if not, why — and from when could it?
 *
 * The refusal order is this programme's own: **nobody can → you cannot → not this → not yet.** `earliestFrom` is
 * populated on every verdict, including the allowed one, because *"you cannot move them today, you can from
 * tomorrow"* is the only useful form of this answer at a counter.
 */
export function moveVerdict(i: MoveInput): MoveVerdict {
  const earliest = earliestEffectiveFrom(i.current, i.lastPourAtCurrent);
  const v = (refusal: MoveRefusal | null, caution: MoveCaution | null = null): MoveVerdict =>
    ({ can: refusal === null, refusal, caution, earliestFrom: earliest });

  if (!i.flagOn) return v('FLAG_OFF');
  if (!i.canManage) return v('NO_MANAGE');
  // A membership that has been ended is not moved, it is re-enrolled: moving it would resurrect a card at a new
  // counter without anybody deciding to.
  if (!i.membershipActive) return v('MEMBERSHIP_INACTIVE');
  if (i.current === null) return v('NO_CURRENT_ROUTE');
  if (i.current.mccId === i.toMccId) return v('SAME_CENTRE');
  // A centre that is not taking milk cannot receive a member. 6d-2's board already shows those members as unaccounted;
  // routing MORE people to one would be adding to a figure that exists to be driven down.
  if (!i.destinationActive) return v('CENTRE_INACTIVE');
  if (i.codeTakenNow) return v('CODE_TAKEN');
  // The subtler one: nobody currently holds the code, but somebody DID during the period this move would claim. Two
  // farmers holding card 108 at Vanthali in one week is a mis-paid slip nobody can reconstruct afterwards.
  if (i.codeHeldInPeriod) return v('CODE_HELD_AT_DESTINATION');
  const from = assertDay(i.effectiveFrom);
  if (from < i.current.validFrom) return v('BEFORE_ROUTE_START');
  // THE SLIP WINS. A pour at the old centre on or after this date would be contradicted by the route.
  if (earliest !== null && from < earliest) return v('BEFORE_LAST_POUR');

  // Allowed — with the one thing an operator should be told first, in order of how much it costs to get wrong.
  if (i.openCycleCovers) return v(null, 'SPLITS_OPEN_CYCLE');
  if (i.unbilledAtCurrent > 0) return v(null, 'UNBILLED_POURS_AT_OLD_CENTRE');
  if (i.liveDebts > 0) return v(null, 'DEBT_FOLLOWS_MEMBER');
  return v(null);
}

/**
 * The earliest day a move can take effect without contradicting a slip.
 *
 * The day AFTER the last pour at the current centre, or the current route's own start if nothing has been poured — a
 * route may not begin before the one it replaces. Null when there is no current route at all, because there is then no
 * question to answer and the move is refused for a different reason.
 */
export function earliestEffectiveFrom(current: Route | null, lastPourAtCurrent: string | null): string | null {
  if (current === null) return null;
  if (lastPourAtCurrent === null) return current.validFrom;
  const after = nextDay(lastPourAtCurrent);
  return after > current.validFrom ? after : current.validFrom;
}

/**
 * The two rows a move writes: the old route CLOSED the day before, the new one OPEN from the effective day.
 *
 * `validTo = effectiveFrom - 1` is the only arithmetic here, and it is the one that makes 0164's inclusive exclusion
 * constraint hold: the day of the move belongs to the destination, and the day before to the origin.
 */
export function moveRows(current: Route, toMccId: string, newMemberCode: string, effectiveFrom: string): {
  close: { validTo: string };
  open: { mccId: string; memberCode: string; validFrom: string };
} {
  const from = assertDay(effectiveFrom);
  const closeOn = previousDay(from);
  if (closeOn < current.validFrom) {
    throw new Error(`dairy move: a move effective ${from} would close the current route before it started (${current.validFrom})`);
  }
  return { close: { validTo: closeOn }, open: { mccId: toMccId, memberCode: newMemberCode, validFrom: from } };
}

export function previousDay(d: string): string {
  const day = assertDay(d);
  return new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/* --------------------------------------------------------------------------------------------------------- */
/* WHAT A BILL'S CENTRE IS, NOW THAT A MEMBER CAN MOVE                                                       */
/* --------------------------------------------------------------------------------------------------------- */

export interface BillCentre { mccId: string; code: string; pours: number }

/**
 * The centre(s) a bill was poured at — TENANT-6c-6's register, repaired.
 *
 * The register used to print the membership's CURRENT centre beside a bill for a fortnight that had already closed.
 * With no membership able to move that was harmless; the moment one can, every historical row re-attributes. And no
 * single stored value would have fixed it: a fortnight in which the member moved was poured at TWO centres, so the
 * honest answer is a LIST, biggest first, counted from the pours that made the bill.
 *
 * An empty list is possible and meaningful: a bill built from no collections (a correction, a manual bill) has no
 * centre, and the register says so rather than borrowing one.
 */
export function billCentres(rows: readonly { mccId: string; code: string; pours: number }[]): BillCentre[] {
  return [...rows].sort((a, b) => (b.pours - a.pours) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/** Did this bill's milk come from more than one centre? W171's move, seen from the register. */
export function billSpansCentres(centres: readonly BillCentre[]): boolean {
  return centres.length > 1;
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE PREFERENCE, WHICH THIS WAVE DOES NOT VERSION                                                          */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * Named, not built: `dairy_memberships.payment_cycle` is read as a CURRENT value for windows that have closed.
 *
 * `membershipsToBillForCycle` selects a closed fortnight's members by today's preference, so a member who switched
 * from weekly to monthly is billed — or not billed — retroactively by a choice they made afterwards. It is the same
 * class of defect as the three this wave repaired, and it is deliberately NOT fixed here: versioning a payment
 * preference changes which members a cadence bills, which is a money change that needs its own proof.
 */
export interface PreferenceVersioning { versioned: false; affects: readonly string[] }
export function preferenceVersioning(): PreferenceVersioning {
  return {
    versioned: false,
    affects: ['membershipsToBillForCycle (which members a closed cycle bills)', 'the counter board\'s derived window', 'the centres board\'s preference mix'],
  };
}

/** The cadences a move never touches: a member keeps their payment preference when they change village. */
export function preferenceSurvivesMove(before: PaymentCycle): PaymentCycle { return before; }
