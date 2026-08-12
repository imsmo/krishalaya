// PC-56 TENANT-3a · W133's tabs and W134's money-box console logic.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ORDER_VIEW_TABS, isOrderViewTab, viewHref, acceptanceClock, orderStatusClass, basisKey, showMoneyLine, snapshotKey } from '../features/orders/console';

describe('TENANT-3a · the working-view tabs', () => {
  it('are the canon’s five plus all, and nothing else can reach the query', () => {
    expect(ORDER_VIEW_TABS).toEqual(['all', 'needs_action', 'in_progress', 'completed', 'disputed', 'cancelled_refunded']);
    expect(isOrderViewTab('disputed')).toBe(true);
    expect(isOrderViewTab('deleted')).toBe(false);
    expect(isOrderViewTab(undefined)).toBe(false);
  });
  it('never carry a cursor — a keyset cursor is a position in ONE ordered set', () => {
    for (const v of ORDER_VIEW_TABS) expect(viewHref(v)).not.toContain('cursor');
    expect(viewHref('all')).toBe('/orders');
    expect(viewHref('needs_action')).toBe('/orders?view=needs_action');
  });
});

describe('TENANT-3a · the acceptance clock only exists where a deadline is real', () => {
  const now = new Date('2026-07-13T14:00:00Z');
  it('counts down for an order actually awaiting acceptance', () => {
    expect(acceptanceClock('payment_pending', '2026-07-13T17:41:00Z', now)).toEqual({ kind: 'live', minutesLeft: 221 });
  });
  it('says expired rather than showing a negative countdown', () => {
    expect(acceptanceClock('created', '2026-07-13T13:00:00Z', now)).toEqual({ kind: 'expired' });
  });
  it('is ABSENT for any other status, and for a missing deadline — a countdown nobody must meet is decoration', () => {
    expect(acceptanceClock('delivered', '2026-07-13T17:41:00Z', now)).toBeNull();
    expect(acceptanceClock('payment_pending', null, now)).toBeNull();
  });
  it('disputed is the one status that alarms', () => {
    expect(orderStatusClass('disputed')).toContain('kv-badge--frozen');
    expect(orderStatusClass('completed')).toBe('kv-badge');
  });
});

describe('TENANT-3a · the money box', () => {
  it('maps every basis to its own explanation', () => {
    expect(basisKey('charged_at_order')).toBe('chargedAtOrder');
    expect(basisKey('settlement_time')).toBe('settlementTime');
    expect(basisKey('not_applicable_at_order')).toBe('notApplicable');
  });
  it('always shows order-time lines (even ₹0) and hides only ZERO settlement-time ones', () => {
    expect(showMoneyLine({ minor: '0', basis: 'charged_at_order' })).toBe(true);   // a real ₹0 delivery is information
    expect(showMoneyLine({ minor: '0', basis: 'settlement_time' })).toBe(false);
    expect(showMoneyLine({ minor: '161', basis: 'settlement_time' })).toBe(true);
  });
  it('tells the three snapshot truths apart — the unrecoverable one included', () => {
    expect(snapshotKey({ present: true, reason: 'recorded' })).toBe('recorded');
    expect(snapshotKey({ present: false, reason: 'placed_before_snapshot' })).toBe('beforeSnapshot');
    expect(snapshotKey({ present: false, reason: 'no_charges_applied' })).toBe('noCharges');
  });
});

describe('TENANT-3a · the pages state their own rules (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('the worklist surfaces the unmapped count instead of quietly losing those orders', () => {
    expect(read('app', 'orders', 'page.tsx')).toContain('oc.unmapped');
  });
  it('the order record prints the TDS section note and the snapshot verdict', () => {
    const s = read('app', 'orders', '[id]', 'page.tsx');
    expect(s).toContain('od.tdsNote');
    expect(s).toContain('snapshotKey');
    expect(s).toContain('od.timeline');
  });
  it('no page-number pager on the worklist (the roster rule)', () => {
    const s = read('app', 'orders', 'page.tsx');
    expect(s.toUpperCase()).not.toContain('OFFSET');
    expect(s).toContain('oc.pagerNote');
  });
});
