// apps/web-storefront/src/test-render/dairy-trace.render.test.tsx · PC-56 STORE-5b · C5 (canon W306) — REFUSED (founder D6): for ANY lot the honest
// "dairy trace not available yet", a link back to the lot's trace, the refusals by name (cows, member litres, churn, cold-chain chart, the split);
// no API read at all.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }), headers: () => ({ get: () => null }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store5b-fixtures');
  return { getLang: () => f.C.lang, getLanguageDef: () => ({ code: f.C.lang, dir: 'ltr' }), getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store5b-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, publicClientIn: f.publicClientIn };
});
jest.mock('server-only', () => ({}), { virtual: true });
import DairyPage from '../app/(platform)/trace/[qrToken]/dairy/page';
import TenantDairyPage from '../app/[tenantSlug]/trace/[qrToken]/dairy/page';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, TOKEN, SLUG } from './store5b-fixtures';
import { store5bRefusalKeys } from '../features/store5b/refusals';

beforeEach(() => { reset(); });

describe('STORE-5b · W306 the dairy trace (refused)', () => {
  it('the refused state, the way back, the refusals — and no read', () => {
    const html = renderToStaticMarkup(DairyPage({ params: { qrToken: TOKEN } }));
    expect(html).toContain('data-kv-dairy="refused"');
    expect(text(html)).toContain(en['store5b.dairy.body']);
    expect(html).toContain(`href="/trace/${TOKEN}"`);
    for (const k of store5bRefusalKeys('dairy_trace')) expect(text(html)).toContain(en[k as keyof typeof en]);
    expect(store5bRefusalKeys('dairy_trace')).toEqual(expect.arrayContaining(['store5b.refusal.dairyLineage', 'store5b.refusal.coldChainChart', 'store5b.refusal.memberSplit']));
    expect(text(html.replace(/<section class="kv-refused"[\s\S]*?<\/section>/, ''))).not.toMatch(/Gir cows|bilona|can number|4°C/);
    expect(C.calls).toEqual([]);
    const t = renderToStaticMarkup(TenantDairyPage({ params: { tenantSlug: SLUG, qrToken: TOKEN } }));
    expect(t).toContain(`href="/${SLUG}/trace/${TOKEN}"`);
  });
});
