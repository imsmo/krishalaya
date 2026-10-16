// apps/web-storefront/src/test-render/checkout-payment.render.test.tsx · PC-56 STORE-2c · C3 — canon W284, the payment step:
//   • online payments ON → "Pay online (the sheet chooses UPI / card / netbanking)"; the WALLET offered ONLY when its balance covers the whole bill
//     (founder D6), with the balance in the data's currency; not offered when short, nor in another currency;
//   • online payments OFF → the single honest line "pay on delivery; the organisation confirms" and NO method radio (HOTFIX-4 D2);
//   • the escrow sentence (D6) and the refund sentence as the code has it (D3); the W284 refusals by name; no COD cap, NEFT, "GST-matched
//     invoices", pay-later or helpline OFFERED; the choice is server-held (choosePaymentAction writes it; the URL carries only the step).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }) }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: jest.requireActual('./store2c-fixtures').C.pending === true }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store2c-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => jest.requireActual('./store2c-fixtures').C.token, requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ getSessionTenant: () => jest.requireActual('./store2c-fixtures').C.sessionTenant }));
jest.mock('../lib/storefront-data', () => ({ loadTenantShell: (s: string) => jest.requireActual('./store2c-fixtures').shell(s) }));
jest.mock('../lib/checkout-flow', () => jest.requireActual('./store2c-fixtures').checkoutFlow);
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store2c-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});

import TenantCheckout from '../app/[tenantSlug]/checkout/page';
import { choosePaymentAction } from '../app/[tenantSlug]/checkout/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset } from './store2c-fixtures';
import { store2cRefusalKeys } from '../features/store2/refusals';

const page = async () => renderToStaticMarkup(await TenantCheckout({ params: { tenantSlug: 'anand-fpo' }, searchParams: { step: 'payment' } }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
beforeEach(() => reset());
void SdkError;

describe('STORE-2c · W284 the payment step', () => {
  it('online ON + the wallet covers the bill → both methods; the wallet line names the balance; asked in the bill\'s currency', async () => {
    const html = await page();
    expect(html).toContain('data-kv-offer="online"');
    expect(html).toContain('data-kv-offer="wallet"');
    expect(text(html)).toContain(en['store2c.pay.online']);
    expect(text(html)).toMatch(/Pay from wallet \(balance ₹\s?90,000\.00\)/);
    expect(C.calls.find((c) => c[0] === 'wallet.balance')).toEqual(['wallet.balance', 'INR']);
  });
  it('the wallet SHORT of the bill (or in another currency) → not offered, and said why', async () => {
    C.wallet = { ...C.wallet, availableMinor: '8236374' };
    let html = await page();
    expect(html).not.toContain('data-kv-offer="wallet"');
    expect(html).toContain('data-kv-wallet="not-offered"');
    C.wallet = { ...C.wallet, availableMinor: '99999999', currencyCode: 'USD' };
    html = await page();
    expect(html).not.toContain('data-kv-offer="wallet"');
  });
  it('online payments OFF → the single honest line, no radio, no wallet; the review is the next step', async () => {
    C.flags = { ...C.flags, online_payments: false };
    const html = await page();
    expect(html).toContain('data-kv-offer="on_delivery"');
    expect(text(html)).toContain(en['store2c.pay.offLine']);
    expect(html).not.toContain('name="pay"');
    expect(C.calls.some((c) => c[0] === 'wallet.balance')).toBe(false);
  });
  it('the escrow sentence (D6) and the refund sentence (D3) as the code has them', async () => {
    const html = await page();
    expect(text(html)).toContain(en['store2c.escrow']);
    expect(text(html)).toContain(en['store2c.refund.true']);
    expect(en['store2c.escrow']).toContain('released to the organisation');
  });
  it('the choice is server-held: choosePaymentAction writes it and goes to review', async () => {
    await expect(choosePaymentAction(form({ slug: 'anand-fpo', pay: 'wallet' }))).rejects.toThrow('REDIRECT /anand-fpo/checkout?step=review');
    expect(C.state.pay).toBe('wallet');
  });
  it('the W284 refusals by name; COD cap, NEFT, GST-matched invoices, pay-later, the helpline are never OFFERED', async () => {
    const html = await page();
    for (const k of store2cRefusalKeys('checkout-payment')) expect([k, text(html).includes(en[k as keyof typeof en])]).toEqual([k, true]);
    expect(text(html)).not.toMatch(/20,000|1800-|CHK-|partner-bank decision|held for 30 minutes/);
  });
  it('payment needs a chosen address: with none the step is the address step (a step is never reached past its prerequisite)', async () => {
    C.state = { ...C.state, addressId: null };
    expect(await page()).toContain('data-kv-checkout-step="address"');
  });
});
