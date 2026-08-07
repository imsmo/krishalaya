// apps/admin-api/src/modules/ai-models-ops/domain/fairness-gate.ts · the HARD gate, PURE (PC-56 ADMIN-7).
//
// ---------------------------------------------------------------------------
// WHAT THIS REPLACES: THE PLATFORM'S MOST EXPLICIT ETHICAL COMMITMENT, WITH NOTHING BEHIND IT
// ---------------------------------------------------------------------------
// `ModelRegistryService.promote` is, in full, a state-machine legality check, an UPDATE and an audit row. It does not
// read `fairness_audit`. It does not require a second operator. So one person holding `ai.model.manage` could put a
// model into production that had never been audited for district or gender skew — a model that decides whether a
// farmer's produce photograph grades FAQ or B, or whether their listing is flagged as fraud.
//
// The canon states the rule three times, and states it as absolute:
//   W085  "no model reaches production with >5pp accuracy gap across any protected slice — the audit is a HARD gate"
//   W088  "Full production blocked until the fairness audit passes — no exceptions"
//   W088  restricted: "production promotion additionally requires the fairness audit record"
//
// ---------------------------------------------------------------------------
// AND THE AUDIT THAT WOULD HAVE FED IT MEASURED NO FAIRNESS
// ---------------------------------------------------------------------------
// `runFairnessAudit` (apps/api, called from nowhere) writes:
//     { window, generatedAt, total, overridden, lowConfidence, overrideRate }
// Not one slice. A rollup of override rates cannot answer "does this model grade Kutch farmers worse than Anand
// farmers", which is the only question a fairness audit exists to answer — and it would have been stored in a column
// named `fairness_audit`, under a console heading reading "passed". **A number that looks like diligence and measures
// something else is worse than an empty column, because an empty column is visibly empty.**
//
// So this module refuses to read `ai_models.fairness_audit` as an audit at all. `legacyAuditShape` below exists purely
// to tell an operator what that column actually contains.
import { assertSecondPerson, isSecondPerson } from '../../../core/approval/two-person-rule';
import { AiGovernanceRefusedError } from './ai-models.errors';

/** THE POLICY FIGURE, in percentage POINTS of accuracy difference between the best and worst group in a slice.
 *
 *  Points and not a ratio, deliberately: two accuracies of 91% and 86% are a 5pp gap and a 1.06× ratio, and the ratio
 *  form compresses exactly the differences the policy is about. W085 states the threshold as "<5pp" and this is that
 *  number, in one place, exported so a test can pin it and a screen can print it.
 */
export const MAX_SLICE_GAP_PP = 5;

/** How stale an audit may be and still gate a promotion.
 *
 *  90 days, and the reason it exists at all is that an audit is a measurement of a POPULATION, not a property of code: a
 *  model unchanged since March can develop a district gap because the districts changed — new tenants, a new crop, a
 *  monsoon. An audit with no expiry would let a clean March result authorise a promotion in December over a population
 *  it never saw. W085's board prints audit dates precisely so a human can notice this; the gate should not need them to.
 */
export const AUDIT_MAX_AGE_DAYS = 90;

/** The smallest group in a slice below which a gap figure is noise rather than a finding.
 *
 *  A slice whose worst group is 11 farmers can show a 40pp gap from four mistakes. Reporting that as a FAIL would make
 *  the gate cry wolf; reporting it as a PASS is how a fairness programme becomes a formality. It is `inconclusive`, which
 *  the gate treats as NOT A PASS — the safe direction, and the one that sends somebody to collect more data rather than
 *  to argue about a number.
 */
export const MIN_SLICE_GROUP = 100;

export const VERDICTS = ['pass', 'fail', 'inconclusive'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** One slice's measurement. `maxGapPp` is best-group accuracy minus worst-group accuracy, in points. */
export interface SliceMeasurement {
  maxGapPp: number;
  worst: string | null;
  best: string | null;
  groups: number;
  /** The size of the SMALLEST group compared, which is what decides whether the gap means anything. */
  smallestGroup: number;
}

export interface AuditRow {
  id: string;
  modelId: string;
  windowStart: string;
  windowEnd: string;
  sampleSize: number;
  slices: Record<string, SliceMeasurement>;
  maxGapPp: number;
  verdict: string;
  verdictNote: string | null;
  auditedByAdminId: string | null;
  slicesApprovedByAdminId: string | null;
  slicesApprovedAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------------------------------------ */
/* SCORING AN AUDIT                                                                                  */
/* ------------------------------------------------------------------------------------------------ */

export interface Scored {
  verdict: Verdict;
  maxGapPp: number;
  /** Which slice produced the worst gap, so the note has somewhere to start. */
  worstSlice: string | null;
  /** Slices whose smallest group is below the floor — the reason a verdict can be `inconclusive`. */
  thinSlices: string[];
  note: string;
}

/** Derive the verdict FROM THE MEASUREMENTS rather than accepting one.
 *
 *  This is a function and not a parameter for the same reason `statusFromCounts` is in ADMIN-6b: the thing it replaces
 *  was a value somebody could assert. A caller that could pass `verdict: 'pass'` could pass it over a 40pp gap, and this
 *  verdict is the only thing standing between a skewed model and production.
 *
 *  ORDER MATTERS AND IS ARGUED. A slice that BOTH breaches the gap AND is thin is reported as `fail`, not
 *  `inconclusive`: a large measured gap on a small group is still the best evidence available, and downgrading it to
 *  "we cannot tell" would let the thinnest slices become the ones the gate ignores — which are exactly the populations
 *  most likely to be underserved. `inconclusive` is for a slice that LOOKS FINE on data too thin to trust.
 */
export function scoreAudit(slices: Record<string, SliceMeasurement>): Scored {
  const names = Object.keys(slices);
  if (names.length === 0) {
    // An audit over no slices is not a pass. This is the shape the unwired job would have produced, and the whole
    // reason this module refuses to read that column as an audit.
    return {
      verdict: 'inconclusive', maxGapPp: 0, worstSlice: null, thinSlices: [],
      note: 'no slices were measured, so nothing about fairness was established',
    };
  }

  let maxGapPp = 0;
  let worstSlice: string | null = null;
  const thinSlices: string[] = [];
  let breached = false;

  for (const name of names) {
    const s = slices[name];
    // A non-finite gap is not read as 0. `Number.isFinite` first, because a NaN fails every comparison silently and
    // would make an unmeasurable slice look like a perfect one.
    const gap = Number.isFinite(s.maxGapPp) ? s.maxGapPp : NaN;
    if (Number.isNaN(gap)) {
      thinSlices.push(name);
      continue;
    }
    if (gap > maxGapPp) { maxGapPp = gap; worstSlice = name; }
    if (gap >= MAX_SLICE_GAP_PP) breached = true;
    if (!Number.isFinite(s.smallestGroup) || s.smallestGroup < MIN_SLICE_GROUP) thinSlices.push(name);
  }

  if (breached) {
    return {
      verdict: 'fail', maxGapPp, worstSlice, thinSlices,
      note: `the ${worstSlice} slice shows a ${maxGapPp}pp accuracy gap, at or above the ${MAX_SLICE_GAP_PP}pp policy `
        + 'limit; this model may not reach production until the gap is closed',
    };
  }
  if (thinSlices.length > 0) {
    return {
      verdict: 'inconclusive', maxGapPp, worstSlice, thinSlices,
      note: `${thinSlices.join(', ')} had fewer than ${MIN_SLICE_GROUP} decisions in the smallest group, so the gap `
        + 'figures are noise rather than findings; collect more data before promoting on this audit',
    };
  }
  return { verdict: 'pass', maxGapPp, worstSlice, thinSlices, note: '' };
}

/** **THE POLICY THRESHOLD IS `>=`, NOT `>`, AND THE CHOICE IS DELIBERATE.**
 *
 *  W085 writes the policy as "<5pp" and "no model reaches production with >5pp gap" — which read literally disagree with
 *  each other about exactly 5.00pp. On a gate protecting farmers from a model that treats them differently by district,
 *  the tie goes to the farmer: 5.00pp fails. Choosing the looser reading would make the cheaper path the accidental
 *  default at exactly the boundary, which is what Rule Zero forbids, and it is the same call ADMIN-5f made rounding
 *  value-at-stake half UP so a threshold can never be understated.
 */
export function breachesPolicy(gapPp: number): boolean {
  if (!Number.isFinite(gapPp)) return true;   // an unmeasurable gap is not a clearance
  return gapPp >= MAX_SLICE_GAP_PP;
}

/* ------------------------------------------------------------------------------------------------ */
/* THE GATE                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

export type GateResult =
  | { open: true; auditId: string; maxGapPp: number; auditedAt: string }
  /** No audit has ever been run for this model version. **This is the state of every model on the platform**, because
   *  the only writer of the old column is unwired — so the gate's default answer is the honest one. */
  | { open: false; reason: 'never_audited' }
  | { open: false; reason: 'audit_failed'; auditId: string; maxGapPp: number; note: string | null }
  | { open: false; reason: 'audit_inconclusive'; auditId: string; note: string | null }
  | { open: false; reason: 'audit_stale'; auditId: string; ageDays: number; maxAgeDays: number }
  /** The slice definitions were never signed off by the DPO. Measuring accuracy by gender means PROCESSING gender, and
   *  an audit that chose its own protected attributes is a privacy decision made by whoever wrote the query. */
  | { open: false; reason: 'slices_unapproved'; auditId: string };

/** May this model version go to production?
 *
 *  Takes the NEWEST audit for the version and nothing else. Not "any passing audit" — a model with a failing June audit
 *  and a passing March one is a model that got worse, and letting the older row authorise the promotion would make the
 *  gate a search for the most convenient evidence.
 */
export function productionGate(newest: AuditRow | null, nowMs: number): GateResult {
  if (!newest) return { open: false, reason: 'never_audited' };

  if (newest.verdict === 'fail') {
    return { open: false, reason: 'audit_failed', auditId: newest.id, maxGapPp: newest.maxGapPp, note: newest.verdictNote };
  }
  // Anything this code does not recognise is treated as inconclusive rather than as a pass. `ck_afa_verdict` constrains
  // the column, so this is reachable only if the vocabulary grows — and the safe direction on this gate is to refuse.
  if (newest.verdict !== 'pass') {
    return { open: false, reason: 'audit_inconclusive', auditId: newest.id, note: newest.verdictNote };
  }
  // A stored `pass` is not taken on trust when the stored gap breaches the policy: the two can only disagree if the
  // verdict was written by something that did not apply this rule — which describes every producer that existed before
  // this module.
  if (breachesPolicy(newest.maxGapPp)) {
    return {
      open: false, reason: 'audit_failed', auditId: newest.id, maxGapPp: newest.maxGapPp,
      note: `this audit records a ${newest.maxGapPp}pp gap and a passing verdict, which the ${MAX_SLICE_GAP_PP}pp policy `
        + 'does not permit; the verdict was not produced by the current policy',
    };
  }
  if (!newest.slicesApprovedByAdminId || !newest.slicesApprovedAt) {
    return { open: false, reason: 'slices_unapproved', auditId: newest.id };
  }

  const ageMs = nowMs - Date.parse(newest.createdAt);
  // An unparseable date is STALE, not fresh. NaN comparisons are false in both directions, so a bare `>` would read an
  // unreadable timestamp as an audit performed a moment ago.
  if (Number.isNaN(ageMs)) {
    return { open: false, reason: 'audit_stale', auditId: newest.id, ageDays: -1, maxAgeDays: AUDIT_MAX_AGE_DAYS };
  }
  const ageDays = Math.floor(ageMs / 86_400_000);
  if (ageDays > AUDIT_MAX_AGE_DAYS) {
    return { open: false, reason: 'audit_stale', auditId: newest.id, ageDays, maxAgeDays: AUDIT_MAX_AGE_DAYS };
  }

  return { open: true, auditId: newest.id, maxGapPp: newest.maxGapPp, auditedAt: newest.createdAt };
}

/** Which transitions the gate applies to.
 *
 *  PRODUCTION ONLY, and the exclusions are the design. A model may enter `shadow` freely — that is the point of shadow,
 *  it logs and acts on nothing. `canary` is deliberately NOT gated: requiring a fairness audit before a canary would
 *  mean auditing a model on no production traffic, and the canary exists to GENERATE the data the audit needs. W088's
 *  ladder is exactly this — shadow, canary 10%, fairness gate, production — with the gate at step three. And `retired`
 *  is never gated: taking a model out of service must never be harder than leaving it in.
 */
export function transitionNeedsFairnessGate(to: string): boolean {
  return to === 'production';
}

/* ------------------------------------------------------------------------------------------------ */
/* THE PROMOTION AS A TWO-PERSON ACT                                                                 */
/* ------------------------------------------------------------------------------------------------ */

export interface PromotionInputs {
  currentStatus: string;
  proposedStatus: string | null;
  proposedByAdminId: string | null;
  approverAdminId: string;
  gate: GateResult | null;
}

/** ELEVENTH MAKER-CHECKER SITE. W080: "Status transitions need `ai.deploy` + checker." W088: "Promote to 50% canary —
 *  needs checker · Maker: AI Ops (DV)".
 *
 *  THE GATE IS CHECKED BEFORE THE SECOND-PERSON RULE, so an operator learns that the model is unfair before being told
 *  to find a colleague. Being sent to fetch somebody and only then discovering the promotion was never permissible is
 *  the sequence that gets a control resented.
 */
export function assertPromotable(i: PromotionInputs): void {
  if (!i.proposedStatus) {
    throw new AiGovernanceRefusedError(
      'nothing has been proposed for this model. A promotion is an approval of somebody else\'s proposal, so there has '
      + 'to be one — that is what makes the two-person rule meaningful rather than ceremonial.');
  }
  if (transitionNeedsFairnessGate(i.proposedStatus)) {
    if (!i.gate) {
      throw new AiGovernanceRefusedError(
        'the fairness gate was not evaluated, so production cannot be granted. This is a hard gate with no exceptions '
        + '(W085, W088) and an unevaluated gate is not an open one.');
    }
    if (!i.gate.open) throw new AiGovernanceRefusedError(gateRefusal(i.gate));
  }
  assertSecondPerson('Promoting an AI model', i.proposedByAdminId, i.approverAdminId,
    'The operator who proposed a model transition cannot approve it.');
}

/** The refusal in words an operator can act on. Each reason gets its own sentence because each has a different next
 *  step: run an audit, close a gap, gather more data, re-audit, or get the DPO to sign off on the slice definitions. */
export function gateRefusal(g: Extract<GateResult, { open: false }>): string {
  switch (g.reason) {
    case 'never_audited':
      return 'this model version has never had a fairness audit, so it may not reach production. That is the state of '
        + 'every model on this platform today, because the only writer of the old fairness column was never scheduled — '
        + 'run an audit against this version first.';
    case 'audit_failed':
      return `the newest fairness audit for this version FAILED at ${g.maxGapPp}pp against a ${MAX_SLICE_GAP_PP}pp `
        + `policy limit. ${g.note ?? ''} Production is blocked with no exceptions; close the gap and re-audit.`;
    case 'audit_inconclusive':
      return `the newest fairness audit for this version is INCONCLUSIVE. ${g.note ?? ''} An audit that could not `
        + 'establish fairness is not an audit that established it — collect more decisions and re-audit.';
    case 'audit_stale':
      return g.ageDays < 0
        ? 'the newest fairness audit for this version has an unreadable date, so its age cannot be established and it '
          + 'cannot be relied on. Re-audit.'
        : `the newest fairness audit for this version is ${g.ageDays} days old, past the ${g.maxAgeDays}-day limit. A `
          + 'fairness audit measures a population, and the population changes — re-audit against current traffic.';
    case 'slices_unapproved':
      return 'the slice definitions behind this audit have not been signed off by the DPO. Measuring accuracy by '
        + 'district or gender means processing those attributes, so which slices are measured is a privacy decision and '
        + 'not an engineering one.';
    default:
      return 'the fairness gate is closed for a reason this console does not recognise, so production is refused.';
  }
}

/** Read-side counterpart: should the console draw the Approve control?
 *
 *  Maker-checker BY ABSENCE — the standing doctrine. A disabled Approve teaches an operator they nearly have the right
 *  to authorise their own model promotion; an absent one beside a line naming the rule teaches them to find a colleague.
 */
export function canApprove(i: { proposedStatus: string | null; proposedByAdminId: string | null; viewerAdminId: string | null; gate: GateResult | null }): boolean {
  if (!i.proposedStatus) return false;
  if (transitionNeedsFairnessGate(i.proposedStatus) && !(i.gate?.open ?? false)) return false;
  return isSecondPerson(i.proposedByAdminId, i.viewerAdminId);
}

/* ------------------------------------------------------------------------------------------------ */
/* WHAT THE OLD COLUMN ACTUALLY CONTAINS                                                             */
/* ------------------------------------------------------------------------------------------------ */

export type LegacyShape =
  | { kind: 'absent' }
  /** The shape `runFairnessAudit` produces: counts and an override rate, and NO SLICES. Reported to the operator as
   *  what it is, so nobody reads "fairness_audit: present" as "audited". */
  | { kind: 'usage_rollup'; overrideRate: number | null; total: number | null }
  /** Something with slices in it — plausibly a real audit written by hand before this table existed. */
  | { kind: 'has_slices'; sliceNames: string[] }
  | { kind: 'unrecognised' };

export function legacyAuditShape(v: unknown): LegacyShape {
  if (v === null || v === undefined || typeof v !== 'object') return { kind: 'absent' };
  const o = v as Record<string, unknown>;
  if (Object.keys(o).length === 0) return { kind: 'absent' };
  const slices = o.slices;
  if (slices && typeof slices === 'object' && Object.keys(slices as object).length > 0) {
    return { kind: 'has_slices', sliceNames: Object.keys(slices as object) };
  }
  // The unwired job's exact output. Detected by the fields it writes rather than by the fields it lacks, so a future
  // shape is `unrecognised` rather than being mislabelled as this one.
  if ('overrideRate' in o || ('total' in o && 'overridden' in o)) {
    return {
      kind: 'usage_rollup',
      overrideRate: typeof o.overrideRate === 'number' ? o.overrideRate : null,
      total: typeof o.total === 'number' ? o.total : null,
    };
  }
  return { kind: 'unrecognised' };
}
