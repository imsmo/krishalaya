// apps/web-storefront/src/test-render/payment-processing.render.test.tsx · PC-56 STORE-2c · C5 — canon W286 and its "Send again" chain W3061–W3063, on
// the organisation's pay page (the platform's /checkout/pay is a door), plus the confirmation's money states:
//   • the REAL attempt states from the payment read: none → "Pay now" (attempt 1); live → "open until <time>" + continue the SAME attempt;
//     failed → the reason LOCALIZED BY CODE, "nothing was charged" only when the API says so, "Send again" = the NEXT attempt (W3062); expired →
//     "lapsed" + Send again; authorized → said; success → the confirmation;
//   • W3063: a live attempt refused by name with its time; "no longer awaiting payment" named;
//   • the sheet names the ORGANISATION and a localized "Order <order_no>" (D8) — never the platform, never a uuid;
//   • wallet pay (D6) when chosen and covered; refused by name when short; online payments OFF → the honest line, no Pay button;
//   • the confirmation: a paid order says the platform holds the money until completion, then releases it to the organisation; a cancelled paid
//     order says refunded to source (or requested at the gateway) from the payment read; every order of a group with its own Pay link.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }) }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: jest.requireActual('./store2c-fixtures').C.pending === true }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', featureAuctions: false, siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
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

import TenantPayPage from '../app/[tenantSlug]/checkout/pay/page';
import TenantConfirmPage from '../app/[tenantSlug]/checkout/confirm/page';
import { payFromWalletAction, createOrderAttemptAction } from '../app/[tenantSlug]/checkout/pay/actions';
import { PayButton } from '../components/PayButton';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, O, ORDER } from './store2c-fixtures';
import { store2cRefusalKeys } from '../features/store2/refusals';

type El = React.ReactElement<Record<string, unknown>>;
/** The PayButton element the page rendered (its props are what the sheet gets). */
function payButtonOf(node: React.ReactNode): El | null {
  let found: El | null = null;
  const walk = (n: React.ReactNode) => { if (found) return; if (Array.isArray(n)) { n.forEach(walk); return; } if (!React.isValidElement(n)) return;
    const e = n as El; if (e.type === PayButton) { found = e; return; } walk((e.props as { children?: React.ReactNode }).children); };
  walk(node);
  return found;
}
const pay = async (sp: Record<string, string> = {}) => TenantPayPage({ params: { tenantSlug: 'anand-fpo' }, searchParams: { o: O.a, ...sp } });
const html = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await pay(sp));
const confirm = async (sp: Record<string, string>) => renderToStaticMarkup(await TenantConfirmPage({ params: { tenantSlug: 'anand-fpo' }, searchParams: sp }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const attempt = (latest: Record<string, unknown> | null, n = latest ? 1 : 0) => ({ latest, attempts: n, nextAttempt: n + 1, liveAttempt: latest?.status === 'initiated', ttlSeconds: 900 });
beforeEach(() => { reset(); C.orders[O.a] = ORDER(O.a, 'pending'); });

describe('STORE-2c · W286 payment processing (the real attempt states)', () => {
  it('no attempt yet → "Pay now" for attempt 1; the sheet names the ORGANISATION and "Order <no>"; its timeout is the platform setting', async () => {
    const node = await pay();
    const b = payButtonOf(node)!;
    expect(b.props).toMatchObject({ slug: 'anand-fpo', orderId: O.a, attempt: 1, timeoutSec: 900 });
    expect((b.props.labels as Record<string, string>).sheetName).toBe('Anand FPO');
    expect((b.props.labels as Record<string, string>).sheetDescription).toBe(`Order KV2026-${O.a.slice(-4).toUpperCase()}`);
    expect(JSON.stringify(b.props.labels)).not.toMatch(/Krishalaya|0209e000/);
    const h = renderToStaticMarkup(node);
    expect(h).toContain(`>${en['checkout.payNow']}</button>`);
    expect(text(h)).toMatch(/Amount due ₹\s?61,728\.75/);
    expect(text(h)).toContain(en['store2c.pay.closeSafe']);
    expect(text(h)).toContain(en['store2c.pay.messageOnConfirm']);
  });
  it('a LIVE attempt → "open until <time>" and the SAME attempt continued (its key replays its gateway order)', async () => {
    C.attempts[O.a] = attempt({ id: 'p1', status: 'initiated', amountMinor: '6172875', currencyCode: 'INR', expiresAt: '2099-10-15T10:15:00.000Z', attempt: 1 });
    const node = await pay();
    expect(payButtonOf(node)!.props.attempt).toBe(1);
    const h = renderToStaticMarkup(node);
    expect(h).toContain('data-kv-processing="live"');
    expect(text(h)).toMatch(/A payment attempt is open until \d{2}:\d{2}/);
    expect(h).toContain(`>${en['store2c.pay.continue']}</button>`);
  });
  it('FAILED → the reason localized BY CODE; "nothing was charged" only when the API says so; Send again = the NEXT attempt (W3062)', async () => {
    C.attempts[O.a] = attempt({ id: 'p1', status: 'failed', failureCode: 'BAD_REQUEST_ERROR', failureReason: 'timed_out', chargedNothing: true, attempt: 1 });
    let node = await pay();
    expect(payButtonOf(node)!.props.attempt).toBe(2);
    let h = renderToStaticMarkup(node);
    expect(h).toContain('data-kv-failure="timed_out"');
    expect(text(h)).toContain(en['store2c.fail.timed_out']);
    expect(text(h)).toContain(en['store2c.pay.notCharged']);
    expect(h).toContain(`>${en['store2c.pay.sendAgain']}</button>`);
    expect(text(h)).toContain(en['store2c.pay.sendAgainNote']);
    C.attempts[O.a] = attempt({ id: 'p1', status: 'failed', failureReason: 'gateway_error', chargedNothing: false, attempt: 1 });
    node = await pay(); h = renderToStaticMarkup(node);
    expect(text(h)).toContain(en['store2c.fail.gateway_error']);
    expect(text(h)).toContain(en['store2c.pay.mayReverse']);
    expect(text(h)).not.toContain(en['store2c.pay.notCharged']);
  });
  it('EXPIRED (or a live attempt past its expiresAt) → "lapsed" + Send again with the next attempt', async () => {
    C.attempts[O.a] = attempt({ id: 'p1', status: 'initiated', expiresAt: '2000-01-01T00:00:00.000Z', attempt: 1 });
    const node = await pay();
    expect(renderToStaticMarkup(node)).toContain('data-kv-lapsed=""');
    expect(payButtonOf(node)!.props.attempt).toBe(2);
  });
  it('AUTHORIZED (cards) → said as the API has it, no second Pay; SUCCESS → the confirmation', async () => {
    C.attempts[O.a] = attempt({ id: 'p1', status: 'authorized', attempt: 1 });
    const node = await pay();
    expect(text(renderToStaticMarkup(node))).toContain(en['store2c.pay.authorized']);
    expect(payButtonOf(node)).toBeNull();
    C.attempts[O.a] = attempt({ id: 'p1', status: 'success', attempt: 1 });
    await expect(pay()).rejects.toThrow(`REDIRECT /anand-fpo/checkout/confirm?o=${O.a}`);
  });
  it('W3063: a second live attempt refused by name (with its time), "no longer awaiting payment" named — never a generic failure', async () => {
    C.fail.createOrderAttempt = { code: 'PAYMENT_ATTEMPT_LIVE', details: { paymentId: 'p1', expiresAt: '2099-10-15T10:15:00.000Z' } };
    expect(await createOrderAttemptAction('anand-fpo', O.a, 2)).toEqual({ ok: false, refusal: 'attempt_live', expiresAt: '2099-10-15T10:15:00.000Z' });
    C.orders[O.a] = ORDER(O.a, 'paid');
    expect(await createOrderAttemptAction('anand-fpo', O.a, 2)).toEqual({ ok: false, refusal: 'not_awaiting' });
    expect(text(await html({ status: 'attempt_live' }).catch(() => ''))).toBe('');   // a paid order never shows the pay page
  });
  it('the attempt is asked with the ORDER\'s own total and currency, under the attempt\'s key', async () => {
    expect(await createOrderAttemptAction('anand-fpo', O.a, 3)).toMatchObject({ ok: true, attempt: 3 });
    expect(C.calls.find((c) => c[0] === 'createOrderAttempt')![1]).toEqual({ orderId: O.a, attempt: 3, amountMinor: '6172875', currencyCode: 'INR' });
  });
  it('wallet pay (D6): chosen + covered → the wallet form; short → refused by name and the online Pay offered; the act pays under one key per order', async () => {
    let h = await html({ via: 'wallet' });
    expect(h).toContain('data-kv-form="wallet-pay"');
    expect(text(h)).toMatch(/Pay ₹\s?61,728\.75 from wallet/);
    C.wallet = { ...C.wallet, availableMinor: '100' };
    h = await html({ via: 'wallet' });
    expect(h).toContain('data-kv-wallet="short"');
    expect(h).toContain(`>${en['checkout.payNow']}</button>`);
    await expect(payFromWalletAction(form({ slug: 'anand-fpo', orderId: O.a }))).rejects.toThrow(`REDIRECT /anand-fpo/checkout/confirm?o=${O.a}`);
    expect(C.calls.find((c) => c[0] === 'payFromWallet')!.slice(1)).toEqual([O.a, `walletpay-ui:${O.a}`]);
    C.fail.payFromWallet = { code: 'WALLET_INSUFFICIENT_BALANCE', status: 422 };
    await expect(payFromWalletAction(form({ slug: 'anand-fpo', orderId: O.a }))).rejects.toThrow(`REDIRECT /anand-fpo/checkout/pay?o=${O.a}&via=wallet&status=wallet_short`);
  });
  it('online payments OFF → the honest line and no Pay button (the OFF regime never reaches pay from checkout)', async () => {
    C.flags = { ...C.flags, online_payments: false };
    const h = await html();
    expect(h).toContain('data-kv-pay="off"');
    expect(h).not.toContain(`>${en['checkout.payNow']}</button>`);
  });
  it('the W286 refusals by name; no helpline, no quote number, no "slots held"', async () => {
    const h = await html();
    for (const k of store2cRefusalKeys('processing')) expect([k, text(h).includes(en[k as keyof typeof en])]).toEqual([k, true]);
    expect(text(h)).not.toMatch(/1800-|CHK-|pay_KV|held for/);
  });
});

describe('STORE-2c · the confirmation (under the organisation)', () => {
  it('a paid order: the platform holds it until completion, then releases it to the organisation; no Pay link', async () => {
    C.orders[O.a] = ORDER(O.a, 'paid');
    const h = await confirm({ o: O.a });
    expect(text(h)).toContain(en['checkout.state.paid']);
    expect(en['checkout.state.paid']).toContain('released to the organisation');
    expect(h).not.toContain('data-kv-pay=');
  });
  it('a CANCELLED paid order says the refund to source from the payment read — refunded, or requested at the gateway', async () => {
    C.orders[O.a] = ORDER(O.a, 'cancelled');
    C.attempts[O.a] = attempt({ id: 'p1', status: 'refunded', attempt: 1 });
    let h = await confirm({ o: O.a });
    expect(h).toContain('data-kv-refund="store2c.confirm.refunded"');
    C.attempts[O.a] = attempt({ id: 'p1', status: 'refund_initiated', attempt: 1 });
    h = await confirm({ o: O.a });
    expect(h).toContain('data-kv-refund="store2c.confirm.refunding"');
    C.attempts[O.a] = attempt(null);
    h = await confirm({ o: O.a });
    expect(h).not.toContain('data-kv-refund=');
  });
  it('a GROUP: every order with its own state and Pay link (to THIS store\'s pay step); the auto-refund refusal is GONE (D3 built)', async () => {
    C.group = { orders: [{ id: O.a }, { id: O.b }] };
    C.orders[O.a] = ORDER(O.a, 'pending'); C.orders[O.b] = ORDER(O.b, 'paid');
    const h = await confirm({ g: 'g1' });
    expect(h).toContain(`href="/anand-fpo/checkout/pay?o=${O.a}&amp;g=g1"`);
    expect(h).not.toContain(`/checkout/pay?o=${O.b}`);
    expect(h).not.toContain('store2.refusal.autoRefund');
    expect(text(h)).toContain(en['store2c.refund.true']);
  });
});
