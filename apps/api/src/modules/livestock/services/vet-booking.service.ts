// modules/livestock/services/vet-booking.service.ts
// The vet-marketplace demand side + THE MONEY PATH. A farmer books a vet service (fee snapshotted from the
// vet_service price); the vet drives the lifecycle (accept→en_route→in_consult→prescribed); the farmer (the
// payer) confirms completion, which SETTLES THE FEE through the wallet boundary (farmer userMain → vet
// userMain, txnType 'service_fee', a ZERO-SUM, idempotent ledger txn — Law 2). Every write: one ACID tx
// (UoW), state via the machine (Law 5), outbox in-tx (Law 4), idempotent money mutations (Law 3), authz
// that THROWS (Law 6). No version column → bookings lock FOR UPDATE.
//
// [PC-56 HOTFIX-13] NOBODY SPENDS HER MONEY BUT HER (founder Q1-A, 2026-11-09; survey_ops4 F-2, OPS4-B2). `completeAndPay` moves
// the FARMER's fee to the vet, so only the farmer who booked pays (`VET_PAY_NOT_FARMER`, 403) — refused after the permission and
// key checks and BEFORE the idempotency record, the unit of work and any write (a pre-read; the same check on the locked row).
// The administrator escape (`&& !actor.isAdmin`) is gone, and so is `assertOwningVet`'s: only the vet of record drives a booking.
// `cancel` keeps its administrator escape (a vet booking holds no money; cancelling moves none) — recorded, not changed here.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { userMain } from '../../../core/wallet/account-codes';
import { uuidv7 } from '../../../core/database/uuid.util';
import { VetBooking } from '../domain/vet-booking.entity';
import { DomainEvent, LivestockEventType } from '../domain/livestock.events';
import { VetBookingRepository } from '../repositories/vet-booking.repository';
import { VetProfileRepository } from '../repositories/vet-profile.repository';
import { VetServiceRepository } from '../repositories/vet-service.repository';
import { AnimalRepository } from '../repositories/animal.repository';
import { BookVetDto, VetProgressDto } from '../dto/create-vet-booking.dto';
import {
  VetBookingNotFoundError, VetProfileNotFoundError, VetServiceNotFoundError, AnimalNotFoundError,
  ServiceVetMismatchError, LivestockForbiddenError, VetPayNotFarmerError,
} from '../domain/livestock.errors';

export interface BookingActor { userId: string; canBook: boolean; canManageVet: boolean; isAdmin: boolean; }

@Injectable()
export class VetBookingService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly bookings: VetBookingRepository,
    private readonly vets: VetProfileRepository,
    private readonly services: VetServiceRepository,
    private readonly animals: AnimalRepository,
  ) {}

  // ---- farmer: book a vet (fee snapshotted from the service price) ----
  async book(tenantId: string, actor: BookingActor, idemKey: string, dto: BookVetDto) {
    if (!actor.canBook) throw new LivestockForbiddenError('requires vet.book');
    return this.idem.remember(idemKey, actor.userId, 'livestock.vet.book', () =>
      timed(this.metrics, 'livestock.vet.book', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const vet = await this.vets.getById(tenantId, dto.vetId, tx);
          if (!vet) throw new VetProfileNotFoundError(dto.vetId);
          const svc = await this.services.getForBooking(tx, dto.serviceId);
          if (!svc) throw new VetServiceNotFoundError(dto.serviceId);
          if (svc.vetId !== dto.vetId) throw new ServiceVetMismatchError();
          if (dto.animalId) {
            const animal = await this.animals.getById(tenantId, dto.animalId, tx);
            if (!animal || animal.ownerUserId !== actor.userId) throw new AnimalNotFoundError(dto.animalId);  // 404, no cross-owner IDOR
          }
          const booking = VetBooking.request({
            id: uuidv7(), tenantId, farmerUserId: actor.userId, vetId: dto.vetId, serviceId: dto.serviceId,
            animalId: dto.animalId ?? null, urgency: dto.urgency, mode: dto.mode, symptomsText: dto.symptomsText ?? null,
            scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null, feeMinor: svc.priceMinor,
          });
          await this.bookings.insert(tx, booking);
          await this.flush(tx, tenantId, booking.id, booking.pullEvents());
          return this.serialize(booking);
        }, { userId: actor.userId })));
  }

  // ---- vet: drive the service lifecycle (accept / en_route / in_consult / prescribed / no_show) ----
  async progress(tenantId: string, actor: BookingActor, bookingId: string, dto: VetProgressDto) {
    // [PC-56 HOTFIX-13] the vet of record only — refused before the unit of work (and again on the locked row).
    const pre = await this.bookings.getById(tenantId, bookingId);
    if (!pre) throw new VetBookingNotFoundError(bookingId);
    await this.assertOwningVet(undefined, tenantId, pre, actor);
    return this.uow.run(tenantId, async (tx) => {
      const booking = await this.bookings.getForUpdate(tx, tenantId, bookingId);
      if (!booking) throw new VetBookingNotFoundError(bookingId);
      await this.assertOwningVet(tx, tenantId, booking, actor);
      switch (dto.action) {
        case 'accept': booking.accept(); break;
        case 'en_route': booking.enRoute(); break;
        case 'in_consult': booking.startConsult(); break;
        case 'prescribed': booking.prescribe(); break;
        case 'no_show': booking.noShow(); break;
      }
      await this.bookings.update(tx, booking);
      await this.flush(tx, tenantId, booking.id, booking.pullEvents());
      return this.serialize(booking);
    }, { userId: actor.userId });
  }

  // ---- farmer: cancel (requested/accepted) ----
  async cancel(tenantId: string, actor: BookingActor, bookingId: string, reason?: string) {
    return this.uow.run(tenantId, async (tx) => {
      const booking = await this.bookings.getForUpdate(tx, tenantId, bookingId);
      if (!booking) throw new VetBookingNotFoundError(bookingId);
      if (booking.farmerUserId !== actor.userId && !actor.isAdmin) throw new LivestockForbiddenError('only the farmer may cancel');
      booking.cancel(reason);
      await this.bookings.update(tx, booking);
      await this.flush(tx, tenantId, booking.id, booking.pullEvents());
      return this.serialize(booking);
    }, { userId: actor.userId });
  }

  // ---- farmer: confirm completion + SETTLE THE FEE (the money path) ----
  async completeAndPay(tenantId: string, actor: BookingActor, bookingId: string, idemKey: string) {
    if (!actor.canBook) throw new LivestockForbiddenError('requires vet.book');
    // [PC-56 HOTFIX-13] HER fee — only she pays. Refused before the idempotency record and any write.
    const pre = await this.bookings.getById(tenantId, bookingId);
    if (!pre) throw new VetBookingNotFoundError(bookingId);
    if (pre.farmerUserId !== actor.userId) throw new VetPayNotFarmerError();
    return this.idem.remember(idemKey, actor.userId, 'livestock.vet.pay', () =>
      timed(this.metrics, 'livestock.vet.pay', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const booking = await this.bookings.getForUpdate(tx, tenantId, bookingId);
          if (!booking) throw new VetBookingNotFoundError(bookingId);
          if (booking.farmerUserId !== actor.userId) throw new VetPayNotFarmerError();
          const vet = await this.vets.getById(tenantId, booking.vetId, tx);
          if (!vet) throw new VetProfileNotFoundError(booking.vetId);
          booking.complete(new Date());     // throws BookingNotCompletableError if not in a completable state
          // Farmer pays the vet the consultation fee — a balanced, idempotent wallet transfer (Law 2).
          await this.wallet.post(tx, {
            tenantId, txnType: 'service_fee', idempotencyKey: `vetfee:${booking.id}`, referenceType: 'vet_booking', referenceId: booking.id, initiatedBy: actor.userId,
            legs: [{ account: userMain(booking.farmerUserId), amountMinor: -booking.feeMinor }, { account: userMain(vet.userId), amountMinor: booking.feeMinor }],
          });
          await this.bookings.update(tx, booking);
          for (const e of booking.pullEvents()) await this.outbox.write(tx, { tenantId, aggregateType: 'vet_booking', aggregateId: booking.id, eventType: e.type, payload: { v: 1, ...e.payload } });
          await this.outbox.write(tx, { tenantId, aggregateType: 'vet_booking', aggregateId: booking.id, eventType: LivestockEventType.VetFeePaid, payload: { v: 1, bookingId: booking.id, vetId: vet.id, feeMinor: booking.feeMinor.toString() } });
          return { ...this.serialize(booking), feePaidMinor: booking.feeMinor.toString() };
        }, { userId: actor.userId })));
  }

  // ---- reads ----
  async getById(tenantId: string, actor: BookingActor, id: string) {
    const b = await this.bookings.getById(tenantId, id);
    if (!b) throw new VetBookingNotFoundError(id);
    if (b.farmerUserId !== actor.userId && !actor.isAdmin) {
      const vet = await this.vets.findByUser(tenantId, actor.userId);
      if (!vet || vet.id !== b.vetId) throw new VetBookingNotFoundError(id);   // 404, no cross-party enumeration
    }
    return this.serialize(b);
  }
  async list(tenantId: string, actor: BookingActor, q: { box: 'farmer' | 'vet'; status?: string; cursor?: { c: string; id: string }; limit: number }) {
    let vetId: string | undefined;
    if (q.box === 'vet') { const vet = await this.vets.findByUser(tenantId, actor.userId); vetId = vet?.id ?? '00000000-0000-0000-0000-000000000000'; }
    const rows = await this.bookings.listFor(tenantId, { farmerUserId: q.box === 'farmer' ? actor.userId : undefined, vetId, status: q.status, cursor: q.cursor, limit: q.limit });
    const items = rows.map((b) => this.serialize(b));
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  private async assertOwningVet(tx: TxContext | undefined, tenantId: string, booking: VetBooking, actor: BookingActor) {
    // [PC-56 HOTFIX-13] the administrator escape (`if (actor.isAdmin) return;`) is gone: only the vet of record drives a booking.
    if (!actor.canManageVet) throw new LivestockForbiddenError('requires vet.manage');
    const vet = await this.vets.findByUser(tenantId, actor.userId, tx);
    if (!vet || vet.id !== booking.vetId) throw new LivestockForbiddenError('only the assigned vet may drive this booking');
  }
  private serialize(b: VetBooking) {
    const v = b.toProps();
    return { id: v.id, farmerUserId: v.farmerUserId, vetId: v.vetId, serviceId: v.serviceId, animalId: v.animalId,
      urgency: v.urgency, mode: v.mode, status: v.status, feeMinor: v.feeMinor.toString(), scheduledAt: v.scheduledAt, completedAt: v.completedAt, createdAt: v.createdAt };
  }
  private async flush(tx: TxContext, tenantId: string, bookingId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'vet_booking', aggregateId: bookingId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
