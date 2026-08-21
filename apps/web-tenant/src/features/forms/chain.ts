// apps/web-tenant/src/features/forms/chain.ts · the canon's shared FORM pattern (B2) — PC-56 TENANT-6d-4.
//
// Eleven canon screens describe two chains with one shape: **W2517–W2520** for the `bmc` module (*"Add BMC"*) and
// **W2555–W2558** for `dairy` (*"Add centre"*). Their own words:
//
//   • form-error — *"every invalid field is listed with its reason, values you entered are preserved, nothing was
//     saved"*;
//   • review — *"everything you entered, shown read-only, with the diff against current values where applicable"*;
//   • success — *"the change is applied and the audit trail has the entry (actor · time · reason · before/after)"*;
//   • failure — *"the attempt was rejected or errored; state is untouched (all-or-nothing). The failure reason and a
//     retry path are below."*
//
// FOUR STATES, ONE PAGE, VALUES IN THE URL. This console ships no client JS, so "values you entered are preserved"
// cannot mean React state — it means the values travel in the query string. That is not a workaround: it makes every
// step BOOKMARKABLE and the Back button correct, which is the same ruling every screen in this panel has made since
// TENANT-6a. A form whose review step cannot be re-opened after a phone rings is a form a village operator abandons.
//
// AND THE REVIEW IS THE FORM-ERROR SCREEN. The API's review answers `ready` plus every refusal against the field to
// blame; the page renders the same values either way and shows the reasons when there are any. Two screens with one
// implementation, because they are one question — *"can this be written, and if not, why"* — asked once.
import type { DairyReview, DairyReviewField, DairyReviewRefusal } from '@krishalaya/sdk-js';

/* --------------------------------------------------------------------------------------------------------- */
/* THE FOUR STATES                                                                                           */
/* --------------------------------------------------------------------------------------------------------- */

export const CHAIN_STEPS = ['edit', 'review', 'success', 'failure'] as const;
export type ChainStep = (typeof CHAIN_STEPS)[number];

/**
 * Which step a URL is asking for.
 *
 * Unknown values fall back to `edit` rather than erroring: a hand-typed or truncated link should land on the form, not
 * on a page that refuses to render. `formError` is deliberately NOT a step — it is the review step with refusals, and
 * modelling it separately is how two screens drift apart.
 */
export function chainStep(raw: string | null | undefined): ChainStep {
  return (CHAIN_STEPS as readonly string[]).includes(raw ?? '') ? (raw as ChainStep) : 'edit';
}

export function chainStepKey(step: ChainStep, hasRefusals: boolean): string {
  if (step === 'review') return hasRefusals ? 'form.step.formError' : 'form.step.review';
  return `form.step.${step}`;
}

/** The review step, with refusals, IS W2517/W2555 — one implementation for the two screens. */
export function isFormError(step: ChainStep, review: Pick<DairyReview, 'ready'> | null): boolean {
  return step === 'review' && review !== null && !review.ready;
}

/* --------------------------------------------------------------------------------------------------------- */
/* VALUES IN THE URL                                                                                         */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * The submitted values, carried forward.
 *
 * Empty values are DROPPED, so a URL never asserts that somebody typed a blank — and the whole set is length-capped:
 * a query string long enough to be truncated by a proxy would preserve the values and lose one silently, which is
 * worse than admitting the limit. `preserved` says which it was.
 */
export const MAX_CARRIED_LENGTH = 1500;

export interface CarriedValues { query: string; preserved: boolean }

export function carryValues(step: ChainStep, values: Record<string, string | undefined | null>): CarriedValues {
  const q = new URLSearchParams();
  q.set('step', step);
  for (const [k, v] of Object.entries(values)) {
    const s = (v ?? '').trim();
    if (s.length > 0) q.set(k, s);
  }
  const query = q.toString();
  return query.length <= MAX_CARRIED_LENGTH ? { query, preserved: true } : { query: `step=${step}`, preserved: false };
}

/** `?step=review&code=MCC-AND-04&…` — the href a submit button points at. */
export function chainHref(path: string, step: ChainStep, values: Record<string, string | undefined | null>): string {
  return `${path}?${carryValues(step, values).query}`;
}

/** Read the fields back out of the URL, so the form re-renders with what was typed. */
export function readCarried(sp: Record<string, string | string[] | undefined>, names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const v = sp[n];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === 'string' && s.trim().length > 0) out[n] = s.trim();
  }
  return out;
}

/** W2517's promise, as a fact the screen can state when it cannot keep it. */
export function valuesLostKey(): string { return 'form.valuesNotPreserved'; }

/* --------------------------------------------------------------------------------------------------------- */
/* THE REVIEW TABLE                                                                                          */
/* --------------------------------------------------------------------------------------------------------- */

export function fieldLabelKey(form: string, name: string): string { return `form.${form}.field.${name}`; }
export function refusalKey(form: string, code: string): string { return `form.${form}.refusal.${code}`; }

/** Reasons against one field. W2517: *"every invalid field is listed with its reason"* — every, not the first. */
export function refusalsFor(review: DairyReview | null, field: string): DairyReviewRefusal[] {
  return (review?.refusals ?? []).filter((r) => r.field === field);
}

/** Reasons that belong to no field — a permission, a flag. They head the screen rather than a row. */
export function generalRefusals(review: DairyReview | null): DairyReviewRefusal[] {
  return (review?.refusals ?? []).filter((r) => r.field === null);
}

/**
 * What a review row shows in its "will be stored" column.
 *
 * `null` becomes an explicit NOTHING key rather than an empty cell: on the *Add centre* form a blank operator is a
 * decision — *nobody holds this centre yet* — and an empty cell would hide it (TENANT-6d-2's whole argument about
 * that field).
 */
export function storedText(f: DairyReviewField): { text: string; isNothing: boolean } {
  return f.stored === null ? { text: '', isNothing: true } : { text: f.stored, isNothing: false };
}
export function nothingStoredKey(): string { return 'form.nothingStored'; }

/** Draw attention where the platform will store something other than what was typed. */
export function normalisedKey(): string { return 'form.normalised'; }

/**
 * W2518: *"with the diff against current values where applicable"*.
 *
 * A CREATE has nothing to be different from, and `diff: null` is the API saying so. The screen prints that sentence
 * rather than an empty table, because an empty before/after table implies a comparison nobody made.
 */
export function diffKey(review: DairyReview | null): string {
  return review?.diff === null ? 'form.diff.notApplicable' : 'form.diff.heading';
}

/* --------------------------------------------------------------------------------------------------------- */
/* SUCCESS AND FAILURE                                                                                       */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W2519/W2557: *"the audit trail has the entry (actor · time · reason · before/after)"* — and this links to it.
 *
 * The auditor screen already filters by `entityType` and `entityId`, so the promise is keepable rather than
 * decorative: the success screen deep-links to this record's own trail. A success screen that CLAIMED an audit trail
 * and linked nowhere would be the same class of defect as a screen claiming a figure nothing measures.
 */
export function auditHref(entityType: string, entityId: string): string {
  const q = new URLSearchParams({ entityType, entityId });
  return `/auditor?${q.toString()}`;
}

/** The audit link is only offered when there IS an entity to look up. */
export function canLinkAudit(entityType: string | null, entityId: string | null): boolean {
  return typeof entityType === 'string' && entityType.length > 0 && typeof entityId === 'string' && entityId.length > 0;
}

/**
 * W2520/W2558: *"Retry — back to confirm"*.
 *
 * The retry path goes back to the REVIEW step with the values intact, not to a blank form: an operator whose write
 * failed on a duplicate code should see their own entries with the reason beside them.
 */
export function retryHref(path: string, values: Record<string, string | undefined | null>): string {
  return chainHref(path, 'review', values);
}

/** The failure screen's own copy: nothing was written, and this is why. */
export function failureKey(): string { return 'form.failure.untouched'; }

/**
 * *"Repeated failures page the on-call."*
 *
 * NOT BUILT, and named rather than implied. An audit row is written inside the transaction that performs the act, so a
 * FAILED attempt rolls back with it and this platform keeps no record of one — there is nothing to count, and an
 * ops-alert rule cannot fire on it. Recording failed attempts is a real thing to build (it needs a writer outside the
 * act's own transaction) and it is not this wave.
 */
export function repeatedFailuresGapKey(): string { return 'form.failure.noOnCallCount'; }
