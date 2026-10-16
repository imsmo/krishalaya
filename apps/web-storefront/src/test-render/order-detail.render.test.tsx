// apps/web-storefront/src/test-render/order-detail.render.test.tsx · PC-56 STORE-3a · C2 — canon W289 "Order" under the organisation:
//   • the Pay link ONLY for an order awaiting payment that is not an auction order (an auction balance → the refusal by name);
//   • "Deposit applied · Balance due" ONLY when the API says a deposit was applied — the server's figures;
//   • "Where it stands": every hop with its time and its ROLE ("by the organisation", "by you", "by the system") — never a name or an id;
//   • "I received it" ONLY for a delivered order paid into escrow — with its inline confirm and a key minted at render; a COD delivered order
//     prints the honest line instead; the act's outcomes named (escrow refused / moved / failed);
//   • the returns form is gone; the dispute form only with the store's `disputes` flag (else "not available in this store");
//   • a cancelled order says who ended it (the system: the organisation did not confirm in time) and what happened to the money;
//   • a stranger → notFound; a load error → Retry + Back; the platform /orders/[id] is a door.
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

import TenantOrderPage from '../app/[tenantSlug]/orders/[id]/page';
import { completeOrderAction } from '../app/[tenantSlug]/orders/[id]/actions';
import PlatformOrderDoor from '../app/(platform)/orders/[id]/page';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, DETAIL, SLUG, SELLER_UUID, OID } from './store3a-fixtures';
import { store3aRefusalKeys } from '../features/store3a/refusals';

const page = async (id: string, sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantOrderPage({ params: { tenantSlug: SLUG, id }, searchParams: sp }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
beforeEach(() => { reset(); });

describe('STORE-3a · W289 the money', () => {
  it('awaiting payment (a direct order) → the Pay link to THIS store\'s pay step; the escrow sentence', async () => {
    C.orders[OID.pending] = DETAIL(OID.pending, { status: 'payment_pending', paymentState: 'pending' });
    const h = await page(OID.pending);
    expect(h).toContain(`data-kv-pay="${OID.pending}" href="/${SLUG}/checkout/pay?o=${OID.pending}"`);
    expect(text(h)).toContain(en['store2c.escrow']);
  });
  it('an AUCTION order awaiting its balance: the Pay link to THIS store\'s pay step (STORE-3c, founder D2 — it charges the due); the deposit and balance rows from the API', async () => {
    C.orders[OID.auction] = DETAIL(OID.auction, { status: 'payment_pending', paymentState: 'pending', source: 'auction', totalMinor: '13100000', amountDueMinor: '12100000', depositAppliedMinor: '1000000' });
    const h = await page(OID.auction);
    expect(h).toContain(`data-kv-pay="${OID.auction}" href="/${SLUG}/checkout/pay?o=${OID.auction}"`);
    expect(h).not.toContain('data-kv-refused="pay_balance"');
    expect(h).toContain('data-kv-deposit="applied"');
    expect(text(h)).toMatch(/Deposit applied −\s?₹10,000\.00/);
    expect(text(h)).toMatch(/Balance due ₹1,21,000\.00/);
  });
  it('no deposit → no deposit rows; a paid order → "you paid <amount>" from the payment read; COD → pay on delivery', async () => {
    C.orders[OID.paid] = DETAIL(OID.paid, { paymentState: 'paid' });
    C.attempts[OID.paid] = { latest: { status: 'success', amountMinor: '6172875', currencyCode: 'INR' }, attempts: 1, nextAttempt: 2, liveAttempt: false, ttlSeconds: 900 };
    const h = await page(OID.paid);
    expect(h).not.toContain('data-kv-deposit=');
    expect(h).not.toContain('data-kv-pay=');
    expect(text(h)).toContain('You paid ₹61,728.75');
    C.orders[OID.cod] = DETAIL(OID.cod, { status: 'created' });
    expect(await page(OID.cod)).toContain('data-kv-pay="on-delivery"');
  });
});

describe('STORE-3a · W289 where it stands (roles and times, never a person)', () => {
  it('each hop with its role and time; no name, no uuid', async () => {
    C.orders[OID.cod] = DETAIL(OID.cod, { status: 'confirmed' });
    C.events[OID.cod] = [{ fromStatus: 'created', toStatus: 'confirmed', actorRole: 'seller', at: '2026-10-15T12:10:00.000Z' }, { fromStatus: null, toStatus: 'created', actorRole: 'buyer', at: '2026-10-15T11:42:00.000Z' }];
    const h = await page(OID.cod);
    expect(h).toContain('data-kv-hops="2"');
    expect(h).toMatch(/data-kv-hop="created" data-kv-actor="buyer".*data-kv-hop="confirmed" data-kv-actor="seller"/s);
    expect(text(h)).toContain(`${en['order.status.confirmed']} · ${en['store3a.actor.seller']}`);
    expect(h).toContain('dateTime="2026-10-15T12:10:00.000Z"');
    expect(h).not.toContain(SELLER_UUID);
    expect(text(h)).not.toMatch(/Ramesh/);
  });
});

describe('STORE-3a · W289 "I received it" (lead\'s D6 — fail-closed)', () => {
  it('a delivered order PAID into escrow: the act, the quality window from the API; the inline confirm with a minted key', async () => {
    C.orders[OID.paid] = DETAIL(OID.paid, { status: 'delivered', paymentState: 'paid', qualityWindowEnds: '2026-10-16T12:00:00.000Z' });
    const h = await page(OID.paid);
    expect(h).toContain('data-kv-act="received"');
    expect(h).toContain('data-kv-window="quality"');
    expect(h).toContain(`data-kv-received="start" href="/${SLUG}/orders/${OID.paid}?confirm=received"`);
    expect(h).not.toContain('data-kv-confirm="received"');
    const c = await page(OID.paid, { confirm: 'received' });
    expect(c).toContain('data-kv-confirm="received"');
    expect(text(c)).toContain(en['store3a.received.confirm']);
    expect(c).toMatch(new RegExp(`name="key" value="complete:${OID.paid}:[0-9a-f-]{36}"`));
  });
  it('a delivered PAY-ON-DELIVERY order: NO act — the honest line (the organisation completes it); no quality-window promise', async () => {
    C.orders[OID.cod] = DETAIL(OID.cod, { status: 'delivered', paymentState: 'none', qualityWindowEnds: '2026-10-16T12:00:00.000Z' });
    const h = await page(OID.cod, { confirm: 'received' });
    expect(h).not.toContain('data-kv-act="received"');
    expect(h).not.toContain('data-kv-confirm="received"');
    expect(h).not.toContain('data-kv-window="quality"');
    expect(h).toContain('data-kv-cod-delivered="organisation"');
  });
  it('the action: complete under the page\'s key → ?ok=received; a refused unfunded escrow → named', async () => {
    const k = `complete:${OID.paid}:0210aaaa-0000-7000-8000-000000000001`;
    await expect(completeOrderAction(form({ slug: SLUG, id: OID.paid, key: k }))).rejects.toThrow(`REDIRECT /${SLUG}/orders/${OID.paid}?ok=received`);
    expect(C.calls).toContainEqual(['orders.complete', OID.paid, k]);
    C.fail['orders.complete'] = { code: 'ORDER_COMPLETE_REQUIRES_ESCROW' };
    await expect(completeOrderAction(form({ slug: SLUG, id: OID.cod, key: k }))).rejects.toThrow(`REDIRECT /${SLUG}/orders/${OID.cod}?received=escrow`);
    C.orders[OID.cod] = DETAIL(OID.cod, { status: 'delivered', paymentState: 'none' });
    expect(text(await page(OID.cod, { received: 'escrow' }))).toContain(en['store3a.received.err.escrow']);
  });
});

describe('STORE-3a · W289 cancel, dispute, returns', () => {
  it('cancellable through ready → "Need to cancel?"; picked up → no cancel door; the returns form is gone', async () => {
    C.orders[OID.cod] = DETAIL(OID.cod, { status: 'ready' });
    const h = await page(OID.cod);
    expect(h).toContain(`data-kv-cancel-door="${OID.cod}" href="/${SLUG}/orders/${OID.cod}/cancel"`);
    expect(h).not.toMatch(/returnTitle|Request return|name="reasonCode".*Return/);
    expect(text(h)).not.toContain(en['order.returnTitle']);
    C.orders[OID.late] = DETAIL(OID.late, { status: 'picked_up' });
    expect(await page(OID.late)).not.toContain('data-kv-cancel-door=');
  });
  it('the dispute door: flag OFF → "not available in this store" (no form); ON → the form', async () => {
    C.orders[OID.cod] = DETAIL(OID.cod, { status: 'delivered' });
    const off = await page(OID.cod);
    expect(off).toContain('data-kv-dispute="off"');
    expect(off).not.toContain('name="reasonCode"');
    expect(text(off)).toContain(en['store3a.dispute.off']);
    C.flags.disputes = true;
    const on = await page(OID.cod);
    expect(on).toContain('data-kv-dispute="on"');
    expect(on).toContain('name="reasonCode"');
  });
  it('cancelled by the system: "the organisation did not confirm in time"; nothing was paid; the reason by its label', async () => {
    C.orders[OID.cancelled] = DETAIL(OID.cancelled, { status: 'cancelled', paymentState: 'cancelled', cancelReasonCode: 'changed_mind' });
    C.events[OID.cancelled] = [{ toStatus: 'created', actorRole: 'buyer', at: '2026-10-15T11:42:00.000Z' }, { toStatus: 'cancelled', actorRole: 'system', at: '2026-10-16T11:45:00.000Z' }];
    const h = await page(OID.cancelled, { ok: 'cancelled' });
    expect(h).toContain('data-kv-cancelled="system"');
    expect(text(h)).toContain(en['store3a.cancelledBy.system']);
    expect(h).toContain('data-kv-refund="nothing_paid"');
    expect(text(h)).toContain(`Reason: ${en['order.cancelReason.changed_mind']}`);
    expect(text(h)).toContain(en['store3a.ok.cancelled']);
  });
  it('a paid order cancelled by you: refunded with the amount and the provider\'s reference; while pending: "awaiting the provider"', async () => {
    C.orders[OID.cancelled] = DETAIL(OID.cancelled, { status: 'cancelled', paymentState: 'cancelled' });
    C.events[OID.cancelled] = [{ toStatus: 'cancelled', actorRole: 'buyer', at: '2026-10-16T11:45:00.000Z' }];
    C.attempts[OID.cancelled] = { latest: { status: 'refunded', amountMinor: '6172875', currencyCode: 'INR' }, attempts: 1, nextAttempt: 2, liveAttempt: false, ttlSeconds: 900,
      refund: { state: 'refunded', amountMinor: '6172875', currencyCode: 'INR', initiatedAt: '2026-10-16T11:45:01.000Z', completedAt: '2026-10-16T11:46:00.000Z', gatewayRefundId: 'rfnd_KV16904' } };
    const h = await page(OID.cancelled);
    expect(h).toContain('data-kv-cancelled="buyer"');
    expect(h).toContain('data-kv-refund="refunded"');
    expect(text(h)).toContain('₹61,728.75 was refunded to your source. Reference: rfnd_KV16904');
    C.attempts[OID.cancelled].refund = { state: 'initiated', amountMinor: '6172875', currencyCode: 'INR', initiatedAt: '2026-10-16T11:45:01.000Z', completedAt: null, gatewayRefundId: null };
    expect(await page(OID.cancelled)).toContain('data-kv-refund="refunding"');
  });
});

describe('STORE-3a · W289 states and the door', () => {
  it('a stranger\'s id → notFound; a load error → Retry (a reload) + Back to the list; the refusals by name; the trust mark', async () => {
    await expect(TenantOrderPage({ params: { tenantSlug: SLUG, id: OID.late }, searchParams: {} })).rejects.toThrow('NEXT_NOT_FOUND');
    C.orders[OID.cod] = new Error('down');
    const e = await page(OID.cod);
    expect(e).toContain('data-kv-state="error"');
    expect(e).toContain(`href="/${SLUG}/orders/${OID.cod}" class="kv-btn" data-kv-retry="reload"`);
    C.orders[OID.cod] = DETAIL(OID.cod);
    const h = await page(OID.cod);
    for (const k of store3aRefusalKeys('order')) expect(text(h)).toContain(en[k]);
    expect(h).toContain('data-kv-mark="platform"');
  });
  // PC-56 STORE-4b · C4 (founder D1): "Message the organisation about this order" replaces 3a's `get_help` refusal — only with `communication` ON
  it('STORE-4b · communication ON → "Message the organisation about this order" (the order\'s id, keyed at render); OFF → none; `get_help` is no longer refused', async () => {
    C.orders[OID.cod] = DETAIL(OID.cod);
    let h = await page(OID.cod);
    expect(h).not.toContain('data-kv-form="message-org"');
    expect(h).not.toContain('data-kv-refusal="get_help"');
    C.flags = { ...C.flags, communication: true };
    h = await page(OID.cod);
    expect(h).toContain('data-kv-form="message-org" data-kv-context="order"');
    expect(h).toContain(`name="contextId" value="${OID.cod}"`);
    expect(h).toMatch(/name="key" value="openorg:[0-9a-f-]{36}"/);
    expect(text(h)).toContain(en['store4b.entry.order']);
  });
  it('the platform /orders/[id] → /<slug>/orders/[id], carrying ok / error / status', async () => {
    await expect(PlatformOrderDoor({ params: { id: OID.cod }, searchParams: { status: 'reviewed' } })).rejects.toThrow(`REDIRECT /${SLUG}/orders/${OID.cod}?status=reviewed`);
  });
});

// PC-56 STORE-3b · C4 (founder D2): an order made from an accepted offer says where it came from and the regime it runs under; a direct order
// says neither.
describe('STORE-3b · C4 the order page of an OFFER order', () => {
  const OFFER_ID = '0211c000-0000-7000-8000-000000000004';
  it('"from your offer" links the thread under this store; the regime is printed; a direct order shows neither', async () => {
    C.orders[OID.cod] = DETAIL(OID.cod, { source: 'offer', offerId: OFFER_ID, deliveryFeeMinor: '0', platformFeeMinor: '0', totalMinor: '6150000' });
    let h = renderToStaticMarkup(await TenantOrderPage({ params: { tenantSlug: SLUG, id: OID.cod }, searchParams: {} }));
    expect(h).toContain(`data-kv-offer-link="${OFFER_ID}" href="/${SLUG}/offers/${OFFER_ID}"`);
    expect(h).toContain('data-kv-regime="offer"');
    expect(text(h)).toContain(en['store3b.regime']);
    C.orders[OID.cod] = DETAIL(OID.cod);
    h = renderToStaticMarkup(await TenantOrderPage({ params: { tenantSlug: SLUG, id: OID.cod }, searchParams: {} }));
    expect(h).not.toContain('data-kv-regime="offer"');
  });
});
