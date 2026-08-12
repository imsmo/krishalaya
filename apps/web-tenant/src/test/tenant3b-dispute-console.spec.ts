// PC-56 TENANT-3b · W140's desk, W141's money card and W142's returns queue — the console rules, and the pages'
// own promises pinned against their source (comments stripped, so a promise in a comment cannot pass a test).
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DISPUTE_TABS, isDisputeTab, disputeTabHref, slaCell, disputedValue, moneyBasisKey, gateView, canSign,
  returnActions, refundBlockedBy, medianText,
} from '../features/disputes/console';

describe('TENANT-3b · W140’s tabs', () => {
  it('are the canon’s four plus all, and nothing else reaches the query', () => {
    expect(DISPUTE_TABS).toEqual(['all', 'needs_response', 'under_review', 'escalated', 'closed']);
    expect(isDisputeTab('closed')).toBe(true);
    expect(isDisputeTab('deleted')).toBe(false);
    expect(isDisputeTab(undefined)).toBe(false);
  });
  it('never carry a cursor — a keyset cursor is a position in ONE ordered set', () => {
    for (const v of DISPUTE_TABS) expect(disputeTabHref(v)).not.toContain('cursor');
    expect(disputeTabHref('all')).toBe('/disputes');
    expect(disputeTabHref('escalated')).toBe('/disputes?view=escalated');
  });
});

describe('TENANT-3b · the SLA cell only exists where a clock is real', () => {
  const now = new Date('2026-07-13T14:00:00Z');
  it('counts down, and says overdue rather than showing a negative', () => {
    expect(slaCell('open', '2026-07-13T23:00:00Z', now)).toEqual({ kind: 'left', hours: 9 });
    expect(slaCell('seller_responded', '2026-07-13T12:00:00Z', now)).toEqual({ kind: 'overdue', hours: 2 });
  });
  it('an escalated dispute shows "platform" — a tenant cannot meet a deadline they do not own', () => {
    expect(slaCell('escalated', '2026-07-13T23:00:00Z', now)).toEqual({ kind: 'platform' });
  });
  it('is ABSENT on a closed dispute and on one with no due date', () => {
    for (const s of ['resolved', 'rejected', 'withdrawn']) expect(slaCell(s, '2026-07-13T23:00:00Z', now)).toBeNull();
    expect(slaCell('open', null, now)).toBeNull();
  });
});

describe('TENANT-3b · the figures that must never be guessed', () => {
  it('an unrecorded disputed value says so — it is not zero and not the order total', () => {
    expect(disputedValue({ disputedAmountMinor: '1282000' })).toEqual({ kind: 'amount', minor: '1282000' });
    expect(disputedValue({ disputedAmountMinor: null })).toEqual({ kind: 'not_recorded' });
    expect(disputedValue({ disputedAmountMinor: '' })).toEqual({ kind: 'not_recorded' });
    expect(disputedValue({ disputedAmountMinor: '0' })).toEqual({ kind: 'not_recorded' });
  });
  it('a median of null is "nothing closed", which is not "0 hours"', () => {
    expect(medianText(null)).toEqual({ kind: 'noBasis' });
    expect(medianText(0)).toEqual({ kind: 'value', hours: 0 });   // a real 0 is a real figure, and reads differently
    expect(medianText(50.4)).toEqual({ kind: 'value', hours: 50.4 });
  });
  it('every money basis maps to its own explanation, and an unknown one is not silently pretty', () => {
    expect(moneyBasisKey('escrow_holds_order_gross')).toBe('escrowGross');
    expect(moneyBasisKey('settled_to_seller_before_dispute')).toBe('settledBefore');
    expect(moneyBasisKey('no_escrowed_payment')).toBe('noPayment');
    expect(moneyBasisKey('something_new')).toBe('unknown');
  });
});

describe('TENANT-3b · the refund gate, as buttons', () => {
  it('only two states let a refund be pressed', () => {
    const canRefund = (g: string) => gateView(g).canRefund;
    expect(canRefund('single_signature')).toBe(true);
    expect(canRefund('ready')).toBe(true);
    for (const g of ['needs_proposal', 'awaiting_checker', 'rejected_by_checker', 'amount_changed', 'already_applied', 'nonsense']) {
      expect(canRefund(g)).toBe(false);
    }
  });
  it('a changed amount offers a NEW proposal rather than re-using a signature', () => {
    expect(gateView('amount_changed')).toEqual({ key: 'amountChanged', canRefund: false, canPropose: true, canDecide: false });
    expect(gateView('awaiting_checker').canDecide).toBe(true);
    expect(gateView('already_applied')).toEqual({ key: 'alreadyApplied', canRefund: false, canPropose: false, canDecide: false });
  });
  it('the maker may not be the checker, and the permission is still required', () => {
    expect(canSign('u-maker', 'u-checker', true)).toBe(true);
    expect(canSign('u-maker', 'u-maker', true)).toBe(false);
    expect(canSign('u-maker', 'u-checker', false)).toBe(false);
    expect(canSign(null, 'u-checker', true)).toBe(false);
    expect(canSign('u-maker', null, true)).toBe(false);
  });
});

describe('TENANT-3b · W142’s row actions follow the goods, and the money is last', () => {
  const perms = { canResolve: true, canRefund: true };
  const row = (over: Partial<{ status: string; inspectedAt: string | null; refundAmountMinor: string | null }> = {}) =>
    ({ status: 'received', inspectedAt: null, refundAmountMinor: '418000', ...over });

  it('a received parcel offers INSPECT first — never refund', () => {
    expect(returnActions(row(), perms)).toEqual(['inspect']);
  });
  it('once inspected, the refund appears — and only with the money key and a recorded amount', () => {
    expect(returnActions(row({ inspectedAt: '2026-07-13T10:00:00Z' }), perms)).toEqual(['refund']);
    expect(returnActions(row({ inspectedAt: '2026-07-13T10:00:00Z' }), { canResolve: true, canRefund: false })).toEqual([]);
    expect(returnActions(row({ inspectedAt: '2026-07-13T10:00:00Z', refundAmountMinor: null }), perms)).toEqual([]);
  });
  it('in_transit is the BUYER’s act, so the console never offers to ship for them', () => {
    expect(returnActions(row({ status: 'approved' }), perms)).toEqual(['reject']);
    expect(returnActions(row({ status: 'requested' }), perms)).toEqual(['approve', 'reject']);
    expect(returnActions(row({ status: 'in_transit' }), perms)).toEqual(['receive']);
    expect(returnActions(row({ status: 'refunded' }), perms)).toEqual([]);
  });
  it('and the row SAYS why a refund is not offered instead of looking stuck', () => {
    expect(refundBlockedBy(row({ status: 'in_transit' }), { canRefund: true })).toBe('notReceived');
    expect(refundBlockedBy(row(), { canRefund: true })).toBe('notInspected');
    expect(refundBlockedBy(row({ inspectedAt: 'x', refundAmountMinor: null }), { canRefund: true })).toBe('noAmount');
    expect(refundBlockedBy(row({ inspectedAt: 'x' }), { canRefund: false })).toBe('noPermission');
    expect(refundBlockedBy(row({ inspectedAt: 'x' }), { canRefund: true })).toBeNull();
    expect(refundBlockedBy(row({ status: 'refunded' }), { canRefund: true })).toBeNull();   // done, not blocked
  });
});

describe('TENANT-3b · the pages state their own rules (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('THE DESK PRINTS THE FREEZE TRUTH rather than the canon’s "only this amount is frozen"', () => {
    const s = read('app', 'disputes', 'page.tsx');
    expect(s).toContain('dsp.freezeTruth');
    expect(s).toContain('dsp.scopeNotRecorded');
    expect(s).toContain('dsp.unmapped');           // an order in no tab is surfaced, not dropped
  });
  it('no page-number pager on the desk (the roster rule)', () => {
    const s = read('app', 'disputes', 'page.tsx');
    expect(s.toUpperCase()).not.toContain('OFFSET');
    expect(s).toContain('dsp.pagerNote');
  });
  it('the detail page says the undisputed remainder is held too, and never invents a held figure', () => {
    const s = read('app', 'disputes', '[id]', 'page.tsx');
    expect(s).toContain('dsp.undisputedHeldToo');
    expect(s).toContain('dsp.moneyUnreadable');    // degrade to silence, not to zeroes
    expect(s).toContain('moneyBasisKey');
    expect(s).toContain('dsp.youProposed');        // the maker sees WHY there is no sign button
  });
  it('the returns queue shows the refund value and refuses to imply a missing one is zero', () => {
    const s = read('app', 'returns', 'page.tsx');
    expect(s).toContain('rma.colValue');
    expect(s).toContain('rma.valueNotRecorded');
    expect(s).toContain('inspectReturnAction');
    expect(s).toContain('refundBlockedBy');
  });
  it('every gate refusal is translated by NAME in both action files (a generic error invites a second press)', () => {
    for (const p of [['app', 'disputes', 'actions.ts'], ['app', 'returns', 'actions.ts']]) {
      const s = read(...p);
      expect(s).toContain('REFUND_NEEDS_CHECKER');
      expect(s).toContain('REFUND_ALREADY_APPLIED');
      expect(s).toContain('REFUND_AMOUNT_CHANGED');
    }
  });
  it('the 20-character note floor is checked before the round trip, on both doors', () => {
    for (const p of [['app', 'disputes', 'actions.ts'], ['app', 'returns', 'actions.ts']]) {
      const s = read(...p);
      expect((s.match(/length < 20/g) ?? []).length).toBeGreaterThanOrEqual(1);
      expect(s).toContain('noteTooShort');
    }
  });
});

describe('TENANT-3b · every new key is translated in all three launch languages', () => {
  const keys = (file: string) => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'i18n', file), 'utf8');
    return new Set([...src.matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1]));
  };
  it('hi and gu carry every dsp.*, rma.* and disputeDetail.error.* key en has', () => {
    const en = keys('en.ts'), hi = keys('hi.ts'), gu = keys('gu.ts');
    const mine = [...en].filter((k) => k.startsWith('dsp.') || k.startsWith('rma.') || k.startsWith('disputeDetail.error.'));
    expect(mine.length).toBeGreaterThan(60);
    expect(mine.filter((k) => !hi.has(k))).toEqual([]);
    expect(mine.filter((k) => !gu.has(k))).toEqual([]);
  });
});
