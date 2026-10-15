// apps/web-storefront/src/test-render/order-cancel.render.test.tsx · PC-56 STORE-3a · C3 — canon W291 and the cancel chain W3083 / W3084 / W3085:
//   • the rules as the code has them (free through ready, closed after pickup, a paid order refunded to source, nothing paid → nothing back);
//   • THE CONFIRM: the order, what comes back (the captured amount "back to your source" vs "nothing was paid — nothing to refund"), THE AUCTION
//     WARNING both ways (unpaid: forfeited; paid: returned), the seven reasons (labelled by code), the note for `other`, the key minted at
//     render, the pending lock, "Keep the order";
//   • every named failure (moved forward + the dispute door, not a party, reason / note refusals with the values kept, concurrency → the SAME
//     key, anything else); success → the order page `?ok=cancelled`;
//   • not cancellable (picked up or later) → said, with the way to raise a problem; the refusals (the fee ladder, bank days, "notified").
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

import TenantCancelPage from '../app/[tenantSlug]/orders/[id]/cancel/page';
import { cancelOrderAction } from '../app/[tenantSlug]/orders/[id]/cancel/actions';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { text } from './store1b-harness';
import { C, reset, DETAIL, SLUG, OID, REASONS, reasonId } from './store3a-fixtures';
import { store3aRefusalKeys } from '../features/store3a/refusals';
import { CANCEL_DRAFT_COOKIE } from '../features/store3a/cancel-draft';

const page = async (id: string, sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantCancelPage({ params: { tenantSlug: SLUG, id }, searchParams: sp }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const KEY = `cancel:${OID.cod}:0210aaaa-0000-7000-8000-000000000002`;
beforeEach(() => { reset(); C.orders[OID.cod] = DETAIL(OID.cod, { status: 'confirmed', paymentState: 'none' }); });

describe('STORE-3a · W291 the rules and W3083 the confirm', () => {
  it('the rules as the code has them; the order named; nothing was paid → nothing to refund; the refusals by name', async () => {
    const h = await page(OID.cod);
    const tx = text(h);
    for (const k of ['store3a.cancel.rule.free', 'store3a.cancel.rule.closed', 'store3a.cancel.rule.paid', 'store3a.cancel.rule.unpaid']) expect(tx).toContain(en[k]);
    expect(h).toContain(`data-kv-the-order="${OID.cod}"`);
    expect(tx).toContain('KV2026-0001');
    expect(tx).toContain('Anand FPO');
    expect(h).toContain('data-kv-back="nothing_paid"');
    expect(tx).toContain(en['store3a.cancel.back.nothing']);
    for (const k of store3aRefusalKeys('cancel')) expect(tx).toContain(en[k]);
    expect(h).not.toContain('data-kv-auction-warning=');
  });
  it('a PAID order: the captured amount back to the source (the payment read\'s figure, the data\'s currency)', async () => {
    C.orders[OID.paid] = DETAIL(OID.paid, { status: 'packed', paymentState: 'paid', currencyCode: 'USD' });
    C.attempts[OID.paid] = { latest: { status: 'success', amountMinor: '120050', currencyCode: 'USD' }, attempts: 1, nextAttempt: 2, liveAttempt: false, ttlSeconds: 900 };
    const h = await page(OID.paid);
    expect(h).toContain('data-kv-back="back_to_source"');
    expect(text(h)).toMatch(/\$\s?1,200\.50|US\$/);
    expect(text(h)).not.toContain(en['store3a.cancel.back.nothing']);
  });
  it('THE AUCTION WARNING: unpaid → the deposit is forfeited to the organisation; paid → the deposit and the payment are returned', async () => {
    C.orders[OID.auction] = DETAIL(OID.auction, { status: 'payment_pending', paymentState: 'pending', source: 'auction' });
    const unpaid = await page(OID.auction);
    expect(unpaid).toContain('data-kv-auction-warning="forfeit"');
    expect(text(unpaid)).toContain(en['store3a.cancel.auction.forfeit']);
    C.orders[OID.auction] = DETAIL(OID.auction, { status: 'confirmed', paymentState: 'paid', source: 'auction' });
    const paid = await page(OID.auction);
    expect(paid).toContain('data-kv-auction-warning="returned"');
    expect(text(paid)).toContain(en['store3a.cancel.auction.returned']);
  });
  it('the seven reasons from the store\'s vocabulary, labelled by code (en / hi); the note field for `other`; a key minted at render', async () => {
    const h = await page(OID.cod);
    for (const r of REASONS) expect(h).toContain(`data-kv-reason="${r.code}"`);
    expect((h.match(/name="reasonId"/g) ?? []).length).toBe(7);
    expect(text(h)).toContain(en['order.cancelReason.quantity_or_grade_doubt']);
    expect(h).toMatch(/data-kv-reason="other"[^]*?\(say why below\)/);
    expect(h).toContain('data-kv-note="other"');
    expect(h).toMatch(new RegExp(`name="key" value="cancel:${OID.cod}:[0-9a-f-]{36}"`));
    C.lang = 'hi';
    expect(text(await page(OID.cod))).toContain(hi['order.cancelReason.changed_mind']);
  });
  it('a reason this storefront has no label for prints the vocabulary\'s own name (an organisation\'s own value)', async () => {
    C.reasons = [...REASONS, { id: '0210c000-0000-7000-8000-0000000000aa', code: 'lot_resold_offline', name: 'Bought the lot offline', sortOrder: 8, meta: {} }];
    expect(text(await page(OID.cod))).toContain('Bought the lot offline');
  });
  it('the pending lock: while the act is in flight the button is disabled and says so', async () => {
    C.pending = true;
    const h = await page(OID.cod);
    expect(h).toMatch(/<button type="submit" class="kv-btn" disabled="" aria-busy="true">Cancelling…<\/button>/);
  });
  it('the vocabulary unreadable → no form (a cancel without a reason would be refused) — said, with a Retry', async () => {
    C.reasons = new Error('down');
    const h = await page(OID.cod);
    expect(h).toContain('data-kv-state="reasons-unavailable"');
    expect(h).not.toContain('data-kv-form="cancel"');
  });
});

describe('STORE-3a · W3084 success / W3085 failure (the act)', () => {
  it('success: the reason (and the note for `other`) under the page\'s key → the order page ?ok=cancelled', async () => {
    await expect(cancelOrderAction(form({ slug: SLUG, id: OID.cod, key: KEY, reasonId: reasonId('changed_mind') }))).rejects.toThrow(`REDIRECT /${SLUG}/orders/${OID.cod}?ok=cancelled`);
    expect(C.calls).toContainEqual(['orders.cancel', OID.cod, KEY, reasonId('changed_mind'), undefined]);
    await expect(cancelOrderAction(form({ slug: SLUG, id: OID.cod, key: KEY, reasonId: reasonId('other'), note: ' bought locally ' }))).rejects.toThrow('ok=cancelled');
    expect(C.calls).toContainEqual(['orders.cancel', OID.cod, KEY, reasonId('other'), 'bought locally']);
  });
  it('no reason / `other` without a note → refused before the API, the key and the reason kept, the note kept in the cookie (never the URL)', async () => {
    await expect(cancelOrderAction(form({ slug: SLUG, id: OID.cod, key: KEY }))).rejects.toThrow(`REDIRECT /${SLUG}/orders/${OID.cod}/cancel?error=reason_required&k=${encodeURIComponent(KEY)}`);
    await expect(cancelOrderAction(form({ slug: SLUG, id: OID.cod, key: KEY, reasonId: reasonId('other'), note: '' }))).rejects.toThrow(`?error=note_required&k=${encodeURIComponent(KEY)}&r=${reasonId('other')}`);
    expect(C.calls.filter((c) => c[0] === 'orders.cancel')).toHaveLength(0);
    C.cookies.clear();
    await expect(cancelOrderAction(form({ slug: SLUG, id: OID.cod, key: KEY, reasonId: reasonId('other'), note: 'x'.repeat(300) }))).rejects.toThrow('error=note_too_long');
    expect(C.cookies.has(CANCEL_DRAFT_COOKIE)).toBe(true);
    const h = await page(OID.cod, { error: 'note_too_long', k: KEY, r: reasonId('other') });
    expect(h).toContain(`name="key" value="${KEY}"`);
    expect(h).toContain(`checked="" value="${reasonId('other')}"`);
    expect(h).toContain('x'.repeat(280));
  });
  it.each([
    ['ORDER_ILLEGAL_TRANSITION', 409, 'moved'], ['ORDER_FORBIDDEN', 403, 'forbidden'], ['CANCEL_REASON_UNKNOWN', 422, 'reason_unknown'],
    ['CANCEL_NOTE_REQUIRED', 422, 'note_required'], ['ORDER_CONCURRENCY_CONFLICT', 409, 'concurrency'], ['BOOM', 500, 'failed'],
  ])('the API refuses %s (%i) → its named failure', async (code, status, outcome) => {
    C.fail['orders.cancel'] = { code, status };
    await expect(cancelOrderAction(form({ slug: SLUG, id: OID.cod, key: KEY, reasonId: reasonId('changed_mind') }))).rejects.toThrow(`?error=${outcome}&k=`);
    const h = await page(OID.cod, { error: String(outcome), k: KEY, r: reasonId('changed_mind') });
    expect(h).toContain(`data-kv-failure="${outcome}"`);
    expect(text(h)).toContain(en[`store3a.cancel.err.${outcome}`]);
    expect(h).toContain(`name="key" value="${KEY}"`);   // Retry is the SAME request
    if (outcome === 'moved') expect(h).toContain(`data-kv-dispute-door="problem" href="/${SLUG}/orders/${OID.cod}#problem"`);
  });
});

describe('STORE-3a · W291 not cancellable', () => {
  it('picked up → "it can no longer be cancelled", the way to raise a problem, no form; the rules and refusals still said', async () => {
    C.orders[OID.late] = DETAIL(OID.late, { status: 'picked_up', paymentState: 'paid' });
    const h = await page(OID.late);
    expect(h).toContain('data-kv-state="not-cancellable"');
    expect(h).not.toContain('data-kv-form="cancel"');
    expect(text(h)).toContain(`This order is ${en['order.status.picked_up']}`);
    expect(h).toContain('data-kv-dispute-door="problem"');
    expect(text(h)).toContain(en['store3a.refusal.feeLadder']);
  });
});
