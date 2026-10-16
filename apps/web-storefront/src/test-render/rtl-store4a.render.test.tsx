// apps/web-storefront/src/test-render/rtl-store4a.render.test.tsx · PC-56 STORE-4a · C7 — the person's pages under dir="rtl": the account, the
// address book (cards, a confirm, a named failure, empty), the form (refusals, the review diff), the data download (queued, ready, failed) and
// the deletion request (blocked, allowed) carry no PHYSICAL-direction class or inline style and no bare arrow outside .kv-dir-flip. Same guards as
// rtl-store3a / 3b / 3c (store1b-harness). In Hindi and Gujarati too.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => jest.requireActual('./store4a-fixtures').cookieJar() }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store4a-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store4a-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import AccountPage from '../app/[tenantSlug]/account/page';
import BookPage from '../app/[tenantSlug]/account/addresses/page';
import NewAddress from '../app/[tenantSlug]/account/addresses/new/page';
import EditAddress from '../app/[tenantSlug]/account/addresses/[id]/edit/page';
import DataPage from '../app/[tenantSlug]/account/data/page';
import DeletePage from '../app/[tenantSlug]/account/delete/page';
import { reviewAddressAction } from '../app/(platform)/account/addresses/actions';
import { bareArrows, physical, resolveTree } from './store1b-harness';
import { C, reset, ADDR, LABEL, exportRequest } from './store4a-fixtures';

const P = { tenantSlug: 'anand-fpo' };
const KEY = 'address:0214cafe-0000-4000-8000-000000000001';
const rtl = async (node: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{await resolveTree(node, [])}</div>);
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const quiet = async (p: Promise<unknown>) => { try { await p; } catch { /* the action redirects */ } };
beforeEach(() => { reset(); });

const STATES: Array<[string, () => Promise<React.ReactNode>]> = [
  ['W300 the account', () => AccountPage({ params: P, searchParams: {} })],
  ['W301 the book', () => BookPage({ params: P, searchParams: {} })],
  ['W3038 a remove confirm', () => BookPage({ params: P, searchParams: { confirm: 'remove', id: ADDR.farm } })],
  ['W3040 a named failure', () => BookPage({ params: P, searchParams: { confirm: 'default', id: ADDR.shop, k: KEY, failure: 'server' } })],
  ['W301 empty', async () => { C.addresses = []; return BookPage({ params: P, searchParams: {} }); }],
  ['W3034 the form with refusals', async () => { await quiet(reviewAddressAction(form({ chrome: 'anand-fpo', key: KEY, line1: 'a', pincode: '1' }))); return NewAddress({ params: P, searchParams: { k: KEY, error: 'form' } }); }],
  ['W3035 the edit review diff', async () => {
    await quiet(reviewAddressAction(form({ chrome: 'anand-fpo', id: ADDR.farm, key: KEY, line1: 'Plot 14, GIDC Vadal', village: 'Vadal', pincode: '362001', countryCode: 'IN', contactName: 'Nilesh', labelId: LABEL.home, deliveryNote: 'x' })));
    return EditAddress({ params: { ...P, id: ADDR.farm }, searchParams: { k: KEY, step: 'review' } });
  }],
  ['W3029 queued', async () => { C.requests = [exportRequest('queued')]; return DataPage({ params: P, searchParams: {} }); }],
  ['W3030 ready', async () => { C.requests = [exportRequest('ready')]; return DataPage({ params: P, searchParams: {} }); }],
  ['W3030 failed', async () => { C.requests = [exportRequest('failed')]; return DataPage({ params: P, searchParams: {} }); }],
  ['deletion blocked', () => DeletePage({ params: P, searchParams: {} })],
  ['deletion allowed', async () => { C.commitments = { ...C.commitments, walletMinor: '0', blocked: false }; return DeletePage({ params: P, searchParams: {} }); }],
];

describe('STORE-4a · rtl', () => {
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
