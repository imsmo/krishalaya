// apps/web-storefront/src/features/store5a/review.ts · PC-56 STORE-5a · C1–C3 / C6 — THE REVIEW PAGES' PURE HALF (no React, no Next, no I/O;
// unit-tested in test/store5a-reviews.spec.ts).
//
//   • the routes under the ORGANISATION's chrome (`/<slug>/orders/<id>/review` — W290 — and `/review/edit` — W3141–W3144; the platform route is
//     a door, founder Q13/C-13);
//   • which state W290 shows, decided from the SERVER's answers only (the flag, the order's status, `reviews.eligibility` → eligible /
//     windowOpen / reviewed, `reviews.mine` → editable): NO client clock decision — a window is open or locked because the API said so, and
//     the page prints the API's instants;
//   • the form's codec (stars 1–5 required; each sub-rating a code of the vocabulary the page rendered, 1–5, optional; the words ≤ 4,000 — the
//     DELTA from the canon form's 2,000: the API's own limit) and its named form errors (W3141: values kept);
//   • the chain keys (`review:<uuid>` for the submit, `review-edit:<uuid>` for the edit) minted when the FORM rendered and carried by the draft,
//     the confirm and every Retry — a retried act is the same request;
//   • the DRAFT the chain carries between the form and the confirm (never the URL — the words can be 4,000 characters): deflated, base64url,
//     split over at most three httpOnly cookies on the review route (a cookie holds ~4 KB; a header budget is the residual named in the report);
//   • the named failures of the submit (W3147) and the edit (W3144); the old-vs-new rows of the edit's review (W3142).
import { deflateRawSync, inflateRawSync } from 'node:zlib';

export const REVIEW_BODY_MAX = 4000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CODE = /^[a-z_]{1,30}$/;
export const isSlug = (s: unknown): s is string => typeof s === 'string' && SLUG.test(s);
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* ROUTES                                                                                                                              */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
const q = (o: Record<string, string | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && v !== '') p.set(k, v.slice(0, 120));
  const s = p.toString();
  return s ? `?${s}` : '';
};
export const reviewBase = (slug: string, orderId: string) => `/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderId)}/review`;
export const reviewHref = (slug: string, orderId: string, o: Record<string, string | null | undefined> = {}) => `${reviewBase(slug, orderId)}${q(o)}`;
export const reviewEditHref = (slug: string, orderId: string, o: Record<string, string | null | undefined> = {}) => `${reviewBase(slug, orderId)}/edit${q(o)}`;

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* W290 — WHICH STATE (the server's answers only)                                                                                      */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export type ReviewPageState = 'off' | 'not_completed' | 'not_eligible' | 'closed' | 'reviewed' | 'locked' | 'form';
export interface EligibilityFacts { eligible: boolean; windowOpen: boolean; reviewed: boolean }
/** flag OFF → `off` (no API call was made); an order not completed → `not_completed`; the API says not a party → `not_eligible`; already
 *  reviewed → `reviewed` (editable, the server's word) or `locked`; the window closed → `closed`; else the form. */
export function reviewPageState(i: { flagOn: boolean; orderStatus: string; elig: EligibilityFacts | null; mineEditable: boolean | null }): ReviewPageState {
  if (!i.flagOn) return 'off';
  if (i.orderStatus !== 'completed') return 'not_completed';
  if (!i.elig || !i.elig.eligible) return 'not_eligible';
  if (i.elig.reviewed) return i.mineEditable === true ? 'reviewed' : 'locked';
  if (!i.elig.windowOpen) return 'closed';
  return 'form';
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE FORM (W290 / W3141)                                                                                                             */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export interface ReviewValues { stars: number | null; subRatings: Record<string, number>; body: string }
export type ReviewFormError = 'stars' | 'body_long' | 'dimension' | 'nothing';
export const REVIEW_FORM_ERRORS: readonly ReviewFormError[] = ['stars', 'body_long', 'dimension', 'nothing'];
const star = (raw: unknown): number | null => { const n = Number(String(raw ?? '')); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null; };
/** Read the posted form against the vocabulary the page rendered: `stars` required 1–5; `dim.<code>` 1–5 for a known code (an unknown code →
 *  `dimension`); the words trimmed, ≤ 4,000. The values are ALWAYS returned (W3141 keeps them). */
export function readReviewForm(get: (name: string) => unknown, names: readonly string[], vocabulary: readonly string[] | null): { values: ReviewValues; errors: ReviewFormError[] } {
  const errors: ReviewFormError[] = [];
  const stars = star(get('stars'));
  if (stars === null) errors.push('stars');
  const subRatings: Record<string, number> = {};
  const known = vocabulary ? new Set(vocabulary) : null;   // the vocabulary unreadable → the API judges the codes (REVIEW_DIMENSION_UNKNOWN)
  for (const n of names) {
    if (!n.startsWith('dim.')) continue;
    const code = n.slice(4); const v = String(get(n) ?? '');
    if (v === '') continue;                                   // optional: an unrated dimension is no rating
    if (!CODE.test(code) || (known !== null && !known.has(code))) { if (!errors.includes('dimension')) errors.push('dimension'); continue; }
    const s = star(v);
    if (s === null) { if (!errors.includes('dimension')) errors.push('dimension'); continue; }
    subRatings[code] = s;
  }
  const body = String(get('body') ?? '').replace(/\r\n/g, '\n').trim();
  if (body.length > REVIEW_BODY_MAX) errors.push('body_long');
  return { values: { stars, subRatings, body }, errors };
}
export function readFormError(raw: unknown): ReviewFormError | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (REVIEW_FORM_ERRORS as readonly string[]).includes(String(v ?? '')) ? (v as ReviewFormError) : null;
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE KEYS                                                                                                                            */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export const SUBMIT_KEY_RE = /^review:[0-9a-f-]{36}$/;
export const EDIT_KEY_RE = /^review-edit:[0-9a-f-]{36}$/;
export const submitKey = (nonce: string) => `review:${nonce}`;
export const editKey = (nonce: string) => `review-edit:${nonce}`;
export function readKey(raw: unknown, re: RegExp): string | null { const v = Array.isArray(raw) ? raw[0] : raw; return typeof v === 'string' && re.test(v) ? v : null; }

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE DRAFT (form → confirm → act), server-held in httpOnly cookies — never the URL                                                   */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export const REVIEW_DRAFT_COOKIE = 'kvs_review_draft';
export const REVIEW_DRAFT_CHUNKS = 3;
const CHUNK = 3800;
/** `stars` is null only for a draft kept to re-show a form error (W3141 — the values kept); the confirm and the acts need it. */
export interface ReviewDraft { v: 1; mode: 'submit' | 'edit'; key: string; orderId: string; reviewId: string | null; stars: number | null; subRatings: Record<string, number>; body: string }
export const draftCookieName = (i: number) => (i === 0 ? REVIEW_DRAFT_COOKIE : `${REVIEW_DRAFT_COOKIE}_${i}`);
/** The draft as at most three cookie values (deflated + base64url), or null when it cannot be carried in three (the action then refuses by
 *  name — `body_long` — rather than truncate a buyer's words). */
export function encodeReviewDraft(d: ReviewDraft): string[] | null {
  const packed = deflateRawSync(Buffer.from(JSON.stringify(d), 'utf8')).toString('base64url');
  const parts: string[] = [];
  for (let i = 0; i < packed.length; i += CHUNK) parts.push(packed.slice(i, i + CHUNK));
  return parts.length <= REVIEW_DRAFT_CHUNKS ? parts : null;
}
/** Read the draft back: the chunks in order, the key and the order must match what the page carries; anything malformed → null. */
export function decodeReviewDraft(chunks: ReadonlyArray<string | null | undefined>, key: string | null, orderId: string): ReviewDraft | null {
  if (!key) return null;
  const parts: string[] = [];
  for (const c of chunks) { if (typeof c !== 'string' || c === '') break; if (!/^[A-Za-z0-9_-]+$/.test(c)) return null; parts.push(c); }
  if (parts.length === 0) return null;
  try {
    const d = JSON.parse(inflateRawSync(Buffer.from(parts.join(''), 'base64url')).toString('utf8')) as ReviewDraft;
    if (!d || d.v !== 1 || d.key !== key || d.orderId !== orderId || (d.mode !== 'submit' && d.mode !== 'edit')) return null;
    const stars = d.stars === null ? null : star(d.stars);
    if (d.stars !== null && stars === null) return null;
    const subRatings: Record<string, number> = {};
    for (const [k, v] of Object.entries(d.subRatings ?? {})) { const s = star(v); if (CODE.test(k) && s !== null) subRatings[k] = s; }
    const body = typeof d.body === 'string' ? d.body.slice(0, REVIEW_BODY_MAX) : '';
    const reviewId = d.mode === 'edit' && isUuid(d.reviewId) ? d.reviewId : null;
    if (d.mode === 'edit' && !reviewId) return null;
    return { v: 1, mode: d.mode, key, orderId, reviewId, stars, subRatings, body };
  } catch { return null; }
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE NAMED FAILURES                                                                                                                  */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
/** W3147 — the submit's failure, NAMED. */
export const SUBMIT_FAILURES = ['not_eligible', 'duplicate', 'window_closed', 'dimension', 'invalid', 'off', 'server'] as const;
export type SubmitFailure = (typeof SUBMIT_FAILURES)[number];
export function submitFailureOf(code: string | null | undefined, status: number | null | undefined): SubmitFailure {
  switch (code) {
    case 'REVIEW_NOT_ELIGIBLE': return 'not_eligible';
    case 'REVIEW_DUPLICATE': return 'duplicate';
    case 'REVIEW_WINDOW_CLOSED': return 'window_closed';
    case 'REVIEW_DIMENSION_UNKNOWN': return 'dimension';
    case 'REVIEW_INVALID': case 'VALIDATION_FAILED': return 'invalid';
    case 'FEATURE_DISABLED': case 'FEATURE_FLAG_DISABLED': return 'off';
    default: return status === 404 && code === 'NOT_FOUND' ? 'off' : 'server';
  }
}
/** W3144 — the edit's failure, NAMED. */
export const EDIT_FAILURES = ['locked', 'removed', 'invalid', 'dimension', 'off', 'server'] as const;
export type EditFailure = (typeof EDIT_FAILURES)[number];
export function editFailureOf(code: string | null | undefined, status: number | null | undefined): EditFailure {
  switch (code) {
    case 'REVIEW_LOCKED': return 'locked';
    case 'REVIEW_REMOVED': return 'removed';
    case 'REVIEW_INVALID': case 'VALIDATION_FAILED': return 'invalid';
    case 'REVIEW_DIMENSION_UNKNOWN': return 'dimension';
    case 'FEATURE_DISABLED': case 'FEATURE_FLAG_DISABLED': return 'off';
    default: return status === 404 && code === 'NOT_FOUND' ? 'off' : 'server';
  }
}
export function readFailure<T extends string>(raw: unknown, all: readonly T[]): T | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (all as readonly string[]).includes(String(v ?? '')) ? (v as T) : null;
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* W3142 — OLD VS NEW                                                                                                                  */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export interface DiffRow { field: string; before: string; after: string; changed: boolean }
/** One row per field the buyer can change: the stars, each dimension of the vocabulary (unrated = "—" from the caller), the words. */
export function editDiff(before: { stars: number; subRatings: Record<string, number>; body: string | null }, after: { stars: number; subRatings: Record<string, number>; body: string },
  vocabulary: readonly string[], none: string): DiffRow[] {
  const n = (v: number | undefined) => (typeof v === 'number' ? String(v) : none);
  const rows: DiffRow[] = [{ field: 'stars', before: String(before.stars), after: String(after.stars), changed: before.stars !== after.stars }];
  for (const code of vocabulary) {
    const b = before.subRatings?.[code]; const a = after.subRatings?.[code];
    rows.push({ field: `dim.${code}`, before: n(b), after: n(a), changed: b !== a });
  }
  const bb = before.body ?? ''; rows.push({ field: 'body', before: bb || none, after: after.body || none, changed: bb !== after.body });
  return rows;
}
/** The edit's PATCH: only what changed (an unchanged review is "nothing to save", said — never an empty PATCH). */
export function editPatch(before: { stars: number; subRatings: Record<string, number>; body: string | null }, after: { stars: number; subRatings: Record<string, number>; body: string }):
  { stars?: number; subRatings?: Record<string, number>; body?: string | null } | null {
  const patch: { stars?: number; subRatings?: Record<string, number>; body?: string | null } = {};
  if (before.stars !== after.stars) patch.stars = after.stars;
  const same = (a: Record<string, number>, b: Record<string, number>) => { const ka = Object.keys(a).sort(); const kb = Object.keys(b).sort(); return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]); };
  if (!same(before.subRatings ?? {}, after.subRatings)) patch.subRatings = after.subRatings;
  if ((before.body ?? '') !== after.body) patch.body = after.body === '' ? null : after.body;
  return Object.keys(patch).length > 0 ? patch : null;
}
