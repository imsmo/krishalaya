// PC-56 TENANT-3a · W133's working views + W134's money box and timeline — and the dead column made real.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ORDER_VIEWS, orderMoneyView, statusesInView, viewOfStatus } from '../domain/order-money';
import { ORDER_STATUSES } from '../domain/order.state';
import { OrderConsoleReadModel } from '../read-models/order-console.read-model';
import { parseOrderCursor, buildOrderCursor } from '../dto/order-console.dto';

const ROW = {
  subtotalMinor: '4466000', deliveryFeeMinor: '0', discountMinor: '0', taxMinor: '0',
  commissionMinor: '0', platformFeeMinor: '89300', tdsMinor: '0', totalMinor: '4555300',
  commissionRuleSnapshot: null as unknown,
};

describe('TENANT-3a · the five working views are EXHAUSTIVE over the 15-state machine', () => {
  it('every status the machine knows maps to exactly one view — a status in no tab is an order nobody works', () => {
    const unmapped = ORDER_STATUSES.filter((s) => viewOfStatus(s) === null);
    expect(unmapped).toEqual([]);
  });
  it('the mapping is a partition: no status appears in two views, and the union is the machine', () => {
    const all = ORDER_VIEWS.flatMap((v) => statusesInView(v));
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(ORDER_STATUSES));
  });
  it("`delivered` sits in IN PROGRESS, not completed — the goods arrived but the money has not closed", () => {
    expect(viewOfStatus('delivered')).toBe('in_progress');
    expect(viewOfStatus('completed')).toBe('completed');
  });
  it('refunds and cancellations share one view; a dispute has its own', () => {
    expect(statusesInView('cancelled_refunded')).toEqual(['cancelled', 'partially_refunded', 'refunded']);
    expect(statusesInView('disputed')).toEqual(['disputed']);
  });
  it('an unknown status returns null rather than a default tab — a wrong tab hides an order', () => {
    expect(viewOfStatus('teleported')).toBeNull();
  });
});

describe('TENANT-3a · W134’s money box carries the BASIS of every figure', () => {
  it('order-time charges and settlement-time figures are labelled apart', () => {
    const v = orderMoneyView(ROW);
    const basisOf = (k: string) => v.lines.find((l) => l.key === k)!.basis;
    expect(basisOf('platformFee')).toBe('charged_at_order');
    expect(basisOf('subtotal')).toBe('charged_at_order');
    expect(basisOf('total')).toBe('charged_at_order');
    expect(basisOf('tds')).toBe('settlement_time');        // 194-O at settlement — never an order-row deduction
    expect(basisOf('commission')).toBe('settlement_time');
    expect(basisOf('tax')).toBe('settlement_time');
  });

  it('the buyer’s number and the seller’s gross are the two figures every party checks', () => {
    const v = orderMoneyView(ROW);
    expect(v.buyerPaidMinor).toBe('4555300');   // the total, exactly
    expect(v.sellerGrossMinor).toBe('4466000'); // the subtotal: a buyer-side fee never comes out of the farmer's money
  });

  it('THE SNAPSHOT VERDICT DISTINGUISHES "no rule existed" FROM "nobody recorded it"', () => {
    // charged something, no snapshot → an order placed before the snapshot began. Not recoverable, and said so.
    expect(orderMoneyView(ROW).snapshot).toEqual({ present: false, reason: 'placed_before_snapshot' });
    // charged nothing → there was no rule to record; that is not a gap
    expect(orderMoneyView({ ...ROW, platformFeeMinor: '0' }).snapshot).toEqual({ present: false, reason: 'no_charges_applied' });
    // snapshot present → the rules are on the record
    expect(orderMoneyView({ ...ROW, commissionRuleSnapshot: { resolvedAt: 'x', charges: [] } }).snapshot)
      .toEqual({ present: true, reason: 'recorded' });
  });
});

describe('TENANT-3a · the console reads', () => {
  class StubPool {
    calls: Array<{ sql: string; params: unknown[] }> = [];
    rows: any[] = [];
    async query(sql: string, params: unknown[] = []) { this.calls.push({ sql, params }); return { rows: this.rows, rowCount: this.rows.length }; }
  }
  const rm = (pool: StubPool) => new OrderConsoleReadModel({ forTenant: async () => pool } as any);

  it('view counts fold statuses through the ONE mapping and count the unmapped rather than dropping them', async () => {
    const pool = new StubPool();
    pool.rows = [{ status: 'confirmed', n: 3 }, { status: 'delivered', n: 2 }, { status: 'teleported', n: 1 }];
    const out = await rm(pool).viewCounts('t1');
    expect(out.needs_action).toBe(3);
    expect(out.in_progress).toBe(2);
    expect(out.unmapped).toBe(1);
    expect(out.all).toBe(6);
  });

  it('the list filters by the view’s status SET, keyset only, and prunes the item partition (Law 8)', async () => {
    const pool = new StubPool();
    await rm(pool).list('t1', { view: 'needs_action', cursor: { c: '2026-07-01', id: 'x' }, limit: 50 });
    const { sql, params } = pool.calls[0];
    expect(sql).toContain('o.status = ANY(');
    expect(params).toContainEqual(['confirmed', 'created', 'payment_pending']);
    expect(sql).toContain('o.created_at <');
    expect(sql.toUpperCase()).not.toContain('OFFSET');
    expect(sql).toContain('oi.order_created_at = o.created_at');       // parent partition located
  });

  it('the money read never recomputes — it selects the frozen columns and prunes by uuid_v7_time', async () => {
    const pool = new StubPool();
    await rm(pool).money('t1', 'o-1');
    const { sql } = pool.calls[0];
    expect(sql).toContain('commission_rule_snapshot');
    expect(sql).toContain('uuid_v7_time($2)');
    expect(sql).not.toMatch(/subtotal_minor\s*[+*]/);                  // no arithmetic: the row IS the answer
  });

  it('the timeline reads order_events with a lower bound that prunes old partitions', async () => {
    const pool = new StubPool();
    await rm(pool).timeline('t1', 'o-1', new Date('2026-07-09T14:22:00Z'));
    const { sql } = pool.calls[0];
    expect(sql).toContain('FROM order_events');
    expect(sql).toContain("e.created_at >= $3::timestamptz - interval '1 day'");
    expect(sql).toContain('ORDER BY e.created_at DESC');
  });

  it('a stale or malformed cursor reads as the first page, never a 500', () => {
    expect(parseOrderCursor(undefined)).toBeNull();
    expect(parseOrderCursor('nonsense')).toBeNull();
    const c = buildOrderCursor({ createdAt: '2026-07-09T14:22:00.000Z', id: 'o-1' });
    expect(parseOrderCursor(c)).toEqual({ c: '2026-07-09T14:22:00.000Z', id: 'o-1' });
  });
});

describe('TENANT-3a · the dead column, and the promise it now keeps (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('the order INSERT now writes commission_rule_snapshot — for 133 migrations nothing did', () => {
    const repo = read('repositories', 'order.repository.ts');
    expect(repo).toContain('commission_rule_snapshot');
    expect(repo).toContain('$25::jsonb');
    expect(repo).toContain('commissionRuleSnapshot');
  });

  it('checkout freezes the RESOLVED RULES, not just the amounts — an amount cannot be re-checked, a rule can', () => {
    const co = read('services', 'checkout.service.ts');
    expect(co).toContain('checkoutChargesWithSnapshot');
    expect(co).toContain('commissionRuleSnapshot');
    // and a membership benefit that overrides an amount goes INTO the snapshot, or the snapshot disagrees with the money
    expect(co).toContain('memberBenefit');
  });

  it('the money route does not recompute anything (no charge service on the read path)', () => {
    const ctrl = read('controllers', 'v1', 'orders.controller.ts');
    const money = ctrl.slice(ctrl.indexOf("@Get(':id/money')"), ctrl.indexOf("@Get('stats')"));
    expect(money).toContain('orderMoneyView');
    expect(money).not.toMatch(/charge|price|quote/i);
  });
});
