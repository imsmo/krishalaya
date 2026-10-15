// apps/web-storefront/src/test-render/pay-confirm.render.test.tsx · PC-56 STORE-2c · C1 (rewritten from HOTFIX-4's platform pay / confirm test, whose
// pages moved under the organisation — their states are now proven in payment-processing.render.test.tsx). The PLATFORM's money routes are DOORS:
//   /checkout, /checkout/pay, /checkout/confirm → the session's store (`/<slug>/checkout…`), carrying the order / group / status; /auctions/[id]
//   → `/<slug>/auctions/[id]` for a signed-in buyer, else "open it from its organisation's store"; the store unreadable → said, with a Retry.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }) }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: jest.requireActual('./store2c-fixtures').C.pending === true }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', featureAuctions: false, siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
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
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: () => ({ storefront: { tenant: async () => { if (f.C.doorFails) throw new Error('down'); return { slug: 'anand-fpo', displayName: 'Anand FPO' }; } } }) };
});

jest.mock('server-only', () => ({}), { virtual: true });   // lib/store-door.ts is exercised for real (only its client is faked)

import PlatformCheckoutDoor from '../app/(platform)/checkout/page';
import PlatformPayDoor from '../app/(platform)/checkout/pay/page';
import PlatformConfirmDoor from '../app/(platform)/checkout/confirm/page';
import PlatformAuctionDoor from '../app/(platform)/auctions/[id]/page';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, AUCTION } from './store2c-fixtures';

const fails = (on: boolean) => { (C as unknown as { doorFails: boolean }).doorFails = on; };
beforeEach(() => { reset(); fails(false); });
void SdkError;

describe('STORE-2c · the platform money routes are doors to the organisation', () => {
  it('/checkout → /<slug>/checkout, carrying a refusal status and its region', async () => {
    await expect(PlatformCheckoutDoor({ searchParams: { status: 'banned', region: 'Maharashtra' } })).rejects.toThrow('REDIRECT /anand-fpo/checkout?status=banned&region=Maharashtra');
  });
  it('/checkout/pay and /checkout/confirm → the store\'s own, the order, the group and the coupon notice carried', async () => {
    await expect(PlatformPayDoor({ searchParams: { o: 'o1', g: 'g1', cn: 'user_limit' } })).rejects.toThrow('REDIRECT /anand-fpo/checkout/pay?o=o1&g=g1&cn=user_limit');
    await expect(PlatformConfirmDoor({ searchParams: { g: 'g1' } })).rejects.toThrow('REDIRECT /anand-fpo/checkout/confirm?g=g1');
  });
  it('the session\'s store cannot be read → said, with a Retry (a reload of the door) — never a guessed store', async () => {
    fails(true);
    const h = renderToStaticMarkup(await PlatformPayDoor({ searchParams: { o: 'o1' } }));
    expect(h).toContain('data-kv-state="error"');
    expect(h).toContain('href="/checkout/pay?o=o1" class="kv-btn" data-kv-retry="reload"');
    expect(text(h)).toContain(en['store2c.doorError']);
  });
  it('/auctions/[id]: a signed-in buyer → the auction under their store; anonymous → "open it from its organisation\'s store"', async () => {
    await expect(PlatformAuctionDoor({ params: { id: AUCTION } })).rejects.toThrow(`REDIRECT /anand-fpo/auctions/${AUCTION}`);
    C.token = null;
    const h = renderToStaticMarkup(await PlatformAuctionDoor({ params: { id: AUCTION } }));
    expect(h).toContain('data-kv-state="which-store"');
    expect(text(h)).toContain(en['store2c.auction.whichStore']);
  });
});
