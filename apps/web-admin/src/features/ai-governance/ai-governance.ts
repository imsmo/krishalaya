// apps/web-admin/src/features/ai-governance/ai-governance.ts · W079–W088 view logic, PURE (PC-56 ADMIN-7).
//
// Every function maps a server field to a class name or an i18n KEY. No text lives here: web-admin is EN-only today and
// will not always be, and a string returned from a formatter is a string no translator will ever find.

/* ------------------------------------------------------------------------------------------------ */
/* THE FAIRNESS VERDICT                                                                              */
/* ------------------------------------------------------------------------------------------------ */

export type Verdict = 'pass' | 'fail' | 'inconclusive';

/** INCONCLUSIVE IS DRAWN AS A WARNING, NOT AS NEUTRAL, and that is the most consequential styling choice on this plane.
 *
 *  An audit that could not establish fairness is not an audit that established it. Grey would let a reader skim past a
 *  model nobody has actually cleared — which is precisely how a fairness programme becomes a formality. */
export function verdictClass(v: string): string {
  switch (v) {
    case 'pass': return 'kv-badge is-ok';
    case 'fail': return 'kv-badge is-danger';
    case 'inconclusive': return 'kv-badge is-warn';
    // A verdict this console does not recognise is DANGER, not neutral. `ck_afa_verdict` constrains the column, so this
    // is reachable only if the vocabulary grows — and on a fairness gate the safe direction is to draw attention.
    default: return 'kv-badge is-danger';
  }
}

export function verdictKey(v: string): string {
  const known = ['pass', 'fail', 'inconclusive'];
  return known.includes(v) ? `ai.verdict.${v}` : 'ai.verdict.unknown';
}

/** The gap, rendered against the policy. Returns the class so a breach is visible at a glance in a table of numbers. */
export function gapClass(gapPp: number, limitPp: number): string {
  if (!Number.isFinite(gapPp)) return 'kv-badge is-danger';
  // `>=` matching the server: the policy is written both ways in the canon and on a gate protecting farmers the tie goes
  // to the farmer. A console drawing 5.00pp as acceptable while the server refuses it would have an operator arguing
  // with a screen.
  if (gapPp >= limitPp) return 'kv-badge is-danger';
  if (gapPp >= limitPp * 0.8) return 'kv-badge is-warn';
  return 'kv-badge is-ok';
}

export function formatGap(gapPp: number | null | undefined): string {
  if (gapPp === null || gapPp === undefined || !Number.isFinite(gapPp)) return '—';
  return `${gapPp.toFixed(1)}pp`;
}

/* ------------------------------------------------------------------------------------------------ */
/* THE GATE                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

export type GateReason = 'never_audited' | 'audit_failed' | 'audit_inconclusive' | 'audit_stale' | 'slices_unapproved';

/** The gate's own badge. OPEN is the only green state and every closed reason is danger — there is no "nearly open". */
export function gateClass(open: boolean): string {
  return open ? 'kv-badge is-ok' : 'kv-badge is-danger';
}

export function gateKey(open: boolean, reason?: string | null): string {
  if (open) return 'ai.gate.open';
  const known = ['never_audited', 'audit_failed', 'audit_inconclusive', 'audit_stale', 'slices_unapproved'];
  return known.includes(reason ?? '') ? `ai.gate.${reason}` : 'ai.gate.closed';
}

/** MAKER-CHECKER BY ABSENCE. The Approve control is not drawn unless the server says this viewer may use it.
 *
 *  A disabled Approve teaches an operator that they nearly have the right to promote their own model; an absent one
 *  beside a line naming the rule teaches them to find a colleague. */
export function showApproveTransition(canApprove: boolean): boolean { return canApprove; }

/** Withdraw is shown whenever a proposal is open, INCLUDING to its own maker. Withdrawing your own proposal is noticing
 *  your own mistake, and requiring a colleague to help you stop a promotion would make the safe action the expensive
 *  one — the same asymmetry ADMIN-6b argued for returning a payout batch. */
export function showWithdraw(proposedStatus: string | null): boolean { return !!proposedStatus; }

/* ------------------------------------------------------------------------------------------------ */
/* W085's UNAUDITED CENSUS — the headline                                                            */
/* ------------------------------------------------------------------------------------------------ */

export type LegacyKind = 'absent' | 'usage_rollup' | 'has_slices' | 'unrecognised';

/** What the old `fairness_audit` column holds, as a sentence key.
 *
 *  `usage_rollup` IS THE IMPORTANT ONE. It means the column contains an override-rate summary with no slices in it — the
 *  output of a job that was never scheduled and that, had it run, would have filled a column named `fairness_audit` with
 *  something that measures no fairness. The console names that rather than showing "audit present". */
export function legacyKey(kind: string): string {
  const known = ['absent', 'usage_rollup', 'has_slices', 'unrecognised'];
  return known.includes(kind) ? `ai.legacy.${kind}` : 'ai.legacy.unrecognised';
}

/** A model in production with no audit is the worst row on the board and is drawn as an incident.
 *
 *  These rows are the violations of `ck_ai_model_production_needs_audit` that 0115 deliberately landed NOT VALID over —
 *  so that this screen could show them, rather than the migration refusing to apply until somebody cleared the backlog. */
export function unauditedClass(inProduction: boolean): string {
  return inProduction ? 'kv-note is-danger' : 'kv-note is-warn';
}

export function unauditedKey(inProduction: boolean): string {
  return inProduction ? 'ai.unaudited.inProduction' : 'ai.unaudited.notYetServing';
}

/* ------------------------------------------------------------------------------------------------ */
/* W088's ROLLOUT GATES                                                                              */
/* ------------------------------------------------------------------------------------------------ */

export type GateStatusKind = 'pass' | 'fail' | 'insufficient' | 'unmeasured';

/** INSUFFICIENT AND UNMEASURED ARE BOTH WARNINGS, NEVER OK. Each means the screen cannot vouch for the row, and a tick
 *  over a metric nothing measures is the defect this whole programme keeps finding. */
export function gateStatusClass(kind: string): string {
  switch (kind) {
    case 'pass': return 'kv-badge is-ok';
    case 'fail': return 'kv-badge is-danger';
    case 'insufficient': return 'kv-badge is-warn';
    case 'unmeasured': return 'kv-badge is-warn';
    default: return 'kv-badge';
  }
}

export function gateStatusKey(kind: string): string {
  const known = ['pass', 'fail', 'insufficient', 'unmeasured'];
  return known.includes(kind) ? `ai.gateStatus.${kind}` : 'ai.gateStatus.unknown';
}

export type AdviceKind = 'blocked' | 'proceed_with_caveats' | 'proceed';

export function adviceClass(a: string): string {
  switch (a) {
    case 'blocked': return 'kv-note is-danger';
    case 'proceed_with_caveats': return 'kv-note is-warn';
    default: return 'kv-note is-ok';
  }
}

export function adviceKey(a: string): string {
  const known = ['blocked', 'proceed_with_caveats', 'proceed'];
  return known.includes(a) ? `ai.advice.${a}` : 'ai.advice.blocked';
}

/** W088's "Auto-rollback armed" panel. ARMED BY POLICY AND BY NO RUNNING CODE — and `enforced` false must render as a
 *  caution rather than as reassurance, because a screen promising an automatic rollback nothing performs would be the
 *  fifth status-claiming-an-act-nobody-does on this platform. */
export function rollbackClass(enforced: boolean, fires: boolean): string {
  if (fires && !enforced) return 'kv-note is-danger';
  return enforced ? 'kv-note' : 'kv-note is-warn';
}

export function rollbackKey(enforced: boolean, fires: boolean): string {
  if (fires && !enforced) return 'ai.rollback.firesButNotEnforced';
  return enforced ? 'ai.rollback.armed' : 'ai.rollback.notEnforced';
}

/** The canary ladder's next rung, as a label. NULL at the top means the next move is production, which goes through the
 *  fairness gate and not through the ladder. */
export function nextStepKey(next: number | null): string {
  return next === null ? 'ai.canary.atTop' : 'ai.canary.next';
}

/* ------------------------------------------------------------------------------------------------ */
/* W082 · THE QUEUE                                                                                  */
/* ------------------------------------------------------------------------------------------------ */

export type ClaimKind = 'claimable' | 'held_by_other' | 'held_by_you' | 'stale_claim' | 'already_decided';

export function claimKey(kind: string): string {
  const known = ['claimable', 'held_by_other', 'held_by_you', 'stale_claim', 'already_decided'];
  return known.includes(kind) ? `ai.claim.${kind}` : 'ai.claim.unknown';
}

/** Which control to draw. `stale_claim` gets its OWN action label, because taking a case off a colleague should be a
 *  visible act with its own wording rather than an ordinary Take. */
export function claimAction(kind: string): 'take' | 'takeover' | 'decide' | null {
  switch (kind) {
    case 'claimable': return 'take';
    case 'stale_claim': return 'takeover';
    case 'held_by_you': return 'decide';
    default: return null;
  }
}

/** Case kinds, ordered by what they cost a farmer while they wait. `fraud_flag` first: it holds a listing off the
 *  market. */
export function kindKey(k: string): string {
  const known = ['fraud_flag', 'low_confidence_grade', 'price_anomaly', 'dispute_triage', 'drift'];
  return known.includes(k) ? `ai.kind.${k}` : 'ai.kind.other';
}

/** A `fraud_flag` case is drawn as urgent regardless of its priority number, because the number is set by the producer
 *  and the consequence is not. */
export function kindClass(k: string): string {
  if (k === 'fraud_flag') return 'kv-badge is-danger';
  if (k === 'low_confidence_grade') return 'kv-badge is-warn';
  return 'kv-badge';
}

/** Age in minutes, from a timestamp. Returns null for an unreadable date rather than 0 — "arrived this second" and "we
 *  cannot read when this arrived" must not render alike on a queue whose whole job is to show what has waited. */
export function ageMinutes(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 60_000));
}

/** WHICH REALM DECIDED. `ck_ai_review_one_reviewer` makes exactly one non-null on a resolved case, and showing a
 *  platform decision as a tenant's would be a forgery — the finding 0112 fixed for moderation reports and this fixes for
 *  review cases. */
export function reviewerRealmKey(reviewerUserId: string | null, reviewerAdminId: string | null): string {
  if (reviewerAdminId) return 'ai.reviewer.platform';
  if (reviewerUserId) return 'ai.reviewer.tenant';
  return 'ai.reviewer.none';
}

/* ------------------------------------------------------------------------------------------------ */
/* W079's TILES                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

export type Tile = { known: true; value: number } | { known: false; reason: string };

/** A tile renders its figure OR its reason. "0 inferences today" and "the inference log has no rows for today" are
 *  opposite findings — a quiet Sunday versus a recording path that has stopped — and a number cannot say which. */
export function tileText(t: Tile): { value: string; unknownKey: string | null } {
  if (t.known) return { value: t.value.toLocaleString('en-IN'), unknownKey: null };
  return { value: '—', unknownKey: t.reason === 'no_rows_today' ? 'ai.tile.noRows' : 'ai.tile.notRecorded' };
}

/** An override rate as a percentage. Takes the FRACTION the server sends. */
export function formatRate(r: number | null | undefined): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return '—';
  return `${(r * 100).toFixed(1)}%`;
}

/** W079's "Human override rate 4.8% ▼ 0.6pt — models learning".
 *
 *  A HIGH override rate is a WARNING and not a success. It is easy to read "humans are catching things" as reassurance;
 *  what it actually means is that the model is wrong that often and every one of those cases cost a person time. The
 *  thresholds match the rollout gate's ceiling so one screen cannot call acceptable what another refuses. */
export function overrideRateClass(r: number | null | undefined): string {
  if (r === null || r === undefined || !Number.isFinite(r)) return 'kv-badge';
  if (r > 0.10) return 'kv-badge is-danger';
  if (r > 0.075) return 'kv-badge is-warn';
  return 'kv-badge is-ok';
}

/* ------------------------------------------------------------------------------------------------ */
/* W084 · THE DECISION EXPLORER                                                                      */
/* ------------------------------------------------------------------------------------------------ */

/** Is the requested window inside the partition limit? Mirrors the server so the operator is told in the form rather
 *  than by a 409, and the server still refuses — a client-side rule is a courtesy, not a constraint. */
export function windowTooWide(from: string | undefined, to: string | undefined, maxDays: number): boolean {
  if (!from || !to) return false;
  const a = Date.parse(from); const b = Date.parse(to);
  // An unparseable pair is NOT "fine". Returning false here would send the query and let the server reject it, which is
  // survivable — but the form can say so first, and NaN must not read as a narrow window.
  if (Number.isNaN(a) || Number.isNaN(b)) return true;
  return (b - a) / 86_400_000 > maxDays;
}

/** One inference's output, summarised for a table cell. The full jsonb goes to the drill-in.
 *
 *  Never renders an object with `[object Object]`: an unreadable output shows a dash, because a cell that says
 *  "[object Object]" in a governance log teaches an operator to stop reading the column. */
export function outputSummary(output: unknown): string {
  if (output === null || output === undefined) return '—';
  if (typeof output === 'string') return output.slice(0, 80);
  if (typeof output !== 'object') return String(output).slice(0, 80);
  const o = output as Record<string, unknown>;
  // The keys real producers use, in the order W084 shows them: a grade, a flag, a band, an extraction.
  for (const k of ['grade', 'flag', 'band', 'crop', 'label', 'classification']) {
    const v = o[k];
    if (typeof v === 'string' || typeof v === 'number') return `${k}: ${v}`;
  }
  const keys = Object.keys(o);
  return keys.length > 0 ? keys.slice(0, 3).join(', ') : '—';
}

export function overriddenClass(was: boolean): string {
  // An override is a NOTE, not an error: it is the system working as designed. Drawing it red would make a healthy
  // human-in-the-loop look like a fault, and W085's whole argument is that overrides are the training signal.
  return was ? 'kv-badge is-warn' : 'kv-badge';
}

/* ------------------------------------------------------------------------------------------------ */
/* W087's THRESHOLD IMPACT                                                                           */
/* ------------------------------------------------------------------------------------------------ */

export type Capacity = 'fits' | 'exceeds' | 'unknown';

/** UNKNOWN CAPACITY IS A CAUTION, NOT A CLEARANCE. There is no reviewer-capacity record on this platform, so headroom is
 *  whatever the operator supplied — and a green tick over an unknown would be the console inventing a fact. */
export function capacityClass(c: string): string {
  switch (c) {
    case 'fits': return 'kv-note is-ok';
    case 'exceeds': return 'kv-note is-danger';
    default: return 'kv-note is-warn';
  }
}

export function capacityKey(c: string): string {
  const known = ['fits', 'exceeds', 'unknown'];
  return known.includes(c) ? `ai.capacity.${c}` : 'ai.capacity.unknown';
}

/** The review-load delta. NULL means "we cannot say", which the screen must not render as "no change" — a threshold
 *  raised on the strength of that mistake is how a review desk silently falls behind on farmers' listings. */
export function deltaKey(d: { perWindow: number; direction: string } | null): string {
  if (d === null) return 'ai.delta.unknown';
  if (d.direction === 'none') return 'ai.delta.none';
  return d.direction === 'more' ? 'ai.delta.more' : 'ai.delta.fewer';
}

/** A threshold as the canon prints it — four decimals, matching `numeric(5,4)`. */
export function formatThreshold(t: number | null | undefined): string {
  if (t === null || t === undefined || !Number.isFinite(t)) return '—';
  return t.toFixed(4);
}

/* ------------------------------------------------------------------------------------------------ */
/* THE PROXY CAVEAT — printed with every gap on every screen                                         */
/* ------------------------------------------------------------------------------------------------ */

/** The measurement basis and its biases, as i18n keys.
 *
 *  Exported as a function rather than inlined into one page because EVERY screen that prints a gap has to be able to
 *  print what the gap is made of — the platform has no labelled eval set, so the figure is a human-correction rate and
 *  its worst bias is that a district whose cases are reviewed LESS looks better rather than worse. A gap presented as
 *  accuracy would be the most misleading number in this console. */
export function caveatKeys(caveats: readonly string[]): string[] {
  const known = ['under_review_looks_like_accuracy', 'reviewer_threshold_variance', 'no_labelled_ground_truth'];
  return caveats.map((c) => (known.includes(c) ? `ai.caveat.${c}` : 'ai.caveat.other'));
}
