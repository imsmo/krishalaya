// apps/web-storefront/src/test-render/rtl-store1c.render.test.tsx · PC-56 STORE-1c — W307 /for-organisations (every step) and /pricing under
// dir="rtl", in en / hi / gu: no PHYSICAL-direction class, no physical inline style, no bare "→"/"←" outside `.kv-dir-flip` — the guards of
// rtl-store1a / rtl-store1b (store1b-harness.tsx, proven to bite there).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mock: { lang: string; pending: unknown; flags: unknown } = { lang: 'en', pending: null, flags: { org_self_signup: true } };
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: false }) }));
jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', platformCountry: 'IN', tenantAppUrl: 'https://console.example' } }));
jest.mock('../lib/i18n', () => {
  const { Translator: T } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  return { getLang: () => mock.lang, getTranslator: () => new T(mock.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/signup-flow', () => ({ readPendingSignup: () => mock.pending }));
jest.mock('../lib/api-client', () => ({
  publicClient: () => ({
    storefront: {
      flags: async () => mock.flags,
      stats: async () => ({ liveListings: 3, verifiedOrganisations: 2, districts: 1, computedAt: new Date(Date.now() - 2 * 3600_000).toISOString() }),
      plans: async () => ({ country: 'IN', trialDays: 14, plans: [{ code: 'growth', name: 'Growth', monthlyMinor: '1499900', annualMinor: '14999900', setupFeeMinor: '2500000', currency: 'INR', exponent: 2 }] }),
    },
    lookups: { values: async () => [{ id: '0190a8b2-0000-7000-8000-0000000000f0', code: 'fpo', name: 'FPO', sortOrder: 1, meta: {} }] },
  }),
}));
jest.mock('../app/(platform)/for-organisations/actions', () => ({
  startSignupAction: async () => undefined, resendCodeAction: async () => undefined, editFormAction: async () => undefined,
  confirmCodeAction: async () => undefined, submitSignupAction: async () => undefined, restartSignupAction: async () => undefined,
}));

import ForOrganisationsPage from '../app/(platform)/for-organisations/page';
import PricingPage from '../app/(platform)/pricing/page';
import { bareArrows, physical } from './store1b-harness';

const P = { orgName: 'Bhavnagar Kisan FPC', orgTypeId: '0190a8b2-0000-7000-8000-0000000000f0', fullName: 'Kavita Ben', typed: '98123 4574', lang: 'gu',
  phone: '+919812345742', code: '123456', idem: '0190a8b2-0000-7000-8000-00000000c0de', sentAt: Math.floor(Date.now() / 1000), ttlSec: 300, resendAt: 0,
  done: { org: 'Bhavnagar Kisan FPC', slug: 'bhavnagar-kisan-fpc', trialEndsOn: '2026-10-28', resumed: false } };
const rtl = async (node: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{node}</div>);

describe('STORE-1c pages under dir="rtl"', () => {
  const cases: Array<[string, () => Promise<React.ReactNode>]> = [
    ['W307 form-error (W2466)', async () => ForOrganisationsPage({ searchParams: { step: 'form', e: 'org_short.phone_digits', need: '10', have: '9', dial: '91' } })],
    ['W307 code', async () => ForOrganisationsPage({ searchParams: { step: 'code', err: 'code_wrong', left: '2' } })],
    ['W307 review (W2467)', async () => ForOrganisationsPage({ searchParams: { step: 'review' } })],
    ['W307 done (W2468)', async () => ForOrganisationsPage({ searchParams: { step: 'done' } })],
    ['W307 failure (W2469) + Retry', async () => ForOrganisationsPage({ searchParams: { step: 'failure', err: 'unavailable' } })],
    ['/pricing', async () => PricingPage({ searchParams: {} })],
  ];
  it.each(cases)('%s', async (_n, build) => {
    mock.pending = P;
    for (const lang of ['en', 'hi', 'gu']) {
      mock.lang = lang;
      const html = await rtl(await build());
      expect(html.startsWith('<div dir="rtl">')).toBe(true);
      expect([lang, physical(html)]).toEqual([lang, []]);
      expect([lang, bareArrows(html)]).toEqual([lang, 0]);
    }
  });

  it('W307 flagged off under dir="rtl"', async () => {
    mock.flags = { org_self_signup: false };
    const html = await rtl(await ForOrganisationsPage({ searchParams: {} }));
    expect(html).toContain('data-kv-state="flagged-off"');
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
    mock.flags = { org_self_signup: true };
  });
});
