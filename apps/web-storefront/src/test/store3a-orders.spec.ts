// apps/web-storefront/src/test/store3a-orders.spec.ts · PC-56 STORE-3a — the order pages' PURE half (features/store3a/*):
//   • the tab model (founder D4) and the hrefs under the organisation's chrome (founder D3); the capped count form;
//   • status parity: the storefront's list IS the API's 15 (read from apps/api order.state.ts) and every status has a label in en / hi / gu;
//   • the refusal map: unique ids, every key in all three catalogues, every English refusal says no; the 10 canon files;
//   • the cancel form codec (reason from the vocabulary, `other` needs a note ≤ 280) and every named outcome;
//   • the refund view of a cancelled order; what comes back; the auction warning both ways; who cancelled;
//   • `showsReceivedAct` FAIL-CLOSED (only delivered + paid into escrow — lead's D6), the Pay link never for an auction order, the deadline never
//     for an auction order, the deposit rows only when the API says a deposit was applied;
//   • Rule Zero: no 'INR' literal in any STORE-3a page or feature.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ORDER_STATUS_LIST, orderStatusKey, orderStatusTone } from '../features/store3a/order-status';
import {
  STORE_ORDER_GROUPS, readGroup, ordersHref, orderHref, cancelHref, orderTabs, countForm, showsPayLink, showsReceivedAct,
  codDeliveredLine, canCancel, showsDeadline, showsDepositRows, moreItems, reasonOptions, checkCancelForm, cancelOutcomeKey, readCancelOutcome,
  completeOutcomeKey, refundView, whatComesBack, auctionCancelWarning, cancelledBy, readOk, CANCEL_OUTCOMES,
} from '../features/store3a/orders';
import { STORE3A_REFUSALS, STORE3A_DELTAS, STORE3A_CHAIN_PAGES, store3aRefusalKeys } from '../features/store3a/refusals';
import { encodeCancelDraft, decodeCancelDraft } from '../features/store3a/cancel-draft';
import { orderTimeline } from '../features/orders/timeline';
import { canCancelOrder } from '../features/orders/buyer-actions';

const CATS = { en, hi, gu } as const;
const SRC = join(__dirname, '..');
const O = '0210e000-0000-7000-8000-000000000001';

describe('STORE-3a · the buyer\'s tabs (founder D4) under the organisation (founder D3)', () => {
  it('five tabs, `?group=` read back (anything unknown → all), hrefs under /<slug>/orders', () => {
    expect(STORE_ORDER_GROUPS).toEqual(['all', 'active', 'attention', 'completed', 'cancelled']);
    expect([readGroup('attention'), readGroup(['completed']), readGroup('needs_action'), readGroup(undefined)]).toEqual(['attention', 'completed', 'all', 'all']);
    expect(ordersHref('anand-fpo')).toBe('/anand-fpo/orders');
    expect(ordersHref('anand-fpo', 'attention', 'c1')).toBe('/anand-fpo/orders?group=attention&cursor=c1');
    expect(orderHref('anand-fpo', O, { ok: 'cancelled' })).toBe(`/anand-fpo/orders/${O}?ok=cancelled`);
    expect(cancelHref('anand-fpo', O)).toBe(`/anand-fpo/orders/${O}/cancel`);
  });
  it('the tab model: every tab, the current one marked, a count only when the API gave one; past the cap the "+" form', () => {
    const tabs = orderTabs('anand-fpo', 'attention', { all: { count: 100, capped: true }, attention: { count: 1, capped: false } });
    expect(tabs.map((t) => [t.group, t.current, t.count])).toEqual([
      ['all', false, { count: 100, capped: true }], ['active', false, null], ['attention', true, { count: 1, capped: false }], ['completed', false, null], ['cancelled', false, null]]);
    expect(orderTabs('anand-fpo', 'all', null).every((t) => t.count === null)).toBe(true);
    expect(countForm({ count: 100, capped: true })).toEqual({ key: 'store3a.tab.countCapped', n: 100 });
    expect(countForm({ count: 4, capped: false })).toEqual({ key: 'store3a.tab.count', n: 4 });
    for (const t of tabs) for (const cat of Object.values(CATS)) expect([t.labelKey, typeof (cat as Record<string, string>)[t.labelKey]]).toEqual([t.labelKey, 'string']);
  });
});

describe('STORE-3a · E9 every order status labelled ×3 (parity with the API\'s machine)', () => {
  it('the storefront\'s list IS apps/api ORDER_STATUSES (15, same order)', () => {
    const src = readFileSync(join(SRC, '..', '..', 'api', 'src', 'modules', 'orders', 'domain', 'order.state.ts'), 'utf8');
    const block = src.slice(src.indexOf('ORDER_STATUSES = ['), src.indexOf('] as const'));
    expect([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...ORDER_STATUS_LIST]);
    expect(ORDER_STATUS_LIST).toHaveLength(15);
  });
  it.each(Object.entries(CATS))('%s: every status (and "unknown") has its label', (_l, cat) => {
    for (const s of [...ORDER_STATUS_LIST, 'unknown']) expect([s, typeof (cat as Record<string, string>)[`order.status.${s}`]]).toEqual([s, 'string']);
    expect(orderStatusKey('teleported')).toBe('order.status.unknown');
    expect([orderStatusTone('delivered'), orderStatusTone('refunded'), orderStatusTone('disputed'), orderStatusTone('created')]).toEqual(['done', 'closed', 'trouble', 'waiting']);
  });
  it.each(Object.entries(CATS))('%s: the seven cancel reasons (founder D5) are labelled by code', (_l, cat) => {
    for (const c of ['changed_mind', 'found_better_price', 'ordered_by_mistake', 'delivery_too_slow', 'quantity_or_grade_doubt', 'payment_issue', 'other']) {
      expect([c, typeof (cat as Record<string, string>)[`order.cancelReason.${c}`]]).toEqual([c, 'string']);
    }
  });
  it('mutation candidate 9: `refunded` is its own terminal, never `cancelled`; the way-stations are on the bar; `ready` is cancellable', () => {
    expect(orderTimeline('refunded').terminal).toBe('refunded');
    for (const s of ['picked_up', 'in_transit', 'out_for_delivery', 'payment_pending', 'partially_fulfilled']) expect([s, orderTimeline(s).currentIndex >= 0]).toEqual([s, true]);
    expect([canCancelOrder('ready'), canCancel('ready'), canCancel('picked_up'), canCancel('delivered')]).toEqual([true, true, false, false]);
  });
});

describe('STORE-3a · which acts an order shows', () => {
  it('"I received it" is FAIL-CLOSED: only delivered AND paid into escrow (a COD delivered order gets the honest line instead)', () => {
    expect(showsReceivedAct({ status: 'delivered', paymentState: 'paid' })).toBe(true);
    for (const o of [{ status: 'delivered', paymentState: 'none' }, { status: 'delivered', paymentState: 'pending' }, { status: 'delivered' }, { status: 'delivered', paymentState: 'PAID' },
      { status: 'completed', paymentState: 'paid' }, { status: 'confirmed', paymentState: 'paid' }]) expect([o, showsReceivedAct(o)]).toEqual([o, false]);
    expect([codDeliveredLine({ status: 'delivered', paymentState: 'none' }), codDeliveredLine({ status: 'delivered', paymentState: 'paid' })]).toEqual([true, false]);
  });
  it('the Pay link: awaiting payment — an AUCTION order too since STORE-3c (founder D2: the pay step charges the balance due)', () => {
    expect(showsPayLink({ paymentState: 'pending', source: 'direct' })).toBe(true);
    expect(showsPayLink({ paymentState: 'pending', source: 'auction' })).toBe(true);
    for (const ps of ['none', 'paid', 'cancelled', 'expired', undefined]) expect(showsPayLink({ paymentState: ps, source: 'direct' })).toBe(false);
  });
  it('the acceptance deadline: only before confirmation, never for an auction order; the deposit rows only when > 0', () => {
    const d = '2026-10-16T12:00:00.000Z';
    expect(showsDeadline({ status: 'created', source: 'direct', acceptanceDeadline: d })).toBe(true);
    expect(showsDeadline({ status: 'payment_pending', source: 'auction', acceptanceDeadline: d })).toBe(false);
    expect(showsDeadline({ status: 'confirmed', source: 'direct', acceptanceDeadline: d })).toBe(false);
    expect(showsDeadline({ status: 'created', source: 'direct', acceptanceDeadline: null })).toBe(false);
    expect([showsDepositRows({ depositAppliedMinor: '1000000' }), showsDepositRows({ depositAppliedMinor: '0' }), showsDepositRows({ depositAppliedMinor: '000' }), showsDepositRows({})]).toEqual([true, false, false, false]);
    expect([moreItems(3), moreItems(1), moreItems(undefined)]).toEqual([2, null, null]);
  });
});

describe('STORE-3a · the cancel form and its named outcomes (W3083 / W3085)', () => {
  const opts = reasonOptions([
    { id: '0210c000-0000-7000-8000-000000000001', code: 'changed_mind', name: 'I changed my mind', meta: {} },
    { id: '0210c000-0000-7000-8000-000000000007', code: 'other', name: 'Other', meta: { textRequired: true } },
    { id: 'not-a-uuid', code: 'junk', name: 'x', meta: {} },
  ]);
  const form = (o: Record<string, string>) => (k: string) => o[k];
  it('the radios come from the vocabulary (a malformed row dropped); `other` needs the note', () => {
    expect(opts.map((o) => [o.code, o.textRequired])).toEqual([['changed_mind', false], ['other', true]]);
  });
  it('no reason / an unoffered reason / `other` without a note / a note too long → named, values kept; a good form → the API body', () => {
    expect(checkCancelForm(form({}), opts)).toMatchObject({ ok: false, error: 'reason_required' });
    expect(checkCancelForm(form({ reasonId: '0210c000-0000-7000-8000-0000000000ff' }), opts)).toMatchObject({ ok: false, error: 'reason_unknown' });
    expect(checkCancelForm(form({ reasonId: opts[1].id, note: '  ' }), opts)).toMatchObject({ ok: false, error: 'note_required', kept: { reasonId: opts[1].id } });
    expect(checkCancelForm(form({ reasonId: opts[1].id, note: 'x'.repeat(281) }), opts)).toMatchObject({ ok: false, error: 'note_too_long' });
    expect(checkCancelForm(form({ reasonId: opts[1].id, note: ' bought locally ' }), opts)).toEqual({ ok: true, value: { reasonId: opts[1].id, note: 'bought locally' } });
    expect(checkCancelForm(form({ reasonId: opts[0].id, note: 'ignored' }), opts)).toEqual({ ok: true, value: { reasonId: opts[0].id } });
  });
  it('every API refusal maps to a named outcome — never a generic "try again" for a cause the server named', () => {
    expect(['ORDER_ILLEGAL_TRANSITION', 'ORDER_FORBIDDEN', 'CANCEL_REASON_REQUIRED', 'CANCEL_REASON_UNKNOWN', 'CANCEL_NOTE_REQUIRED', 'ORDER_CONCURRENCY_CONFLICT', 'BOOM'].map((c) => cancelOutcomeKey(c)))
      .toEqual(['moved', 'forbidden', 'reason_required', 'reason_unknown', 'note_required', 'concurrency', 'failed']);
    expect(cancelOutcomeKey(null, 403)).toBe('forbidden');
    expect([readCancelOutcome('moved'), readCancelOutcome('weird'), readCancelOutcome(undefined)]).toEqual(['moved', 'failed', null]);
    expect([completeOutcomeKey('ORDER_COMPLETE_REQUIRES_ESCROW'), completeOutcomeKey('ORDER_ILLEGAL_TRANSITION'), completeOutcomeKey('X')]).toEqual(['escrow', 'moved', 'failed']);
    expect([readOk('cancelled'), readOk('received'), readOk('paid')]).toEqual(['cancelled', 'received', null]);
    for (const o of CANCEL_OUTCOMES) for (const cat of Object.values(CATS)) expect([o, typeof (cat as Record<string, string>)[`store3a.cancel.err.${o}`]]).toEqual([o, 'string']);
  });
  it('the kept note round-trips for THIS order only (never another order\'s draft)', () => {
    const raw = encodeCancelDraft({ orderId: O, note: 'bought locally' });
    expect(decodeCancelDraft(raw, O)).toBe('bought locally');
    expect(decodeCancelDraft(raw, '0210e000-0000-7000-8000-000000000002')).toBeNull();
    expect(decodeCancelDraft('junk', O)).toBeNull();
  });
});

describe('STORE-3a · what happened to the money (the refund read, survey B11)', () => {
  it('refunded with its reference / partial / requested / starting (captured, not yet booked) / nothing was paid', () => {
    expect(refundView({ refund: { state: 'refunded', amountMinor: '452000', currencyCode: 'INR', gatewayRefundId: 'rfnd_1', completedAt: '2026-10-15T10:00:00.000Z' } }))
      .toEqual({ kind: 'refunded', amountMinor: '452000', currencyCode: 'INR', reference: 'rfnd_1', completedAt: '2026-10-15T10:00:00.000Z' });
    expect(refundView({ refund: { state: 'partial', amountMinor: '1000', currencyCode: 'INR' } }).kind).toBe('partial');
    expect(refundView({ refund: { state: 'initiated', amountMinor: '452000', currencyCode: 'INR' } })).toMatchObject({ kind: 'refunding', reference: null });
    expect(refundView({ refund: { state: 'none' }, latest: { status: 'success', amountMinor: '452000', currencyCode: 'INR' } })).toMatchObject({ kind: 'starting', amountMinor: '452000' });
    expect(refundView({ latest: { status: 'refund_initiated', amountMinor: '1' } }).kind).toBe('refunding');
    expect(refundView({ refund: { state: 'none' }, latest: null }).kind).toBe('nothing_paid');
    expect(refundView(null).kind).toBe('nothing_paid');
  });
  it('what comes back: a paid order → the captured amount (or the sentence without one); else nothing was paid', () => {
    expect(whatComesBack({ paymentState: 'paid' }, { latest: { status: 'success', amountMinor: '452000', currencyCode: 'USD' } })).toEqual({ kind: 'back_to_source', amountMinor: '452000', currencyCode: 'USD' });
    expect(whatComesBack({ paymentState: 'paid' }, null).kind).toBe('back_unknown_amount');
    for (const ps of ['none', 'pending', undefined]) expect(whatComesBack({ paymentState: ps }, { latest: { status: 'success', amountMinor: '1' } }).kind).toBe('nothing_paid');
  });
  it('the auction warning: unpaid → forfeit, paid → returned, any other order → none; who cancelled, from the events', () => {
    expect([auctionCancelWarning({ source: 'auction', paymentState: 'pending' }), auctionCancelWarning({ source: 'auction', paymentState: 'paid' }), auctionCancelWarning({ source: 'direct', paymentState: 'paid' })])
      .toEqual(['forfeit', 'returned', null]);
    expect(cancelledBy([{ toStatus: 'created', actorRole: 'buyer' }, { toStatus: 'cancelled', actorRole: 'system' }])).toBe('system');
    expect(cancelledBy(null)).toBeNull();
  });
});

describe('STORE-3a · the refusal map (brief §E)', () => {
  it('unique ids, every key in all three catalogues, every surface prints at least one; 10 canon files; DELTAs named', () => {
    expect(new Set(STORE3A_REFUSALS.map((r) => r.id)).size).toBe(STORE3A_REFUSALS.length);
    for (const r of STORE3A_REFUSALS) for (const cat of Object.values(CATS)) expect([r.key, typeof (cat as Record<string, string>)[r.key]]).toEqual([r.key, 'string']);
    for (const s of ['orders', 'order', 'cancel', 'confirm'] as const) expect(store3aRefusalKeys(s).length).toBeGreaterThan(0);
    expect(STORE3A_CHAIN_PAGES.map((p) => p.file.slice(0, 5))).toEqual(['W287-', 'W288-', 'W289-', 'W291-', 'W3058', 'W3059', 'W3060', 'W3083', 'W3084', 'W3085']);
    expect(STORE3A_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['orders_route', 'keyset_pages', 'review_route', 'retry_reload', 'chain_back_links']));
  });
  it('every English STORE-3a refusal says no / not / never / nothing / nobody / cannot', () => {
    for (const r of STORE3A_REFUSALS) expect([r.key, /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnobody\b|cannot/i.test(en[r.key])]).toEqual([r.key, true]);
  });
});

describe('STORE-3a · Rule Zero', () => {
  it('no \'INR\' literal in any STORE-3a page or feature (the currency is always the data\'s)', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(e)) files.push(p); } };
    walk(join(SRC, 'app', '[tenantSlug]', 'orders')); walk(join(SRC, 'features', 'store3a'));
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const f of files) expect([f, /['"`]INR['"`]/.test(readFileSync(f, 'utf8'))]).toEqual([f, false]);
  });
});
