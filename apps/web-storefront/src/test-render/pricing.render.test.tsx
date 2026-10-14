// apps/web-storefront/src/test-render/pricing.render.test.tsx · PC-56 STORE-1c · C4 (founder D2) — /pricing from the platform's PUBLIC plans.
//   • real minor units → formatted by the one money formatter with the currency's exponent (₹4,999.00 a month), monthly + annual, the
//     setup fee only when above zero; the price SIGN comes from the formatter, never from a catalogue (the old "₹0" / "From ₹999/mo" are gone);
//   • ERROR ≠ EMPTY: a failed read → "Pricing is not available right now" + Retry (a reload of the same URL); zero plans → "No public plans
//     for India yet"; the country is ?country= else the platform's;
//   • an exponent that disagrees with the currency → the price is NOT printed (said instead).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mock: { lang: string; plans: unknown; asked: string[] } = { lang: 'en', plans: null, asked: [] };

jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', platformCountry: 'IN', tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: T } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  return { getLang: () => mock.lang, getTranslator: () => new T(mock.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/api-client', () => ({
  publicClient: () => ({
    storefront: {
      plans: async (country: string) => {
        mock.asked.push(country);
        if (mock.plans instanceof Error) throw Object.assign(new Error('api'), { status: 503 });
        return mock.plans;
      },
    },
  }),
}));

import PricingPage from '../app/(platform)/pricing/page';
import { en } from '../i18n/en';
import { text } from './store1b-harness';

const STARTER = { code: 'starter', name: 'Starter', monthlyMinor: '499900', annualMinor: '4999900', setupFeeMinor: '0', currency: 'INR', exponent: 2 };
const GROWTH = { code: 'growth', name: 'Growth', monthlyMinor: '1499900', annualMinor: '14999900', setupFeeMinor: '2500000', currency: 'INR', exponent: 2 };
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await PricingPage({ searchParams: sp }));

beforeEach(() => { mock.lang = 'en'; mock.asked = []; mock.plans = { country: 'IN', plans: [STARTER, GROWTH], trialDays: 14 }; });

describe('STORE-1c · /pricing from the public plans read', () => {
  it('real minors → formatted monthly + annual; the setup fee only above zero; the trial from the policy; CTA → /for-organisations', async () => {
    const html = await render();
    expect(mock.asked).toEqual(['IN']);
    const starter = html.slice(html.indexOf('data-kv-plan="starter"'), html.indexOf('data-kv-plan="growth"'));
    expect(text(starter)).toContain('₹4,999.00 a month');
    expect(text(starter)).toContain('₹49,999.00 a year');
    expect(starter).not.toContain('data-kv-price="setup"');
    const growth = html.slice(html.indexOf('data-kv-plan="growth"'));
    expect(text(growth)).toContain('₹14,999.00 a month');
    expect(text(growth)).toContain('₹25,000.00 one-time setup fee');
    expect(text(html)).toContain('New organisations start on a free trial of 14 days — no card is asked for.');
    expect(text(html)).toContain('Every public plan for organisations in India, as the platform lists it today.');
    expect(text(html)).toContain(en['pricing.buyersFree']);
    expect(html).toContain('href="/for-organisations"');
    expect(html).not.toContain('href="/tenants-signup"');
    expect(text(html)).not.toMatch(/From ₹999|₹0\b|Talk to us/);
  });

  it('?country=bd asks for BD (validated, upper-cased); a malformed one falls back to the platform\'s', async () => {
    mock.plans = { country: 'BD', plans: [], trialDays: null };
    await render({ country: 'bd' });
    await render({ country: 'Bangladesh' });
    expect(mock.asked).toEqual(['BD', 'IN']);
  });

  it('EMPTY (a real answer with no plans) → "No public plans for <country> yet" — and no error, no Retry', async () => {
    mock.plans = { country: 'IN', plans: [], trialDays: 14 };
    const html = await render();
    expect(html).toContain('data-kv-state="pricing-empty"');
    expect(text(html)).toContain('No public plans for India yet.');
    expect(html).not.toContain('data-kv-retry');
  });

  it('ERROR (no plan read) → "not available right now" + Retry = a reload of the same URL — never the empty sentence', async () => {
    mock.plans = new Error('down');
    const html = await render({ country: 'IN' });
    expect(html).toContain('data-kv-state="pricing-error"');
    expect(text(html)).toContain(en['pricing.error']);
    expect(html).toMatch(/<a href="\/pricing\?country=IN" class="kv-btn" data-kv-retry="reload">Retry<\/a>/);
    expect(text(html)).not.toContain('No public plans');
  });

  it('an exponent that disagrees with the currency is NOT printed (a price scaled wrong is worse than none)', async () => {
    mock.plans = { country: 'IN', plans: [{ ...STARTER, exponent: 0 }], trialDays: null };
    const html = await render();
    expect(html).toContain('data-kv-state="price-unreadable"');
    expect(text(html)).not.toMatch(/4,999|499,900/);
  });

  it('Hindi and Gujarati: the price formatted for the reader, the country named in their language', async () => {
    for (const lang of ['hi', 'gu']) {
      mock.lang = lang;
      const html = await render();
      expect(html).toContain('data-kv-plan="starter"');
      expect(text(html)).toMatch(/4,999\.00/);
      expect(text(html)).not.toContain('a month');
    }
  });
});
