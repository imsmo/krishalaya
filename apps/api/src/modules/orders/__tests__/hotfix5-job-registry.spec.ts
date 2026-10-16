// modules/orders/__tests__/hotfix5-job-registry.spec.ts · PC-56 HOTFIX-5 — THE CLOCKS ARE REGISTERED, AND THE PURE RULES THEY STAND ON.
//
// (1) THE REGISTRY GATE (founder D2, survey F-1 / C-2): the REAL AppModule is constructed (no database is dialled — the boot gate's shape), the
//     two modules' `onModuleInit` run, and SCHEDULED_JOB_REGISTRY must hold `seller-confirm-timeout`, `quality-window-complete` and
//     `offers-expire`, each at the cadence the table (core/jobs/clock-cadence.ts) gives it. Drop one registration → red.
// (2) The pure rules: the 24 h timeout never touches an auction order (D2 / F-2); the quality window; the one order-number helper (the random
//     bits — two orders minted in one millisecond differ, F-6); currency from the listing or a named refusal (F-8); the buyer's event shape (F-7).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../../core/jobs/scheduled-job.registry';
import { CLOCK_CADENCE_MS, CLOCK_NAMES } from '../../../core/jobs/clock-cadence';
import { uuidv7 } from '../../../core/database/uuid.util';
import { sellerConfirmTimeoutDue, qualityWindowDue, SELLER_CONFIRM_TIMEOUT_EXCLUDED_SOURCES, QUALITY_WINDOW_REQUIRES_ONLINE_PAYMENT } from '../domain/order-clocks';
import { orderNoFor } from '../domain/order-no';
import { currencyFromListing } from '../domain/order-currency';
import { actorRoleOf, buyerTimeline, staffTimeline, viewerRoleOf } from '../domain/order-event-roles';

describe('PC-56 HOTFIX-5 · (1) the three clocks are in SCHEDULED_JOB_REGISTRY at the table\'s cadence', () => {
  const env = { ...process.env };
  let app: INestApplication | undefined;
  beforeAll(() => {
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'hotfix5-gate-access-secret-hotfix5-32';
    process.env.AUTH_HASH_PEPPER = process.env.AUTH_HASH_PEPPER || 'hotfix5-gate-hash-pepper-hotfix5-32b';
    process.env.SHARD_COUNT = process.env.SHARD_COUNT || '1';
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://kv_app:unused@127.0.0.1:1/hotfix5_never_dialled';
  });
  afterAll(async () => { await app?.close().catch(() => undefined); process.env = env; });

  it('OrdersModule + OffersModule register seller-confirm-timeout, quality-window-complete and offers-expire — none missing, none twice', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../../../app.module') as typeof import('../../../app.module');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OrdersModule } = require('../orders.module') as typeof import('../orders.module');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OffersModule } = require('../../offers/offers.module') as typeof import('../../offers/offers.module');
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    // construction only (no init → no module dials anything); the two modules' registration runs here, exactly as boot runs it
    app.get(OrdersModule, { strict: false }).onModuleInit();
    app.get(OffersModule, { strict: false }).onModuleInit();
    const jobs = app.get<ScheduledJobRegistry>(SCHEDULED_JOB_REGISTRY, { strict: false });
    const byName = new Map(jobs.list().map((j) => [j.name, j]));
    for (const name of ['seller-confirm-timeout', 'quality-window-complete', 'offers-expire']) {
      expect(`${name}:${byName.has(name)}`).toBe(`${name}:true`);
      expect(`${name}:${byName.get(name)?.intervalMs}`).toBe(`${name}:${CLOCK_CADENCE_MS[name as keyof typeof CLOCK_CADENCE_MS]}`);
    }
    // PC-56 STORE-3c · B8: the table also carries the group-lot deadline clock (its own registry spec: group-lots/__tests__/store3c-deadline-registry.spec.ts)
    // PC-56 HOTFIX-7 · B23: + the two dispute clocks (their registry case: the hotfix7 live spec, group (9))
    expect([...CLOCK_NAMES].sort()).toEqual(['dispute-seller-response-timeout', 'dispute-sla-escalation', 'group-lots-deadline', 'offers-expire', 'quality-window-complete', 'seller-confirm-timeout']);
  }, 120_000);
});

describe('PC-56 HOTFIX-5 · (2) the pure rules', () => {
  const now = new Date('2026-10-15T10:00:00Z');
  const past = new Date('2026-10-15T09:59:59Z');
  const future = new Date('2026-10-15T10:00:01Z');

  it('the seller-confirm timeout: created / payment_pending past the deadline — NEVER an auction order (founder D2)', () => {
    expect(SELLER_CONFIRM_TIMEOUT_EXCLUDED_SOURCES).toEqual(['auction']);
    expect(sellerConfirmTimeoutDue({ status: 'created', source: 'direct', acceptanceDeadline: past }, now)).toBe(true);
    expect(sellerConfirmTimeoutDue({ status: 'payment_pending', source: 'offer', acceptanceDeadline: past }, now)).toBe(true);
    expect(sellerConfirmTimeoutDue({ status: 'payment_pending', source: 'auction', acceptanceDeadline: past }, now)).toBe(false);
    expect(sellerConfirmTimeoutDue({ status: 'created', source: 'auction', acceptanceDeadline: past }, now)).toBe(false);
    expect(sellerConfirmTimeoutDue({ status: 'created', source: 'direct', acceptanceDeadline: future }, now)).toBe(false);
    expect(sellerConfirmTimeoutDue({ status: 'confirmed', source: 'direct', acceptanceDeadline: past }, now)).toBe(false);
    expect(sellerConfirmTimeoutDue({ status: 'cancelled', source: 'direct', acceptanceDeadline: past }, now)).toBe(false);   // a second tick: refused
    expect(sellerConfirmTimeoutDue({ status: 'created', source: 'direct', acceptanceDeadline: null }, now)).toBe(false);
  });

  it('the quality window: delivered past quality_window_ends only (a completed / disputed order is never touched); paid-online only (fail closed)', () => {
    expect(QUALITY_WINDOW_REQUIRES_ONLINE_PAYMENT).toBe(true);   // a pay-on-delivery order's settlement would credit the seller from an empty escrow
    expect(qualityWindowDue({ status: 'delivered', qualityWindowEnds: past }, now)).toBe(true);
    expect(qualityWindowDue({ status: 'delivered', qualityWindowEnds: future }, now)).toBe(false);
    expect(qualityWindowDue({ status: 'completed', qualityWindowEnds: past }, now)).toBe(false);
    expect(qualityWindowDue({ status: 'disputed', qualityWindowEnds: past }, now)).toBe(false);
    expect(qualityWindowDue({ status: 'delivered', qualityWindowEnds: null }, now)).toBe(false);
  });

  it('orderNoFor: KV<year>-<LAST 8 hex> — two ids minted in the same millisecond get different numbers (the timestamp prefix collided)', () => {
    expect(orderNoFor('0199f2a1-1234-7abc-8def-0123456789ab', now)).toBe('KV2026-456789AB');
    const ids = Array.from({ length: 200 }, () => uuidv7());
    const sameMs = ids.filter((x) => x.slice(0, 8) === ids[0].slice(0, 8));
    expect(sameMs.length).toBeGreaterThan(1);                                          // the old rule's prefix repeats …
    expect(new Set(sameMs.map((x) => orderNoFor(x, now))).size).toBe(sameMs.length);  // … the helper's numbers do not
  });

  it('currencyFromListing: the listing\'s code (upper-cased) or ORDER_CURRENCY_UNKNOWN — never an assumed INR', () => {
    expect(currencyFromListing('usd', 'offer', 'o1')).toBe('USD');
    expect(currencyFromListing('INR', 'auction', 'a1')).toBe('INR');
    for (const bad of [undefined, null, '', 'RUPEE', 12]) expect(() => currencyFromListing(bad, 'offer', 'o1')).toThrow(expect.objectContaining({ code: 'ORDER_CURRENCY_UNKNOWN' }));
  });

  it('events: a BUYER reads roles only — no id, no name, no note; the seller / staff keep the row plus the role', () => {
    const order = { buyerUserId: 'B', sellerUserId: 'S' };
    expect(viewerRoleOf({ userId: 'B', canModerate: false }, order)).toBe('buyer');
    expect(viewerRoleOf({ userId: 'S', canModerate: false }, order)).toBe('seller');
    expect(viewerRoleOf({ userId: 'M', canModerate: true }, order)).toBe('moderator');
    expect([actorRoleOf(null, order), actorRoleOf('B', order), actorRoleOf('S', order), actorRoleOf('M', order)]).toEqual(['system', 'buyer', 'seller', 'moderator']);
    const rows = [{ fromStatus: 'created', toStatus: 'confirmed', note: null, actorUserId: 'S', actorName: 'Ramesh Kumar Patel', at: '2026-10-15T10:00:00Z' },
      { fromStatus: 'confirmed', toStatus: 'cancelled', note: 'system', actorUserId: null, actorName: null, at: '2026-10-15T11:00:00Z' }];
    const forBuyer = buyerTimeline(rows, order);
    expect(forBuyer).toEqual([{ fromStatus: 'created', toStatus: 'confirmed', actorRole: 'seller', at: '2026-10-15T10:00:00Z' },
      { fromStatus: 'confirmed', toStatus: 'cancelled', actorRole: 'system', at: '2026-10-15T11:00:00Z' }]);
    expect(JSON.stringify(forBuyer)).not.toMatch(/Ramesh|"S"|actorUserId|actorName|note/);
    expect(staffTimeline(rows, order)[0]).toMatchObject({ actorName: 'Ramesh Kumar Patel', actorUserId: 'S', actorRole: 'seller' });
  });
});
