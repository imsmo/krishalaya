// modules/livestock/__tests__/hotfix13-her-animal.spec.ts · PC-56 HOTFIX-13 — NOBODY SPENDS HER MONEY OR READS HER ANIMAL'S RECORD BUT
// HER (unit, livestock). Founder Q1-A (2026-11-09): nobody but the payer spends the payer's money (the vet fee); an animal's health
// record opens only to its owner and the vet of a booking on that animal; writes are recorded. Each refusal pinned with an ordering
// log (before idem.remember, the unit of work and any write). Live twin: src/__tests__/hotfix13-her-money.integration.spec.ts.
import { VetBookingService } from '../services/vet-booking.service';
import { HealthService } from '../services/health.service';
import { VetBooking } from '../domain/vet-booking.entity';
import { VetProfile } from '../domain/vet-profile.entity';
import { VET_FILE_ACCESS_STATUSES } from '../repositories/vet-booking.repository';

const T = 't1';
const vetA = VetProfile.rehydrate({ id: 'vA', userId: 'vetUserA', tenantId: T, registrationNo: 'VCI-1', isAiTechnician: false, serviceRadiusKm: 25, baseRegionId: null, ratingAvg: null });
const vetB = VetProfile.rehydrate({ id: 'vB', userId: 'vetUserB', tenantId: T, registrationNo: 'VCI-2', isAiTechnician: false, serviceRadiusKm: 25, baseRegionId: null, ratingAvg: null });
const booking = (o: Partial<{ status: string; animalId: string | null; vetId: string; farmerUserId: string }> = {}) => VetBooking.rehydrate({
  id: 'vb1', tenantId: T, farmerUserId: o.farmerUserId ?? 'farmerA', vetId: o.vetId ?? 'vA', serviceId: 's1', animalId: o.animalId === undefined ? 'animal1' : o.animalId,
  urgency: 'routine', mode: 'visit', symptomsText: null, scheduledAt: null, status: (o.status ?? 'in_consult') as never, feeMinor: 30000n, completedAt: null });

describe('PC-56 HOTFIX-13 · B2 — the vet fee is HER money: only the farmer who booked pays', () => {
  function harness(b: VetBooking) {
    const log: string[] = [];
    const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => { log.push('uow'); return fn({ query: jest.fn() }); }) };
    const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: () => unknown) => { log.push('idem'); return fn(); }) };
    const wallet = { post: jest.fn(async () => { log.push('wallet'); return { txnId: 'x', alreadyApplied: false }; }), balanceMinor: jest.fn() };
    const bookings = { getById: jest.fn(async () => { log.push('pre'); return b; }), getForUpdate: jest.fn(async () => { log.push('lock'); return b; }), update: jest.fn(async () => { log.push('update'); }), insert: jest.fn(), listFor: jest.fn() };
    const vets = { getById: jest.fn(async () => vetA), findByUser: jest.fn(async (_t: string, u: string) => (u === 'vetUserA' ? vetA : u === 'vetUserB' ? vetB : null)) };
    const s = new VetBookingService(uow as never, { write: jest.fn(async () => { log.push('outbox'); }) } as never, idem as never, { inc: jest.fn(), observe: jest.fn(), timing: jest.fn() } as never,
      wallet as never, bookings as never, vets as never, {} as never, {} as never);
    return { s, log, wallet };
  }
  const adminFarmer = { userId: 'adminX', canBook: true, canManageVet: true, isAdmin: true };

  it('an administrator who also books vets paying ANOTHER farmer\'s vet → VET_PAY_NOT_FARMER (403), before idem.remember, no service_fee leg', async () => {
    const h = harness(booking());
    await expect(h.s.completeAndPay(T, adminFarmer, 'vb1', 'k')).rejects.toMatchObject({ code: 'VET_PAY_NOT_FARMER', httpStatus: 403 });
    expect(h.log).toEqual(['pre']); expect(h.wallet.post).not.toHaveBeenCalled();
  });

  it('the farmer who booked pays → the fee leg runs (order: pre, idem, uow, lock, wallet)', async () => {
    const h = harness(booking());
    await h.s.completeAndPay(T, { userId: 'farmerA', canBook: true, canManageVet: false, isAdmin: false }, 'vb1', 'k');
    expect(h.log.slice(0, 5)).toEqual(['pre', 'idem', 'uow', 'lock', 'wallet']);
  });

  it('assertOwningVet lost its administrator escape: an administrator driving a vet booking → refused before the unit of work', async () => {
    const h = harness(booking({ status: 'accepted' }));
    await expect(h.s.progress(T, { userId: 'adminX', canBook: false, canManageVet: true, isAdmin: true }, 'vb1', { action: 'in_consult' } as never))
      .rejects.toMatchObject({ code: 'LIVESTOCK_FORBIDDEN', httpStatus: 403 });
    expect(h.log).toEqual(['pre']);
  });
});

describe('PC-56 HOTFIX-13 · B3 — the health file: her, and the vet of a booking on that animal; nobody else (404)', () => {
  function harness(opts: { vetHasBooking?: boolean; foreign?: VetBooking | null } = {}) {
    const log: string[] = [];
    const uow = { run: jest.fn(async (_t: string, fn: (tx: unknown) => unknown) => { log.push('uow'); return fn({ query: jest.fn() }); }) };
    const repo = { resolveEventTypeId: jest.fn(async () => 'et1'), insertEvent: jest.fn(async () => { log.push('insert'); }), listEvents: jest.fn(async () => { log.push('list'); return []; }),
      getPrescriptionByBooking: jest.fn(async () => { log.push('rx'); return { id: 'rx1' }; }) };
    const animals = { getById: jest.fn(async () => ({ toProps: () => ({ ownerUserId: 'farmerA' }) })) };
    const vets = { findByUser: jest.fn(async (_t: string, u: string) => (u === 'vetUserA' ? vetA : u === 'vetUserB' ? vetB : null)) };
    const bookings = { vetHasBookingOnAnimal: jest.fn(async (_t: string, vetId: string) => vetId === 'vA' && (opts.vetHasBooking ?? true)),
      getById: jest.fn(async () => (opts.foreign === undefined ? booking() : opts.foreign)) };
    const audit = { write: jest.fn(async (_tx: unknown, e: { action: string }) => { log.push(`audit:${e.action}`); }) };
    const svc = new HealthService(uow as never, repo as never, animals as never, vets as never, bookings as never, audit as never);
    return { svc, log, audit, bookings };
  }
  const owner = { userId: 'farmerA', canManage: true, isAdmin: false };
  const neighbour = { userId: 'farmerB', canManage: true, isAdmin: false };            // holds animal.manage, like every farmer
  const admin = { userId: 'adminX', canManage: true, isAdmin: true };
  const vetOfBooking = { userId: 'vetUserA', canManage: true, isAdmin: false };
  const otherVet = { userId: 'vetUserB', canManage: true, isAdmin: false };

  it('the counting booking states are exactly: accepted, en_route, in_consult, prescribed, completed', () => {
    expect([...VET_FILE_ACCESS_STATUSES]).toEqual(['accepted', 'en_route', 'in_consult', 'prescribed', 'completed']);
  });

  it.each([['another farmer (animal.manage)', neighbour], ['an administrator', admin], ['a vet with no booking on it', otherVet]])(
    '%s reading the file → 404, writing it → 404, before the unit of work, nothing written', async (_n, actor) => {
      const h = harness();
      await expect(h.svc.listEvents(T, actor, 'animal1')).rejects.toMatchObject({ httpStatus: 404 });
      await expect(h.svc.recordEvent(T, actor, 'animal1', { eventTypeCode: 'treatment' })).rejects.toMatchObject({ httpStatus: 404 });
      expect(h.log).toEqual([]);
    });

  it('the owner reads and writes; her write is recorded — ONE audit row (as owner), the diagnosis NOT copied into it', async () => {
    const h = harness();
    await h.svc.listEvents(T, owner, 'animal1');
    await h.svc.recordEvent(T, owner, 'animal1', { eventTypeCode: 'treatment', diagnosis: 'mastitis' });
    expect(h.log).toEqual(['list', 'uow', 'insert', 'audit:livestock.health_event.recorded']);
    const entry = (h.audit.write.mock.calls[0] as unknown[])[1] as { newValue: Record<string, unknown> };
    expect(entry.newValue).toEqual({ animalId: 'animal1', eventTypeCode: 'treatment', vetBookingId: null, recordedAs: 'owner' });
    expect(JSON.stringify(entry)).not.toContain('mastitis');
  });

  it('the vet of a booking on the animal reads and writes (recorded as vet); the same vet without a counting booking → 404', async () => {
    const h = harness();
    await h.svc.listEvents(T, vetOfBooking, 'animal1');
    await h.svc.recordEvent(T, vetOfBooking, 'animal1', { eventTypeCode: 'treatment', vetBookingId: 'vb1' });
    expect(((h.audit.write.mock.calls[0] as unknown[])[1] as { newValue: { recordedAs: string } }).newValue.recordedAs).toBe('vet');
    const h2 = harness({ vetHasBooking: false });
    await expect(h2.svc.listEvents(T, vetOfBooking, 'animal1')).rejects.toMatchObject({ httpStatus: 404 });
  });

  it.each([
    ['a booking on ANOTHER animal', booking({ animalId: 'animal2' })],
    ['a booking with no animal', booking({ animalId: null })],
    ['a booking that does not exist', null],
  ])('a write naming %s → HEALTH_BOOKING_NOT_THIS_ANIMAL (422), before the unit of work', async (_n, b) => {
    const h = harness({ foreign: b });
    await expect(h.svc.recordEvent(T, owner, 'animal1', { eventTypeCode: 'treatment', vetBookingId: 'vbX' })).rejects.toMatchObject({ code: 'HEALTH_BOOKING_NOT_THIS_ANIMAL', httpStatus: 422 });
    expect(h.log).toEqual([]);
  });

  it('a vet naming ANOTHER vet\'s booking on the same animal → HEALTH_BOOKING_NOT_THIS_ANIMAL', async () => {
    const h = harness({ foreign: booking({ vetId: 'vB' }) });
    await expect(h.svc.recordEvent(T, vetOfBooking, 'animal1', { eventTypeCode: 'treatment', vetBookingId: 'vbX' })).rejects.toMatchObject({ code: 'HEALTH_BOOKING_NOT_THIS_ANIMAL' });
  });

  it('a prescription opens only to the booking\'s farmer and the vet of record; a vet.manage holder or administrator → 404', async () => {
    const h = harness();
    await expect(h.svc.getPrescription(T, owner, 'vb1')).resolves.toEqual({ id: 'rx1' });
    await expect(h.svc.getPrescription(T, vetOfBooking, 'vb1')).resolves.toEqual({ id: 'rx1' });
    await expect(h.svc.getPrescription(T, { userId: 'vetUserB', canManage: true }, 'vb1')).rejects.toMatchObject({ httpStatus: 404 });
    await expect(h.svc.getPrescription(T, admin, 'vb1')).rejects.toMatchObject({ httpStatus: 404 });
  });
});
