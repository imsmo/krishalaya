// modules/promotions/__tests__/tenant10b-promotions.spec.ts · PC-56 TENANT-10b — the pure rules + the service seams.
// Every block here fails on cd6dd86 (the file, or the behaviour it pins, did not exist):
//   F-2 / A1 the three promotion money moves (legs, keys, the savepoint around the hold) · A5 / F-21 / F-22 the one coupon
//   decision · B3 / F-10 the status order and the human-pause bit · B2 / B7 / F-8 / F-24 the create + coupon review rules ·
//   F-17 the microsecond cursor · F-12 the delete reason + 404 · F-29 the backstop never touches the relay's transaction ·
//   the route-order gate · the auditor gate · 0185 as text.
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../../../core/auth/permissions.guard';
import { AUDITOR_READ_ACT_KEY, auditorVerdict } from '../../../core/auth/auditor-read-only.guard';
import { InsufficientWalletBalanceError, WalletFrozenError } from '../../../core/wallet/wallet.errors';
import { couponDecision, couponNotice, CouponFacts, COUPON_OUTCOMES, TENANT_FUNDS_UNAVAILABLE } from '../domain/coupon-outcome';
import { derivePromotionStatus } from '../domain/promotion.state';
import { Promotion, parsePromoRules } from '../domain/promotion.entity';
import { promotionRefusals, promotionReview, couponRefusals, couponReview, reasonOk } from '../domain/promotion.rules';
import { encodeCursor, decodeCursor } from '../domain/cursor';
import { holdLegs, settleLegs, releaseLegs, holdKey, settleKey, releaseKey, PROMO_TXN } from '../domain/promo-money';
import { ENGINE_PROMO_TYPES, NO_ENGINE_PROMO_TYPES, hasEngine } from '../domain/promotions.events';
import { couponStatus, ratioTenths } from '../read-models/offers.read-model';
import { CouponMoneyService } from '../services/coupon-money.service';
import { CouponService } from '../services/coupon.service';
import { PromotionService } from '../services/promotion.service';
import { OrderCreatedHandler } from '../events/handlers/order-created.handler';
import { OrderClosedHandler } from '../events/handlers/order-closed.handler';
import { PromotionsController } from '../controllers/v1/promotions.controller';
import { CouponsController } from '../controllers/v1/coupons.controller';

const NOW = new Date('2026-07-15T06:00:00Z');
const win = { startsAt: new Date('2026-07-01T00:00:00Z'), endsAt: new Date('2026-07-31T00:00:00Z') };
const facts = (over: Partial<CouponFacts> = {}): CouponFacts => ({
  coupon: { hasGlobalCapacity: true, perUserLimit: 1 }, promotion: { status: 'active', canReserve: true },
  discountMinor: 9600n, usedByUser: 0, fundsAvailable: true, ...over,
});

describe('A5 / F-21 / F-22 · ONE coupon decision — an outcome, never an exception', () => {
  it('applied only when every rule passes', () => { expect(couponDecision(facts())).toBe('applied'); });
  it('names every decline, in the order a buyer should hear it', () => {
    expect(couponDecision(facts({ coupon: null }))).toBe('invalid');
    expect(couponDecision(facts({ promotion: null }))).toBe('invalid');
    expect(couponDecision(facts({ promotion: { status: 'exhausted', canReserve: false } }))).toBe('budget_exhausted');
    for (const s of ['scheduled', 'expired', 'paused'] as const) expect(couponDecision(facts({ promotion: { status: s, canReserve: true } }))).toBe('window');
    expect(couponDecision(facts({ coupon: { hasGlobalCapacity: false, perUserLimit: 1 } }))).toBe('max_uses_reached');
    expect(couponDecision(facts({ discountMinor: 0n }))).toBe('not_applicable');
    expect(couponDecision(facts({ usedByUser: 1 }))).toBe('user_limit');
    expect(couponDecision(facts({ promotion: { status: 'active', canReserve: false } }))).toBe('budget_exhausted');
    expect(couponDecision(facts({ fundsAvailable: false }))).toBe('tenant_funds_unavailable');
  });
  it('funds not yet asked (checkout asks the wallet under lock) is not a decline', () => { expect(couponDecision(facts({ fundsAvailable: null }))).toBe('applied'); });
  it('the buyer gets a kind message KEY; the funds case carries the brief\'s name', () => {
    expect(couponNotice('tenant_funds_unavailable')).toEqual({ code: TENANT_FUNDS_UNAVAILABLE, outcome: 'tenant_funds_unavailable', messageKey: 'coupon.notice.tenant_funds_unavailable' });
    expect(couponNotice('user_limit')).toEqual({ code: 'USER_LIMIT', outcome: 'user_limit', messageKey: 'coupon.notice.user_limit' });
  });
  it('the outcome vocabulary is the 0185 enum, exactly', () => {
    const mig = fs.readFileSync(path.join(__dirname, '../../../../../../db/migrations/0185_promotion_money.sql'), 'utf8');
    const m = /CREATE TYPE coupon_attempt_outcome AS ENUM \(([^)]+)\)/.exec(mig)!;
    expect(m[1].split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual([...COUPON_OUTCOMES]);
  });
});

describe('B3 / F-10 · status order: exhausted → expired → paused → scheduled → active', () => {
  const v = (over: object = {}) => ({ isActive: true, ...win, budgetMinor: 1000n as bigint | null, spentMinor: 0n, ...over });
  it('a spent budget reads exhausted even when the sweep switched it off (it used to read "paused")', () => {
    expect(derivePromotionStatus(v({ isActive: false, spentMinor: 1000n }), NOW)).toBe('exhausted');
  });
  it('an ended window reads expired even when inactive', () => {
    expect(derivePromotionStatus(v({ isActive: false }), new Date('2026-08-02T00:00:00Z'))).toBe('expired');
  });
  it('paused before scheduled; active last', () => {
    expect(derivePromotionStatus(v({ isActive: false }), new Date('2026-06-01T00:00:00Z'))).toBe('paused');
    expect(derivePromotionStatus(v(), new Date('2026-06-01T00:00:00Z'))).toBe('scheduled');
    expect(derivePromotionStatus(v(), NOW)).toBe('active');
  });
  it('a person\'s pause sets the bit; resume clears it; the system toggle never touches it', () => {
    const p = Promotion.create({ id: 'p', tenantId: 't', promoType: 'festival', defaultName: 'Ghee', rules: parsePromoRules({ discountType: 'flat', amountOffMinor: '500' }), budgetMinor: 5000n, ...win, now: NOW });
    p.setActive(false); expect(p.isHumanPaused).toBe(false);
    p.pauseBy('u1', NOW); expect(p.isHumanPaused).toBe(true); expect(p.toProps().pausedByUserId).toBe('u1');
    p.setActive(true); expect(p.isHumanPaused).toBe(true);
    p.resume(); expect(p.isHumanPaused).toBe(false); expect(p.isActive).toBe(true);
  });
  it('A6 · reserve is admitted against the budget, never over it; release gives it back', () => {
    const p = Promotion.create({ id: 'p', tenantId: 't', promoType: 'discount', defaultName: 'Flat', rules: parsePromoRules({ discountType: 'flat', amountOffMinor: '500' }), budgetMinor: 1000n, ...win, now: NOW });
    expect(p.canReserve(1000n)).toBe(true); expect(p.canReserve(1001n)).toBe(false);
    p.reserve(600n); expect(p.spentMinor).toBe(600n); expect(p.canReserve(500n)).toBe(false);
    expect(() => p.reserve(500n)).toThrow();
    p.releaseSpend(600n); expect(p.spentMinor).toBe(0n);
  });
});

describe('B2 / B7 / F-8 / F-24 · the New promotion review — every refusal, by name', () => {
  const ok = { defaultName: 'Kharif input 5%', promoType: 'discount', discountType: 'percent', percentOff: '5', maxDiscountMinor: '20000', budgetMinor: '4000000', startsAt: '2026-07-01T00:00:00Z', endsAt: '2026-07-31T00:00:00Z' };
  it('a complete percent promotion is ready, and the review computes its status now', () => {
    const r = promotionReview(ok, NOW);
    expect(r.ready).toBe(true); expect(r.computedStatus).toBe('active'); expect(r.diff).toBeNull(); expect(r.entityType).toBe('promotion');
  });
  it('UNCAPPED IS REFUSED BY NAME (BUDGET_REQUIRED); a bad budget is BUDGET_INVALID', () => {
    expect(promotionRefusals({ ...ok, budgetMinor: undefined }, NOW)).toEqual([{ field: 'budgetMinor', code: 'BUDGET_REQUIRED' }]);
    expect(promotionRefusals({ ...ok, budgetMinor: '0' }, NOW)).toEqual([{ field: 'budgetMinor', code: 'BUDGET_INVALID' }]);
  });
  it('the types without an engine are refused by name; the two with one are not', () => {
    for (const t of NO_ENGINE_PROMO_TYPES) expect(promotionRefusals({ ...ok, promoType: t }, NOW)).toEqual([{ field: 'promoType', code: 'PROMO_TYPE_NO_ENGINE' }]);
    for (const t of ENGINE_PROMO_TYPES) expect(promotionRefusals({ ...ok, promoType: t }, NOW)).toEqual([]);
    expect(hasEngine('cashback')).toBe(false); expect(hasEngine('festival')).toBe(true);
  });
  it('a per-order cap belongs to a percent rule only; a flat discount above the whole budget can never apply', () => {
    expect(promotionRefusals({ ...ok, discountType: 'flat', percentOff: undefined, amountOffMinor: '5000' }, NOW)).toEqual([{ field: 'maxDiscountMinor', code: 'MAX_DISCOUNT_NOT_FOR_FLAT' }]);
    expect(promotionRefusals({ ...ok, discountType: 'flat', percentOff: undefined, maxDiscountMinor: undefined, amountOffMinor: '5000', budgetMinor: '4000' }, NOW)).toEqual([{ field: 'amountOffMinor', code: 'DISCOUNT_EXCEEDS_BUDGET' }]);
  });
  it('every refusal at once (W2720: every invalid field is listed)', () => {
    const codes = promotionRefusals({ defaultName: 'x', promoType: 'cashback', discountType: 'percent', percentOff: '0', budgetMinor: '', startsAt: '2026-07-10T00:00:00Z', endsAt: '2026-07-01T00:00:00Z' }, NOW).map((r) => r.code);
    expect(codes).toEqual(['NAME_INVALID', 'PROMO_TYPE_NO_ENGINE', 'PERCENT_INVALID', 'BUDGET_REQUIRED', 'WINDOW_INVALID']);
    expect(promotionRefusals({ ...ok, endsAt: '2026-07-02T00:00:00Z' }, NOW).map((r) => r.code)).toEqual(['WINDOW_ENDED']);
  });
});

describe('W2539–W2542 · the New coupon review', () => {
  const live = { promotion: { status: 'active' as const, promoType: 'discount' }, codeTaken: false };
  const e = { promotionId: '01890000-0000-7000-8000-000000000001', code: 'kharif5', perUserLimit: '1' };
  it('ready, with the code stored uppercase (shown as normalised)', () => {
    const r = couponReview(e, live);
    expect(r.ready).toBe(true);
    expect(r.fields.find((f) => f.name === 'code')).toEqual({ name: 'code', entered: 'kharif5', stored: 'KHARIF5', normalised: true });
  });
  it('refusals by name', () => {
    expect(couponRefusals({ ...e, promotionId: '' }, live).map((r) => r.code)).toEqual(['PROMOTION_REQUIRED']);
    expect(couponRefusals(e, { ...live, promotion: null }).map((r) => r.code)).toEqual(['PROMOTION_UNKNOWN']);
    expect(couponRefusals(e, { ...live, promotion: { status: 'expired', promoType: 'discount' } }).map((r) => r.code)).toEqual(['PROMOTION_ENDED']);
    expect(couponRefusals(e, { ...live, promotion: { status: 'active', promoType: 'cashback' } }).map((r) => r.code)).toEqual(['PROMOTION_NO_ENGINE']);
    expect(couponRefusals({ ...e, code: 'a b' }, live).map((r) => r.code)).toEqual(['CODE_INVALID']);
    expect(couponRefusals(e, { ...live, codeTaken: true }).map((r) => r.code)).toEqual(['CODE_TAKEN']);
    expect(couponRefusals({ ...e, maxUses: '0', perUserLimit: '1001' }, live).map((r) => r.code)).toEqual(['MAX_USES_INVALID', 'PER_USER_INVALID']);
  });
  it('a mutate reason is 3–300 characters', () => {
    expect(reasonOk('ok')).toBe(false); expect(reasonOk('stock ran out')).toBe(true); expect(reasonOk('x'.repeat(301))).toBe(false); expect(reasonOk(undefined)).toBe(false);
  });
});

describe('F-17 · the microsecond cursor (copied from 10a, not imported)', () => {
  it('round-trips every digit; refuses junk', () => {
    const c = encodeCursor('2026-03-01 10:00:00.123999+00', '01890000-0000-7000-8000-000000000001')!;
    expect(decodeCursor(c)).toEqual({ c: '2026-03-01 10:00:00.123999+00', id: '01890000-0000-7000-8000-000000000001' });
    expect(decodeCursor(Buffer.from('x|y').toString('base64url'))).toBeUndefined();
    expect(encodeCursor(null, 'x')).toBeNull();
  });
});

describe('F-2 · the three promotion money moves — balanced, keyed, referenced', () => {
  it('hold / settle / release legs sum to zero and move between the right accounts', () => {
    const sum = (l: Array<{ amountMinor: bigint }>) => l.reduce((a, x) => a + x.amountMinor, 0n);
    const h = holdLegs('t', 9600n); const s = settleLegs('t', 'seller', 9600n); const r = releaseLegs('t', 9600n);
    for (const l of [h, s, r]) expect(sum(l)).toBe(0n);
    expect(h.map((x) => [x.account.kind, x.account.accountCode, x.amountMinor])).toEqual([['tenant', 'main', -9600n], ['tenant', 'hold', 9600n]]);
    expect(s.map((x) => [x.account.kind, x.account.accountCode, x.amountMinor])).toEqual([['tenant', 'hold', -9600n], ['user', 'main', 9600n]]);
    expect(r.map((x) => [x.account.kind, x.account.accountCode, x.amountMinor])).toEqual([['tenant', 'hold', -9600n], ['tenant', 'main', 9600n]]);
    expect(() => holdLegs('t', 0n)).toThrow();
  });
  it('the keys are per (order, coupon) — a replay is the same transaction', () => {
    expect(holdKey('o', 'c')).toBe('promo-hold:o:c'); expect(settleKey('o', 'c')).toBe('promo-settle:o:c'); expect(releaseKey('o', 'c')).toBe('promo-release:o:c');
    expect(PROMO_TXN).toEqual({ Hold: 'promo_hold', Settle: 'promo_settle', Release: 'promo_release' });
  });
  it('A1 · a funds refusal rolls back to the savepoint and answers NULL (nothing reserved); any other error rethrows', async () => {
    const calls: string[] = [];
    const tx = { query: jest.fn(async (sql: string) => { calls.push(sql); return { rows: [], rowCount: 0 }; }), tenantId: 't' };
    for (const err of [new InsufficientWalletBalanceError('main'), new WalletFrozenError('main')]) {
      calls.length = 0;
      const svc = new CouponMoneyService({ post: jest.fn(async () => { throw err; }), balanceMinor: jest.fn() } as never, {} as never);
      await expect(svc.tryHold(tx as never, { tenantId: 't', orderId: 'o', couponId: 'c', amountMinor: 100n })).resolves.toBeNull();
      expect(calls).toEqual(['SAVEPOINT kv_promo_hold', 'ROLLBACK TO SAVEPOINT kv_promo_hold', 'RELEASE SAVEPOINT kv_promo_hold']);
    }
    const boom = new CouponMoneyService({ post: jest.fn(async () => { throw new Error('connection lost'); }), balanceMinor: jest.fn() } as never, {} as never);
    await expect(boom.tryHold(tx as never, { tenantId: 't', orderId: 'o', couponId: 'c', amountMinor: 100n })).rejects.toThrow('connection lost');
    const post = jest.fn(async () => ({ txnId: 'txn-1', alreadyApplied: false }));
    const good = new CouponMoneyService({ post, balanceMinor: jest.fn() } as never, {} as never);
    await expect(good.tryHold(tx as never, { tenantId: 't', orderId: 'o', couponId: 'c', amountMinor: 100n, initiatedBy: 'b' })).resolves.toBe('txn-1');
    expect((post.mock.calls[0] as any[])[1]).toMatchObject({ txnType: 'promo_hold', idempotencyKey: 'promo-hold:o:c', referenceType: 'coupon_redemption', initiatedBy: 'b' });
  });
  it('A2 · settlement pays only held, unsettled, unreleased rows — and stamps each', async () => {
    const rows = [
      { id: 'r1', couponId: 'c1', userId: 'b', orderId: 'o', amountMinor: 500n, holdTxnId: 'h1', settledTxnId: null, releasedTxnId: null },
      { id: 'r2', couponId: 'c2', userId: 'b', orderId: 'o', amountMinor: 700n, holdTxnId: null, settledTxnId: null, releasedTxnId: null },
      { id: 'r3', couponId: 'c3', userId: 'b', orderId: 'o', amountMinor: 900n, holdTxnId: 'h3', settledTxnId: 's3', releasedTxnId: null },
      { id: 'r4', couponId: 'c4', userId: 'b', orderId: 'o', amountMinor: 900n, holdTxnId: 'h4', settledTxnId: null, releasedTxnId: 'x4' },
    ];
    const repo = { forOrderForUpdate: jest.fn(async () => rows), markSettled: jest.fn(async () => 1) };
    const post = jest.fn(async () => ({ txnId: 'set-1', alreadyApplied: false }));
    const out = await new CouponMoneyService({ post, balanceMinor: jest.fn() } as never, repo as never).settleOrderInTx({} as never, { tenantId: 't', orderId: 'o', sellerUserId: 'seller' });
    expect(out).toEqual({ settled: 1, topUpMinor: 500n, unfunded: 1 });
    expect(post).toHaveBeenCalledTimes(1);
    expect((post.mock.calls[0] as any[])[1]).toMatchObject({ txnType: 'promo_settle', idempotencyKey: 'promo-settle:o:c1', referenceId: 'r1' });
    expect(repo.markSettled).toHaveBeenCalledWith({}, 't', 'r1', 'set-1');
  });
});

describe('F-12 · coupon delete needs a reason and 404s when nothing was deleted (no audit row)', () => {
  const make = (row: unknown, deleted: number) => {
    const audit = { write: jest.fn() };
    const svc = new CouponService({ run: async (_t: string, fn: (tx: unknown) => unknown) => fn({}) } as never, {} as never, {} as never, {} as never, audit as never, {} as never,
      { getByIdForUpdate: jest.fn(async () => row), softDelete: jest.fn(async () => deleted) } as never, {} as never, {} as never, {} as never);
    return { svc, audit };
  };
  it('no reason → REASON_REQUIRED', async () => {
    const { svc } = make(null, 0);
    await expect(svc.deleteCoupon('t', { userId: 'u', canManage: true }, 'id', '', null)).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });
  it('a missing coupon → 404 and NO audit', async () => {
    const { svc, audit } = make(null, 0);
    await expect(svc.deleteCoupon('t', { userId: 'u', canManage: true }, 'id', 'duplicate code', null)).rejects.toMatchObject({ httpStatus: 404 });
    expect(audit.write).not.toHaveBeenCalled();
  });
});

describe('F-29 / A3 · the lifecycle handlers never use the relay\'s transaction', () => {
  it('order-created backstop: the relay tx is untouched; the recorder runs in its own unit of work', async () => {
    const relayTx = { query: jest.fn() };
    const recordFromOrder = jest.fn(async () => ({ recorded: false, held: false }));
    await new OrderCreatedHandler({ recordFromOrder } as never).handle({ id: '1', tenantId: 't', aggregateType: 'order', aggregateId: 'o', eventType: 'orders.order_created', payload: { couponCode: 'X1Y', buyerUserId: 'b', discountMinor: '500' } } as never, relayTx as never);
    expect(relayTx.query).not.toHaveBeenCalled();
    expect(recordFromOrder).toHaveBeenCalledWith('t', { orderId: 'o', couponCode: 'X1Y', userId: 'b', discountMinor: 500n });
  });
  it('cancel / refund: release for the order, by cause', async () => {
    const relayTx = { query: jest.fn() };
    const releaseForOrder = jest.fn(async () => ({ released: 1, amountMinor: 500n }));
    await new OrderClosedHandler('orders.order_cancelled', { releaseForOrder } as never).handle({ id: '1', tenantId: 't', aggregateType: 'order', aggregateId: 'o', eventType: 'orders.order_cancelled', payload: {} } as never, relayTx as never);
    await new OrderClosedHandler('orders.order_refunded', { releaseForOrder } as never).handle({ id: '2', tenantId: 't', aggregateType: 'order', aggregateId: 'o', eventType: 'orders.order_refunded', payload: {} } as never, relayTx as never);
    expect(releaseForOrder.mock.calls).toEqual([['t', 'o', 'cancelled'], ['t', 'o', 'refunded']]);
    expect(relayTx.query).not.toHaveBeenCalled();
  });
});

describe('B6 · pause / resume carry a reason and refuse what would change nothing', () => {
  const svc = (promo: Promotion | null) => new PromotionService({ run: async (_t: string, fn: (tx: unknown) => unknown) => fn({}) } as never, { write: jest.fn() } as never, {} as never, {} as never, { write: jest.fn() } as never,
    { getForUpdate: jest.fn(async () => promo), update: jest.fn() } as never);
  const promo = () => Promotion.create({ id: 'p', tenantId: 't', promoType: 'discount', defaultName: 'Kharif', rules: parsePromoRules({ discountType: 'flat', amountOffMinor: '500' }), budgetMinor: 5000n, startsAt: new Date(Date.now() - 3600_000), endsAt: new Date(Date.now() + 86400_000) });
  it('no reason → REASON_REQUIRED', async () => { await expect(svc(promo()).setActive('t', { userId: 'u', canManage: true }, 'p', false, '  ', null)).rejects.toMatchObject({ code: 'REASON_REQUIRED' }); });
  it('resume of a running promotion → PROMOTION_NOT_RESUMABLE; pause of a paused one → PROMOTION_NOT_PAUSABLE', async () => {
    await expect(svc(promo()).setActive('t', { userId: 'u', canManage: true }, 'p', true, 'go again', null)).rejects.toMatchObject({ code: 'PROMOTION_NOT_RESUMABLE' });
    const paused = promo(); paused.pauseBy('u');
    await expect(svc(paused).setActive('t', { userId: 'u', canManage: true }, 'p', false, 'again', null)).rejects.toMatchObject({ code: 'PROMOTION_NOT_PAUSABLE' });
  });
});

describe('W130 · coupon status and the GMV ratio (pure)', () => {
  it('status comes from the promotion, then the coupon\'s own cap', () => {
    expect(couponStatus(null, 0, null)).toBe('no_promotion');
    expect(couponStatus({ status: 'active' }, 5, 5)).toBe('used_up');
    expect(couponStatus({ status: 'active' }, 4, 5)).toBe('active');
    expect(couponStatus({ status: 'scheduled' }, 0, null)).toBe('scheduled');
  });
  it('the ratio is integer tenths; nothing spent → null', () => {
    expect(ratioTenths(684000n, 41260n)).toBe('165'); expect(ratioTenths(1n, 0n)).toBeNull();
  });
});

describe('the route-order gate + the auditor gate', () => {
  const NAME: Record<number, string> = { [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PATCH]: 'PATCH', [RequestMethod.PUT]: 'PUT', [RequestMethod.DELETE]: 'DELETE' };
  const routes: Array<{ m: string; segs: string[]; label: string; perms: string[] | undefined; act?: unknown }> = [];
  for (const [name, cls] of Object.entries({ PromotionsController, CouponsController }) as Array<[string, any]>) {
    const base = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '');
    for (const h of Object.getOwnPropertyNames(cls.prototype)) {
      const fn = cls.prototype[h];
      if (h === 'constructor' || typeof fn !== 'function') continue;
      const m = Reflect.getMetadata(METHOD_METADATA, fn);
      if (m === undefined) continue;
      const sub = String(Reflect.getMetadata(PATH_METADATA, fn) ?? '');
      const full = [base, sub].filter((x) => x && x !== '/').join('/');
      routes.push({ m: NAME[m], segs: full.split('/').filter(Boolean), label: `${NAME[m]} /${full} (${name}.${h})`, perms: Reflect.getMetadata(PERMISSIONS_KEY, fn), act: Reflect.getMetadata(AUDITOR_READ_ACT_KEY, fn) });
    }
  }
  it('no earlier route matches a later route\'s static path (GET :id never swallows GET summary)', () => {
    const shadows: string[] = [];
    routes.forEach((a, i) => routes.slice(i + 1).forEach((b) => {
      if (a.m !== b.m || a.segs.length !== b.segs.length || a.segs[0] !== b.segs[0]) return;
      const covers = a.segs.every((s, k) => s.startsWith(':') || s === b.segs[k]);
      const differs = a.segs.some((s, k) => s.startsWith(':') && !b.segs[k].startsWith(':'));
      if (covers && differs) shadows.push(`${a.label} shadows ${b.label}`);
    }));
    expect(shadows).toEqual([]);
  });
  it('the new routes exist, read promotion.manage, and every non-GET is refused for an auditor', () => {
    const labels = routes.map((r) => r.label.split(' (')[0]);
    expect(labels).toEqual(expect.arrayContaining(['POST /promotions/review', 'GET /promotions/summary', 'GET /coupons/all', 'GET /coupons/:id/redemptions', 'POST /coupons/review', 'DELETE /coupons/:id', 'POST /promotions/:id/active']));
    for (const l of ['POST /promotions/review', 'GET /promotions/summary', 'GET /coupons/all', 'GET /coupons/:id/redemptions', 'POST /coupons/review', 'DELETE /coupons/:id'])
      expect(routes.find((r) => r.label.startsWith(l))!.perms).toEqual(['promotion.manage']);
    for (const r of routes.filter((x) => x.m !== 'GET')) { expect(r.act).toBeUndefined(); expect(auditorVerdict(['auditor'], r.m, r.act as never)).toBe('refused'); }
  });
});

describe('B4 / F-9 · the module registers both sweeps and the three lifecycle handlers', () => {
  const mod = fs.readFileSync(path.join(__dirname, '../promotions.module.ts'), 'utf8');
  it('budget watch + festival scheduler through SCHEDULED_JOB_REGISTRY; order created / cancelled / refunded through the outbox registry', () => {
    expect(mod).toMatch(/this\.jobs\.register\(this\.budgetWatch\)/);
    expect(mod).toMatch(/this\.jobs\.register\(this\.festival\)/);
    expect(mod).toMatch(/new OrderClosedHandler\('orders\.order_cancelled'/);
    expect(mod).toMatch(/new OrderClosedHandler\('orders\.order_refunded'/);
    expect(mod).toMatch(/this\.registry\.register\(this\.orderCreated\)/);
  });
  it('the payments settlement calls the promotion top-up after the escrow leg (and on a zero-escrow order)', () => {
    // PC-56 TENANT-SW-a: the settlement body moved from the handler to OrderSettlementService (shared with the hold release, same key)
    const h = fs.readFileSync(path.join(__dirname, '../../payments/services/order-settlement.service.ts'), 'utf8');
    expect(h.match(/this\.couponMoney\.settleOrderInTx\(tx, \{ tenantId, orderId, sellerUserId \}\)/g)).toHaveLength(2);
    expect(h.indexOf("idempotencyKey: `settle:${orderId}`")).toBeLessThan(h.lastIndexOf('this.couponMoney.settleOrderInTx'));
    const handler = fs.readFileSync(path.join(__dirname, '../../payments/events/handlers/order-completed.handler.ts'), 'utf8');
    expect(handler).toContain('this.settlement.settle(tx, event.tenantId, event.aggregateId');
  });
});

describe('0185 + seed 0005 · as text', () => {
  const mig = fs.readFileSync(path.join(__dirname, '../../../../../../db/migrations/0185_promotion_money.sql'), 'utf8');
  const seed = fs.readFileSync(path.join(__dirname, '../../../../../../db/seeds/core/0005_lookup_vocabularies.sql'), 'utf8');
  it('the attempts table: RLS ENABLE + FORCE, the 0175 split with WITH CHECK, kv_app SELECT + INSERT only, append-only trigger', () => {
    expect(mig).toMatch(/ALTER TABLE coupon_redemption_attempts ENABLE ROW LEVEL SECURITY/);
    expect(mig).toMatch(/ALTER TABLE coupon_redemption_attempts FORCE ROW LEVEL SECURITY/);
    expect(mig).toMatch(/CREATE POLICY cra_insert_own\s+ON coupon_redemption_attempts FOR INSERT WITH CHECK \(tenant_id = current_tenant_id\(\)\)/);
    expect(mig).toMatch(/GRANT SELECT, INSERT ON coupon_redemption_attempts TO kv_app;/);
    expect(mig).toMatch(/BEFORE UPDATE OR DELETE ON coupon_redemption_attempts/);
    expect(mig).not.toMatch(/GRANT[^;]*(UPDATE|DELETE)[^;]*ON coupon_redemption_attempts/);
  });
  it('kv_relay gets SELECT + UPDATE(settled_txn_id, settled_at) on coupon_redemptions and nothing else', () => {
    const relay = mig.split(';').filter((s) => /TO kv_relay/.test(s)).map((s) => s.trim().replace(/\s+/g, ' '));
    expect(relay).toEqual(['GRANT SELECT ON coupon_redemptions TO kv_relay', 'GRANT UPDATE (settled_txn_id, settled_at) ON coupon_redemptions TO kv_relay']);
  });
  it('the three txn types live in BOTH the migration and the fresh-install seed', () => {
    for (const code of ['promo_hold', 'promo_settle', 'promo_release']) { expect(mig).toContain(`'${code}'`); expect(seed).toContain(`'${code}'`); }
  });
});
