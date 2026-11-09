// modules/equipment/__tests__/hotfix13-her-money.spec.ts · PC-56 HOTFIX-13 — NOBODY SPENDS HER MONEY BUT HER (unit, machine hire).
// Founder Q1-A (2026-11-09): nothing beyond the deposit leaves the renter's wallet until she confirms the hours herself, in her own
// session; until then the owner can be paid only from the deposit. Nobody but the payer spends the payer's money (the hire deposit).
// Each refusal is pinned WITH an ordering log: refused before `idem.remember`, before the unit of work and before any write.
// Live twin: src/__tests__/hotfix13-her-money.integration.spec.ts.
import { EquipmentBookingService } from '../services/equipment-booking.service';
import { EquipmentBooking } from '../domain/equipment-booking.entity';
import { EquipmentEventType } from '../domain/equipment.events';

const T = 't1';
const owner = { userId: 'owner1', canManage: true, canRent: false, isAdmin: false };
const renter = { userId: 'renter1', canManage: false, canRent: true, isAdmin: false };
/** an organisation administrator (booking.manage) who ALSO holds equipment.manage + equipment.rent — the F-2 person. */
const admin = { userId: 'admin1', canManage: true, canRent: true, isAdmin: true };
const stranger = { userId: 'other1', canManage: true, canRent: true, isAdmin: false };

function hire(stage: 'quoted' | 'confirmed' | 'in_progress' | 'completed', o: { advance?: bigint; actualCenti?: bigint } = {}) {
  // rate ₹500/h (50000 minor), estimate 4.00 h
  const b = EquipmentBooking.request({ id: 'b1', tenantId: T, bookingNo: 'EQ-X', renterUserId: 'renter1', assetId: 'a1', ownerUserId: 'owner1',
    operatorUserId: null, taskDesc: null, rateBasis: 'per_hour', rateMinor: 50000n, estQuantityCenti: 400n, scheduledAt: new Date() });
  b.quote(o.advance ?? 80000n);
  if (stage !== 'quoted') b.confirm('H');
  if (stage === 'in_progress' || stage === 'completed') b.start('H', new Date());
  if (stage === 'completed') b.complete(o.actualCenti ?? 350n, new Date());
  b.pullEvents();
  return b;
}

/** Every collaborator records into ONE ordered log, so "refused before X" is a fact about the log. */
function harness(pre: EquipmentBooking | null, locked: EquipmentBooking | null = pre, cfgOtp = false) {
  const log: string[] = [];
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => { log.push('uow'); return fn(tx); }) };
  const outbox = { write: jest.fn(async (_tx: unknown, e: { eventType: string; payload: Record<string, unknown> }) => { log.push(`outbox:${e.eventType}`); }) };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: () => unknown) => { log.push('idem'); return fn(); }) };
  const metrics = { inc: jest.fn(), observe: jest.fn(), timing: jest.fn() };
  const audit = { write: jest.fn(async (_tx: unknown, e: { action: string }) => { log.push(`audit:${e.action}`); }) };
  const wallet = { post: jest.fn(async (_tx: unknown, a: { txnType: string; idempotencyKey: string }) => { log.push(`wallet:${a.idempotencyKey.split(':')[0]}`); return { txnId: 't', alreadyApplied: false }; }), balanceMinor: jest.fn() };
  const bookings = {
    getById: jest.fn(async () => { log.push('pre'); return pre; }),
    getForUpdate: jest.fn(async () => { log.push('lock'); return locked; }),
    update: jest.fn(async () => { log.push('update'); }),
    confirmUsage: jest.fn(async () => { log.push('stamp'); return true; }),
    listFor: jest.fn(), insert: jest.fn(),
  };
  const cfg = { auth: { hashPepper: 'pepper', exposeOtp: cfgOtp } } as never;
  const svc = new EquipmentBookingService(uow as never, outbox as never, idem as never, metrics as never, audit as never, cfg, wallet as never, bookings as never, {} as never, {} as never);
  return { svc, log, wallet, audit, outbox, idem, uow, bookings };
}

describe('PC-56 HOTFIX-13 · B2 — confirm escrows HER deposit: only she confirms', () => {
  it.each([['an administrator with equipment.rent', admin], ['another renter', stranger], ['the machine owner', { ...owner, canRent: true }]])(
    '%s confirming her hire → EQ_CONFIRM_NOT_RENTER (403), before idem.remember, the unit of work and any escrow leg', async (_n, actor) => {
      const h = harness(hire('quoted'));
      await expect(h.svc.confirm(T, actor, 'b1', 'k')).rejects.toMatchObject({ code: 'EQ_CONFIRM_NOT_RENTER', httpStatus: 403 });
      expect(h.log).toEqual(['pre']);
      expect(h.wallet.post).not.toHaveBeenCalled(); expect(h.idem.remember).not.toHaveBeenCalled();
    });

  it('the renter confirms → the escrow hold from HER wallet, and the start code in HER response (with exposeOtp OFF)', async () => {
    const h = harness(hire('quoted'), hire('quoted'), false);
    const out = await h.svc.confirm(T, renter, 'b1', 'k') as { startOtp?: string; status: string };
    expect(h.log).toEqual(['pre', 'idem', 'uow', 'lock', 'wallet:eqbook-hold', 'update', `outbox:${EquipmentEventType.BookingConfirmed}`]);
    expect(out.status).toBe('confirmed'); expect(out.startOtp).toMatch(/^\d{6}$/);
    // B4: the code is in no event payload
    for (const c of h.outbox.write.mock.calls as unknown as [unknown, { payload: Record<string, unknown> }][]) expect(JSON.stringify(c[1].payload)).not.toContain(out.startOtp!);
  });

  it('B4: the start code is never in a read, a list or an owner response (toJSON carries neither the code nor its hash)', () => {
    const json = hire('confirmed').toJSON() as Record<string, unknown>;
    expect(Object.keys(json)).not.toEqual(expect.arrayContaining(['startOtp']));
    expect(Object.keys(json).some((k) => /otp/i.test(k))).toBe(false);
  });
});

describe('PC-56 HOTFIX-13 · B2 — quote / start / complete / settle are the machine owner\'s acts only', () => {
  it.each([
    ['quote', (s: EquipmentBookingService, a: typeof admin) => s.quote(T, a, 'b1', { advanceMinor: '1000' } as never), 'quoted'],
    ['start', (s: EquipmentBookingService, a: typeof admin) => s.start(T, a, 'b1', { otp: '123456' } as never), 'confirmed'],
    ['complete', (s: EquipmentBookingService, a: typeof admin) => s.complete(T, a, 'b1', { actualQuantity: '3.50' } as never), 'in_progress'],
  ] as const)('an administrator calling %s → EQ_NOT_MACHINE_OWNER (403), before the unit of work', async (_n, call, stage) => {
    const h = harness(hire(stage === 'quoted' ? 'quoted' : stage));
    await expect(call(h.svc, admin)).rejects.toMatchObject({ code: 'EQ_NOT_MACHINE_OWNER', httpStatus: 403 });
    expect(h.log).toEqual(['pre']); expect(h.uow.run).not.toHaveBeenCalled();
  });

  it('an administrator settling → EQ_NOT_MACHINE_OWNER (403), before idem.remember and any ledger leg — even with her confirmation', async () => {
    const b = hire('completed'); b.confirmUsage('renter1', new Date());
    const h = harness(b);
    await expect(h.svc.settle(T, admin, 'b1', 'k', null)).rejects.toMatchObject({ code: 'EQ_NOT_MACHINE_OWNER', httpStatus: 403 });
    expect(h.log).toEqual(['pre']); expect(h.wallet.post).not.toHaveBeenCalled();
  });

  it('cancel KEEPS its administrator escape: on a confirmed hire it only refunds HER deposit (escrow → her wallet)', async () => {
    const h = harness(hire('confirmed'));
    // NAMED UPDATE (PC-56 OPS-4a · E10): cancel is now Idempotency-Keyed and takes a strict body; the escape and the legs are unchanged.
    await h.svc.cancel(T, admin, 'b1', 'k-cancel', {}, null);
    const legs = (h.wallet.post.mock.calls as unknown as [unknown, { txnType: string; legs: { account: { userId?: string; kind?: string }; amountMinor: bigint }[] }][]).map((c) => c[1]);
    expect(legs).toHaveLength(1); expect(legs[0].txnType).toBe('escrow_release');
    expect(legs[0].legs.find((l) => l.amountMinor > 0n)!.account.userId).toBe('renter1');
  });
});

describe('PC-56 HOTFIX-13 · B1 — confirm-usage: the renter confirms the hours, in her own session', () => {
  it.each([['the machine owner', { ...owner, canRent: true }], ['an administrator', admin], ['anyone else', stranger]])(
    '%s → USAGE_CONFIRM_NOT_RENTER (403), before idem.remember, the unit of work and any write', async (_n, actor) => {
      const h = harness(hire('completed'));
      await expect(h.svc.confirmUsage(T, actor, 'b1', 'k', null)).rejects.toMatchObject({ code: 'USAGE_CONFIRM_NOT_RENTER', httpStatus: 403 });
      expect(h.log).toEqual(['pre']);
    });

  it('the renter on a completed hire → stamped, ONE audit row with the hours and the total; no ledger leg; no event', async () => {
    const h = harness(hire('completed'));
    const out = await h.svc.confirmUsage(T, renter, 'b1', 'k', '10.0.0.1');
    expect(h.log).toEqual(['pre', 'idem', 'uow', 'lock', 'stamp', 'audit:equipment.booking.usage_confirmed']);
    const entry = (h.audit.write.mock.calls[0] as unknown[])[1] as { newValue: Record<string, unknown>; entityId: string; actorUserId: string };
    expect(entry).toMatchObject({ entityId: 'b1', actorUserId: 'renter1' });
    expect(entry.newValue).toMatchObject({ actualQuantity: '3.50', totalMinor: '175000', advanceMinor: '80000', rateMinor: '50000' });
    expect(out.usageConfirmedAt).toBeInstanceOf(Date);
    expect(h.wallet.post).not.toHaveBeenCalled();
  });

  it('a hire not yet completed → USAGE_NOT_CONFIRMABLE (409) inside the record, nothing written', async () => {
    const h = harness(hire('in_progress'));
    await expect(h.svc.confirmUsage(T, renter, 'b1', 'k', null)).rejects.toMatchObject({ code: 'USAGE_NOT_CONFIRMABLE', httpStatus: 409 });
    expect(h.bookings.confirmUsage).not.toHaveBeenCalled(); expect(h.audit.write).not.toHaveBeenCalled();
  });

  it('already confirmed → USAGE_ALREADY_CONFIRMED (409), nothing written; a racing second stamp that updates no row → the same', async () => {
    const b = hire('completed'); b.confirmUsage('renter1', new Date());
    const h = harness(b);
    await expect(h.svc.confirmUsage(T, renter, 'b1', 'k', null)).rejects.toMatchObject({ code: 'USAGE_ALREADY_CONFIRMED' });
    expect(h.audit.write).not.toHaveBeenCalled();
    const h2 = harness(hire('completed')); h2.bookings.confirmUsage.mockImplementation(async () => false);
    await expect(h2.svc.confirmUsage(T, renter, 'b1', 'k', null)).rejects.toMatchObject({ code: 'USAGE_ALREADY_CONFIRMED' });
    expect(h2.audit.write).not.toHaveBeenCalled();
  });
});

describe('PC-56 HOTFIX-13 · B1 — the settle branch table (founder Q1-A)', () => {
  // rate ₹500/h; advance ₹800 (80000); 3.50 h → ₹1750 (175000) beyond; 1.00 h → ₹500 (50000) within; 1.60 h → ₹800 = the deposit.
  const legsOf = (h: ReturnType<typeof harness>) => (h.wallet.post.mock.calls as unknown as [unknown, { idempotencyKey: string }][]).map((c) => c[1].idempotencyKey.split(':')[0]);

  it('total > deposit, NOT confirmed → SETTLE_HOURS_NOT_CONFIRMED (409), before idem.remember: no ledger leg, no audit row', async () => {
    const h = harness(hire('completed', { actualCenti: 350n }));
    await expect(h.svc.settle(T, owner, 'b1', 'k', null)).rejects.toMatchObject({ code: 'SETTLE_HOURS_NOT_CONFIRMED', httpStatus: 409,
      message: 'Not settled: the renter has not confirmed these hours in her own app. Nothing beyond the deposit leaves the renter\'s wallet until she confirms those hours in her own app.' });
    expect(h.log).toEqual(['pre']); expect(h.wallet.post).not.toHaveBeenCalled(); expect(h.audit.write).not.toHaveBeenCalled();
  });

  it('total > deposit, confirmed → escrow release + the shortfall from her wallet; one audit row naming her confirmation', async () => {
    const b = hire('completed', { actualCenti: 350n }); b.confirmUsage('renter1', new Date('2026-11-09T05:00:00Z'));
    const h = harness(b);
    await h.svc.settle(T, owner, 'b1', 'k', null);
    expect(legsOf(h)).toEqual(['eqbook-release', 'eqbook-collect']);
    const entry = (h.audit.write.mock.calls[0] as unknown[])[1] as { newValue: Record<string, unknown> };
    expect(entry.newValue).toMatchObject({ totalMinor: '175000', advanceMinor: '80000', usageConfirmedBy: 'renter1', usageConfirmedAt: '2026-11-09T05:00:00.000Z' });
  });

  it('total < deposit, NOT confirmed → allowed: the deposit pays the owner the bill and the rest goes back to her; nothing else from her wallet', async () => {
    const h = harness(hire('completed', { actualCenti: 100n }));
    await h.svc.settle(T, owner, 'b1', 'k', null);
    expect(legsOf(h)).toEqual(['eqbook-release', 'eqbook-refund']);
  });

  it('total = deposit, NOT confirmed → allowed: the deposit alone, no refund, no shortfall', async () => {
    const h = harness(hire('completed', { actualCenti: 160n }));
    await h.svc.settle(T, owner, 'b1', 'k', null);
    expect(legsOf(h)).toEqual(['eqbook-release']);
  });

  it('the locked row decides too: a pre-read that saw a confirmation the locked row does not hold → refused inside, no ledger leg', async () => {
    const seen = hire('completed'); seen.confirmUsage('renter1', new Date());
    const h = harness(seen, hire('completed'));
    await expect(h.svc.settle(T, owner, 'b1', 'k', null)).rejects.toMatchObject({ code: 'SETTLE_HOURS_NOT_CONFIRMED' });
    expect(h.log).toEqual(['pre', 'idem', 'uow', 'lock']); expect(h.wallet.post).not.toHaveBeenCalled();
  });

  it('a hire she never confirms stays completed and unsettled: settle keeps refusing, and nothing in this service times it out', async () => {
    const b = hire('completed');
    const h = harness(b);
    for (let i = 0; i < 3; i++) await expect(h.svc.settle(T, owner, 'b1', `k${i}`, null)).rejects.toMatchObject({ code: 'SETTLE_HOURS_NOT_CONFIRMED' });
    expect(b.status).toBe('completed');
    await h.svc.timeout(T, 'b1');   // the only timeout acts on requested/quoted hires — a completed one is left as it is
    expect(b.status).toBe('completed'); expect(h.wallet.post).not.toHaveBeenCalled();
  });
});
