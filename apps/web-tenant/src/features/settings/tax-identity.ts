// apps/web-tenant/src/features/settings/tax-identity.ts · W2424-W2427 as PURE rules (PC-56 TENANT-4d-3).
// No React, no I/O — unit- and mutation-tested, and the API re-validates and re-diffs every one of them.

export const STEPS = ['edit', 'review', 'done', 'failed'] as const;
export type Step = (typeof STEPS)[number];

export function stepOf(raw: string | undefined): Step {
  return raw && (STEPS as readonly string[]).includes(raw) ? (raw as Step) : 'edit';
}

/* ------------------------------------------------------------------------------------------------------- */
/* W2424 — EVERY INVALID FIELD, WITH ITS REASON, AND WHAT YOU TYPED PRESERVED                              */
/* ------------------------------------------------------------------------------------------------------- */

export type ErrorReason = 'malformed' | 'too_long' | 'not_plain_text' | 'required';
export interface FieldError { field: string; reason: ErrorReason; detail?: string }

/** One sentence per reason, per field — never a single "the form has errors". `detail` carries the country's
 *  example for `malformed` and the limit for `too_long`, so the message can be specific. */
export function errorKey(e: FieldError): string {
  return `tax.err.${e.reason === 'too_long' ? 'tooLong' : e.reason === 'not_plain_text' ? 'notPlain' : e.reason}`;
}

/** The errors indexed by field, so an input can render its own message beside itself rather than in a list
 *  the tenant has to map back onto the form by eye. */
export function errorsByField(errors: readonly FieldError[]): Record<string, FieldError> {
  const out: Record<string, FieldError> = {};
  for (const e of errors) if (!out[e.field]) out[e.field] = e;   // first reason per field wins; order is the API's
  return out;
}

/** W2424: "values you entered are preserved, nothing was saved." The form re-renders from what was SUBMITTED,
 *  falling back to the stored value only for fields the tenant did not touch. Losing a tenant's typing because
 *  one field was wrong is the thing this screen exists to prevent. */
export function fieldValue(submitted: Record<string, string | undefined>, current: Record<string, string | null>, field: string): string {
  const s = submitted[field];
  if (s !== undefined) return s;
  return current[field] ?? '';
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE CHECK DIGIT — ADVISORY, NEVER A SILENT PASS                                                         */
/* ------------------------------------------------------------------------------------------------------- */

export type ChecksumVerdict = 'verified' | 'failed' | 'not_applicable' | 'not_verifiable';

/** Four verdicts, four sentences. `not_verifiable` must NOT read like `verified`: the first says we did not
 *  check, the second says we did. And `failed` is a warning the tenant may override — the API stores the
 *  value — so it says "this looks like a typo", not "invalid". */
export function checksumKey(v: ChecksumVerdict): string {
  return `tax.checksum.${v === 'not_applicable' ? 'notApplicable' : v === 'not_verifiable' ? 'notVerifiable' : v}`;
}

export function isAdvisory(v: ChecksumVerdict): boolean { return v === 'failed'; }

/* ------------------------------------------------------------------------------------------------------- */
/* W2425 — THE REVIEW STEP                                                                                 */
/* ------------------------------------------------------------------------------------------------------- */

export interface DiffRow { field: string; from: string | null; to: string | null }

/** Each row is one of three things, and they must not look alike: a value being SET for the first time, one
 *  being REPLACED, or one being CLEARED. "GSTIN: — → 24AB…" and "GSTIN: 27AB… → —" are opposite acts. */
export function diffRowKey(r: DiffRow): string {
  if (r.from === null) return 'tax.diff.set';
  if (r.to === null) return 'tax.diff.cleared';
  return 'tax.diff.replaced';
}

/** Whether Submit may be offered at all. A review screen with no rows must say "nothing would change" rather
 *  than offering a button that will be refused by the API for exactly that reason. */
export type SubmitState =
  | { kind: 'ready' }
  | { kind: 'blocked'; key: string };

export function submitState(p: {
  writable: boolean; errors: readonly FieldError[]; noOp: boolean; reasonRequired: boolean;
  reasonProblem: ErrorReason | null;
}): SubmitState {
  // Order matters: the most fundamental refusal wins, so a suspended tenant is not told to write a reason.
  if (!p.writable) return { kind: 'blocked', key: 'tax.blocked.notWritable' };
  if (p.errors.length > 0) return { kind: 'blocked', key: 'tax.blocked.errors' };
  if (p.noOp) return { kind: 'blocked', key: 'tax.blocked.noChange' };
  if (p.reasonProblem === 'required') return { kind: 'blocked', key: 'tax.blocked.reasonRequired' };
  if (p.reasonProblem) return { kind: 'blocked', key: `tax.err.${p.reasonProblem === 'too_long' ? 'tooLong' : 'notPlain'}` };
  return { kind: 'ready' };
}

/** W2426 promises the audit carries a reason. It is required when a value is being replaced or cleared — the
 *  screen asks for it at the review step, where the human can see WHAT they are changing. */
export function reasonPromptKey(required: boolean): string {
  return required ? 'tax.reason.required' : 'tax.reason.optional';
}

/* ------------------------------------------------------------------------------------------------------- */
/* W2427 — FAILURE, AND THE RETRY PATH                                                                     */
/* ------------------------------------------------------------------------------------------------------- */

/** Every refusal the API can return here, translated BY NAME. `TENANT_PROFILE_INVALID` is special: it carries
 *  the per-field list, so the chain sends the tenant back to the FORM with the errors rather than to a dead end. */
export const REFUSALS: Record<string, string> = {
  TENANT_PROFILE_INVALID: 'invalid',
  TENANT_NOT_WRITABLE: 'notWritable',
  TENANT_FORBIDDEN: 'forbidden',
  TENANT_NOT_FOUND: 'notFound',
};

export function refusalKey(code: string): string {
  return `tax.fail.${REFUSALS[code] ?? 'generic'}`;
}

/** W2427: "the failure reason and a retry path are below". A validation refusal is retried by EDITING; an
 *  infrastructure one by re-submitting the same thing. Sending a tenant back to a form they cannot fix, or
 *  offering "retry" on a permission error, are both dead ends. */
export function retryTarget(code: string): 'edit' | 'confirm' | 'none' {
  if (code === 'TENANT_PROFILE_INVALID') return 'edit';
  if (code === 'TENANT_FORBIDDEN' || code === 'TENANT_NOT_WRITABLE' || code === 'TENANT_NOT_FOUND') return 'none';
  return 'confirm';
}

/** THE IDEMPOTENCY KEY IS DERIVED FROM THE CHANGE, NOT GENERATED PER CLICK. W2427's Retry must not apply the
 *  edit twice, and a fresh uuid per click would let it: two clicks, two keys, two writes. Keyed by the diff, so
 *  retrying the SAME change reuses the key and a DIFFERENT change gets its own. */
export function idempotencyKeyFor(diff: readonly DiffRow[], reason: string | null): string {
  const shape = diff.map((r) => `${r.field}:${r.from ?? ''}>${r.to ?? ''}`).sort().join('|');
  return `tenant-profile:${fnv1a(`${shape}#${reason ?? ''}`)}`;
}

/** Small, stable, dependency-free hash — the same algorithm core/jobs' lockKey uses. Not security; identity. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
