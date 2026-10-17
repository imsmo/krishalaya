'use server';
// apps/web-storefront/src/app/[tenantSlug]/orders/[id]/review/actions.ts · PC-56 STORE-5a · C1–C3 — the review chains' acts, under the
// ORGANISATION's chrome. AUTHENTICATED (requireSession + the authed serverClient); the API re-checks the eligibility, the window, the
// vocabulary, the lock and the author on every call (reflect, never grant).
//
//   previewReviewAction  — W290 "Submit review": the form read against the vocabulary the page rendered (W3141-style errors by name, the values
//                          kept), then the SERVER's preview (`reviews.preview` — writes nothing); its refusal → the form again with the failure
//                          by name; else the draft is held server-side (httpOnly cookies on the review route — never the URL) and the page goes
//                          to `?step=confirm` (W3145 renders the server's review).
//   submitReviewAction   — W3145 Proceed: `reviews.create` under the key MINTED WHEN THE FORM RENDERED (`review:<uuid>`, carried by the draft and
//                          every Retry — a submit that did land is answered, never doubled) → the order page `?status=reviewed` (W3146) or the
//                          confirm with the failure BY NAME and the same key (W3147).
//   editReviewAction     — W3141 → W3142: the edit form read (errors by name, values kept; "nothing changed" said) → the draft → `?step=review`.
//   saveReviewEditAction — W3142 Save: `reviews.edit` under the edit form's key (`review-edit:<uuid>`) → the review page `?ok=updated` (W3143) or
//                          the review again with the failure BY NAME and the same key (W3144).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient, publicClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { orderHref } from '../../../../../features/store3a/orders';
import {
  REVIEW_DRAFT_CHUNKS, draftCookieName, encodeReviewDraft, decodeReviewDraft, readReviewForm, readKey, reviewBase, reviewHref, reviewEditHref,
  submitFailureOf, editFailureOf, editPatch, isSlug, isUuid, SUBMIT_KEY_RE, EDIT_KEY_RE, type ReviewDraft, type ReviewFormError,
} from '../../../../../features/store5a/review';

function ids(fd: FormData): { slug: string; id: string } {
  const slug = String(fd.get('slug') ?? ''); const id = String(fd.get('id') ?? '');
  if (!isSlug(slug) || !isUuid(id)) redirect('/');
  return { slug, id };
}
const cookieOpts = (slug: string, id: string, maxAge: number) => ({ httpOnly: true, sameSite: 'lax' as const, secure: true, path: reviewBase(slug, id), maxAge });
/** Hold the draft (≤ 3 cookies); false when it cannot be carried (the caller refuses by name — the words are never cut). */
function keep(slug: string, id: string, d: ReviewDraft): boolean {
  const parts = encodeReviewDraft(d);
  if (!parts) return false;
  for (let i = 0; i < REVIEW_DRAFT_CHUNKS; i++) cookies().set(draftCookieName(i), parts[i] ?? '', cookieOpts(slug, id, parts[i] ? 900 : 0));
  return true;
}
function spend(slug: string, id: string): void {
  for (let i = 0; i < REVIEW_DRAFT_CHUNKS; i++) cookies().set(draftCookieName(i), '', cookieOpts(slug, id, 0));
}
function draftOf(id: string, key: string | null): ReviewDraft | null {
  const chunks = Array.from({ length: REVIEW_DRAFT_CHUNKS }, (_, i) => cookies().get(draftCookieName(i))?.value);
  return decodeReviewDraft(chunks, key, id);
}
async function vocabulary(slug: string): Promise<string[] | null> {
  try { return (await publicClient(slug).lookups.values('review_dimension')).map((v) => v.code); } catch { return null; }
}
const names = (fd: FormData) => [...new Set([...fd.keys()])];
const err = (e: unknown) => (e instanceof SdkError ? { code: e.code, status: e.status } : { code: null, status: null });

export async function previewReviewAction(fd: FormData): Promise<void> {
  const { slug, id } = ids(fd);
  await requireSession(reviewHref(slug, id));
  const key = readKey(fd.get('key'), SUBMIT_KEY_RE);
  if (!key) redirect(reviewHref(slug, id));
  const { values, errors } = readReviewForm((n) => fd.get(n), names(fd), await vocabulary(slug));
  const draft: ReviewDraft = { v: 1, mode: 'submit', key: key!, orderId: id, reviewId: null, stars: values.stars, subRatings: values.subRatings, body: values.body };
  const back = (error: ReviewFormError | null, failure?: string): never => {
    const kept = keep(slug, id, draft);
    redirect(reviewHref(slug, id, { k: key!, error: kept ? error : 'body_long', failure }));
  };
  if (errors.length > 0) back(errors[0]);
  try {
    await serverClient(slug).reviews.preview({ orderId: id, stars: values.stars!, subRatings: values.subRatings, ...(values.body ? { body: values.body } : {}) });
  } catch (e) {
    const f = submitFailureOf(err(e).code, err(e).status);
    if (f === 'dimension') back('dimension');
    if (f === 'invalid') back('stars');
    back(null, f);
  }
  if (!keep(slug, id, draft)) redirect(reviewHref(slug, id, { k: key!, error: 'body_long' }));
  redirect(reviewHref(slug, id, { step: 'confirm', k: key! }));                                     // W3145
}

export async function submitReviewAction(fd: FormData): Promise<void> {
  const { slug, id } = ids(fd);
  await requireSession(reviewHref(slug, id));
  const key = readKey(fd.get('key'), SUBMIT_KEY_RE);
  const draft = draftOf(id, key);
  if (!key || !draft || draft.mode !== 'submit' || draft.stars === null) redirect(reviewHref(slug, id, key ? { k: key } : {}));
  let failure: string | null = null;
  try {
    await serverClient(slug).reviews.create({ orderId: id, stars: draft!.stars!, subRatings: draft!.subRatings, ...(draft!.body ? { body: draft!.body } : {}) }, key!);
  } catch (e) { failure = submitFailureOf(err(e).code, err(e).status); }
  revalidatePath(orderHref(slug, id));
  if (failure) redirect(reviewHref(slug, id, { step: 'confirm', k: key!, failure }));            // W3147 — the same key on Retry
  spend(slug, id);
  redirect(orderHref(slug, id, { status: 'reviewed' }));                                          // W3146
}

export async function editReviewAction(fd: FormData): Promise<void> {
  const { slug, id } = ids(fd);
  await requireSession(reviewEditHref(slug, id));
  const key = readKey(fd.get('key'), EDIT_KEY_RE);
  if (!key) redirect(reviewEditHref(slug, id));
  // the review is the caller's own for THIS order, read from the API (the page carries no review id)
  let mine: { id: string; stars: number; subRatings: Record<string, number>; body: string | null } | null = null;
  try { mine = await serverClient(slug).reviews.mine({ orderId: id }); } catch { mine = null; }
  if (!mine) redirect(reviewEditHref(slug, id));
  const { values, errors } = readReviewForm((n) => fd.get(n), names(fd), await vocabulary(slug));
  const draft: ReviewDraft = { v: 1, mode: 'edit', key: key!, orderId: id, reviewId: mine!.id, stars: values.stars, subRatings: values.subRatings, body: values.body };
  const back = (error: ReviewFormError): never => { const kept = keep(slug, id, draft); redirect(reviewEditHref(slug, id, { k: key!, error: kept ? error : 'body_long' })); };
  if (errors.length > 0) back(errors[0]);                                                          // W3141 — the values kept
  if (!editPatch(mine!, { stars: values.stars!, subRatings: values.subRatings, body: values.body })) back('nothing');
  if (!keep(slug, id, draft)) redirect(reviewEditHref(slug, id, { k: key!, error: 'body_long' }));
  redirect(reviewEditHref(slug, id, { step: 'review', k: key! }));                                // W3142
}

export async function saveReviewEditAction(fd: FormData): Promise<void> {
  const { slug, id } = ids(fd);
  await requireSession(reviewEditHref(slug, id));
  const key = readKey(fd.get('key'), EDIT_KEY_RE);
  const draft = draftOf(id, key);
  if (!key || !draft || draft.mode !== 'edit' || draft.stars === null || !draft.reviewId) redirect(reviewEditHref(slug, id, key ? { k: key } : {}));
  let failure: string | null = null;
  try {
    // the full new values (not a diff): a Retry after a save that did land is the same request, answered from the API's memory of the key
    await serverClient(slug).reviews.edit(draft!.reviewId!, { stars: draft!.stars!, subRatings: draft!.subRatings, body: draft!.body === '' ? null : draft!.body }, key!);
  } catch (e) { failure = editFailureOf(err(e).code, err(e).status); }
  revalidatePath(reviewHref(slug, id));
  if (failure) redirect(reviewEditHref(slug, id, { step: 'review', k: key!, failure }));          // W3144 — the same key on Retry
  spend(slug, id);
  redirect(reviewHref(slug, id, { ok: 'updated' }));                                              // W3143
}
