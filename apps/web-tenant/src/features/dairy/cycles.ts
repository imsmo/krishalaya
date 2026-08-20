// apps/web-tenant/src/features/dairy/cycles.ts · W169 (Dairy payout cycles) view-model — PC-56 TENANT-6c-6.
//
// Pure: no React, no fetch, no formatting of money (that is `@krishalaya/i18n`'s job with the tenant's currency). Every
// sentence the screen can say is a KEY chosen here, so the decisions are testable and the page is a layout.
//
// The API decides what an operator may DO — `acts.preview` and `acts.approve` come back with their refusal already
// resolved from the flag, the two permissions, the cycle's stage and the maker-checker rule. This file only names those
// refusals in the operator's own language. That split is the point: a button whose availability is computed in the
// browser is a button that 403s on the press.
import type { DairyCycleAct, DairyCycleBillRow, DairyCycleConsole } from '@krishalaya/sdk-js';

export const CYCLES_HREF = '/dairy/cycles';
export function cycleHref(cycleId: string, extra: { cursor?: string | null; direction?: string | null } = {}): string {
  const q = new URLSearchParams({ cycle: cycleId });
  if (extra.cursor) q.set('cursor', extra.cursor);
  if (extra.direction && extra.direction !== 'desc') q.set('direction', extra.direction);
  return `${CYCLES_HREF}?${q.toString()}`;
}

/* --------------------------------------------------------------------------------------------------------- */
/* STATES — the same split every wave since TENANT-5c has used                                               */
/* --------------------------------------------------------------------------------------------------------- */

export type CyclesViewState = 'ok' | 'flaggedOff' | 'restricted' | 'error';

/** 404 is Law 10's invisible-when-disabled flag guard; 403 is the canon's *"Cycles restricted"* card. */
export function cyclesState(code: string | null | undefined, status?: number): CyclesViewState {
  if (!code && status === undefined) return 'ok';
  if (code === 'FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'NOT_FOUND' || status === 404) return 'flaggedOff';
  return 'error';
}
export function cyclesStateKey(s: CyclesViewState): string { return `dairy.cycles.state.${s}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* THE CYCLE'S STAGE                                                                                         */
/* --------------------------------------------------------------------------------------------------------- */

export type Stage = DairyCycleConsole['cycle']['stage'];

export function stageKey(stage: Stage): string { return `dairy.cycles.stage.${stage}`; }

/** `closed_unbilled` is amber, not green and not red: nothing is wrong, and nothing has happened yet either. */
export function stageTone(stage: Stage): 'ok' | 'warn' | 'muted' {
  if (stage === 'previewed' || stage === 'approved') return 'ok';
  if (stage === 'closed_unbilled') return 'warn';
  return 'muted';
}

/**
 * THE SENTENCE THIS SCREEN EXISTS TO SAY HONESTLY.
 *
 * W169 draws 312 bills in `draft` while the fortnight is still running. On this platform a bill is BUILT WHEN THE
 * WINDOW SHUTS (0157's ruling — a money record that changes under the member is worse than one that arrives on the
 * Thursday), so an open cycle has an accrual and no bills. An empty register with no explanation reads as "nobody
 * poured", which is the one thing it must never mean.
 */
export function registerNoteKey(view: Pick<DairyCycleConsole, 'cycle' | 'cadenceOn'>): string | null {
  if (view.cycle.stage === 'accruing') return 'dairy.cycles.note.accruing';
  if (view.cycle.stage === 'closed_unbilled') {
    // Two different sentences, and the difference is actionable: the clock is off, or the clock has not got here yet.
    return view.cadenceOn ? 'dairy.cycles.note.billsPending' : 'dairy.cycles.note.cadenceOff';
  }
  return null;
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE ACTS                                                                                                  */
/* --------------------------------------------------------------------------------------------------------- */

/** The refusal, named. One key per reason — a single "you cannot do this" would waste the server's work. */
export function actRefusalKey(act: DairyCycleAct): string | null {
  return act.refusal === null ? null : `dairy.cycles.act.refusal.${act.refusal}`;
}
export function actCautionKey(act: DairyCycleAct): string | null {
  return act.caution === null ? null : `dairy.cycles.act.caution.${act.caution}`;
}

/**
 * A refusal an operator can FIX by talking to somebody is different from one that needs a switch thrown.
 *
 * `MAKER_IS_CHECKER` is the friendliest of them (find a colleague) and `FLAG_OFF` the least (ask the platform), so they
 * do not share a colour: an amber "somebody else must sign this" is a working cooperative, and a red one would suggest
 * the software is broken when it is doing exactly what 312 families need it to.
 */
export function actTone(act: DairyCycleAct): 'ok' | 'warn' | 'muted' {
  if (act.can) return act.caution ? 'warn' : 'ok';
  if (act.refusal === 'MAKER_IS_CHECKER' || act.refusal === 'NOTHING_LEFT' || act.refusal === 'WRONG_STAGE') return 'warn';
  return 'muted';
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE REGISTER                                                                                              */
/* --------------------------------------------------------------------------------------------------------- */

export function billStatusKey(status: string): string { return `dairy.bill.status.${status}`; }
export function billStatusTone(status: string): 'ok' | 'bad' | 'warn' | 'muted' {
  if (status === 'paid') return 'ok';
  if (status === 'disputed') return 'bad';
  if (status === 'voided') return 'muted';
  if (status === 'approved' || status === 'previewed') return 'warn';
  return 'muted';
}

/**
 * The member, as the register may show them: the name if the platform has one, and the MASKED code either way.
 *
 * A bill whose member has no `full_name` on file is a real row — `users.full_name` is nullable and a farmer enrolled
 * by phone at a counter may never have given one — so the code carries the row rather than an empty cell that reads
 * like a bug.
 */
export function memberLabel(row: Pick<DairyCycleBillRow, 'memberName' | 'memberCodeMasked'>): { name: string | null; code: string } {
  const name = row.memberName === null ? null : row.memberName.trim();
  return { name: name && name.length > 0 ? name : null, code: row.memberCodeMasked };
}

/** *"13.6 L/day this cycle · 30d avg 14.2"* — and the average's own day count, because it is not always 30. */
export function paceParts(row: Pick<DairyCycleBillRow, 'litresPerDay' | 'avg30d' | 'avg30dDays'>): { perDay: string | null; avg: string | null; avgDays: number } {
  return { perDay: row.litresPerDay, avg: row.avg30d, avgDays: row.avg30dDays };
}

/**
 * W169 itemises: *"−₹1,240 loan EMI + insurance"*. The label comes from the DB vocabulary (Law 6 — a cooperative
 * renames its own feed credit), so this returns the row's own names and never a hardcoded string.
 */
export function deductionParts(row: Pick<DairyCycleBillRow, 'deductions'>): Array<{ label: string | null; amountMinor: string; unsupportedReason: string | null; partly: boolean }> {
  return row.deductions.map((d) => ({
    label: d.typeName ?? d.typeCode,
    amountMinor: d.amountMinor,
    unsupportedReason: d.unsupportedReason,
    // Some of this line's money has moved and some has not — the state 6c-4 built and the register must not average
    // away, because "applied" is what actually reduced a debt.
    partly: d.applied > 0 && d.applied < d.lines,
  }));
}

/** A bill that will REFUSE to pay until the member is asked again. The count is on the tile; this is the row. */
export function rowWarningKey(row: Pick<DairyCycleBillRow, 'needsFreshConsent' | 'openDisputes' | 'status' | 'memberRefusedBelowLine'>): string | null {
  if (row.openDisputes > 0) return 'dairy.cycles.row.disputed';
  if (row.needsFreshConsent) return 'dairy.cycles.row.needsConsent';
  // Below the line and refused: 6c-4's hardest call, on the screen. The bill pays; the objection is still owed an
  // answer, and the desk is the only party who can give one.
  if (row.memberRefusedBelowLine) return 'dairy.cycles.row.refusedBelowLine';
  return null;
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE TILES                                                                                                 */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W169's second tile. The payday IS recorded (0157) — what is NOT built is the canon's *"one bank trip"*: no payout
 * batch over a cycle exists, so bills pay one at a time and the screen says which of the two it is showing.
 */
export function paydayNoteKey(payday: DairyCycleConsole['payday']): string {
  return payday.batchBuilt ? 'dairy.cycles.payday.batch' : 'dairy.cycles.payday.noBatch';
}

/** *"Last cycle disputes 2 / 309 · both resolved before payday"* — claimed only when it is true of every one. */
export function disputesKey(last: DairyCycleConsole['lastCycle']): string {
  if (!last) return 'dairy.cycles.disputes.noPrevious';
  if (last.disputes.total === 0) return 'dairy.cycles.disputes.none';
  if (last.disputes.allResolvedBeforePayday) return 'dairy.cycles.disputes.allBeforePayday';
  if (last.disputes.open > 0) return 'dairy.cycles.disputes.stillOpen';
  return 'dairy.cycles.disputes.someAfterPayday';
}

/**
 * The consent line, in the tenant's own numbers.
 *
 * W169's alert says *"above 25%"*. That 25 is a SETTING (0160), and a second setting caps what the automatic path may
 * take below it (0161) — so a cooperative that tightened either must see its own number here, and the gap between them
 * is what explains why a member with a large debt had a small recovery.
 */
export function consentParts(c: DairyCycleConsole['consent']): { consentPct: number; automaticPct: number; tightened: boolean } {
  return { consentPct: c.consentPct, automaticPct: c.automaticPct, tightened: c.automaticPct < c.consentPct };
}

/** The deductions tile's own refusal: with assembly OFF, a zero total means "not switched on", not "nothing owed". */
export function deductionsNoteKey(d: DairyCycleConsole['deductions']): string | null {
  if (!d.assemblyOn && d.totalMinor === '0') return 'dairy.cycles.deductions.assemblyOff';
  if (d.needingConsent > 0) return 'dairy.cycles.deductions.needingConsent';
  return null;
}

/** The accrual tile's caveat, carried from TENANT-6a: the bonus slabs W168 promises are still applied by nothing. */
export function bonusIgnoredKey(a: DairyCycleConsole['accrual']): string | null {
  return a.bonusRulesIgnored ? 'dairy.cycles.accrual.bonusIgnored' : null;
}

/* --------------------------------------------------------------------------------------------------------- */
/* PAGING                                                                                                    */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W169 draws numbered pages (1 · 2 · 13). This register is KEYSET-paginated, so page 13 has no address — and inventing
 * one with OFFSET would get slower every fortnight and skip rows while a preview pass reorders nothing but changes
 * statuses under the operator. So: "next", and the count of what is shown against the cycle's real total.
 */
export function pagingText(view: Pick<DairyCycleConsole, 'page' | 'totals'>): { shown: number; of: number } {
  return { shown: view.page.totals.rows, of: view.totals.bills };
}
export function nextHref(cycleId: string, view: Pick<DairyCycleConsole, 'page'>, direction: string): string | null {
  return view.page.nextCursor === null ? null : cycleHref(cycleId, { cursor: view.page.nextCursor, direction });
}
/** The other end of the register: the smallest bills, where a missing pour hides. Not a sort menu — one flip. */
export function flipDirection(direction: string): 'desc' | 'asc' { return direction === 'asc' ? 'desc' : 'asc'; }
export function directionKey(direction: string): string { return direction === 'asc' ? 'dairy.cycles.sort.asc' : 'dairy.cycles.sort.desc'; }
