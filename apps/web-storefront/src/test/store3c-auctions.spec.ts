// apps/web-storefront/src/test/store3c-auctions.spec.ts · PC-56 STORE-3c · C6 (pure) — the auction list, my bids, the group lot and the balance pay
// step's rules without React:
//   • E9 status parity: the NINE auction statuses and the SIX group-lot statuses ARE the API's state machines (read from their own source), each
//     labelled in en / hi / gu — twice over (the auction labels and the group-lot labels);
//   • the tab model (Live / Upcoming / With my bids for a session / Ended), the routes, the my-bids outcome from the server's facts;
//   • the deposit state as the LEDGER has it → its sentence (all six ×3); the won row's Pay balance only while the balance is open + online + due;
//   • the pay step charges `amountDueMinor` (the total only when absent); the deposit rows only when a deposit was applied;
//   • bps → percent text (string math); the cancel reasons ×3; the routes to the lot, the similar lots facet and the listing;
//   • the refusal map (every key ×3, every English refusal says no) and the 12 canon files; the sealed-raise refusal mapped by name;
//   • NO MONEY ARITHMETIC (the `*` grep, and no `BigInt(`/`+`/`-` on a minor in the store3c files) and NO 'INR' literal on the new pages —
//     and the old platform auction list (the storefront's last `'INR'`) is gone; `env.featureAuctions` is gone.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  AUCTION_STATUS_LIST, auctionStatusKey, auctionKindKey, auctionNoteKey, AUCTION_TABS, readAuctionTab, tabGroup, auctionsHref, myBidsHref, auctionHref, auctionTabs,
  bidOutcome, bidOutcomeKey, EMD_STATES, emdStateKey, SETTLEMENT_OUTCOMES, settlementOutcomeKey, wonView, payableMinor, showsDepositRows, BID_REFUSAL_STATUS,
} from '../features/store3c/auctions';
import {
  GROUP_LOT_STATUS_LIST, groupLotStatusKey, GROUP_LOT_CANCEL_REASONS, cancelReasonKey, groupLotState, bpsPercent, groupLotHref, similarLotsHref, lotListingHref,
} from '../features/store3c/group-lot';
import { STORE3C_REFUSALS, STORE3C_DELTAS, STORE3C_CHAIN_PAGES, store3cRefusalKeys } from '../features/store3c/refusals';
import { moneyRefusalOf, moneyRefusalKey } from '../features/store2c/checkout';
import { showsPayLink } from '../features/store3a/orders';

const CATS: Record<string, Record<string, string>> = { en, hi, gu };
const SRC = path.join(__dirname, '..');
const API = path.join(SRC, '..', '..', 'api', 'src', 'modules');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const listOf = (file: string, name: string) => {
  const m = new RegExp(`${name} = \\[([^\\]]+)\\]`).exec(fs.readFileSync(file, 'utf8'));
  expect(m).not.toBeNull();
  return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
};

describe('STORE-3c · E9 the nine auction statuses and the six group-lot statuses, each labelled ×3', () => {
  it('the storefront lists ARE the API\'s state machines (read from their source)', () => {
    expect(listOf(path.join(API, 'auctions', 'domain', 'auction.state.ts'), 'AUCTION_STATUSES')).toEqual([...AUCTION_STATUS_LIST]);
    expect(listOf(path.join(API, 'group-lots', 'domain', 'group-lot.state.ts'), 'GROUP_LOT_STATUSES')).toEqual([...GROUP_LOT_STATUS_LIST]);
    expect(AUCTION_STATUS_LIST).toHaveLength(9);
    expect(GROUP_LOT_STATUS_LIST).toHaveLength(6);
  });
  it.each(['en', 'hi', 'gu'])('%s: every auction status and every group-lot status has its OWN label (no two the same); unknown is said', (l) => {
    const a = AUCTION_STATUS_LIST.map((s) => CATS[l][auctionStatusKey(s)]);
    for (const [i, s] of AUCTION_STATUS_LIST.entries()) expect([s, typeof a[i]]).toEqual([s, 'string']);
    expect(new Set(a).size).toBe(9);
    const g = GROUP_LOT_STATUS_LIST.map((s) => CATS[l][groupLotStatusKey(s)]);
    for (const [i, s] of GROUP_LOT_STATUS_LIST.entries()) expect([s, typeof g[i]]).toEqual([s, 'string']);
    expect(new Set(g).size).toBe(6);
    expect(auctionStatusKey('reverse')).toBe('store3c.status.unknown');
    expect(groupLotStatusKey('interest')).toBe('store3c.gl.status.unknown');
    for (const k of ['store3c.status.unknown', 'store3c.gl.status.unknown', auctionKindKey('english_open'), auctionKindKey('sealed'), auctionKindKey('dutch')]) expect([k, typeof CATS[l][k]]).toEqual([k, 'string']);
  });
  it('the per-status notes: reserve not met → deposits released; awaiting → the organisation\'s own deadline ({date}); none for a live auction', () => {
    expect(auctionNoteKey('failed_reserve')).toBe('store3c.note.failedReserve');
    expect(en['store3c.note.failedReserve']).toMatch(/released automatically/);
    expect(en[auctionNoteKey('awaiting_approval')!]).toContain('{date}');
    expect(auctionNoteKey('live')).toBeNull();
  });
});

describe('STORE-3c · the tabs and the routes', () => {
  it('Live / Upcoming / With my bids (a session only) / Ended; an unknown tab is Live; `mine` reads my bids (no API group)', () => {
    expect([...AUCTION_TABS]).toEqual(['live', 'upcoming', 'mine', 'ended']);
    expect([readAuctionTab('ended'), readAuctionTab('bogus'), readAuctionTab(undefined)]).toEqual(['ended', 'live', 'live']);
    expect([tabGroup('live'), tabGroup('upcoming'), tabGroup('ended'), tabGroup('mine')]).toEqual(['live', 'upcoming', 'ended', null]);
    expect(auctionTabs('anand-fpo', 'live', false).map((x) => x.tab)).toEqual(['live', 'upcoming', 'ended']);
    expect(auctionTabs('anand-fpo', 'mine', true).find((x) => x.current)?.tab).toBe('mine');
    for (const t of AUCTION_TABS) for (const cat of Object.values(CATS)) expect([t, typeof cat[`store3c.tab.${t}`], typeof cat[`store3c.list.empty.${t}`]]).toEqual([t, 'string', 'string']);
  });
  it('the routes stay under the organisation; keyset Next only', () => {
    expect(auctionsHref('anand-fpo')).toBe('/anand-fpo/auctions');
    expect(auctionsHref('anand-fpo', 'ended', 'c1')).toBe('/anand-fpo/auctions?tab=ended&cursor=c1');
    expect(myBidsHref('anand-fpo', 'c2')).toBe('/anand-fpo/auctions/bids?cursor=c2');
    expect(auctionHref('anand-fpo', 'a1')).toBe('/anand-fpo/auctions/a1');
    expect(groupLotHref('anand-fpo', 'g1')).toBe('/anand-fpo/g/g1');
    expect(similarLotsHref('anand-fpo')).toBe('/anand-fpo/search?saleType=group_lot');
    expect(lotListingHref('anand-fpo', 'l1')).toBe('/anand-fpo/listings/l1');
  });
});

describe('STORE-3c · a my-bids row (W296)', () => {
  const row = (o: Record<string, unknown>) => ({ won: false, status: 'live', auctionStatus: 'live', isOpen: true, sealedHidden: false, leading: false, ...o }) as never;
  it('the outcome comes from the server\'s facts, never an amount comparison', () => {
    expect(bidOutcome(row({ leading: true }))).toBe('leading');
    expect(bidOutcome(row({}))).toBe('outbid');
    expect(bidOutcome(row({ sealedHidden: true, leading: false }))).toBe('sealed');
    expect(bidOutcome(row({ isOpen: false, status: 'awaiting_approval' }))).toBe('awaiting');
    expect(bidOutcome(row({ isOpen: false, status: 'settled', won: true }))).toBe('won');
    expect(bidOutcome(row({ isOpen: false, status: 'settled' }))).toBe('lost');
    expect(bidOutcome(row({ isOpen: false, status: 'failed_reserve' }))).toBe('no_sale');
    for (const o of ['leading', 'outbid', 'sealed', 'awaiting', 'won', 'lost', 'no_sale'] as const) for (const cat of Object.values(CATS)) expect([o, typeof cat[bidOutcomeKey(o)]]).toEqual([o, 'string']);
  });
  it('the deposit AS THE LEDGER HAS IT: every state has its sentence ×3 (held / applied with the amount; released / forfeited with the time); unknown → none', () => {
    expect([...EMD_STATES]).toEqual(['held', 'released', 'applied', 'forfeited', 'returned', 'none']);
    for (const s of EMD_STATES) for (const cat of Object.values(CATS)) expect([s, typeof cat[emdStateKey(s)]]).toEqual([s, 'string']);
    expect(en[emdStateKey('held')]).toContain('{amount}');
    expect(en[emdStateKey('released')]).toContain('{date}');
    expect(en[emdStateKey('forfeited')]).toContain('{date}');
    expect(en[emdStateKey('returned')]).toMatch(/\{date\}.*\{amount\}/);
    expect(emdStateKey('mystery')).toBe('store3c.emd.none');
  });
  it('the won row: Pay balance ONLY while open + online + something due → THIS store\'s pay step; offline → its own sentence; the outcomes ×3', () => {
    const s = { orderId: 'o1', outcome: 'open', collection: 'online', orderValueMinor: '13100000', emdAppliedMinor: '1000000', balanceDueMinor: '12100000', balanceDueAt: 'x', amountDueMinor: '12100000', outcomeAt: null } as const;
    expect(wonView('anand-fpo', s)).toEqual({ pay: '/anand-fpo/checkout/pay?o=o1', offline: false, outcomeKey: null, orderHref: '/anand-fpo/orders/o1' });
    expect(wonView('anand-fpo', { ...s, amountDueMinor: '0' }).pay).toBeNull();
    expect(wonView('anand-fpo', { ...s, collection: 'offline' })).toMatchObject({ pay: null, offline: true });
    expect(wonView('anand-fpo', { ...s, outcome: 'cancelled_paid' })).toMatchObject({ pay: null, outcomeKey: 'store3c.won.outcome.cancelled_paid' });
    expect(wonView('anand-fpo', null)).toEqual({ pay: null, offline: false, outcomeKey: null, orderHref: null });
    for (const o of SETTLEMENT_OUTCOMES.filter((x) => x !== 'open')) for (const cat of Object.values(CATS)) expect([o, typeof cat[settlementOutcomeKey(o)!]]).toEqual([o, 'string']);
    expect(en['store3c.won.outcome.cancelled_paid']).toBe('Paid, then cancelled — deposit and payment returned.');
    expect(en['store3c.won.rows']).toMatch(/Deposit applied −\{deposit\} · Balance due \{balance\}, by \{date\}/);
  });
  it('the sealed raise-only rule (founder D1) is TRUE copy and its refusal is mapped by name', () => {
    expect(BID_REFUSAL_STATUS.BID_SEALED_MUST_RAISE).toBe('sealed_raise');
    expect(en['store3c.sealed.placed']).toMatch(/only raise your own sealed bid/);
    for (const cat of Object.values(CATS)) expect(typeof cat['store3c.bid.sealedRaise']).toBe('string');
  });
});

describe('STORE-3c · the balance pay step (C4, founder D2)', () => {
  it('charges the order\'s amountDueMinor; the total ONLY when the field is absent; the deposit rows only when a deposit was applied', () => {
    expect(payableMinor({ totalMinor: '13100000', amountDueMinor: '12100000' })).toBe('12100000');
    expect(payableMinor({ totalMinor: '5000' })).toBe('5000');
    expect(payableMinor({ totalMinor: '5000', amountDueMinor: 'garbage' })).toBe('5000');
    expect([showsDepositRows({ depositAppliedMinor: '1000000' }), showsDepositRows({ depositAppliedMinor: '0' }), showsDepositRows({})]).toEqual([true, false, false]);
    expect(en['store3c.pay.depositRows']).toBe('Deposit applied −{deposit} · Balance due {balance}');
  });
  it('ORDER_PAYMENT_AMOUNT_MISMATCH is refused BY NAME (×3); an auction order shows the Pay link now (3a\'s withheld link retired)', () => {
    expect(moneyRefusalOf('ORDER_PAYMENT_AMOUNT_MISMATCH')).toBe('amount_mismatch');
    for (const cat of Object.values(CATS)) expect(typeof cat[moneyRefusalKey('amount_mismatch')]).toBe('string');
    expect(showsPayLink({ paymentState: 'pending', source: 'auction' })).toBe(true);
    for (const cat of Object.values(CATS)) expect(cat['store3a.refusal.payBalance']).toBeUndefined();
  });
});

describe('STORE-3c · the group lot (W279)', () => {
  it('bps → percent text by string math (a RATE, not money); anything not whole bps in range → null', () => {
    expect([bpsPercent(150), bpsPercent(7400), bpsPercent(5), bpsPercent(0), bpsPercent(10000), bpsPercent(1234)]).toEqual(['1.5', '74', '0.05', '0', '100', '12.34']);
    expect([bpsPercent(-1), bpsPercent(10001), bpsPercent(1.5), bpsPercent('150')]).toEqual([null, null, null, null]);
  });
  it('the page state from the read; the cancel reasons ×3 (never the coordinator\'s words); the true sentences', () => {
    expect(groupLotState({ status: 'pledging', listingId: null })).toBe('pledging');
    expect(groupLotState({ status: 'listed', listingId: 'l1' })).toBe('listed');
    expect(groupLotState({ status: 'listed', listingId: null })).toBe('ready');
    expect(groupLotState({ status: 'settled', listingId: 'l1' })).toBe('sold');
    expect(groupLotState({ status: 'cancelled', listingId: null })).toBe('cancelled');
    for (const r of [...GROUP_LOT_CANCEL_REASONS, 'unknown']) for (const cat of Object.values(CATS)) expect([r, typeof cat[cancelReasonKey(r)]]).toEqual([r, 'string']);
    expect(en['store3c.gl.payout']).toBe('Each pledger is paid their share of the real sale, by pledged quantity, less the coordination fee, after a second person confirms.');
    expect(en['store3c.gl.unfilled']).toMatch(/nothing was paid, nothing is owed/);
    expect(en['store3c.gl.pledgers']).toBe('{n} farmers pledging');
  });
});

describe('STORE-3c · the refusal map (brief §E)', () => {
  it('unique ids, every key ×3, every surface prints at least one; the 12 canon files; the DELTAs named', () => {
    expect(new Set(STORE3C_REFUSALS.map((r) => r.id)).size).toBe(STORE3C_REFUSALS.length);
    for (const r of STORE3C_REFUSALS) for (const cat of Object.values(CATS)) expect([r.key, typeof cat[r.key]]).toEqual([r.key, 'string']);
    for (const s of ['auctions', 'bids', 'group'] as const) expect(store3cRefusalKeys(s).length).toBeGreaterThan(0);
    expect(STORE3C_CHAIN_PAGES.map((p) => p.file.slice(0, 5))).toEqual(['W279-', 'W295-', 'W296-', 'W3077', 'W3078', 'W3079', 'W3089', 'W3090', 'W3091', 'W3115', 'W3116', 'W3117']);
    expect(STORE3C_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['routes', 'keyset_pages', 'pay_balance', 'retry_reload', 'chain_back_links', 'similar_lots', 'interest_decor']));
  });
  it('every English STORE-3c refusal says no / not / never / cannot', () => {
    for (const r of STORE3C_REFUSALS) expect([r.key, /\bnot\b|\bno\b|\bnever\b|\bcannot\b/i.test(en[r.key])]).toEqual([r.key, true]);
  });
});

describe('STORE-3c · no money arithmetic, no \'INR\', no build-time auction switch', () => {
  const FILES = ['features/store3c/auctions.ts', 'features/store3c/group-lot.ts', 'app/[tenantSlug]/auctions/page.tsx', 'app/[tenantSlug]/auctions/bids/page.tsx',
    'app/[tenantSlug]/g/[id]/page.tsx', 'app/(platform)/auctions/page.tsx', 'app/(platform)/auctions/bids/page.tsx', 'app/(platform)/g/[id]/page.tsx',
    'app/[tenantSlug]/checkout/pay/page.tsx', 'app/[tenantSlug]/checkout/pay/actions.ts'];
  it.each(FILES)('%s: no multiplication, no BigInt arithmetic (every amount is the API\'s) and no currency literal', (f) => {
    const src = strip(fs.readFileSync(path.join(SRC, f), 'utf8'));
    expect(src.match(/[\w)\]]\s*\*\s*[\w(]/g) ?? []).toEqual([]);
    expect(src.match(/BigInt\(/g) ?? []).toEqual([]);
    expect(src.match(/Minor\s*[-+]\s*[\w(]/g) ?? []).toEqual([]);
    expect(src.match(/['"`](INR|USD|₹)['"`]/g) ?? []).toEqual([]);
  });
  it('the storefront has NO \'INR\' literal left in any non-test source (the old platform list was the last); `env.featureAuctions` is gone', () => {
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!['test', 'test-render', 'i18n', 'node_modules'].includes(e.name)) walk(p); }
        else if (/\.tsx?$/.test(e.name)) { const s = strip(fs.readFileSync(p, 'utf8')); if (/['"`]INR['"`]/.test(s)) hits.push(path.relative(SRC, p)); if (/featureAuctions/.test(s)) hits.push(`${path.relative(SRC, p)} (featureAuctions)`); }
      }
    };
    walk(SRC);
    expect(hits).toEqual([]);
  });
});
