// apps/web-storefront/src/test-render/checkout-refusals.render.test.tsx · PC-56 STORE-2b · C6, carried by STORE-2c under the organisation's checkout:
// the cart's refusals mapped BY NAME at the preview (a ban names the region; a line problem points back to THIS store's cart; the Place button is
// withheld while the preview refuses), buying paused said platform-wide, a load error with Retry (a reload — W3052–W3054 PARITY-DECOR), and
// one store per session (signed in to another organisation → said, never another store's checkout under this name).
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
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, T_OTHER } from './store2c-fixtures';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantCheckout({ params: { tenantSlug: 'anand-fpo' }, searchParams: sp }));
beforeEach(() => reset());

describe('STORE-2b/2c · the organisation\'s checkout maps the cart refusals by name', () => {
  it('a load error → said with Retry (a reload of this URL, the step kept); buying paused → said, platform-wide', async () => {
    C.cart = new Error('down');
    let h = await page({ step: 'review' });
    expect(h).toContain('href="/anand-fpo/checkout?step=review" class="kv-btn" data-kv-retry="reload"');
    expect(text(h)).toContain(en['store2c.loadError']);
    reset(); C.cart = 'OFF';
    h = await page();
    expect(h).toContain('data-kv-state="cart-off"');
    expect(text(h)).toContain(en['store2b.refusal.flagTenantPlan']);
    reset(); C.flags = { ...C.flags, storefront_cart: false };
    expect(await page()).toContain('data-kv-state="cart-off"');
  });
  it('the preview refuses a line (PRICE_CHANGED) → back to THIS store\'s cart, no Place button; BANNED_IN_REGION at placement names the region', async () => {
    C.preview = new SdkError('PRICE_CHANGED', 409, 'x', undefined, { addedPriceMinor: '252000', currentPriceMinor: '256000' });
    let h = await page({ step: 'review' });
    expect(h).toContain('data-kv-refused="price_changed"');
    expect(h).toContain('href="/anand-fpo/cart?status=price_changed"');
    expect(h).not.toContain('Place order</button>');
    reset();
    h = await page({ step: 'review', status: 'banned', region: 'Maharashtra' });
    expect(text(h)).toContain('banned in Maharashtra');
  });
  it('signed in to ANOTHER organisation → said, with the way to your own store\'s checkout; anonymous → sign in to THIS store', async () => {
    C.sessionTenant = T_OTHER;
    let h = await page();
    expect(h).toContain('data-kv-state="wrong-store"');
    expect(h).toContain('href="/kisan-sathi/checkout"');
    reset(); C.token = null;
    h = await page();
    expect(h).toContain('data-kv-state="signin"');
    expect(h).toContain('href="/anand-fpo/login?next=%2Fanand-fpo%2Fcheckout"');
  });
});
