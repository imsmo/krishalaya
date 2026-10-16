// apps/web-storefront/src/test-render/orders-list.render.test.tsx · PC-56 STORE-3a · C1 — canon W288 "My orders" under the organisation:
//   • five tabs with the API's bounded counts — a capped tab says "<n>+"; the current tab marked; each tab a link under /<slug>/orders;
//   • a row names the ORGANISATION — never a person, never a uuid; the money in the DATA's currency (Rule Zero — USD printed as dollars);
//   • every one of the 15 statuses labelled in en / hi / gu (never the raw enum);
//   • awaiting payment + the acceptance deadline — never for an auction order;
//   • a load error is NOT an empty list (said, with a Retry that reloads); an empty tab says so with "Browse this store"; keyset Next;
//   • the platform's /orders is a door to the session's store (tab and cursor carried); the store unreadable → said, with a Retry.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }) }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => jest.requireActual('./store3a-fixtures').cookieJar() }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: jest.requireActual('./store3a-fixtures').C.pending === true }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
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
import PlatformOrdersDoor from '../app/(platform)/orders/page';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text } from './store1b-harness';
import { C, reset, ROW, SLUG, SELLER_UUID, OID } from './store3a-fixtures';
import { ORDER_STATUS_LIST } from '../features/store3a/order-status';
import { store3aRefusalKeys } from '../features/store3a/refusals';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantOrdersPage({ params: { tenantSlug: SLUG }, searchParams: sp }));
beforeEach(() => { reset(); });
const CATS: Record<string, Record<string, string>> = { en, hi, gu };

describe('STORE-3a · W288 the tabs (founder D4)', () => {
  it('five tabs with their counts; a tab past the cap says "<n>+"; the current tab from ?group=', async () => {
    C.counts.completed = { count: 100, capped: true };
    C.list.attention = [ROW(OID.pending, 'payment_pending', { paymentState: 'pending' })];
    const h = await page({ group: 'attention' });
    for (const g of ['all', 'active', 'attention', 'completed', 'cancelled']) expect(h).toContain(`data-kv-tab="${g}"`);
    expect(h).toContain(`class="kv-tab kv-tab--current" aria-current="page" data-kv-tab="attention" href="/${SLUG}/orders?group=attention"`);
    expect(h).toContain('data-kv-count="completed" data-kv-capped="true"');
    expect(text(h)).toContain('(100+)');
    expect(text(h)).toContain(`${en['store3a.tab.attention']} (1)`);
    expect(C.calls).toContainEqual(['orders.list', expect.objectContaining({ group: 'attention' })]);
  });
  it('the counts unreadable → the tabs are still links, with no number invented', async () => {
    C.counts = new Error('down');
    const h = await page();
    expect(h).toContain('data-kv-tab="active"');
    expect(h).not.toContain('data-kv-count=');
  });
});

describe('STORE-3a · W288 the rows', () => {
  it('the primary item + "+N more", the ORGANISATION (never a person or a uuid), the number, the status, the money in the data\'s currency', async () => {
    C.list.all = [ROW(OID.cod, 'confirmed', { itemCount: 3, currencyCode: 'USD', totalMinor: '120050' })];
    const h = await page();
    const tx = text(h);
    expect(tx).toContain('GG-20 Groundnut · 10 quintal');
    expect(tx).toContain('+2 more');
    expect(h).toContain('data-kv-seller="organisation"');
    expect(tx).toContain('Anand FPO');
    expect(h).not.toContain(SELLER_UUID);
    expect(h).toContain('data-kv-money="USD"');
    expect(tx).toMatch(/\$\s?1,200\.50|US\$/);
    expect(tx).not.toContain('₹');
  });
  it.each(['en', 'hi', 'gu'])('%s: every one of the 15 statuses carries its own label — never the raw enum', async (lang) => {
    C.lang = lang;
    C.list.all = ORDER_STATUS_LIST.map((s, i) => ROW(`0210e000-0000-7000-8000-0000000001${String(i).padStart(2, '0')}`, s));
    const h = await page();
    for (const s of ORDER_STATUS_LIST) {
      expect(h).toContain(`data-kv-chip="${s}">${CATS[lang][`order.status.${s}`].replace(/&/g, '&amp;')}<`);
    }
    expect(text(h)).not.toMatch(/payment_pending|out_for_delivery|partially_fulfilled|partially_refunded/);
  });
  it('awaiting payment + the deadline for a placed order; NO deadline sentence for an auction order', async () => {
    C.list.all = [ROW(OID.pending, 'payment_pending', { paymentState: 'pending', acceptanceDeadline: '2026-10-16T11:42:00.000Z' }),
      ROW(OID.auction, 'payment_pending', { paymentState: 'pending', source: 'auction', acceptanceDeadline: '2026-10-16T11:42:00.000Z' })];
    const h = await page();
    expect(h).toContain(`data-kv-deadline="${OID.pending}"`);
    expect(h).not.toContain(`data-kv-deadline="${OID.auction}"`);
    expect((h.match(/data-kv-awaiting="payment"/g) ?? []).length).toBe(2);
  });
  it('keyset Next only (the cursor carried, the tab kept)', async () => {
    C.list.active = [ROW(OID.cod, 'packed')]; C.next = 'abc';
    expect(await page({ group: 'active' })).toContain(`href="/${SLUG}/orders?group=active&amp;cursor=abc"`);
  });
});

describe('STORE-3a · W288 the states', () => {
  it('a load error is NOT an empty list: said, with a Retry that reloads (W3058–W3060 DECOR); the refusals still printed', async () => {
    C.list.all = new Error('down') as unknown as never[];
    const h = await page();
    expect(h).toContain('data-kv-state="error"');
    expect(h).not.toContain('data-kv-state="empty"');
    expect(h).toContain(`href="/${SLUG}/orders" class="kv-btn" data-kv-retry="reload"`);
    expect(text(h)).toContain(en['store3a.list.error']);
  });
  it('an empty list says so, with "Browse this store" → the store; the refused claims by name', async () => {
    const h = await page();
    expect(h).toContain('data-kv-state="empty"');
    expect(h).toContain(`data-kv-cta="browse" href="/${SLUG}"`);
    for (const k of store3aRefusalKeys('orders')) expect(text(h)).toContain(en[k]);
  });
});

describe('STORE-3a · the platform /orders is a door (founder D3)', () => {
  it('→ /<slug>/orders, carrying the tab and the cursor', async () => {
    await expect(PlatformOrdersDoor({ searchParams: { group: 'attention', cursor: 'c1' } })).rejects.toThrow(`REDIRECT /${SLUG}/orders?group=attention&cursor=c1`);
  });
  it('the session\'s store unreadable → said, with a Retry (a reload of the door)', async () => {
    C.doorFails = true;
    const h = renderToStaticMarkup(await PlatformOrdersDoor({ searchParams: {} }));
    expect(h).toContain('data-kv-state="error"');
    expect(h).toContain('href="/orders" class="kv-btn" data-kv-retry="reload"');
  });
});
