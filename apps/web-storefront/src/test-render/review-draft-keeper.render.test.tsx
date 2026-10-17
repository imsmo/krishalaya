// apps/web-storefront/src/test-render/review-draft-keeper.render.test.tsx · PC-56 STORE-6b · D4 / C3 — THE REVIEW FORM AND THE REVIEW EDIT FORM KEEP
// YOUR STARS AND WORDS ON THIS PHONE (canon W290's "saved on this phone" half TRUE; "will send when signal returns" still refused):
//   • the review form (W290) mounts the keeper INSIDE its form — kind `review`, ref = THIS order, the fields `stars`, every `dim.<code>` and
//     `body` (ReviewFields' names); the hidden slug / id / key stay the form's, the key still minted at this render; the confirm step (W3145),
//     whose form has no fields of the person's, mounts NO keeper; no keeper when the review is already written;
//   • the edit form (W3141) mounts it with `edit` (its "Send now" returns to the edit page); the edit's review step (W3142) mounts none;
//   • the success renders mount `DraftDone` for THIS order: the order page `?status=reviewed` (W3146) and the review page `?ok=updated` (W3143);
//   • the 5a `offline` refusal reworded.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => jest.requireActual('./store5a-fixtures').cookieJar() }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: false }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store5a-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ getSessionTenant: () => 't' }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store5a-fixtures'); return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient }; });
jest.mock('server-only', () => ({}), { virtual: true });

import ReviewPage from '../app/[tenantSlug]/orders/[id]/review/page';
import ReviewEditPage from '../app/[tenantSlug]/orders/[id]/review/edit/page';
import TenantOrderPage from '../app/[tenantSlug]/orders/[id]/page';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, SLUG, OID, RID, KEY, MINE } from './store5a-fixtures';
import { encodeReviewDraft, draftCookieName } from '../features/store5a/review';

beforeEach(() => reset());
const P = { tenantSlug: SLUG, id: OID };
const review = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await ReviewPage({ params: P, searchParams: sp }));
const edit = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await ReviewEditPage({ params: P, searchParams: sp }));
const formOf = (h: string, name: string) => (h.match(new RegExp(`<form[^>]*data-kv-form="${name}"[\\s\\S]*?</form>`)) ?? [''])[0];

describe('STORE-6b · the review form (W290) keeps the person\'s words on this phone', () => {
  it('the keeper INSIDE the form: kind review, ref = this order; the fields are ReviewFields\' stars / dim.<code> / body; the key minted here', async () => {
    const h = await review(); const f = formOf(h, 'review');
    expect(f).toContain('data-kv-draft-keeper="review"');
    expect(f).toContain(`data-kv-draft-kind="review" data-kv-draft-ref="${OID}"`);
    expect(f).toMatch(/name="stars"/); expect(f).toMatch(/name="dim\.[a-z_]+"/); expect(f).toMatch(/name="body"/);
    expect(f).toMatch(/name="key" value="review:[0-9a-f-]{36}"/);
    expect(f).not.toContain('data-kv-draft-note');
  });
  it('the confirm step (W3145) — the server\'s preview, no fields of the person\'s — mounts NO keeper', async () => {
    const parts = encodeReviewDraft({ v: 1, mode: 'submit', key: KEY, orderId: OID, reviewId: null, stars: 4, subRatings: {}, body: 'ok' })!;
    C.cookies = new Map(parts.map((p, i) => [draftCookieName(i), p] as [string, string]));
    const h = await review({ step: 'confirm', k: KEY });
    expect(h).toContain('data-kv-form="review-submit"');
    expect(h).not.toContain('data-kv-draft-keeper');
  });
  it('already reviewed → no form, no keeper; the edit success (?ok=updated, W3143) mounts DraftDone for THIS order', async () => {
    C.mine = MINE(); C.elig = { ...C.elig, reviewed: true, reviewId: RID };
    expect(await review()).not.toContain('data-kv-draft-keeper');
    expect(await review()).not.toContain('data-kv-draft-done');
    expect(await review({ ok: 'updated' })).toContain(`data-kv-draft-done="" data-kv-draft-kind="review" data-kv-draft-ref="${OID}"`);
  });
  it('the submit success is on the ORDER page (?status=reviewed, W3146): DraftDone for this order; the plain order page: none', async () => {
    expect(renderToStaticMarkup(await TenantOrderPage({ params: P, searchParams: { status: 'reviewed' } }))).toContain(`data-kv-draft-done="" data-kv-draft-kind="review" data-kv-draft-ref="${OID}"`);
    expect(renderToStaticMarkup(await TenantOrderPage({ params: P, searchParams: {} }))).not.toContain('data-kv-draft-done');
  });
  it('the 5a offline refusal says the truth: kept on this phone; nothing sends by itself', async () => {
    expect(text(await review())).toContain(en['store5a.refusal.offline']);
    expect(en['store5a.refusal.offline']).toMatch(/kept on this phone/); expect(en['store5a.refusal.offline']).toMatch(/nothing sends by itself/);
  });
});

describe('STORE-6b · the review EDIT form (W3141) keeps the new words on this phone', () => {
  beforeEach(() => { C.mine = MINE(); C.elig = { ...C.elig, reviewed: true, reviewId: RID }; });
  it('the keeper INSIDE the edit form, kind review, ref = this order, marked edit (its own live page)', async () => {
    const f = formOf(await edit(), 'review-edit');
    expect(f).toContain('data-kv-draft-keeper="review"');
    expect(f).toContain(`data-kv-draft-ref="${OID}"`);
    expect(f).toMatch(/name="key" value="review-edit:[0-9a-f-]{36}"/);
  });
  it('a locked review has no form and no keeper', async () => {
    C.mine = MINE({ editable: false });
    expect(await edit()).not.toContain('data-kv-draft-keeper');
  });
});
