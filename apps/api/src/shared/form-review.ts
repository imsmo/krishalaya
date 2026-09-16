// shared/form-review.ts · PC-56 TENANT-7a · the canon's shared FORM pattern (B2), as a shape every module can compute.
//
// TENANT-6d-4 wrote this shape inside `modules/dairy/domain/dairy-form-review.ts` for two dairy forms. TENANT-7a is the
// first wave OUTSIDE dairy to need it — the course form (W2546–W2549) — and the module blueprint forbids one module
// reaching into another's domain. So the generic half moves here: the review row, the refusal, the printability
// invariant, and the belt that reports whatever the CREATE schema would refuse. The dairy file keeps its two reviewers
// and re-exports these names, so nothing that imported them moves.
//
// The two sentences the shape exists for (the canon's own words, identical on every module's chain):
//   • review — *"everything you entered, shown read-only, with the diff against current values where applicable"*;
//   • form-error — *"every invalid field is listed with its reason, values you entered are preserved, nothing was
//     saved"*.
//
// A REVIEW BUILT FROM WHAT THE OPERATOR TYPED IS AN ECHO. A review shows what the platform WILL WRITE, normalised the
// way the writer normalises it, and every reason the write would be refused — computed by the module that performs
// the act, from the same facts. A review that says "ready" and is followed by a failure screen is the defect this file
// exists to prevent.
import type { z } from 'zod';

/* --------------------------------------------------------------------------------------------------------- */
/* THE SHAPE                                                                                                 */
/* --------------------------------------------------------------------------------------------------------- */

/** One line of the read-only review: what was typed, and what will actually be stored. */
export interface ReviewField {
  name: string;
  /** As submitted, trimmed. Null when the operator left it empty. */
  entered: string | null;
  /** As it will be STORED — normalised by the same functions the writer uses. */
  stored: string | null;
  /** True when the platform will store something other than what was typed, so the review can draw attention to it. */
  normalised: boolean;
}

/** One refusal, against a field where there is one to blame; `field: null` for a permission, a flag, a missing profile. */
export interface ReviewRefusal { field: string | null; code: string }

export interface ReviewDiffRow { field: string; before: string | null; after: string | null }

export interface ReviewResult {
  ready: boolean;
  fields: ReviewField[];
  /** EVERY refusal, not the first: a form-error screen listing one field at a time is a form nobody finishes. */
  refusals: ReviewRefusal[];
  /** Null for a create — *"where applicable"* — so an empty table never implies a comparison nobody made. */
  diff: ReviewDiffRow[] | null;
  /** What the act will be audited as, so the success screen can link to that entity's own trail. */
  entityType: string;
}

export const field = (name: string, entered: string | null, stored: string | null): ReviewField => {
  const e = entered === null || entered.trim().length === 0 ? null : entered.trim();
  return { name, entered: e, stored, normalised: e !== stored };
};

/**
 * EVERY REFUSAL MUST BE REACHABLE.
 *
 * A refusal naming a field with no row on the review is a refusal the screen cannot print: it is not general (so it
 * does not head the page) and it belongs to no row (so it appears nowhere). The operator reads a review with no reasons
 * on it, presses confirm, and lands on the failure screen — silently, because `ready` is still correctly false. This
 * platform had two of those the first time reviewers were written (6d-4). FAILS LOUD: a 500 on a review is recoverable,
 * a review that hides the one reason the write will be refused is not.
 */
export function assertRefusalsPrintable(entityType: string, fieldNames: readonly string[], refusals: readonly ReviewRefusal[]): void {
  const rows = new Set(fieldNames);
  const orphans = refusals.filter((r) => r.field !== null && !rows.has(r.field));
  if (orphans.length > 0) {
    throw new Error(
      `form review (${entityType}): refusal(s) name fields with no review row: ${orphans.map((o) => `${o.field}/${o.code}`).join(', ')}`,
    );
  }
}

export function reviewResult(entityType: string, fields: ReviewField[], refusals: ReviewRefusal[], diff: ReviewDiffRow[] | null): ReviewResult {
  assertRefusalsPrintable(entityType, fields.map((f) => f.name), refusals);
  return { ready: refusals.length === 0, fields, refusals, diff, entityType };
}

/* --------------------------------------------------------------------------------------------------------- */
/* WHAT THE WRITER WOULD REFUSE                                                                              */
/* --------------------------------------------------------------------------------------------------------- */

/** One complaint from the create schema, named by the field it is about. */
export interface WriterIssue { path: string | null; tooLong: boolean }

/** Every form carries these two, because every writer can refuse a value for a reason the review has no words for. */
export const WRITER_REFUSALS = ['TOO_LONG', 'VALUE_REJECTED'] as const;

/**
 * The create schema's complaints, as review refusals — and NEVER on top of a reason that already names the field.
 *
 * This is the belt that makes `ready` a promise rather than a hope: whatever the writer's validator refuses, the review
 * refuses too. `VALUE_REJECTED` is a fallback for a rule the reviewer does not model, and printing it beside a precise
 * reason would add noise — so a field that already has a reason of its own keeps only that reason.
 */
export function writerRefusals(issues: readonly WriterIssue[], rows: readonly string[], existing: readonly ReviewRefusal[]): ReviewRefusal[] {
  const named = new Set(existing.filter((r) => r.field !== null).map((r) => r.field as string));
  const out: ReviewRefusal[] = [];
  for (const i of issues) {
    const f = i.path !== null && rows.includes(i.path) ? i.path : null;
    if (f !== null && named.has(f)) continue;
    const code = i.tooLong ? 'TOO_LONG' : 'VALUE_REJECTED';
    if (out.some((o) => o.field === f && o.code === code)) continue;
    out.push({ field: f, code });
  }
  return out;
}

/**
 * What the WRITER would refuse about this body, as facts a review can print. Runs the create schema over the same
 * values the create route would receive. `too_big` is separated because *"too long"* is actionable in a way that
 * *"rejected"* is not.
 */
export function writerIssuesOf(schema: z.ZodTypeAny, body: Record<string, unknown>): WriterIssue[] {
  const parsed = schema.safeParse(body);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => ({
    path: typeof i.path[0] === 'string' ? (i.path[0] as string) : null,
    tooLong: i.code === 'too_big',
  }));
}

/**
 * Could this string be an id at all? A review looks values up, and handing Postgres `MCC-AND-03` for a `uuid` raises
 * `22P02` — a 500 on the one screen whose job is to explain what is wrong with an entry.
 */
export function looksLikeId(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Trim, and drop what was left blank — exactly what a chain's submit does before calling the writer, so the review asks
 * the create schema about the values that would actually reach it.
 */
export function submittedValues(dto: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dto)) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s.length > 0) out[k] = s;
  }
  return out;
}

export function trimOrNull(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  return t.length === 0 ? null : t;
}

/** Does this review's refusal list contain a reason against a given field? The form-error screen's own question. */
export function refusalsFor(r: ReviewResult, fieldName: string): string[] {
  return r.refusals.filter((x) => x.field === fieldName).map((x) => x.code);
}

/** The refusals that belong to no field — a permission, a flag. They head the form-error screen rather than a row. */
export function generalRefusals(r: ReviewResult): string[] {
  return r.refusals.filter((x) => x.field === null).map((x) => x.code);
}
