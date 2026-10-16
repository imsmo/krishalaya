// apps/web-storefront/src/test-render/rtl-store3c.render.test.tsx · PC-56 STORE-3c · C7 — the auction list (live / sealed / ended / mine / empty /
// error / flag off / a Next page), my bids (rows, a won row with Pay balance, empty, error) and the group lot (pledging with its progress bar,
// listed, cancelled, off, error) under dir="rtl": no PHYSICAL-direction class or inline style and no bare arrow outside .kv-dir-flip (the progress
// bar's width is a size, not a direction). Same guards as rtl-store3b (store1b-harness). In Hindi and Gujarati too.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }) }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store3c-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ getSessionTenant: () => jest.requireActual('./store3c-fixtures').T, hasSessionCookie: () => true }));
jest.mock('../lib/storefront-data', () => ({ loadTenantShell: (s: string) => jest.requireActual('./store3c-fixtures').shell(s) }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store3c-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import TenantAuctionsPage from '../app/[tenantSlug]/auctions/page';
import TenantMyBidsPage from '../app/[tenantSlug]/auctions/bids/page';
import TenantGroupLotPage from '../app/[tenantSlug]/g/[id]/page';
import { bareArrows, physical, resolveTree } from './store1b-harness';
import { C, reset, MINE, SETTLEMENT, GROUP_LOT, A, SLUG, LOT, LISTING } from './store3c-fixtures';

const rtl = async (node: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{await resolveTree(node, [])}</div>);
const list = (sp: Record<string, string> = {}) => TenantAuctionsPage({ params: { tenantSlug: SLUG }, searchParams: sp });
const bids = () => TenantMyBidsPage({ params: { tenantSlug: SLUG }, searchParams: {} });
const lot = () => TenantGroupLotPage({ params: { tenantSlug: SLUG, id: LOT }, searchParams: {} });
const WON = () => MINE(A.won, { status: 'settled', isOpen: false, won: true, emd: { state: 'applied', amountMinor: '1000000', at: '2026-10-16T12:31:00.000Z' }, settlement: SETTLEMENT() });

const STATES: Array<[string, () => Promise<React.ReactNode>]> = [
  ['W295 live (open + sealed) with a Next page', async () => { C.next = 'c2'; return list(); }],
  ['W295 ended (reserve not met + awaiting)', () => list({ tab: 'ended' })],
  ['W295 with my bids', () => list({ tab: 'mine' })],
  ['W295 empty', async () => { C.lists.upcoming = []; return list({ tab: 'upcoming' }); }],
  ['W295 error', async () => { C.lists.live = new Error('down'); return list(); }],
  ['W295 flag off', async () => { C.flags = { ...C.flags, auctions: false }; return list(); }],
  ['W296 rows + a won row (Pay balance) + Next', async () => { C.mine = [MINE(A.live), WON()]; C.mineNext = 'n2'; return bids(); }],
  ['W296 empty', async () => { C.mine = []; return bids(); }],
  ['W296 error', async () => { C.mine = new Error('down'); return bids(); }],
  ['W279 pledging (progress bar)', () => lot()],
  ['W279 listed', async () => { C.lot = GROUP_LOT({ status: 'listed', listingId: LISTING }); return lot(); }],
  ['W279 cancelled', async () => { C.lot = GROUP_LOT({ status: 'cancelled', cancelReasonCode: 'target_missed' }); return lot(); }],
  ['W279 off', async () => { C.flags = { ...C.flags, group_lots: false }; return lot(); }],
  ['W279 error', async () => { C.lot = new Error('down'); return lot(); }],
];

describe('STORE-3c · rtl', () => {
  beforeEach(() => reset());
  it.each(STATES)('%s: no physical-direction class or style, no bare arrow', async (_name, make) => {
    const html = await rtl(await make());
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
  it('in Hindi and Gujarati too', async () => {
    for (const lang of ['hi', 'gu']) {
      for (const [, make] of STATES) {
        reset(); C.lang = lang;
        const html = await rtl(await make());
        expect(physical(html)).toEqual([]);
        expect(bareArrows(html)).toBe(0);
      }
    }
  });
});
