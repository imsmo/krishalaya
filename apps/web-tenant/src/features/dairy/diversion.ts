// apps/web-tenant/src/features/dairy/diversion.ts · W170's playbook step 2, as sentences — PC-56 TENANT-6d-6.
//
// Pure. The two judgements here are both about NOT overstating what a diversion is:
//
//   • a request is not a diversion. One person cannot move a village's milk, so the screens say *"waiting for a second
//     signature"* rather than *"diverted"* until somebody with `dairy.override` has signed;
//   • a diversion is not a transfer. The member's route, card and history are untouched — they belong to Vanthali and
//     will pour there tomorrow morning — and a screen that blurred the two would be describing TENANT-6d-3's act.
import type { DairyDiversion, DairyDiversionRow, DairyNoticeState, DairyShift } from '@krishalaya/sdk-js';

export const DIVERT_HREF = '/dairy/bmc/divert';
export const DIVERSIONS_HREF = '/dairy/diversions';

/** Prefilled from a tank's own centre, because that is the diversion an operator standing at a warm cooler wants. */
export function divertHref(fromMccId: string, shift: DairyShift = 'evening'): string {
  const q = new URLSearchParams({ step: 'confirm', fromMccId, shift });
  return `${DIVERT_HREF}?${q.toString()}`;
}

/** The shift's own word — the SAME key TENANT-6a's counter board has used since it was built. A second `morning` in
 *  the catalogue is a second place for it to be translated differently, and the parity gate's duplicate check caught
 *  exactly that when this wave first added one. */
export function diversionShiftKey(shift: DairyShift): string { return `dairy.shift.${shift}`; }

/** requested · live · cancelled — three states, three sentences, and the middle one is the only one that moves milk. */
export function diversionStateKey(d: Pick<DairyDiversion, 'state'>): string { return `dairy.diversion.state.${d.state}`; }
export function diversionStateTone(d: Pick<DairyDiversion, 'state'>): 'ok' | 'warn' | 'muted' {
  if (d.state === 'live') return 'ok';
  return d.state === 'requested' ? 'warn' : 'muted';
}

/**
 * W170's *"route notice to 87 pourers, Gujarati voice"* — **SENT, since TENANT-6d-8.**
 *
 * 6d-6 printed *"not told"* here and it was true; the notice exists now, so the screen prints WHICH of five things
 * happened. The vocabulary is deliberately about the past — there is no `sent` in it, because the platform hands the
 * notice to the outbox inside the signing transaction and delivery is what the report answers.
 */
export function diversionNoticeStateKey(state: DairyNoticeState): string { return `dairy.diversion.notice.${state}`; }

/** `queued`/`retracted` is something happening; `not_enabled` is a cooperative doing it themselves; the rest is neither. */
export function diversionNoticeTone(state: DairyNoticeState): 'ok' | 'warn' | 'muted' {
  if (state === 'queued') return 'ok';
  if (state === 'not_enabled' || state === 'retracted') return 'warn';
  return 'muted';
}

/**
 * WHAT THE CONFIRM STEP PROMISES, before the second signature.
 *
 * Two sentences and not one, because the difference matters to whoever is about to sign: with the notice enabled the
 * platform will phone and text these families in their own language; without it, THIS COOPERATIVE tells them the way it
 * always has. A cooperative that believes the platform phoned 87 families will not phone them itself, and that failure
 * ends with members at a locked centre — the same argument 6d-6 made for printing the gap.
 */
export function diversionNoticePromiseKey(noticeEnabled: boolean): string {
  return noticeEnabled ? 'dairy.diversion.notice.willBeTold' : 'dairy.diversion.notice.tellThemYourself';
}

/**
 * THE DELIVERY REPORT, IN ONE SENTENCE A DAIRY DESK CAN ACT ON.
 *
 * `people` and not `rows`: one member reached on push and in the app is ONE family told, and counting rows would
 * report 87 as 261. The gap between queued and reached is the number that sends somebody walking round three houses,
 * so it is the number the key is chosen by — a report that only ever said *"87 queued"* would never do that.
 */
export function diversionDeliveryKey(n: { queuedFor: number | null; people: number } | null): string | null {
  if (n === null || n.queuedFor === null) return null;
  if (n.queuedFor === 0) return 'dairy.diversion.notice.nobodyToTell';
  if (n.people >= n.queuedFor) return 'dairy.diversion.notice.allReached';
  if (n.people === 0) return 'dairy.diversion.notice.noneReached';
  return 'dairy.diversion.notice.someReached';
}

/**
 * The two figures a live diversion makes disagree ON PURPOSE, on TENANT-6a's counter board.
 *
 * The receiving centre takes pours from members who are not on its roll; the sending centre has a roll and no pours.
 * Before this wave those two could only disagree because something was wrong — so the board must now say which it is,
 * or an honest diverted evening looks exactly like a broken counter.
 */
export function diversionNoteKey(c: { divertedIn: number; divertedOut: number }): string | null {
  if (c.divertedIn > 0 && c.divertedOut > 0) return 'dairy.counter.diversion.both';
  if (c.divertedIn > 0) return 'dairy.counter.diversion.in';
  if (c.divertedOut > 0) return 'dairy.counter.diversion.out';
  return null;
}

/**
 * W170's playbook step 3 — *"dairy-union pickup advanced; batch tested before pooling — one warm tank never spoils a
 * tanker"*. NOT BUILT and named on the step itself: there is no union, no pickup and no batch test on this platform.
 * TENANT-6d-1 marked the whole playbook unbuilt; step 2 is built now, which makes saying so about step 3 necessary
 * rather than redundant — a list where two items are actionable and one is silent reads as three actionable items.
 */
export function unionPickupGapKey(): string { return 'dairy.bmc.playbook.unionPickupUnbuilt'; }

/** The register's row label: two villages and an evening, never two ids. */
export function diversionRowText(r: DairyDiversionRow): string {
  return `${r.fromCode} → ${r.toCode}`;
}
