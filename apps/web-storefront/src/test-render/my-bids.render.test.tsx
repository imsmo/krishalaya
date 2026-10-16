// apps/web-storefront/src/test-render/my-bids.render.test.tsx · PC-56 STORE-3c · C1 / C3 — canon W296 "My bids & deposits" under the organisation:
//   • one row PER AUCTION: title · qty unit · the organisation · the status · leading / outbid / won / not won / sealed placed — from the read;
//   • THE DEPOSIT AS THE LEDGER HAS IT: held <amount> · released <time> · applied toward your order · forfeited <time> · returned <time>;
//   • the WON row: the order link, "Deposit applied −X · Balance due Y, by <balanceDueAt>" (server figures), "Pay balance" → THIS store's pay step,
//     the forfeit warning (TRUE), the offline sentence, the decided outcomes (incl. "paid, then cancelled — deposit and payment returned");
//   • the sealed raise-only sentence (TRUE since founder D1); "every bid records the connection it came from" (the ip) — the fingerprint refused;
//   • empty → "See live auctions"; error (Retry reloads — W3115–W3117 DECOR) ≠ empty; flag OFF honest; sign-in only; the platform door.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store3c-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => {
  const f = jest.requireActual('./store3c-fixtures');
  return { resolveSessionToken: async () => f.C.token, requireSession: async (to: string) => { if (!f.C.token) throw new Error(`REDIRECT /login?next=${to}`); return f.C.token; } };
});
jest.mock('../lib/auth', () => ({ getSessionTenant: () => jest.requireActual('./store3c-fixtures').C.sessionTenant, hasSessionCookie: () => jest.requireActual('./store3c-fixtures').C.signedIn === true }));
jest.mock('../lib/storefront-data', () => ({ loadTenantShell: (s: string) => jest.requireActual('./store3c-fixtures').shell(s) }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store3c-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import TenantMyBidsPage from '../app/[tenantSlug]/auctions/bids/page';
import PlatformMyBidsDoor from '../app/(platform)/auctions/bids/page';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text } from './store1b-harness';
import { C, reset, MINE, SETTLEMENT, A, SLUG, ORDER_ID, FARMER, BIDDER_UUID } from './store3c-fixtures';
import { STORE3C_REFUSALS } from '../features/store3c/refusals';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantMyBidsPage({ params: { tenantSlug: SLUG }, searchParams: sp }));
const row = (h: string, id: string) => { const s = h.slice(h.indexOf(`data-kv-auction="${id}"`)); return s.slice(0, s.indexOf('</li>')); };
beforeEach(() => { reset(); });

describe('STORE-3c · W296 one row per auction, the server\'s facts', () => {
  it('title · qty unit · the ORGANISATION · status · "you were outbid" · your best at a time · current + minimum next (server) · "Bid <min next>" → W278', async () => {
    const h = await page();
    const tx = text(h);
    expect(tx).toContain('Bold groundnut');
    expect(tx).toContain('60 quintal · Anand FPO');
    expect(h).toContain('data-kv-outcome-chip="outbid"');
    expect(tx).toContain('You were outbid');
    expect(tx).toMatch(/Your best ₹6,240\.00 per quintal at .+ · 2 bids/);
    expect(tx).toContain('Current ₹6,320.00 per quintal');
    expect(tx).toContain('Minimum next ₹6,340.00 per quintal');
    expect(h).toContain(`data-kv-bid-next="${A.live}" href="/${SLUG}/auctions/${A.live}"`);
    expect(tx).toContain('Bid ₹6,340.00');
    expect(tx).not.toContain(FARMER); expect(h).not.toContain(BIDDER_UUID);
  });
  it('a sealed bid placed: "even we show it to no one until close · you may only raise your own sealed bid" — no current bid shown', async () => {
    C.mine = [MINE(A.sealed, { kind: 'sealed', sealedHidden: true, currentBidMinor: null, leading: false, outbid: false })];
    const h = await page();
    expect(h).toContain('data-kv-sealed-placed=""');
    expect(text(h)).toContain(en['store3c.sealed.placed']);
    expect(h).not.toContain('data-kv-current="server"');
    expect(text(h)).toContain('Raise your sealed bid');
  });
  it('"every bid records the connection it came from" (the ip — TRUE); the fingerprint / rings claim refused by name', async () => {
    const h = await page();
    expect(text(h)).toContain('Every bid records the connection it came from.');
    expect(h).toContain('data-kv-refusal="fingerprint"');
    expect(text(h)).not.toMatch(/fingerprint\.|rings get caught/i);
  });
});

describe('STORE-3c · W296 the deposit AS THE LEDGER HAS IT', () => {
  it.each([
    ['held', { state: 'held', amountMinor: '1000000', at: '2026-10-16T08:30:00.000Z' }, /Deposit held: ₹10,000\.00/],
    ['released', { state: 'released', amountMinor: '1000000', at: '2026-10-16T13:32:00.000Z' }, /Deposit released .+2026/],
    ['applied', { state: 'applied', amountMinor: '1000000', at: '2026-10-16T12:31:00.000Z' }, /Deposit applied toward your order: ₹10,000\.00/],
    ['forfeited', { state: 'forfeited', amountMinor: '1000000', at: '2026-10-18T09:15:00.000Z' }, /Deposit forfeited to the organisation .+2026/],
    ['returned', { state: 'returned', amountMinor: '1000000', at: '2026-10-17T10:00:00.000Z' }, /Deposit returned .+2026.*: ₹10,000\.00/],
    ['none', { state: 'none', amountMinor: '0', at: null }, /No deposit was held\./],
  ])('%s → its own sentence (from the ledger, never the rule)', async (state, emd, re) => {
    C.mine = [MINE(A.live, { emd, isOpen: state === 'held', status: state === 'held' ? 'live' : 'ended' })];
    const h = await page();
    expect(h).toContain(`data-kv-emd-state="${state}"`);
    expect(text(h)).toMatch(re);
  });
  it.each(['hi', 'gu'])('%s: every deposit state reads in the language', async (l) => {
    C.lang = l;
    const cat = l === 'hi' ? hi : gu;
    C.mine = [MINE(A.live, { emd: { state: 'forfeited', amountMinor: '1000000', at: '2026-10-18T09:15:00.000Z' }, isOpen: false, status: 'defaulted' })];
    expect(text(await page())).toContain(cat['store3c.emd.forfeited'].split('{date}')[0].trim());
  });
});

describe('STORE-3c · W296 the WON row — the balance, paid end to end (founder D2)', () => {
  const won = (s: Record<string, unknown> = {}, over: Record<string, unknown> = {}) =>
    MINE(A.won, { status: 'settled', auctionStatus: 'settled', isOpen: false, won: true, leading: false, outbid: false, emd: { state: 'applied', amountMinor: '1000000', at: '2026-10-16T12:31:00.000Z' }, settlement: SETTLEMENT(s), ...over });
  it('the order link; "Deposit applied −X · Balance due Y, by <due>" (server figures); "Pay balance" → THIS store\'s pay step; the forfeit warning', async () => {
    C.mine = [won()];
    const h = await page();
    const r = row(h, A.won);
    expect(r).toContain(`data-kv-order-link="${ORDER_ID}" href="/${SLUG}/orders/${ORDER_ID}"`);
    expect(text(r)).toMatch(/Deposit applied −\s?₹10,000\.00 · Balance due ₹1,21,000\.00, by .+2026/);
    expect(r).toContain(`data-kv-pay-balance="${ORDER_ID}" href="/${SLUG}/checkout/pay?o=${ORDER_ID}"`);
    expect(text(r)).toContain('Miss the deadline and the deposit is forfeited to the organisation.');
    expect(text(r)).not.toMatch(/tomorrow 18:00/);
    expect(h).toContain('data-kv-outcome-chip="won"');
  });
  it('nothing due / offline / decided → NO Pay balance; the offline sentence; "paid, then cancelled — deposit and payment returned"', async () => {
    C.mine = [won({ amountDueMinor: '0' })];
    expect(await page()).not.toContain('data-kv-pay-balance=');
    C.mine = [won({ collection: 'offline' })];
    const off = await page();
    expect(off).not.toContain('data-kv-pay-balance=');
    expect(off).toContain('data-kv-offline=""');
    C.mine = [won({ outcome: 'cancelled_paid' }, { emd: { state: 'returned', amountMinor: '1000000', at: '2026-10-17T10:00:00.000Z' } })];
    const cp = await page();
    expect(cp).not.toContain('data-kv-pay-balance=');
    expect(cp).not.toContain('data-kv-deposit-rows=');
    expect(text(cp)).toContain('Paid, then cancelled — deposit and payment returned.');
    for (const [o, line] of [['paid', 'Balance paid.'], ['defaulted', 'Not paid in time — the deposit was forfeited to the organisation.'], ['returned', 'Cancelled — your deposit was returned.']]) {
      C.mine = [won({ outcome: o })];
      expect([o, text(await page()).includes(line)]).toEqual([o, true]);
    }
  });
  it('a lost row has no settlement and no Pay link', async () => {
    C.mine = [MINE(A.failed, { status: 'settled', isOpen: false, won: false, emd: { state: 'released', amountMinor: '1000000', at: '2026-10-16T12:31:00.000Z' } })];
    const h = await page();
    expect(h).toContain('data-kv-outcome-chip="lost"');
    expect(h).not.toContain('data-kv-won=');
  });
});

describe('STORE-3c · W296 states: empty ≠ error ≠ off; sign-in only; the door; the refusals', () => {
  it('empty → "See live auctions"; error → Retry reload, never the empty sentence; keyset Next', async () => {
    C.mine = [];
    const e = await page();
    expect(e).toContain('data-kv-state="empty"');
    expect(e).toContain(`data-kv-cta="live" href="/${SLUG}/auctions"`);
    C.mine = new Error('down');
    const x = await page();
    expect(x).toContain('data-kv-state="error"');
    expect(x).toContain(`href="/${SLUG}/auctions/bids" class="kv-btn" data-kv-retry="reload"`);
    C.mine = [MINE(A.live)]; C.mineNext = 'n2';
    expect(await page()).toContain(`rel="next" href="/${SLUG}/auctions/bids?cursor=n2"`);
  });
  it('the flag OFF → honest, no read; anonymous → sign in first', async () => {
    C.flags = { ...C.flags, auctions: false };
    const h = await page();
    expect(h).toContain('data-kv-state="flag-off"');
    expect(C.calls.filter((c) => c[0] === 'auctions.myBids')).toEqual([]);
    C.token = null;
    await expect(page()).rejects.toThrow(`REDIRECT /login?next=/${SLUG}/auctions/bids`);
  });
  it('every W296 refusal is printed by name; the platform /auctions/bids is a door to the session\'s store', async () => {
    const h = await page();
    for (const r of STORE3C_REFUSALS.filter((x) => x.surfaces.includes('bids'))) expect(h).toContain(`data-kv-refusal="${r.id}"`);
    await expect(PlatformMyBidsDoor({ searchParams: { cursor: 'n2' } })).rejects.toThrow(`REDIRECT /${SLUG}/auctions/bids?cursor=n2`);
  });
});
