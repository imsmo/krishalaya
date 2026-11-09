// modules/equipment/__tests__/equipment-booking.service.spec.ts · BookingService unit tests with fakes.
// Pins THE ESCROW MONEY PATH: confirm() holds the advance (renter → Escrow); settle() releases the escrow
// to the owner, collects a shortfall (total>advance) or refunds the unused hold (total<advance) — each a
// ZERO-SUM, idempotent wallet post. Real SQL/RLS = integration spec.
import { EquipmentBookingService } from '../services/equipment-booking.service';
import { EquipmentBooking } from '../domain/equipment-booking.entity';

const cfg = { auth: { hashPepper: 'pepper', exposeOtp: true } } as any;
function harness(booking: EquipmentBooking) {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const audit = { write: jest.fn() };
  const wallet = { post: jest.fn(async () => ({ txnId: 't', alreadyApplied: false })), balanceMinor: jest.fn() };
  // [PC-56 HOTFIX-13 · NAMED UPDATE] the services now PRE-READ the row (getById) to refuse before the idempotency record; the fake
  // answers that read with the same booking. Nothing else in this harness changed.
  const bookings = { getForUpdate: jest.fn(async () => booking), update: jest.fn(), getById: jest.fn(async () => booking), listFor: jest.fn(), insert: jest.fn(), confirmUsage: jest.fn(async () => true) };
  const assets = { getById: jest.fn() }; const rates = { resolveActive: jest.fn() };
  const svc = new EquipmentBookingService(uow as any, outbox as any, idem as any, metrics as any, audit as any, cfg, wallet as any, bookings as any, assets as any, rates as any);
  return { svc, wallet };
}
const completed = (advance: bigint, actualCenti: bigint) => {
  const b = EquipmentBooking.request({ id: 'b1', tenantId: 't1', bookingNo: 'EQ-X', renterUserId: 'renter1', assetId: 'a1', ownerUserId: 'owner1',
    operatorUserId: null, taskDesc: null, rateBasis: 'per_hour', rateMinor: 50000n, estQuantityCenti: 400n, scheduledAt: new Date() });
  b.quote(advance); b.confirm('H'); b.start('H', new Date()); b.complete(actualCenti, new Date()); b.pullEvents();
  return b;
};
const owner = { userId: 'owner1', canManage: true, canRent: false, isAdmin: false };
const sumZero = (legs: any[]) => legs.reduce((a, l) => a + l.amountMinor, 0n) === 0n;

describe('settle — escrow release + shortfall/refund (zero-sum)', () => {
  it('total > advance: release advance to owner + collect shortfall from renter', async () => {
    // advance 80000, actual 3.50h → total 175000 ; shortfall 95000
    // [PC-56 HOTFIX-13 · NAMED UPDATE, founder Q1-A] the shortfall leg now needs HER confirmation of the hours first; this case
    // pins the money arithmetic AFTER she has confirmed (the unconfirmed refusal is pinned in hotfix13-her-money.spec.ts).
    const b = completed(80000n, 350n); b.confirmUsage('renter1', new Date());
    const { svc, wallet } = harness(b);
    const out = await svc.settle('t1', owner, 'b1', 'idem-s', null);
    expect(out.status).toBe('settled'); expect(out.settledTotalMinor).toBe('175000');
    const calls = (wallet.post.mock.calls as any[]).map((c) => c[1]);
    const release = calls.find((a) => a.idempotencyKey === 'eqbook-release:b1');
    const collect = calls.find((a) => a.idempotencyKey === 'eqbook-collect:b1');
    expect(release).toBeTruthy(); expect(collect).toBeTruthy();
    expect(calls.find((a) => a.idempotencyKey === 'eqbook-refund:b1')).toBeUndefined();
    expect(sumZero(release.legs)).toBe(true); expect(sumZero(collect.legs)).toBe(true);
    // owner credited 80000 (escrow) + 95000 (shortfall) = 175000 total
    const ownerCredit = release.legs.find((l: any) => l.amountMinor > 0n).amountMinor + collect.legs.find((l: any) => l.amountMinor > 0n).amountMinor;
    expect(ownerCredit).toBe(175000n);
  });
  it('total < advance: release total to owner + refund the unused hold to the renter', async () => {
    // advance 200000, actual 3.50h → total 175000 ; refund 25000
    const { svc, wallet } = harness(completed(200000n, 350n));
    await svc.settle('t1', owner, 'b1', 'idem-s', null);
    const calls = (wallet.post.mock.calls as any[]).map((c) => c[1]);
    const release = calls.find((a) => a.idempotencyKey === 'eqbook-release:b1');
    const refund = calls.find((a) => a.idempotencyKey === 'eqbook-refund:b1');
    expect(release).toBeTruthy(); expect(refund).toBeTruthy();
    expect(calls.find((a) => a.idempotencyKey === 'eqbook-collect:b1')).toBeUndefined();
    expect(release.legs.find((l: any) => l.amountMinor > 0n).amountMinor).toBe(175000n);  // owner gets total
    expect(refund.legs.find((l: any) => l.amountMinor > 0n).amountMinor).toBe(25000n);     // renter refunded
    expect(sumZero(release.legs) && sumZero(refund.legs)).toBe(true);
  });
});

describe('confirm — escrows the advance', () => {
  it('posts an escrow_hold renter → Escrow (zero-sum)', async () => {
    const b = EquipmentBooking.request({ id: 'b1', tenantId: 't1', bookingNo: 'EQ-X', renterUserId: 'renter1', assetId: 'a1', ownerUserId: 'owner1',
      operatorUserId: null, taskDesc: null, rateBasis: 'per_hour', rateMinor: 50000n, estQuantityCenti: 400n, scheduledAt: new Date() });
    b.quote(80000n); b.pullEvents();
    const { svc, wallet } = harness(b);
    const renter = { userId: 'renter1', canManage: false, canRent: true, isAdmin: false };
    await svc.confirm('t1', renter, 'b1', 'idem-c');
    const arg: any = (wallet.post.mock.calls as any[])[0][1];
    expect(arg.txnType).toBe('escrow_hold'); expect(arg.idempotencyKey).toBe('eqbook-hold:b1');
    expect(sumZero(arg.legs)).toBe(true);
    expect(arg.legs.find((l: any) => l.amountMinor < 0n).account.userId).toBe('renter1');
    expect(arg.legs.find((l: any) => l.amountMinor > 0n).account.kind).toBe('platform');
  });
});
