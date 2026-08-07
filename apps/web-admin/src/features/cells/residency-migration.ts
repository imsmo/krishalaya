// apps/web-admin/src/features/cells/residency-migration.ts · W033/W034/W037/W038 view logic, PURE (PC-56 ADMIN-8b).

/* ------------------------------------------------------------------------------------------------ */
/* W033 · THE ATTESTATION                                                                            */
/* ------------------------------------------------------------------------------------------------ */

export type AttestationKind = 'clean' | 'transfers_occurred' | 'no_evidence';

/** **`no_evidence` IS DRAWN AS DANGER, NOT AS NEUTRAL, AND IT IS THE MOST IMPORTANT LINE ON THIS SCREEN.**
 *
 *  Before this wave every window was in that state and W033 rendered "No residency violations logged" — a sentence a
 *  reader takes as assurance. An attestation from an empty log is an attestation from nothing, and drawing it grey would
 *  reproduce exactly the false comfort the missing table produced for the platform's whole life. */
export function attestationClass(kind: string): string {
  switch (kind) {
    case 'clean': return 'kv-badge is-ok';
    case 'transfers_occurred': return 'kv-badge is-warn';
    case 'no_evidence': return 'kv-badge is-danger';
    default: return 'kv-badge is-danger';
  }
}

export function attestationKey(kind: string): string {
  const known = ['clean', 'transfers_occurred', 'no_evidence'];
  return known.includes(kind) ? `rz.attest.${kind}` : 'rz.attest.unknown';
}

/** The claim the document may make. Kept separate from the badge because this string ends up in a compliance record and
 *  must read identically wherever it appears. */
export function claimKey(claim: string): string {
  const known = ['no_cross_border_transfers', 'transfers_under_basis', 'cannot_attest'];
  return known.includes(claim) ? `rz.claim.${claim}` : 'rz.claim.cannot_attest';
}

/** An empty violation list means one of two OPPOSITE things, and only `loggingSince` distinguishes them.
 *
 *  Returning the distinction as a key rather than letting the page infer it, because inferring "nothing happened" from
 *  "nothing is recorded" is precisely the mistake this whole wave exists to stop. */
export function emptyLogKey(loggingSince: string | null): string {
  return loggingSince === null ? 'rz.log.neverRecorded' : 'rz.log.nothingAttempted';
}

export function emptyLogClass(loggingSince: string | null): string {
  return loggingSince === null ? 'kv-note is-danger' : 'kv-note is-ok';
}

/** Which refusals ARE the boundary doing its job. Mirrors the server so the two cannot disagree about what counts as
 *  protection — "the cell did not exist" is a typo, not a boundary. */
export function refusalIsBoundary(refusedBy: string): boolean {
  return refusedBy === 'residency_lock' || refusedBy === 'country_mismatch';
}

export function refusalKey(refusedBy: string): string {
  const known = ['residency_lock', 'country_mismatch', 'cell_missing', 'profile_not_ratified'];
  return known.includes(refusedBy) ? `rz.refused.${refusedBy}` : 'rz.refused.other';
}

/** A PERMITTED transfer is the row that changes what the attestation says, so it is drawn apart from the refusals. */
export function outcomeClass(outcome: string): string {
  return outcome === 'allowed' ? 'kv-badge is-warn' : 'kv-badge is-ok';
}

/* ------------------------------------------------------------------------------------------------ */
/* COUNTRY PROFILES                                                                                  */
/* ------------------------------------------------------------------------------------------------ */

export function regulationClass(status: string): string {
  switch (status) {
    case 'ratified': return 'kv-badge is-ok';
    // A DRAFT IS NOT A PROFILE, and grey would let it read as one. W033 shows BD as "DPA 2023 (draft profile)" with no
    // cells, which is the correct state precisely because a draft cannot anchor a residency lock.
    case 'draft': return 'kv-badge is-warn';
    default: return 'kv-badge is-danger';
  }
}

export function regulationKey(status: string): string {
  const known = ['none', 'draft', 'ratified'];
  return known.includes(status) ? `rz.reg.${status}` : 'rz.reg.none';
}

export type Posture = 'blocked' | 'partial' | 'no_cells';

/** W033's cross-border column reads "blocked" for every country including those with no cells at all — and "the boundary
 *  holds" is a different statement from "there is nothing here to protect". Only the second is true for BD, NP, LK and AE
 *  today. */
export function postureKey(p: string): string {
  const known = ['blocked', 'partial', 'no_cells'];
  return known.includes(p) ? `rz.posture.${p}` : 'rz.posture.no_cells';
}

export function postureClass(p: string): string {
  if (p === 'blocked') return 'kv-badge is-ok';
  // PARTIAL IS DANGER: a country's boundary is as strong as its weakest cell, and one unlocked cell means the lock does
  // not hold for that country.
  if (p === 'partial') return 'kv-badge is-danger';
  return 'kv-badge';
}

/* ------------------------------------------------------------------------------------------------ */
/* W034 · THE MIGRATION PIPELINE                                                                     */
/* ------------------------------------------------------------------------------------------------ */

export type JobStatus = 'queued' | 'copying' | 'verifying' | 'cutover' | 'done' | 'rolled_back' | 'failed';

export function jobClass(s: string): string {
  switch (s) {
    case 'done': return 'kv-badge is-ok';
    case 'cutover': return 'kv-badge is-danger';   // the write freeze is live; the tenant is offline right now
    case 'copying': case 'verifying': return 'kv-badge is-info';
    case 'queued': return 'kv-badge is-warn';
    case 'rolled_back': return 'kv-badge is-warn';  // the safety net worked — a warning, not a failure
    case 'failed': return 'kv-badge is-danger';
    default: return 'kv-badge is-danger';
  }
}

export function jobKey(s: string): string {
  const known = ['queued', 'copying', 'verifying', 'cutover', 'done', 'rolled_back', 'failed'];
  return known.includes(s) ? `rz.job.${s}` : 'rz.job.unknown';
}

/** **WHERE THE TENANT'S DATA ACTUALLY IS.** Only `done` means it moved — the source is authoritative through copy and
 *  verify, and the placement flips inside the cutover. A console that got this wrong would tell somebody their data is in
 *  a country it is not in, which on this plane is the worst possible wrong answer. */
export function dataLocationKey(status: string): string {
  return status === 'done' ? 'rz.where.target' : 'rz.where.source';
}

/** The freeze against its budget. An over-budget RUNNING freeze is the state somebody needs to see immediately: the
 *  tenant is offline and the promise has already been broken. */
export function freezeClass(kind: string, overBudget: boolean): string {
  if (kind === 'unreadable') return 'kv-note is-danger';
  if (kind === 'running') return overBudget ? 'kv-note is-danger' : 'kv-note is-warn';
  if (kind === 'finished') return overBudget ? 'kv-note is-warn' : 'kv-note is-ok';
  return 'kv-note';
}

export function freezeKey(kind: string, overBudget: boolean): string {
  if (kind === 'not_started') return 'rz.freeze.notStarted';
  if (kind === 'unreadable') return 'rz.freeze.unreadable';
  if (kind === 'running') return overBudget ? 'rz.freeze.runningOver' : 'rz.freeze.running';
  return overBudget ? 'rz.freeze.finishedOver' : 'rz.freeze.finished';
}

export function cleanupKey(kind: string): string {
  const known = ['not_applicable', 'holding', 'due', 'done'];
  return known.includes(kind) ? `rz.cleanup.${kind}` : 'rz.cleanup.not_applicable';
}

/** **THE EXECUTOR DOES NOT EXIST, AND EVERY SURFACE SHOWING A JOB MUST SAY SO.**
 *
 *  A console rendering `queued` as though something were about to pick it up would be the sixth status-recording-an-act-
 *  nobody-performs on this platform, and by far the largest. Returned as a key so the sentence is one sentence. */
export function executorNoticeKey(exists: boolean): string | null {
  return exists ? null : 'rz.executor.absent';
}

/* ------------------------------------------------------------------------------------------------ */
/* THE PREFLIGHT                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

export function checkKey(check: string): string {
  const known = ['no_open_payouts', 'no_live_auctions', 'outbox_drained', 'within_window_budget'];
  return known.includes(check) ? `rz.check.${check}` : 'rz.check.other';
}

export type CheckState = 'pass' | 'blocked' | 'unknown';

export function checkState(c: { ok: boolean; unknown?: boolean }): CheckState {
  if (c.ok) return 'pass';
  return c.unknown ? 'unknown' : 'blocked';
}

/** **UNKNOWN IS DRAWN AS DANGER, NOT AS A WARNING.** A check that did not run is worse than one that failed: a failure is
 *  a known problem with a next step, and an unrun check on a migration preflight means somebody is about to freeze a
 *  farmer's tenant while one of the four guards was blind. */
export function checkClass(state: CheckState): string {
  switch (state) {
    case 'pass': return 'kv-badge is-ok';
    case 'blocked': return 'kv-badge is-warn';
    default: return 'kv-badge is-danger';
  }
}

/** Whether the console offers a waiver control at all. It must NOT for an unwaivable check, and must not for an unknown
 *  one — waiving a check that did not run is asserting a result nobody has. */
export function showWaiver(check: string, state: CheckState): boolean {
  if (state !== 'blocked') return false;
  return check !== 'no_open_payouts';
}

/* ------------------------------------------------------------------------------------------------ */
/* W037 · THE PLAN                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

export function planStatusClass(s: string): string {
  switch (s) {
    case 'done': return 'kv-badge is-ok';
    case 'planned': return 'kv-badge is-info';
    case 'gated': return 'kv-badge is-warn';
    case 'abandoned': return 'kv-badge';
    default: return 'kv-badge';   // draft
  }
}

export function planStatusKey(s: string): string {
  const known = ['draft', 'planned', 'gated', 'done', 'abandoned'];
  return known.includes(s) ? `rz.plan.${s}` : 'rz.plan.draft';
}

/** Render a trigger CONDITION as a sentence key plus its values.
 *
 *  A condition rather than a date is the whole design: a plan keyed to "when in-west-1 reaches 70%" survives a slow
 *  quarter, and a calendar entry goes stale. An unrecognised kind renders generically rather than dumping the jsonb,
 *  because raw JSON in a planning table teaches an operator to stop reading the column. */
export function triggerKey(spec: Record<string, unknown>): string {
  const kind = typeof spec.kind === 'string' ? spec.kind : '';
  const known = ['utilisation', 'market_entry', 'date', 'manual'];
  return known.includes(kind) ? `rz.trigger.${kind}` : 'rz.trigger.other';
}

/* ------------------------------------------------------------------------------------------------ */
/* W038 · PROVISIONING                                                                               */
/* ------------------------------------------------------------------------------------------------ */

export function provisioningClass(s: string): string {
  switch (s) {
    case 'open': return 'kv-badge is-ok';
    case 'ready': return 'kv-badge is-info';
    case 'smoke': return 'kv-badge is-warn';
    case 'abandoned': return 'kv-badge';
    default: return 'kv-badge';
  }
}

export function provisioningKey(s: string): string {
  const known = ['drafting', 'awaiting_infra', 'smoke', 'ready', 'open', 'abandoned'];
  return known.includes(s) ? `rz.prov.${s}` : 'rz.prov.drafting';
}

/** W038's six steps, in order, so the checklist renders the same way every time. */
export const PROVISIONING_STEPS = Object.freeze([
  'infra', 'shards', 'residency', 'smoke', 'default_flag', 'open',
]);

export function stepKey(step: string): string {
  return PROVISIONING_STEPS.includes(step) ? `rz.step.${step}` : 'rz.step.other';
}

/** **A CELL MAY NOT OPEN WITHOUT A PASSED SMOKE TEST.** W038's failure state: "Synthetic order could not complete payout
 *  leg — cell stays closed." `ck_cpr_open_needs_smoke` makes that a database fact; this keeps the button from being drawn
 *  in the first place. */
export function canOpenCell(smokeOutcome: string | null, status: string): boolean {
  return smokeOutcome === 'passed' && status === 'ready';
}

export function smokeClass(outcome: string | null): string {
  if (outcome === 'passed') return 'kv-badge is-ok';
  if (outcome === 'failed') return 'kv-badge is-danger';
  // NOT RUN is a warning rather than neutral: a cell nobody has proved works is not a cell in an unknown state, it is a
  // cell that must not open.
  return 'kv-badge is-warn';
}

export function smokeKey(outcome: string | null): string {
  if (outcome === 'passed') return 'rz.smoke.passed';
  if (outcome === 'failed') return 'rz.smoke.failed';
  return 'rz.smoke.notRun';
}

/** The market-entry gate, as the reason it is closed. Returned from the server; this only decides how loudly to draw it. */
export function gateClass(ok: boolean): string {
  return ok ? 'kv-note is-ok' : 'kv-note is-warn';
}
