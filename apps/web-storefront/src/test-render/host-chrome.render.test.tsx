// apps/web-storefront/src/test-render/host-chrome.render.test.tsx · PC-56 STORE-5b · C7 (founder D7 / Q15) — the HOST's chrome:
//   • the slug route renders the trace under the STORE's chrome (data-kv-chrome=<slug>, the store's own paths) and names the organisation;
//   • ANOTHER organisation's lot (or certificate) on a store chrome is never rendered under this store's mark — it redirects to the platform's page;
//   • no brand-domain literal anywhere in the markup.
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
import TenantTracePage from '../app/[tenantSlug]/trace/[qrToken]/page';
import TenantVerifyPage from '../app/[tenantSlug]/trace/[qrToken]/verify/page';
import TenantCertPage from '../app/[tenantSlug]/certificates/[id]/page';
import { C, reset, TOKEN, SLUG, CERT_ID, SCAN, VERIFY, CERT } from './store5b-fixtures';

jest.mock('../lib/storefront-data', () => ({ loadTenantShell: async () => ({ kind: 'ok', tenant: { slug: 'anand-fpo', displayName: 'Anand FPO' }, branding: null }) }));
beforeEach(() => { reset(); });

describe('STORE-5b · the host chrome', () => {
  it('the slug route renders the store chrome with the store\'s paths', async () => {
    const html = renderToStaticMarkup(await TenantTracePage({ params: { tenantSlug: SLUG, qrToken: TOKEN }, searchParams: {} }));
    expect(html).toContain(`data-kv-chrome="${SLUG}"`);
    expect(html).toContain(`href="/${SLUG}/trace/${TOKEN}/verify"`);
    expect(html).toContain(`href="/${SLUG}/certificates/${CERT_ID}?lot=${TOKEN}"`);
    expect(html).not.toMatch(/krishalaya\.in/i);
  });
  it('another organisation\'s lot / verification / certificate → the platform\'s page (never this store\'s mark)', async () => {
    C.scan = SCAN({ organisation: { displayName: 'Other Coop', slug: 'other-coop' } });
    await expect(TenantTracePage({ params: { tenantSlug: SLUG, qrToken: TOKEN }, searchParams: {} })).rejects.toThrow(`REDIRECT /trace/${TOKEN}`);
    C.verify = VERIFY({ organisation: { displayName: 'Other Coop', slug: 'other-coop' } });
    await expect(TenantVerifyPage({ params: { tenantSlug: SLUG, qrToken: TOKEN }, searchParams: {} })).rejects.toThrow(`REDIRECT /trace/${TOKEN}/verify`);
    C.cert = CERT({ organisation: { displayName: 'Other Coop', slug: 'other-coop' } });
    await expect(TenantCertPage({ params: { tenantSlug: SLUG, id: CERT_ID }, searchParams: {} })).rejects.toThrow(`REDIRECT /certificates/${CERT_ID}`);
  });
});
