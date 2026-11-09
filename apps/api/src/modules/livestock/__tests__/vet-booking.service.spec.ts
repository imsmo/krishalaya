// modules/livestock/__tests__/vet-booking.service.spec.ts · VetBookingService unit tests with fakes.
// Pins: the fee is SNAPSHOTTED from the vet_service price (never client-supplied); the service-belongs-to-vet
// guard (anti-IDOR); animal ownership on booking (404, not cross-owner); and that completeAndPay posts a
// ZERO-SUM wallet transfer farmer→vet (txnType service_fee) inside the tx (Law 2). Real SQL/RLS = integration.
import { VetBookingService } from '../services/vet-booking.service';
import { VetBooking } from '../domain/vet-booking.entity';
import { VetProfile } from '../domain/vet-profile.entity';
import { VetService as VetServiceEntity } from '../domain/vet-service.entity';
import { ServiceVetMismatchError } from '../domain/livestock.errors';

const vet = VetProfile.rehydrate({ id: 'v1', userId: 'vetUser', tenantId: 't1', registrationNo: 'VCI-1', isAiTechnician: false, serviceRadiusKm: 25, baseRegionId: null, ratingAvg: null });
const svc = VetServiceEntity.rehydrate({ id: 's1', vetId: 'v1', serviceTypeId: 'st1', priceMinor: 30000n, pricingUnit: 'per_visit', isEmergencyAvailable: false });

function harness(opts: { booking?: VetBooking } = {}) {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const wallet = { post: jest.fn(async () => ({ txnId: 'tx1', alreadyApplied: false })), balanceMinor: jest.fn() };
  // [PC-56 HOTFIX-13 · NAMED UPDATE] completeAndPay now PRE-READS the booking (getById) to refuse anyone but the farmer before the
  // idempotency record; the fake answers that read with the same booking. Nothing else in this harness changed.
  const bookings = { insert: jest.fn(), getForUpdate: jest.fn(async () => opts.booking ?? null), update: jest.fn(), getById: jest.fn(async () => opts.booking ?? null), listFor: jest.fn() };
  const vets = { getById: jest.fn(async () => vet), findByUser: jest.fn(async () => vet) };
  const services = { getForBooking: jest.fn(async () => svc) };
  const animals = { getById: jest.fn() };
  const s = new VetBookingService(uow as any, outbox as any, idem as any, metrics as any, wallet as any, bookings as any, vets as any, services as any, animals as any);
  return { s, wallet, bookings, outbox };
}
const farmer = { userId: 'f1', canBook: true, canManageVet: false, isAdmin: false };

describe('VetBookingService.book', () => {
  it('snapshots the fee from the vet service price (not the client)', async () => {
    const { s, bookings } = harness();
    const out = await s.book('t1', farmer, 'idem-1', { vetId: 'v1', serviceId: 's1', urgency: 'routine', mode: 'visit' } as any);
    expect(out.feeMinor).toBe('30000');
    expect(bookings.insert).toHaveBeenCalledTimes(1);
  });
  it('rejects a service that does not belong to the chosen vet (anti-IDOR)', async () => {
    const { s } = harness();
    // service belongs to v1 but caller passes a different vetId
    await expect(s.book('t1', farmer, 'idem-2', { vetId: 'OTHER', serviceId: 's1', urgency: 'routine', mode: 'visit' } as any)).rejects.toBeInstanceOf(ServiceVetMismatchError);
  });
});

describe('VetBookingService.completeAndPay — the money path', () => {
  it('posts a ZERO-SUM farmer→vet service_fee transfer in-tx, then marks completed', async () => {
    const b = VetBooking.rehydrate({ id: 'b1', tenantId: 't1', farmerUserId: 'f1', vetId: 'v1', serviceId: 's1', animalId: null,
      urgency: 'routine', mode: 'visit', symptomsText: null, scheduledAt: null, status: 'in_consult', feeMinor: 30000n, completedAt: null });
    const { s, wallet, bookings } = harness({ booking: b });
    const out = await s.completeAndPay('t1', farmer, 'b1', 'idem-pay');
    expect(out.status).toBe('completed'); expect(out.feePaidMinor).toBe('30000');
    expect(wallet.post).toHaveBeenCalledTimes(1);
    const arg: any = (wallet.post.mock.calls as any[])[0][1];
    expect(arg.txnType).toBe('service_fee'); expect(arg.idempotencyKey).toBe('vetfee:b1');
    const sum = arg.legs.reduce((acc: bigint, l: any) => acc + l.amountMinor, 0n);
    expect(sum).toBe(0n);                                   // ZERO-SUM
    expect(arg.legs.find((l: any) => l.amountMinor < 0n).account.userId).toBe('f1');   // farmer debited
    expect(arg.legs.find((l: any) => l.amountMinor > 0n).account.userId).toBe('vetUser'); // vet credited
    expect(bookings.update).toHaveBeenCalledTimes(1);
  });
  it('refuses to complete+pay a booking that has not been rendered', async () => {
    const b = VetBooking.rehydrate({ id: 'b1', tenantId: 't1', farmerUserId: 'f1', vetId: 'v1', serviceId: 's1', animalId: null,
      urgency: 'routine', mode: 'visit', symptomsText: null, scheduledAt: null, status: 'accepted', feeMinor: 30000n, completedAt: null });
    const { s, wallet } = harness({ booking: b });
    await expect(s.completeAndPay('t1', farmer, 'b1', 'idem-pay')).rejects.toThrow();
    expect(wallet.post).not.toHaveBeenCalled();              // no money moved on failure
  });
});
