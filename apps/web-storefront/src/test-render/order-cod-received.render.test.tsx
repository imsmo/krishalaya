// apps/web-storefront/src/test-render/order-cod-received.render.test.tsx · PC-56 STORE-5a · C5 (founder D1, HOTFIX-7 Q1) — THE COD "I RECEIVED IT"
// BUTTON OPENS. The API has let the buyer complete a pay-on-delivery order since HOTFIX-7 (settlement fails closed: nothing is released —
// `order.settlement_skipped`); the page now offers the act for EVERY delivered order:
//   • a pay-on-delivery order: the act, its inline confirm with the CASH sentence ("you paid in cash; nothing is released — this closes the
//     order") and a key minted at render; never the escrow sentence; the old "the organisation completes it" line is gone;
//   • an escrow-funded order: the escrow sentence ("this releases the payment to the organisation") and the quality-window line;
//   • the act completes under the page's key (the same request on a double tap) → `?ok=received`;
//   • the money buttons (the confirm's Yes, the Pay link) carry `kv-btn--money` (56px in every mode — D4).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => jest.requireActual('./store5a-fixtures').cookieJar() }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: jest.requireActual('./store5a-fixtures').C.pending === true }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store5a-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ getSessionTenant: () => 't' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store5a-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import TenantOrderPage from '../app/[tenantSlug]/orders/[id]/page';
import { completeOrderAction } from '../app/[tenantSlug]/orders/[id]/actions';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text } from './store1b-harness';
import { C, reset, SLUG, OID, ORDER } from './store5a-fixtures';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantOrderPage({ params: { tenantSlug: SLUG, id: OID }, searchParams: sp }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
beforeEach(() => { reset(); });

describe('STORE-5a · D1 the COD "I received it" button opens', () => {
  it('a delivered PAY-ON-DELIVERY order: the act; its confirm says CASH — nothing is released, this closes the order — never the escrow sentence', async () => {
    C.order = ORDER({ status: 'delivered', paymentState: 'none', qualityWindowEnds: '2026-10-16T12:00:00.000Z' });
    const start = await page();
    expect(start).toContain('data-kv-act="received"');
    expect(start).toContain(`data-kv-received="start" href="/${SLUG}/orders/${OID}?confirm=received"`);
    expect(start).not.toContain('data-kv-window="quality"');   // the quality-window promise is the escrow's — not printed for cash
    const h = await page({ confirm: 'received' });
    expect(h).toContain('data-kv-confirm="received" data-kv-funding="cash"');
    expect(text(h)).toContain(en['store3a.received.confirmCod']);
    expect(text(h)).not.toContain(en['store3a.received.confirm']);
    expect(h).toMatch(new RegExp(`name="key" value="complete:${OID}:[0-9a-f-]{36}"`));
    expect(h).toMatch(/<button type="submit" class="kv-btn kv-btn--money">Yes, I received it<\/button>/);
    expect(text(h)).not.toMatch(/organisation completes it/);
  });
  it('an ESCROW-funded delivered order: the escrow sentence and the quality-window line', async () => {
    C.order = ORDER({ status: 'delivered', paymentState: 'paid', qualityWindowEnds: '2026-10-16T12:00:00.000Z' });
    const h = await page({ confirm: 'received' });
    expect(h).toContain('data-kv-confirm="received" data-kv-funding="escrow"');
    expect(text(h)).toContain(en['store3a.received.confirm']);
    expect(text(h)).not.toContain(en['store3a.received.confirmCod']);
    expect(h).toContain('data-kv-window="quality"');
  });
  it('the act completes a COD order under the page\'s key → ?ok=received (the API settles nothing for it — HOTFIX-7)', async () => {
    C.order = ORDER({ status: 'delivered', paymentState: 'none' });
    const k = `complete:${OID}:0218aaaa-0000-4000-8000-000000000001`;
    await expect(completeOrderAction(form({ slug: SLUG, id: OID, key: k }))).rejects.toThrow(`REDIRECT /${SLUG}/orders/${OID}?ok=received`);
    expect(C.calls).toContainEqual(['orders.complete', OID, k]);
  });
  it('the cash sentence says no money is released, in every language (and the removed line is gone from every catalogue)', () => {
    expect(en['store3a.received.confirmCod']).toMatch(/nothing is released/);
    for (const cat of [en, hi, gu] as Array<Record<string, string>>) {
      expect('store3a.received.codLine' in cat).toBe(false);
      expect(cat['store3a.received.confirmCod']).not.toBe(cat['store3a.received.confirm']);
    }
  });
  it('the Pay link of an order awaiting payment is a money action too (56px)', async () => {
    C.order = ORDER({ status: 'payment_pending', paymentState: 'pending' });
    expect(await page()).toMatch(/class="kv-btn kv-btn--money" data-kv-pay="/);
  });
});
