// apps/web-storefront/src/test-render/rtl-store5a.render.test.tsx · PC-56 STORE-5a · C6 — the review page (the form, a form error, the states, the
// confirm and a named failure), the edit chain (the form and the old-vs-new review) and the accessibility page (the modes, saved, the failure)
// under dir="rtl" carry no PHYSICAL-direction class or inline style and no bare arrow outside .kv-dir-flip. Same guards as rtl-store4b
// (store1b-harness). In Hindi and Gujarati too.
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
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store5a-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import ReviewPage from '../app/[tenantSlug]/orders/[id]/review/page';
import ReviewEditPage from '../app/[tenantSlug]/orders/[id]/review/edit/page';
import TenantA11yPage from '../app/[tenantSlug]/account/accessibility/page';
import { bareArrows, physical, resolveTree } from './store1b-harness';
import { C, reset, SLUG, OID, KEY, EKEY, MINE } from './store5a-fixtures';
import { encodeReviewDraft, draftCookieName } from '../features/store5a/review';

const P = { tenantSlug: SLUG, id: OID };
const rtl = async (node: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{await resolveTree(node, [])}</div>);
const hold = (mode: 'submit' | 'edit', key: string) => encodeReviewDraft({ v: 1, mode, key, orderId: OID, reviewId: mode === 'edit' ? '0218f000-0000-7000-8000-0000000000aa' : null, stars: 3, subRatings: { quality: 2 }, body: 'x' })!
  .forEach((p, i) => C.cookies.set(draftCookieName(i), p));
beforeEach(() => { reset(); });

const STATES: Array<[string, () => Promise<React.ReactNode>]> = [
  ['W290 the form', () => ReviewPage({ params: P, searchParams: {} })],
  ['W290 a form error', async () => { hold('submit', KEY); return ReviewPage({ params: P, searchParams: { error: 'stars', k: KEY } }); }],
  ['W290 off', async () => { C.flags = { ...C.flags, reviews: false }; return ReviewPage({ params: P, searchParams: {} }); }],
  ['W290 window closed', async () => { C.elig = { ...C.elig, windowOpen: false }; return ReviewPage({ params: P, searchParams: {} }); }],
  ['W290 already reviewed', async () => { C.elig = { ...C.elig, reviewed: true }; C.mine = MINE(); return ReviewPage({ params: P, searchParams: {} }); }],
  ['W3145 the confirm', async () => { hold('submit', KEY); return ReviewPage({ params: P, searchParams: { step: 'confirm', k: KEY } }); }],
  ['W3147 a named failure', async () => { hold('submit', KEY); return ReviewPage({ params: P, searchParams: { step: 'confirm', k: KEY, failure: 'window_closed' } }); }],
  ['W3141 the edit form', async () => { C.mine = MINE(); return ReviewEditPage({ params: P, searchParams: {} }); }],
  ['W3142 the edit review', async () => { C.mine = MINE(); hold('edit', EKEY); return ReviewEditPage({ params: P, searchParams: { step: 'review', k: EKEY } }); }],
  ['W324 the modes', async () => TenantA11yPage({ params: { tenantSlug: SLUG }, searchParams: {} })],
  ['W3076 the failure', async () => TenantA11yPage({ params: { tenantSlug: SLUG }, searchParams: { a11y: 'err', want: 'contrast:on' } })],
];

describe('STORE-5a · rtl', () => {
  it.each(STATES)('%s: no physical-direction class or style, no bare arrow', async (_name, make) => {
    const html = await rtl(await make());
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
  it('in Hindi and Gujarati too', async () => {
    for (const l of ['hi', 'gu']) {
      for (const i of [0, 5, 8, 9]) {
        reset(); C.lang = l;
        const html = await rtl(await STATES[i][1]());
        expect(physical(html)).toEqual([]);
        expect(bareArrows(html)).toBe(0);
      }
    }
  });
});
