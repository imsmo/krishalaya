// apps/web-storefront/src/test-render/pay-confirm.render.test.tsx · PC-56 HOTFIX-4 · C6 — the pay step and the confirmation, rendered to the
// markup a buyer receives, state by state (survey F-1, F-5, F-6; founder D2/D3/D4):
//   • none (online payments OFF): "placed — the seller confirms; you pay on delivery", NO Pay link, and /checkout/pay sends it to the
//     confirmation (never a Pay button for a `created` order);
//   • pending: "awaiting your payment" + its own Pay link; the pay page shows the Pay button only while the store's switch is ON;
//   • paid: "Paid … held until the order is completed" (true in code: capture → escrow, released at completion), no Pay link;
//   • cancelled / expired: named;
//   • a checkout GROUP: every order listed, each with its own state and (when pending) its own Pay link;
//   • the bill: platform fee and buyer commission rows present when > 0, absent when 0; the rows sum to the total;
//   • the seller is the ORGANISATION — no person's name anywhere; the §E refusals printed by name.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type Order = Record<string, unknown>;
const mock: { orders: Record<string, Order>; group: { orders: { id: string }[] } | null; flags: Record<string, boolean>; org: string | null } =
  { orders: {}, group: null, flags: {}, org: 'Anand FPO' };

jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', featureAuctions: false, siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
jest.mock('../lib/i18n', () => {
  const { Translator: T } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  return { getLang: () => 'en', getTranslator: () => new T('en').register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ requireSession: async () => 'tok', resolveSessionToken: async () => 'tok' }));
jest.mock('../lib/api-client', () => ({
  serverClient: () => ({
    orders: {
      get: async (id: string) => { const o = mock.orders[id]; if (!o) throw Object.assign(new Error('nf'), { isNotFound: true }); return o; },
      checkoutGroup: async () => mock.group,
    },
  }),
  sessionTenantClient: () => ({
    storefront: { profile: async () => ({ displayName: mock.org }), flags: async () => mock.flags },
  }),
}));

import ConfirmPage from '../app/(platform)/checkout/confirm/page';
import PayPage from '../app/(platform)/checkout/pay/page';
import { en } from '../i18n/en';
import { text } from './store1b-harness';

const order = (id: string, paymentState: string, over: Order = {}): Order => ({
  id, orderNo: `KV2026-${id.toUpperCase()}`, status: paymentState === 'paid' ? 'confirmed' : paymentState === 'pending' ? 'payment_pending' : 'created', paymentState,
  source: 'direct', buyerUserId: 'buyer-uuid', sellerUserId: 'farmer-uuid', currencyCode: 'INR', checkoutGroupId: null,
  subtotalMinor: '1845000', deliveryFeeMinor: '7500', discountMinor: '0', taxMinor: '0', commissionMinor: '0',
  platformFeeMinor: '46125', buyerCommissionMinor: '43542', totalMinor: '1942167',
  items: [{ listing_id: `l-${id}`, title_snapshot: 'Bold groundnut', quantity: 3, unit_code: 'quintal', line_total_minor: '1845000' }], ...over,
});
const confirm = async (sp: Record<string, string>) => renderToStaticMarkup(await ConfirmPage({ searchParams: sp }));
const pay = async (sp: Record<string, string>) => renderToStaticMarkup(await PayPage({ searchParams: sp }));

beforeEach(() => { mock.orders = {}; mock.group = null; mock.flags = { online_payments: true }; mock.org = 'Anand FPO'; });

describe('HOTFIX-4 · /checkout/confirm', () => {
  it('none (online payments OFF): placed — the seller confirms, pay on delivery — and NO Pay link', async () => {
    mock.orders.o1 = order('o1', 'none', { platformFeeMinor: '0', buyerCommissionMinor: '0', totalMinor: '1852500' });
    const html = await confirm({ o: 'o1' });
    expect(text(html)).toContain(en['checkout.state.none']);
    expect(html).not.toContain('data-kv-pay=');
    expect(html).not.toContain('/checkout/pay');
    expect(html).toContain('data-kv-payment-state="none"');
  });
  it('pending: "awaiting your payment" + its own Pay link', async () => {
    mock.orders.o1 = order('o1', 'pending');
    const html = await confirm({ o: 'o1' });
    expect(text(html)).toContain(en['checkout.state.pending']);
    expect(html).toContain('href="/checkout/pay?o=o1"');
  });
  it('paid: says paid and that the money is held until the order is completed; no Pay link (the F-1 bug: it said "still being confirmed")', async () => {
    mock.orders.o1 = order('o1', 'paid');
    const html = await confirm({ o: 'o1' });
    expect(text(html)).toContain(en['checkout.state.paid']);
    expect(html).not.toContain('data-kv-pay=');
    expect(text(html)).not.toMatch(/still being confirmed/i);
  });
  it('cancelled and expired are named', async () => {
    mock.orders.o1 = order('o1', 'cancelled'); mock.orders.o2 = order('o2', 'expired');
    expect(text(await confirm({ o: 'o1' }))).toContain(en['checkout.state.cancelled']);
    expect(text(await confirm({ o: 'o2' }))).toContain(en['checkout.state.expired']);
  });
  it('a checkout GROUP: every order listed with its own state; Pay links only for the pending ones (A9 — none orphaned)', async () => {
    mock.group = { orders: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }] };
    mock.orders.o1 = order('o1', 'pending'); mock.orders.o2 = order('o2', 'paid'); mock.orders.o3 = order('o3', 'pending');
    const html = await confirm({ g: 'g1' });
    expect(html).toContain('data-kv-orders="3"');
    for (const id of ['o1', 'o2', 'o3']) expect(html).toContain(`data-kv-order="${id}"`);
    expect(text(html)).toContain('Order 1 of 3 · KV2026-O1');
    expect(text(html)).toContain('Order 3 of 3 · KV2026-O3');
    expect(html).toContain('href="/checkout/pay?o=o1&amp;g=g1"');
    expect(html).toContain('href="/checkout/pay?o=o3&amp;g=g1"');
    expect(html).not.toContain('href="/checkout/pay?o=o2');
  });
  it('fee rows: platform fee and buyer commission present when > 0, absent when 0; the bill sums', async () => {
    mock.orders.o1 = order('o1', 'pending');
    let html = await confirm({ o: 'o1' });
    expect(html).toContain('data-kv-row="platformFee"');
    expect(html).toContain('data-kv-row="buyerCommission"');
    expect(html).toContain('data-kv-bill="sums"');
    expect(text(html)).toContain(en['bill.buyerCommission']);
    mock.orders.o1 = order('o1', 'none', { platformFeeMinor: '0', buyerCommissionMinor: '0', totalMinor: '1852500' });
    html = await confirm({ o: 'o1' });
    expect(html).not.toContain('data-kv-row="platformFee"');
    expect(html).not.toContain('data-kv-row="buyerCommission"');
    expect(html).not.toContain('data-kv-row="tax"');
    expect(html).toContain('data-kv-bill="sums"');
  });
  it('the seller is the ORGANISATION; no person and no person-id in the markup; the §E refusals printed by name', async () => {
    mock.orders.o1 = order('o1', 'pending');
    const html = await confirm({ o: 'o1' });
    expect(text(html)).toContain('Sold by Anand FPO');
    expect(html).not.toMatch(/farmer-uuid|buyer-uuid|Ramesh/);
    for (const k of ['store2.refusal.autoRefund', 'store2.refusal.codCap', 'store2.refusal.onePayment']) expect(text(html)).toContain(en[k]);
    expect(html).not.toMatch(/20,000/);
  });
  it('no organisation readable → no seller line (never a guess)', async () => {
    mock.org = null; mock.orders.o1 = order('o1', 'none');
    expect(await confirm({ o: 'o1' })).not.toContain('data-kv-seller');
  });
});

describe('HOTFIX-4 · /checkout/pay', () => {
  it('a `none` order (online payments OFF at placement) is sent to the confirmation — never a Pay button', async () => {
    mock.orders.o1 = order('o1', 'none');
    await expect(PayPage({ searchParams: { o: 'o1' } })).rejects.toThrow('REDIRECT /checkout/confirm?o=o1');
  });
  it('a paid order goes to its confirmation, keeping its group', async () => {
    mock.orders.o1 = order('o1', 'paid');
    await expect(PayPage({ searchParams: { o: 'o1', g: 'g1' } })).rejects.toThrow('REDIRECT /checkout/confirm?g=g1');
  });
  it('pending + the store\'s switch ON → the Pay button and the amount in the order\'s currency', async () => {
    mock.orders.o1 = order('o1', 'pending');
    const html = await pay({ o: 'o1' });
    expect(html).toContain(`>${en['checkout.payNow']}</button>`);
    expect(text(html)).toMatch(/19,421\.67/);
  });
  it('pending + the switch OFF → no Pay button; said plainly (the route would 404)', async () => {
    mock.orders.o1 = order('o1', 'pending'); mock.flags = { online_payments: false };
    const html = await pay({ o: 'o1' });
    expect(html).toContain('data-kv-pay="off"');
    expect(html).not.toContain(`>${en['checkout.payNow']}</button>`);
  });
});
