// apps/web-tenant/src/features/dairy/diversion.ts · W170's playbook step 2, as sentences — PC-56 TENANT-6d-6.
//
// Pure. The two judgements here are both about NOT overstating what a diversion is:
//
//   • a request is not a diversion. One person cannot move a village's milk, so the screens say *"waiting for a second
//     signature"* rather than *"diverted"* until somebody with `dairy.override` has signed;
//   • a diversion is not a transfer. The member's route, card and history are untouched — they belong to Vanthali and
//     will pour there tomorrow morning — and a screen that blurred the two would be describing TENANT-6d-3's act.
import type { DairyDiversion, DairyDiversionRow, DairyShift } from '@krishalaya/sdk-js';

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
 * W170's *"route notice to 87 pourers, Gujarati voice"* — COUNTED here, NOT SENT.
 *
 * Printed on the confirm step and again on the success step. A cooperative that believes the platform phoned 87
 * families will not phone them itself, and that is a worse failure than the missing feature: the members turn up at a
 * locked centre. TENANT-6d-7 sends the notice.
 */
export function diversionNoticeGapKey(): string { return 'dairy.diversion.noticeNotSent'; }

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
