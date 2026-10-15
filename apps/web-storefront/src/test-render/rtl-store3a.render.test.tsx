// apps/web-storefront/src/test-render/rtl-store3a.render.test.tsx · PC-56 STORE-3a · C5 — the order pages under dir="rtl": the list (rows, empty,
// error), the order (paid + delivered with the received confirm, cancelled + refunded, an auction balance with the deposit rows), the cancel page
// (the confirm, a named failure, not cancellable) carry no PHYSICAL-direction class or inline style and no bare arrow outside .kv-dir-flip.
// Same guards as rtl-store2a / 2b / 2c (store1b-harness). In Hindi and Gujarati too.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }) }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => jest.requireActual('./store3a-fixtures').cookieJar() }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: jest.requireActual('./store3a-fixtures').C.pending === true }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', featureAuctions: false, siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store3a-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ getSessionTenant: () => 't' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store3a-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import TenantOrdersPage from '../app/[tenantSlug]/orders/page';
import TenantOrderPage from '../app/[tenantSlug]/orders/[id]/page';
import TenantCancelPage from '../app/[tenantSlug]/orders/[id]/cancel/page';
import { bareArrows, physical, resolveTree } from './store1b-harness';
import { C, reset, DETAIL, ROW, SLUG, OID } from './store3a-fixtures';

const rtl = async (node: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{await resolveTree(node, [])}</div>);
const list = (sp: Record<string, string> = {}) => TenantOrdersPage({ params: { tenantSlug: SLUG }, searchParams: sp });
const order = (id: string, sp: Record<string, string> = {}) => TenantOrderPage({ params: { tenantSlug: SLUG, id }, searchParams: sp });
const cancel = (id: string, sp: Record<string, string> = {}) => TenantCancelPage({ params: { tenantSlug: SLUG, id }, searchParams: sp });
beforeEach(() => {
  reset();
  C.orders[OID.paid] = DETAIL(OID.paid, { status: 'delivered', paymentState: 'paid', qualityWindowEnds: '2026-10-16T12:00:00.000Z' });
  C.orders[OID.cancelled] = DETAIL(OID.cancelled, { status: 'cancelled', paymentState: 'cancelled', cancelReasonCode: 'other' });
  C.attempts[OID.cancelled] = { latest: null, attempts: 1, nextAttempt: 2, liveAttempt: false, ttlSeconds: 900, refund: { state: 'refunded', amountMinor: '6172875', currencyCode: 'INR', initiatedAt: null, completedAt: '2026-10-16T11:46:00.000Z', gatewayRefundId: 'rfnd_x' } };
  C.orders[OID.auction] = DETAIL(OID.auction, { status: 'payment_pending', paymentState: 'pending', source: 'auction', amountDueMinor: '12100000', depositAppliedMinor: '1000000' });
  C.orders[OID.cod] = DETAIL(OID.cod);
  C.orders[OID.late] = DETAIL(OID.late, { status: 'picked_up' });
  C.events[OID.paid] = [{ toStatus: 'created', actorRole: 'buyer', at: '2026-10-15T11:42:00.000Z' }, { toStatus: 'delivered', actorRole: 'seller', at: '2026-10-15T15:00:00.000Z' }];
});

const STATES: Array<[string, () => Promise<React.ReactNode>]> = [
  ['W288 the list (rows)', async () => { C.list.all = [ROW(OID.cod, 'confirmed', { itemCount: 2 }), ROW(OID.pending, 'payment_pending', { paymentState: 'pending', acceptanceDeadline: '2026-10-16T11:42:00.000Z' })]; return list(); }],
  ['W288 empty', () => list({ group: 'cancelled' })],
  ['W288 error', async () => { C.list.all = new Error('down') as unknown as never[]; return list(); }],
  ['W289 delivered + paid, the received confirm', () => order(OID.paid, { confirm: 'received' })],
  ['W289 cancelled + refunded', () => order(OID.cancelled)],
  ['W289 an auction balance with the deposit rows', () => order(OID.auction)],
  ['W3083 the cancel confirm', () => cancel(OID.cod)],
  ['W3085 a named failure', () => cancel(OID.cod, { error: 'moved', k: 'cancel:k:0210aaaa-0000-7000-8000-000000000003' })],
  ['W291 not cancellable', () => cancel(OID.late)],
];

describe('STORE-3a · rtl', () => {
  it.each(STATES)('%s: no physical-direction class or style, no bare arrow', async (_name, make) => {
    const html = await rtl(await make());
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
  it('in Hindi and Gujarati too', async () => {
    for (const lang of ['hi', 'gu']) {
      C.lang = lang;
      for (const [, make] of STATES) {
        const html = await rtl(await make());
        expect(physical(html)).toEqual([]);
        expect(bareArrows(html)).toBe(0);
      }
    }
  });
});
