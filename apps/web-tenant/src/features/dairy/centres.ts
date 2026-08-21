// apps/web-tenant/src/features/dairy/centres.ts · W171 (MCC centres) view-model — PC-56 TENANT-6d-2.
//
// Pure. Every sentence the board can say is a KEY chosen here, and the three judgements that matter are all about
// refusing to print a nicer version of the truth:
//
//   • **a name is printed only for a custody the platform stands behind.** `mcc_centres.operator_user_id` references
//     the platform-wide `users` table, so before migration 0163 it could hold a person from another cooperative. A
//     centre in that state says *"operator on file cannot be verified"* — it does not print the name;
//   • **the footer's tick is a check.** *"3 centres · 312 memberships total ✓"* is only a tick when the per-centre
//     counts add up to the tenant's own total; otherwise it names the shortfall, because those members are routed
//     somewhere this board is not showing;
//   • **hours are the centre's or they are unknown.** TENANT-6a refused to print W167's *"evening starts 17:00"*
//     because nothing recorded it. Something does now — for the centres that have recorded it, and only those.
import type {
  DairyCentreRow, DairyCentresConsole, DairyMoveCaution, DairyMoveRefusal, DairyPreferenceRow, DairyShiftWindow,
} from '@krishalaya/sdk-js';

export const CENTRES_HREF = '/dairy/centres';
/** *"Add centre"* — W2555–W2558's chain, built in TENANT-6d-4. The board no longer carries an inline create: two paths
 *  to one write, one of them without the maker-checker step, is the drift that wave exists to remove. */
export const CENTRE_NEW_HREF = '/dairy/centres/new';
export function centresHref(o: { includeInactive?: boolean } = {}): string {
  return o.includeInactive ? `${CENTRES_HREF}?includeInactive=1` : CENTRES_HREF;
}

/* --------------------------------------------------------------------------------------------------------- */
/* STATES — W171 draws five                                                                                  */
/* --------------------------------------------------------------------------------------------------------- */

export type CentresViewState = 'ok' | 'flaggedOff' | 'restricted' | 'error';

/**
 * W171's states, mapped from what the API actually answers.
 *
 * A 404 is `flaggedOff` and not `error`: the flag guard returns 404 by design, because *"a disabled feature should be
 * invisible, never 'exists but forbidden'"*. A 403 is `restricted` — W171's own copy for it names the permission
 * (*"centre management needs dairy lead"*) and the reason custody is recorded.
 */
export function centresState(code: string | null | undefined, status?: number): CentresViewState {
  if (!code && status === undefined) return 'ok';
  if (code === 'FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'NOT_FOUND' || status === 404) return 'flaggedOff';
  return 'error';
}
export function centresStateKey(s: CentresViewState): string { return `dairy.centres.state.${s}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* CUSTODY                                                                                                   */
/* --------------------------------------------------------------------------------------------------------- */

/** *"Bhavna Ben K."*, or the reason there is no name to print. */
export function custodyKey(c: DairyCentreRow['custody']): string {
  return `dairy.centres.custody.${c.state}`;
}

/**
 * `held` is the only calm state.
 *
 * `nobody` is amber rather than red: a centre between two operators is a decision a cooperative made, and it is not
 * broken. `unrecorded` and `disagrees` are red — both mean the platform cannot say who is answerable for the milk.
 */
export function custodyTone(c: DairyCentreRow['custody']): 'ok' | 'warn' | 'bad' {
  if (c.state === 'held') return 'ok';
  if (c.state === 'nobody') return 'warn';
  return 'bad';
}

/** Is there a name and phone this screen may show? */
export function custodyIsNamed(c: DairyCentreRow['custody']): boolean {
  return c.state === 'held' && c.operatorName !== null;
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE HOURS                                                                                                 */
/* --------------------------------------------------------------------------------------------------------- */

/** `{opens:'06:00',closes:'09:00'}` → `"06:00–09:00"`. An en dash, and no invention when the window is absent. */
export function hoursText(w: DairyShiftWindow | null): string | null {
  return w === null ? null : `${w.opens}–${w.closes}`;
}

/** Which of a centre's two windows a screen should lead with — neither, one, or both. */
export function hoursKey(h: DairyCentreRow['hours']): string {
  if (h.morning === null && h.evening === null) return 'dairy.centres.hours.none';
  if (h.morning !== null && h.evening !== null) return 'dairy.centres.hours.both';
  return h.morning !== null ? 'dairy.centres.hours.morningOnly' : 'dairy.centres.hours.eveningOnly';
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE STATUS COLUMN — *"active · BMC warm"*                                                                 */
/* --------------------------------------------------------------------------------------------------------- */

export function statusKey(c: Pick<DairyCentreRow, 'isActive'>): string {
  return c.isActive ? 'dairy.centres.status.active' : 'dairy.centres.status.inactive';
}

/**
 * The tank half of the status, in the order the monitor uses: a GAP outranks a temperature, because a number from
 * forty minutes ago presented as now is the one thing that would get a tank of milk thrown away.
 */
export function tankKey(t: DairyCentreRow['tank']): string {
  return `dairy.centres.tank.${t.condition}`;
}
export function tankTone(t: DairyCentreRow['tank']): 'ok' | 'warn' | 'bad' | 'muted' {
  if (t.condition === 'above_band' || t.condition === 'below_min') return 'bad';
  if (t.condition === 'stale') return 'warn';
  if (t.condition === 'no_unit' || t.condition === 'never') return 'muted';
  return 'ok';
}
/** Is this tank's temperature safe to read as the tank's present state? */
export function tankTempIsCurrent(t: DairyCentreRow['tank']): boolean {
  return t.tempC !== null && (t.condition === 'in_range' || t.condition === 'above_band' || t.condition === 'below_min');
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE FOOTER                                                                                                */
/* --------------------------------------------------------------------------------------------------------- */

/** *"3 centres · 312 memberships total ✓"* — or the shortfall, which is the fact a secretary actually needs. */
export function reconciliationKey(r: DairyCentresConsole['reconciliation']): string {
  return r.reconciles ? 'dairy.centres.footer.reconciles' : 'dairy.centres.footer.unaccounted';
}
export function reconciliationTone(r: DairyCentresConsole['reconciliation']): 'ok' | 'warn' {
  return r.reconciles ? 'ok' : 'warn';
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE PREFERENCE MIX                                                                                        */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * The cadence's own name, from the key family the rest of the dairy already uses (`dairy.cycleName.*`, added by
 * TENANT-6a for the counter board's window). A second family meaning the same four words is how one screen comes to
 * say "fortnightly" where another says "pakshik" for the same row.
 */
export function preferenceLabelKey(p: Pick<DairyPreferenceRow, 'paymentCycle'>): string { return `dairy.cycleName.${p.paymentCycle}`; }

/**
 * *"their choice, honoured"* — as a state rather than a slogan.
 *
 * `honoured` means a cycle for this cadence exists, which is what makes the choice real: TENANT-6c-1 opens one cycle
 * per distinct preference and bill generation filters on `payment_cycle`. `pending` means those members' cadence has
 * no cycle yet, and printing "honoured" over it would be a promise about a job that has not run.
 */
export function preferenceStateKey(p: DairyPreferenceRow): string {
  return `dairy.centres.pref.${p.state}`;
}
export function preferenceTone(p: DairyPreferenceRow): 'ok' | 'warn' {
  return p.state === 'honoured' ? 'ok' : 'warn';
}

/** `9920` → `"99.2"`. Integer basis points to one decimal, by string: a share printed from a float drifts. */
export function shareText(bp: number | null): string | null {
  if (bp === null) return null;
  const neg = bp < 0;
  const abs = Math.abs(bp);
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${Math.floor((abs % 100) / 10)}`;
}

/* --------------------------------------------------------------------------------------------------------- */
/* WHAT THE BOARD STILL CANNOT DO                                                                            */
/* --------------------------------------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------------------------------------- */
/* THE MOVE — PC-56 TENANT-6d-3                                                                              */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W171's other sentence: *"Moving house? The membership moves centres without losing history — the member_code
 * changes, the person's record never resets."*
 *
 * BUILT, and it shipped in a later wave than the board on purpose: TENANT-6c-6's register printed a bill's centre from
 * the membership's CURRENT route, so the first transfer would have silently re-attributed every closed fortnight. The
 * move and the repair of that read are one commit.
 */
export function moveHeadingKey(): string { return 'dairy.centres.move.heading'; }

/** Off for this cooperative (Law 10). The board says so rather than offering a form that answers 404. */
export function moveDisabledKey(): string { return 'dairy.centres.move.disabled'; }

/**
 * Should the board draw the move form at all?
 *
 * The rule lives HERE and not in the page, so it is testable: a form drawn while the tenant's flag is off sends an
 * operator into a 404, and a rule that only exists inside JSX is a rule no test can reach.
 */
export function showMoveForm(v: Pick<DairyCentresConsole, 'transferEnabled'>): boolean {
  return v.transferEnabled === true;
}

/**
 * A calendar day, `YYYY-MM-DD` — the shape a route period is measured in.
 *
 * The server re-validates and the database has the final say; this exists so a half-typed date never leaves the
 * browser, and so the rule is a function a test can call rather than a regex buried in a server action.
 */
export function isCalendarDay(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** A card must be SOMETHING. This platform does not number a cooperative's cards, so it cannot fill a blank one in. */
export function isMemberCode(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && t.length <= 40;
}

/** Exactly one reason a move is refused, from the API's own verdict — the same function the act uses. */
export function moveRefusalKey(r: DairyMoveRefusal): string { return `dairy.centres.move.refusal.${r}`; }

/** Allowed, with something an operator should know before the card is re-issued. */
export function moveCautionKey(c: DairyMoveCaution): string { return `dairy.centres.move.caution.${c}`; }

/**
 * *"Not today — she poured here this morning. From tomorrow."*
 *
 * The earliest legal date accompanies every verdict, including an allowed one, because a refusal without the fix sends
 * an operator away to guess.
 */
export function moveEarliestKey(): string { return 'dairy.centres.move.earliest'; }

/** A membership must be named by id here. A picker belongs with a member roster, which is not this screen. */
export function movePickerGapKey(): string { return 'dairy.centres.move.pickerGap'; }

/** No history of hours: *"what time did this centre open in June"* is unanswerable, and the screen admits it. */
export function hoursHistoryGapKey(): string { return 'dairy.centres.gap.hoursHistory'; }

/** Custody is exclusive at an instant, so a centre that really runs two operators on two shifts is not modelled. */
export function reliefOperatorGapKey(): string { return 'dairy.centres.gap.reliefOperator'; }
