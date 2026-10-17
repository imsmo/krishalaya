// apps/web-storefront/src/test-render/review-chain.render.test.tsx · PC-56 STORE-5a · C2 / C3 — the two REAL review chains:
//   SUBMIT (W290 → W3145 confirm → W3146 success / W3147 failure):
//     • a form error is named and the values are KEPT (the held draft — httpOnly cookies on the review route, never the URL);
//     • the confirm is the SERVER's preview (the organisation, the stars and dimension labels, "Verified buyer", the lock date) under the form's
//       key; Proceed submits under the SAME key; success → the order page `?status=reviewed` ("published on <organisation>'s page");
//     • a failure is named (already reviewed, the window closed, …) and Retry carries the SAME key;
//   EDIT (W3141 form-error → W3142 review → W3143 success / W3144 failure):
//     • the form pre-filled from the author's review, the key minted at render (`review-edit:<uuid>`); errors named, values kept; nothing changed
//       → said; the review shows old vs new and the lock date; Save under the SAME key; success → "Updated — locks on <date>"; a failure named
//       (locked, …) with Retry under the same key; a locked review has no form;
//   every chain link returns to the review page, the edit page or the order — never the home page (the canon's W273 defect).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => jest.requireActual('./store5a-fixtures').cookieJar() }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: jest.requireActual('./store5a-fixtures').C.pending === true }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store5a-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ getSessionTenant: () => 't' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store5a-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import ReviewPage from '../app/[tenantSlug]/orders/[id]/review/page';
import ReviewEditPage from '../app/[tenantSlug]/orders/[id]/review/edit/page';
import TenantOrderPage from '../app/[tenantSlug]/orders/[id]/page';
import { previewReviewAction, submitReviewAction, editReviewAction, saveReviewEditAction } from '../app/[tenantSlug]/orders/[id]/review/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, SLUG, OID, RID, KEY, EKEY, MINE } from './store5a-fixtures';
import { draftCookieName } from '../features/store5a/review';

const P = { tenantSlug: SLUG, id: OID };
const review = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await ReviewPage({ params: P, searchParams: sp }));
const edit = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await ReviewEditPage({ params: P, searchParams: sp }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const BASE = `/${SLUG}/orders/${OID}/review`;
const hrefs = (h: string) => [...h.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
beforeEach(() => { reset(); });

describe('STORE-5a · the SUBMIT chain (W290 → W3145 → W3146 / W3147)', () => {
  it('a missing star → back to the form with the error NAMED; the draft held in httpOnly cookies on the review route; the values kept', async () => {
    await expect(previewReviewAction(form({ slug: SLUG, id: OID, key: KEY, 'dim.quality': '4', body: 'kept' }))).rejects.toThrow(`REDIRECT ${BASE}?k=${encodeURIComponent(KEY)}&error=stars`);
    expect(C.calls.filter((c) => c[0] === 'reviews.preview')).toEqual([]);
    const set = C.calls.find((c) => c[0] === 'cookie.set' && c[1] === draftCookieName(0));
    expect(set).toEqual(['cookie.set', 'kvs_review_draft', 900, BASE, true]);
    const h = await review({ error: 'stars', k: KEY });
    expect(h).toMatch(/name="dim\.quality" checked="" value="4"/);
    expect(h).toContain('>kept</textarea>');
  });
  it('an unknown dimension (not in the vocabulary the page rendered) → named before any API call', async () => {
    await expect(previewReviewAction(form({ slug: SLUG, id: OID, key: KEY, stars: '5', 'dim.taste': '4' }))).rejects.toThrow(`REDIRECT ${BASE}?k=${encodeURIComponent(KEY)}&error=dimension`);
    expect(C.calls.filter((c) => c[0] === 'reviews.preview')).toEqual([]);
  });
  it('the server refuses the preview by name → the form with the failure (window closed) — values kept', async () => {
    C.fail['reviews.preview'] = { code: 'REVIEW_WINDOW_CLOSED', status: 409 };
    await expect(previewReviewAction(form({ slug: SLUG, id: OID, key: KEY, stars: '5' }))).rejects.toThrow(`REDIRECT ${BASE}?k=${encodeURIComponent(KEY)}&failure=window_closed`);
    const h = await review({ k: KEY, failure: 'window_closed' });
    expect(h).toContain('data-kv-failure="window_closed"');
    expect(h).toMatch(/name="stars" required="" checked="" value="5"/);
  });
  it('a valid form → the SERVER\'s preview is asked (nothing written) → W3145 renders it under the form\'s key', async () => {
    await expect(previewReviewAction(form({ slug: SLUG, id: OID, key: KEY, stars: '5', 'dim.quality': '5', 'dim.freshness': '4', 'dim.packaging': '', body: '  Very fresh  ' })))
      .rejects.toThrow(`REDIRECT ${BASE}?step=confirm&k=${encodeURIComponent(KEY)}`);
    expect(C.calls).toContainEqual(['reviews.preview', { orderId: OID, stars: 5, subRatings: { quality: 5, freshness: 4 }, body: 'Very fresh' }]);
    expect(C.calls.some((c) => c[0] === 'reviews.create')).toBe(false);
    const h = await review({ step: 'confirm', k: KEY });
    expect(h).toContain('data-kv-state="confirm"');
    expect(text(h)).toContain('It will publish on Anand FPO\'s page.');
    expect(h).toContain('data-kv-preview-stars="5"');
    expect(text(h)).toContain('Quality: 5★'); expect(text(h)).toContain('Freshness: 4★');
    expect(h).toContain('data-kv-label="verified_buyer"');
    expect(text(h)).toContain(en['store5a.confirm.label']);
    expect(text(h)).toContain('You can edit it until 24 Oct 2026; then it locks.');
    expect(h).toContain(`name="key" value="${KEY}"`);
    for (const u of hrefs(h)) expect(u.startsWith(`/${SLUG}/orders`)).toBe(true);
  });
  it('Proceed → create under the SAME key → the order page `?status=reviewed` (W3146) — "published on <organisation>\'s page"; the draft spent', async () => {
    await expect(previewReviewAction(form({ slug: SLUG, id: OID, key: KEY, stars: '4' }))).rejects.toThrow('step=confirm');
    await expect(submitReviewAction(form({ slug: SLUG, id: OID, key: KEY }))).rejects.toThrow(`REDIRECT /${SLUG}/orders/${OID}?status=reviewed`);
    expect(C.calls).toContainEqual(['reviews.create', { orderId: OID, stars: 4, subRatings: {} }, KEY]);
    expect(C.cookies.has(draftCookieName(0))).toBe(false);
    const o = renderToStaticMarkup(await TenantOrderPage({ params: P, searchParams: { status: 'reviewed' } }));
    expect(o).toContain('data-kv-ok="reviewed"');
    expect(text(o)).toContain('Your review is published on Anand FPO\'s page. The rating there updates within a couple of minutes.');
  });
  it('a failure is NAMED (W3147) and Retry carries the SAME key — even when the preview now says "already reviewed"', async () => {
    await expect(previewReviewAction(form({ slug: SLUG, id: OID, key: KEY, stars: '4' }))).rejects.toThrow('step=confirm');
    C.fail['reviews.create'] = { code: 'REVIEW_DUPLICATE', status: 409 };
    await expect(submitReviewAction(form({ slug: SLUG, id: OID, key: KEY }))).rejects.toThrow(`REDIRECT ${BASE}?step=confirm&k=${encodeURIComponent(KEY)}&failure=duplicate`);
    C.fail['reviews.preview'] = { code: 'REVIEW_DUPLICATE', status: 409 };
    const h = await review({ step: 'confirm', k: KEY, failure: 'duplicate' });
    expect(h).toContain('data-kv-state="failure"');
    expect(h).toContain('data-kv-failure="duplicate"');
    expect(text(h)).toContain(en['store5a.failure.duplicate']);
    expect(h).toContain(`name="key" value="${KEY}"`);
    expect(text(h)).toContain(en['store5a.confirm.retry']);
    for (const [code, name] of [['REVIEW_NOT_ELIGIBLE', 'not_eligible'], ['REVIEW_WINDOW_CLOSED', 'window_closed'], ['REVIEW_DIMENSION_UNKNOWN', 'dimension'], ['REVIEW_INVALID', 'invalid'], ['NOT_FOUND', 'off'], ['BOOM', 'server']]) {
      C.fail['reviews.create'] = new SdkError(code, code === 'NOT_FOUND' ? 404 : 409, code);
      await expect(submitReviewAction(form({ slug: SLUG, id: OID, key: KEY }))).rejects.toThrow(`failure=${name}`);
    }
  });
  it('a confirm without the held draft (or a foreign key) is the form again — never a guessed submit', async () => {
    const h = await review({ step: 'confirm', k: KEY });
    expect(h).toContain('data-kv-form="review"');
    await expect(submitReviewAction(form({ slug: SLUG, id: OID, key: KEY }))).rejects.toThrow(`REDIRECT ${BASE}?k=${encodeURIComponent(KEY)}`);
    expect(C.calls.some((c) => c[0] === 'reviews.create')).toBe(false);
  });
});

describe('STORE-5a · the EDIT chain (W3141 → W3142 → W3143 / W3144)', () => {
  beforeEach(() => { C.mine = MINE(); C.elig = { ...C.elig, reviewed: true, reviewId: RID }; });
  it('the form is pre-filled from the author\'s review; the key minted at render; the lock date from the server; no review id in the page', async () => {
    const h = await edit();
    expect(h).toContain('data-kv-state="form"');
    expect(h).toMatch(/name="key" value="review-edit:[0-9a-f-]{36}"/);
    expect(h).toMatch(/name="stars" required="" checked="" value="4"/);
    expect(h).toMatch(/name="dim\.quality" checked="" value="4"/);
    expect(h).toContain('>Fresh and honest weight</textarea>');
    expect(text(h)).toContain('You can edit it until 23 Oct 2026; then it locks.');
    expect(h).not.toContain(RID);
  });
  it('W3141: the words too long → NAMED, the values kept; nothing changed → said', async () => {
    const long = 'x'.repeat(4001);
    await expect(editReviewAction(form({ slug: SLUG, id: OID, key: EKEY, stars: '3', body: long }))).rejects.toThrow(`REDIRECT ${BASE}/edit?k=${encodeURIComponent(EKEY)}&error=body_long`);
    const h = await edit({ k: EKEY, error: 'body_long' });
    expect(h).toContain('data-kv-state="form-error"');
    expect(text(h)).toContain(en['store5a.formError.body_long']);
    expect(h).toMatch(/name="stars" required="" checked="" value="3"/);
    await expect(editReviewAction(form({ slug: SLUG, id: OID, key: EKEY, stars: '4', 'dim.quality': '4', body: 'Fresh and honest weight' }))).rejects.toThrow('error=nothing');
  });
  it('W3142: old vs new per row and the lock date; Save under the SAME key → edit with the full values → W3143 "Updated — locks on <date>"', async () => {
    await expect(editReviewAction(form({ slug: SLUG, id: OID, key: EKEY, stars: '2', 'dim.quality': '4', 'dim.packaging': '1', body: 'Changed my mind' }))).rejects.toThrow(`REDIRECT ${BASE}/edit?step=review&k=${encodeURIComponent(EKEY)}`);
    const h = await edit({ step: 'review', k: EKEY });
    expect(h).toContain('data-kv-state="review"');
    expect(h).toMatch(/data-kv-row="stars" data-kv-changed="true"><th scope="row">Overall<\/th><td>4<\/td><td>2<\/td>/);
    expect(h).toMatch(/data-kv-row="dim.quality" data-kv-changed="false">/);
    expect(h).toMatch(/data-kv-row="dim.packaging" data-kv-changed="true"><th scope="row">Packaging<\/th><td>—<\/td><td>1<\/td>/);
    expect(h).toMatch(/data-kv-row="body" data-kv-changed="true">/);
    expect(h).toContain(`name="key" value="${EKEY}"`);
    for (const u of hrefs(h)) expect(u.startsWith(`/${SLUG}/orders/${OID}`)).toBe(true);
    await expect(saveReviewEditAction(form({ slug: SLUG, id: OID, key: EKEY }))).rejects.toThrow(`REDIRECT ${BASE}?ok=updated`);
    expect(C.calls).toContainEqual(['reviews.edit', RID, { stars: 2, subRatings: { quality: 4, packaging: 1 }, body: 'Changed my mind' }, EKEY]);
    C.elig = { ...C.elig, reviewed: true };
    const r = await review({ ok: 'updated' });
    expect(r).toContain('data-kv-ok="updated"');
    expect(text(r)).toContain('Updated — it locks on 23 Oct 2026.');
  });
  it('W3144: the failure NAMED (the edit window passed) with Retry under the SAME key; every other refusal by name', async () => {
    await expect(editReviewAction(form({ slug: SLUG, id: OID, key: EKEY, stars: '1' }))).rejects.toThrow('step=review');
    C.fail['reviews.edit'] = { code: 'REVIEW_LOCKED', status: 409 };
    await expect(saveReviewEditAction(form({ slug: SLUG, id: OID, key: EKEY }))).rejects.toThrow(`REDIRECT ${BASE}/edit?step=review&k=${encodeURIComponent(EKEY)}&failure=locked`);
    const h = await edit({ step: 'review', k: EKEY, failure: 'locked' });
    expect(h).toContain('data-kv-failure="locked"');
    expect(text(h)).toContain(en['store5a.editFailure.locked']);
    expect(h).toContain(`name="key" value="${EKEY}"`);
    expect(text(h)).toContain(en['store5a.edit.retry']);
    for (const [code, name] of [['REVIEW_REMOVED', 'removed'], ['REVIEW_INVALID', 'invalid'], ['REVIEW_DIMENSION_UNKNOWN', 'dimension'], ['NOT_FOUND', 'off'], ['BOOM', 'server']]) {
      C.fail['reviews.edit'] = new SdkError(code, code === 'NOT_FOUND' ? 404 : 409, code);
      await expect(saveReviewEditAction(form({ slug: SLUG, id: OID, key: EKEY }))).rejects.toThrow(`failure=${name}`);
    }
  });
  it('a LOCKED review has no form ("locked on <date>"); no review → the link to write one; flag OFF → the honest sentence', async () => {
    C.mine = MINE({ editable: false });
    const l = await edit();
    expect(l).toContain('data-kv-state="locked"');
    expect(l).not.toContain('data-kv-form="review-edit"');
    C.mine = null;
    expect(await edit()).toContain('data-kv-state="none"');
    C.flags.reviews = false;
    expect(await edit()).toContain('data-kv-state="off"');
  });
});
