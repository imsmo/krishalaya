// apps/web-tenant/src/features/mutate/chain.ts · the canon's shared MUTATE pattern (B2) — PC-56 TENANT-6d-5.
//
// Three canon screens, one shape: **W2521 confirm → W2522 success → W2523 failure**, over the `bmc` module's own words —
// *"Sharing actions on this module: Call MCC-AND-03 operator · Retry."*
//
//   • confirm — *"This is the explicit confirm step every destructive or state-changing action gets (Completeness Law
//     B4). Review the object and reason below; confirming writes an audit-trail entry with actor, time and reason."*
//   • success — *"the change is applied and the audit trail has the entry (actor · time · reason · before/after).
//     Money-adjacent actions reconcile zero-sum before this page ever shows."*
//   • failure — *"the attempt was rejected or errored; state is untouched (all-or-nothing). The failure reason and a
//     retry path are below; repeated failures page the on-call."*
//
// **THE FORM CHAIN AND THE MUTATE CHAIN ARE TWO PATTERNS, NOT ONE.** TENANT-6d-4 built the FORM chain (edit → review →
// success → failure) for *creating* a record; this is the chain for *acting on one that exists*. The canon separates
// them and so does this file — but the mechanics they genuinely share (values in the query string, the audit deep-link,
// the retry path, the failure copy) are IMPORTED from `features/forms/chain` rather than copied. A second copy of
// `carryValues` is two answers to *"what did the operator type"*, and the one that drifts is always the one nobody is
// looking at.
//
// WHAT IS DIFFERENT HERE, AND WHY
//   • **There are three states, not four.** The thing being acted on already exists, so there is no edit step and no
//     field table — the confirm screen reviews an OBJECT the server described and a REASON the operator wrote.
//   • **The reason is mandatory.** W2521 promises an audit entry with a reason; a blank one makes that a lie. It is
//     never pre-filled: a platform that suggests the words puts them in somebody's mouth, and an audit trail full of
//     one identical sentence is an audit trail nobody can read.
//   • **The confirm step is not an authorisation token.** The server re-takes its verdict when the act is performed,
//     because custody of a centre can change hands between reading a screen and pressing a button.
import {
  auditHref, canLinkAudit, carryValues, chainHref, failureKey, readCarried, repeatedFailuresGapKey, retryHref,
  valuesLostKey,
} from '../forms/chain';

export { auditHref, canLinkAudit, carryValues, readCarried, repeatedFailuresGapKey, valuesLostKey, failureKey };

/* --------------------------------------------------------------------------------------------------------- */
/* THE THREE STATES                                                                                          */
/* --------------------------------------------------------------------------------------------------------- */

export const MUTATE_STEPS = ['confirm', 'success', 'failure'] as const;
export type MutateStep = (typeof MUTATE_STEPS)[number];

/**
 * Which step a URL is asking for. Unknown → `confirm`, because a truncated or hand-typed link should land on the step
 * that reviews rather than on one that claims something happened.
 */
export function mutateStep(raw: string | null | undefined): MutateStep {
  return (MUTATE_STEPS as readonly string[]).includes(raw ?? '') ? (raw as MutateStep) : 'confirm';
}

export function mutateStepKey(step: MutateStep): string { return `mutate.step.${step}`; }

/** The confirm step's own href — the link a screen offers to START the act. */
export function confirmHref(path: string, values: Record<string, string | undefined | null>): string {
  return chainHref(path, 'confirm', values);
}

/** W2523's *"Retry — back to confirm"*: the reason survives, so the retry is a review of what was typed. */
export function retryToConfirm(path: string, values: Record<string, string | undefined | null>): string {
  return confirmHref(path, values);
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE OBJECT AND THE REASON                                                                                 */
/* --------------------------------------------------------------------------------------------------------- */

/** Mirrors the API's bounds (`MIN_CALL_REASON` / `MAX_CALL_REASON`) so the form refuses before the route does. */
export const MIN_REASON = 3;
export const MAX_REASON = 300;

export type ReasonState = 'empty' | 'too_short' | 'too_long' | 'ok';

/**
 * Is this reason usable — and if not, in which direction.
 *
 * `empty` and `too_short` are DIFFERENT states with different copy: a caller who typed nothing needs to be asked, and a
 * caller who typed `ok` needs to be told that is not a reason anybody will understand in six months.
 */
export function reasonState(raw: string | null | undefined): ReasonState {
  const s = (raw ?? '').trim();
  if (s.length === 0) return 'empty';
  if (s.length < MIN_REASON) return 'too_short';
  if (s.length > MAX_REASON) return 'too_long';
  return 'ok';
}
/**
 * The sentence for a reason that is not usable — and NULL when it is.
 *
 * `ok` has no copy on purpose: the parity gate refuses a blank catalogue value (an empty label is silence to a screen
 * reader), and a key that renders nothing is a key that will one day render its own name. The page asks for a sentence
 * only when there is one.
 */
export function reasonStateKey(state: ReasonState): string | null {
  return state === 'ok' ? null : `mutate.reason.${state}`;
}

/** The confirm button is offered only when the server said the act is allowed AND the reason is usable. */
export function canConfirm(preview: { allowed: boolean } | null, reason: string | null | undefined): boolean {
  return preview !== null && preview.allowed && reasonState(reason) === 'ok';
}

/** One refusal code → one sentence, per module. `mutate.bmc.refusal.NOBODY_HOLDS_CENTRE` and its eight siblings. */
export function mutateRefusalKey(module: string, code: string): string { return `mutate.${module}.refusal.${code}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* WHAT THE OBJECT SAYS ABOUT ITSELF                                                                         */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * WHO WILL BE REACHED, as a key rather than a string.
 *
 * Three states, and the middle one is the point: custody is recorded but the holder's name cannot be verified against
 * this cooperative's own roles (TENANT-6d-2's tenancy-checked join), so the screen says *"the operator on file cannot
 * be verified"* instead of printing a name this platform does not stand behind. The call can still be placed — the
 * provider bridges by id — and that distinction is exactly what an operator deserves to know before pressing a button.
 */
export function calleeKey(o: { operatorName: string | null; operatorUnnamed: boolean } | null): string {
  if (o === null) return 'mutate.bmc.callee.nobody';
  if (o.operatorUnnamed) return 'mutate.bmc.callee.unverified';
  return o.operatorName ? 'mutate.bmc.callee.named' : 'mutate.bmc.callee.nobody';
}

/**
 * The temperature on the confirm screen, and whether it is the tank's CONDITION or its last known reading.
 *
 * TENANT-6d-1's ruling, carried into the act: a forty-minute-old number is not a temperature. On this screen it
 * matters twice over, because a stale reading is one of the two reasons somebody is placing this call.
 */
export function objectTempKey(o: { tempC: string | null; tempIsCurrent: boolean }): string {
  if (o.tempC === null) return 'mutate.bmc.temp.never';
  return o.tempIsCurrent ? 'mutate.bmc.temp.current' : 'mutate.bmc.temp.stale';
}

/**
 * *"Retry"* on W170's TELEMETRY GAP card is a PAGE LOAD, not this chain.
 *
 * TENANT-6a made this ruling and TENANT-6d-1 reused it: nothing on this platform can poll a cooler. `cold_chain_logs`
 * is written by the device, sensors buffer locally, and a button that appeared to fetch a reading would be a button
 * that lies about what it did. So the gap card links to the monitor, and the shared mutate pattern does not apply to
 * it — Completeness Law B4 is about *"every destructive or state-changing action"*, and reloading a screen is neither.
 *
 * Exported as a function rather than left in a comment because TENANT-6d-3 learned that a rule living only inside JSX
 * is a rule no test can reach.
 */
export function gapRetryHref(monitorHref: string): string { return monitorHref; }
export function gapRetryIsMutation(): false { return false; }

/** Re-exported so a page never has to import from two chain files to build one screen. */
export { chainHref, retryHref };
