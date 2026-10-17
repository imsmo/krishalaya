// apps/web-storefront/src/test-render/review-form.render.test.tsx · PC-56 STORE-5a · C1 — canon W290 "Write a review" under the organisation:
//   • the store's `reviews` flag OFF → the honest sentence and NO review / order call (F-11); the flags unreadable → an error with Retry;
//   • the order's facts: the ORGANISATION (never a person), the product, the order number, the delivered date; no uuid in the page but the
//     order's and the key's nonce;
//   • the form: the overall stars (a required radio group of five), the three sub-ratings FROM THE VOCABULARY (labels from the API, optional),
//     the words ≤ 4,000, the key minted at render (`review:<uuid>`), "Submit review"; the facts ("Verified buyer", the organisation cannot hide
//     it, the window's end from the server, one invite + one reminder); the refusals by name;
//   • the states from the SERVER's answers: not completed (no eligibility call), not eligible, Window closed (the API's date), Already reviewed
//     (edit until <date> + "Edit my review") and Locked (no edit link); a form error keeps the values (the held draft);
//   • the order page's W290 door reads the flag: ON → the organisation's review route; OFF → the honest sentence;
//   • the platform /orders/[id]/review is a door to the organisation's.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
import PlatformReviewDoor from '../app/(platform)/orders/[id]/review/page';
import TenantOrderPage from '../app/[tenantSlug]/orders/[id]/page';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, SLUG, OID, KEY, MINE, SELLER_UUID, BUYER_UUID, apiCalls } from './store5a-fixtures';
import { store5aRefusalKeys } from '../features/store5a/refusals';
import { encodeReviewDraft, draftCookieName } from '../features/store5a/review';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await ReviewPage({ params: { tenantSlug: SLUG, id: OID }, searchParams: sp }));
const UUIDS = (h: string) => [...new Set(h.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [])];
beforeEach(() => { reset(); });

describe('STORE-5a · W290 the flag (F-11)', () => {
  it('OFF → the honest sentence, no review or order call at all', async () => {
    C.flags.reviews = false;
    const h = await page();
    expect(h).toContain('data-kv-state="off"');
    expect(text(h)).toContain(en['store5a.off']);
    expect(apiCalls()).toEqual([]);
    expect(h).not.toContain('data-kv-form="review"');
  });
  it('the flags unreadable → an error with a Retry (a reload), never the form', async () => {
    C.flags = new Error('down');
    const h = await page();
    expect(h).toContain('data-kv-state="error"');
    expect(h).toContain('data-kv-retry="reload"');
    expect(apiCalls()).toEqual([]);
  });
});

describe('STORE-5a · W290 the form', () => {
  it('the organisation, the product, the order and the delivered date — never a person; no uuid but the order\'s and the key\'s nonce', async () => {
    const h = await page();
    expect(h).toContain('data-kv-seller="organisation">Anand FPO');
    expect(text(h)).toContain('How was the Okra?');
    expect(text(h)).toContain('KV2026-0001');
    expect(text(h)).toMatch(/delivered 14 Oct 2026/);
    expect(h).not.toContain(SELLER_UUID); expect(h).not.toContain(BUYER_UUID);
    const nonce = h.match(/name="key" value="review:([0-9a-f-]{36})"/)![1];
    expect(UUIDS(h).sort()).toEqual([OID, nonce].sort());
  });
  it('the overall stars are a REQUIRED radio group of five; three sub-ratings from the vocabulary (optional, with "not rated"); the words ≤ 4,000', async () => {
    const h = await page();
    expect(h.match(/<input type="radio" name="stars" required="" value="\d"\/>/g)).toHaveLength(5);
    for (const d of ['quality', 'freshness', 'packaging']) {
      expect(h).toContain(`data-kv-dim="${d}"`);
      expect(h.match(new RegExp(`name="dim\\.${d}" value="\\d"`, 'g'))).toHaveLength(5);
      expect(h).toMatch(new RegExp(`name="dim\\.${d}" checked="" value=""`));
    }
    expect(text(h)).toContain('Quality'); expect(text(h)).toContain('Freshness'); expect(text(h)).toContain('Packaging');
    expect(h).toContain('maxLength="4000"');
    expect(C.calls).toContainEqual(['lookups.values', 'review_dimension']);
  });
  it('the key is minted at render; "Submit review"; the true facts — "Verified buyer", the organisation cannot hide it, the window from the server, one invite + one reminder', async () => {
    const h = await page();
    expect(h).toMatch(/name="key" value="review:[0-9a-f-]{36}"/);
    expect(h).toContain(`data-kv-act="submit-review">${en['store5a.form.submit']}`);
    expect(text(h)).toContain(en['store5a.fact.label']);
    expect(text(h)).toContain(en['store5a.fact.organisation']);
    expect(text(h)).toMatch(/You can review this order until 15 Nov 2026\./);
    expect(text(h)).toContain(en['store5a.fact.nudges']);
    expect(C.calls).toContainEqual(['reviews.eligibility', { orderId: OID }]);
  });
  it('the refusals by name: voice, photos, the offline queue, "tonight", the masked name + city, the grading desk, …', async () => {
    const h = await page();
    const keys = store5aRefusalKeys('review');
    expect(keys).toEqual(expect.arrayContaining(['store5a.refusal.voice', 'store5a.refusal.photos', 'store5a.refusal.offline', 'store5a.refusal.tonight', 'store5a.refusal.maskedName', 'store5a.refusal.gradingDesk']));
    for (const k of keys) expect(text(h)).toContain(en[k as keyof typeof en]);
    expect(h).toContain('data-kv-refused="review"');
    const outside = text(h.replace(/<section class="kv-refused"[\s\S]*?<\/section>/, ''));   // the page OUTSIDE the refusals offers none of it
    expect(outside).not.toMatch(/Speak instead|Add photos|N••• S|Ahmedabad|tonight/);
  });
  it('a form error (`?error=stars&k=`) keeps the values from the held draft and keeps the key', async () => {
    const parts = encodeReviewDraft({ v: 1, mode: 'submit', key: KEY, orderId: OID, reviewId: null, stars: null, subRatings: { freshness: 4 }, body: 'kept words' })!;
    parts.forEach((p, i) => C.cookies.set(draftCookieName(i), p));
    const h = await page({ error: 'stars', k: KEY });
    expect(h).toContain('data-kv-form-error="stars"');
    expect(text(h)).toContain(en['store5a.formError.stars']);
    expect(h).toContain(`name="key" value="${KEY}"`);
    expect(h).toMatch(/name="dim\.freshness" checked="" value="4"/);
    expect(h).toContain('>kept words</textarea>');
  });
});

describe('STORE-5a · W290 the states (the server\'s answers only)', () => {
  it('not completed → said; no eligibility read', async () => {
    C.order = { ...C.order, status: 'delivered' };
    const h = await page();
    expect(h).toContain('data-kv-state="not_completed"');
    expect(C.calls.some((c) => c[0] === 'reviews.eligibility')).toBe(false);
  });
  it('not eligible (the API says this caller is not a party)', async () => {
    C.elig = { eligible: false, expiresAt: null, windowOpen: false, reviewed: false };
    const h = await page();
    expect(h).toContain('data-kv-state="not_eligible"');
    expect(text(h)).toContain(en['store5a.state.notEligible']);
  });
  it('Window closed — with the API\'s date, no form', async () => {
    C.elig = { eligible: true, expiresAt: '2026-10-10T08:00:00.000Z', windowOpen: false, reviewed: false };
    const h = await page();
    expect(h).toContain('data-kv-state="closed"');
    expect(text(h)).toContain('Reviews for this order closed on 10 Oct 2026.');
    expect(h).not.toContain('data-kv-form="review"');
  });
  it('Already reviewed → "edit until <editLocksAt>" + "Edit my review"; Locked → the lock date, no edit link', async () => {
    C.elig = { eligible: true, expiresAt: '2026-11-15T08:00:00.000Z', windowOpen: true, reviewed: true, reviewId: 'x' };
    C.mine = MINE();
    const h = await page();
    expect(h).toContain('data-kv-state="reviewed"');
    expect(text(h)).toContain('You can edit it until 23 Oct 2026; then it locks.');
    expect(h).toContain(`class="kv-btn" data-kv-act="edit" href="/${SLUG}/orders/${OID}/review/edit"`);
    C.mine = MINE({ editable: false });
    const l = await page();
    expect(l).toContain('data-kv-state="locked"');
    expect(text(l)).toContain('Your review locked on 23 Oct 2026.');
    expect(l).not.toContain('data-kv-act="edit"');
  });
});

describe('STORE-5a · the doors to W290', () => {
  const order = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantOrderPage({ params: { tenantSlug: SLUG, id: OID }, searchParams: sp }));
  it('a completed order: flag ON → "Write a review" to the ORGANISATION\'s review route; OFF → the honest sentence, no link', async () => {
    const on = await order();
    expect(on).toContain(`class="kv-btn" data-kv-review="w290" href="/${SLUG}/orders/${OID}/review"`);
    expect(on).not.toContain(`href="/orders/${OID}/review"`);
    C.flags.reviews = false;
    const off = await order();
    expect(off).not.toContain('data-kv-review="w290"');
    expect(off).toContain('data-kv-review="off"');
    expect(text(off)).toContain(en['store5a.ctaOff']);
  });
  it('the platform /orders/[id]/review sends a signed-in buyer to the organisation\'s, carrying the status', async () => {
    await expect(PlatformReviewDoor({ params: { id: OID }, searchParams: { status: 'reviewed', junk: 'x' } })).rejects.toThrow(`REDIRECT /${SLUG}/orders/${OID}/review?status=reviewed`);
  });
});
