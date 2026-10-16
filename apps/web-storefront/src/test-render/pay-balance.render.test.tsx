// apps/web-storefront/src/test-render/pay-balance.render.test.tsx · PC-56 STORE-3c · C4 (founder D2) — 2c's pay step pays an auction order's BALANCE:
//   • the amount printed and the amount the attempt asks for are the order's `amountDueMinor` (total − the deposit applied) — the ONE rule the API's
//     intent, wallet pay and capture re-check apply; a direct order still pays its total (its due IS its total);
//   • "Deposit applied −X · Balance due Y" above the amount for an auction order (server figures; none without a deposit);
//   • wallet pay is offered when the wallet covers the BALANCE (even though it does not cover the total);
//   • ORDER_PAYMENT_AMOUNT_MISMATCH is refused BY NAME (the attempt action and the page), never "something went wrong".
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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

import TenantPayPage from '../app/[tenantSlug]/checkout/pay/page';
import { createOrderAttemptAction } from '../app/[tenantSlug]/checkout/pay/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, ORDER, O } from './store2c-fixtures';

const AUCTION_ORDER = () => ORDER(O.a, 'pending', { source: 'auction', totalMinor: '13100000', amountDueMinor: '12100000', depositAppliedMinor: '1000000', auctionId: 'a1' });
const html = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantPayPage({ params: { tenantSlug: 'anand-fpo' }, searchParams: { o: O.a, ...sp } }));
beforeEach(() => { reset(); C.orders[O.a] = AUCTION_ORDER(); });

describe('STORE-3c · the pay step charges the DUE (founder D2)', () => {
  it('an auction order: the deposit rows above the amount; the amount due is the BALANCE (never the total)', async () => {
    const h = await html();
    const tx = text(h);
    expect(h).toContain('data-kv-deposit-rows=""');
    expect(tx).toMatch(/Deposit applied −\s?₹10,000\.00 · Balance due ₹1,21,000\.00/);
    expect(h).toContain('data-kv-due="12100000"');
    expect(tx).not.toContain('₹1,31,000.00');
  });
  it('the attempt asks for the DUE — the amount the API\'s intent rule demands', async () => {
    const r = await createOrderAttemptAction('anand-fpo', O.a, 1);
    expect(r).toMatchObject({ ok: true, amountMinor: '12100000' });
    expect(C.calls).toContainEqual(['createOrderAttempt', expect.objectContaining({ orderId: O.a, amountMinor: '12100000', currencyCode: 'INR' })]);
  });
  it('a direct order pays its total (its due IS its total) and shows no deposit rows', async () => {
    C.orders[O.a] = ORDER(O.a, 'pending', { amountDueMinor: '6172875', depositAppliedMinor: '0' });
    const h = await html();
    expect(h).not.toContain('data-kv-deposit-rows=');
    expect(h).toContain('data-kv-due="6172875"');
    C.orders[O.a] = ORDER(O.a, 'pending');   // an older read without the field → the total
    expect(await html()).toContain('data-kv-due="6172875"');
  });
  it('wallet pay is offered when the wallet covers the BALANCE (it does not cover the total)', async () => {
    C.wallet = { ...C.wallet, availableMinor: '12100000' };
    const h = await html({ via: 'wallet' });
    expect(h).toContain('data-kv-form="wallet-pay"');
    expect(text(h)).toMatch(/Pay ₹\s?1,21,000\.00 from wallet/);
    C.wallet = { ...C.wallet, availableMinor: '12099999' };
    expect(await html({ via: 'wallet' })).toContain('data-kv-wallet="short"');
  });
  it('ORDER_PAYMENT_AMOUNT_MISMATCH is refused BY NAME — by the attempt action and on the page', async () => {
    C.fail.createOrderAttempt = { code: 'ORDER_PAYMENT_AMOUNT_MISMATCH', status: 400, details: { expected: '12100000', got: '13100000' } };
    expect(await createOrderAttemptAction('anand-fpo', O.a, 1)).toEqual({ ok: false, refusal: 'amount_mismatch' });
    const h = await html({ status: 'amount_mismatch' });
    expect(h).toContain('data-kv-refused="amount_mismatch"');
    expect(text(h)).toContain(en['store2c.refused.amount_mismatch']);
  });
});
