// apps/web-storefront/src/test-render/order-confirmed.render.test.tsx · PC-56 STORE-3a · C4 — canon W287 "Order confirmed" (the organisation's
// /<slug>/checkout/confirm, 2c's page): per order "Track this order" → /<slug>/orders/<id>; "View my orders" → /<slug>/orders (no longer the
// platform's /orders); the acceptance deadline the 24 h clock enforces (never for an auction order); "What happens next" with the release step
// ONLY for a paid order (a pay-on-delivery order is completed by the organisation — founder D6); the re-grade / slot / "two farmers heard"
// claims refused by name.
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: false }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store2c-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ getSessionTenant: () => jest.requireActual('./store2c-fixtures').C.sessionTenant }));
jest.mock('../lib/storefront-data', () => ({ loadTenantShell: (s: string) => jest.requireActual('./store2c-fixtures').shell(s) }));
jest.mock('../lib/checkout-flow', () => jest.requireActual('./store2c-fixtures').checkoutFlow);
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store2c-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});

import TenantConfirmPage from '../app/[tenantSlug]/checkout/confirm/page';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, O, ORDER } from './store2c-fixtures';
import { store3aRefusalKeys } from '../features/store3a/refusals';

const confirm = async (sp: Record<string, string>) => renderToStaticMarkup(await TenantConfirmPage({ params: { tenantSlug: 'anand-fpo' }, searchParams: sp }));
beforeEach(() => { reset(); });

describe('STORE-3a · W287 the order confirmed', () => {
  it('a placed (COD) order: Track this order → the organisation\'s order page; View my orders → /<slug>/orders; the deadline; no release step', async () => {
    C.orders[O.a] = ORDER(O.a, 'none', { acceptanceDeadline: '2026-10-16T11:42:00.000Z' });
    const h = await confirm({ o: O.a });
    expect(h).toContain(`data-kv-track="${O.a}" href="/anand-fpo/orders/${O.a}"`);
    expect(h).toContain('data-kv-view-orders="store" href="/anand-fpo/orders"');
    expect(h).not.toContain('href="/orders"');
    expect(h).toContain(`data-kv-deadline="${O.a}"`);
    expect(text(h)).toContain(en['store3a.confirm.next.confirm']);
    expect(h).not.toContain('data-kv-next="release"');
    for (const k of store3aRefusalKeys('confirm')) expect(text(h)).toContain(en[k]);
  });
  it('a PAID order: the release step ("you confirm you received it, or the quality window closes"); no deadline once confirmed', async () => {
    C.orders[O.a] = ORDER(O.a, 'paid', { acceptanceDeadline: '2026-10-16T11:42:00.000Z' });
    const h = await confirm({ o: O.a });
    expect(h).toContain('data-kv-next="release"');
    expect(text(h)).toContain(en['store3a.confirm.next.release']);
    expect(h).not.toContain('data-kv-deadline=');
  });
  it('an AUCTION order awaiting payment: no deadline sentence (the 24 h clock does not run for it)', async () => {
    C.orders[O.a] = ORDER(O.a, 'pending', { source: 'auction', acceptanceDeadline: '2026-10-16T11:42:00.000Z' });
    expect(await confirm({ o: O.a })).not.toContain('data-kv-deadline=');
  });
});
