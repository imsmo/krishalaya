// modules/livestock/services/health.service.ts · PC-54 W54-4. Lifetime health file + prescriptions.
// AUTHORITY RULES: a health event is recorded by the animal's OWNER or a vet/manager; a PRESCRIPTION is
// written ONLY by the VET-OF-RECORD on that booking (their registered profile must match booking.vetId —
// server-enforced; one prescription per booking). Reads are party-scoped (owner/farmer/vet/manage).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { HealthRepository } from '../repositories/health.repository';
import { AnimalRepository } from '../repositories/animal.repository';
import { VetProfileRepository } from '../repositories/vet-profile.repository';
import { VetBookingRepository } from '../repositories/vet-booking.repository';

export interface HealthActor { userId: string; canManage?: boolean; isAdmin?: boolean }

@Injectable()
export class HealthService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly repo: HealthRepository,
    private readonly animals: AnimalRepository,
    private readonly vets: VetProfileRepository,
    private readonly bookings: VetBookingRepository,
  ) {}

  private async assertAnimalParty(tenantId: string, actor: HealthActor, animalId: string) {
    const animal = await this.animals.getById(tenantId, animalId);
    if (!animal) throw new NotFoundError('animal not found');
    const owner = (animal.toProps() as { ownerUserId: string }).ownerUserId;
    if (owner !== actor.userId && !actor.canManage && !actor.isAdmin) throw new NotFoundError('animal not found'); // 404, no IDOR
  }

  async recordEvent(tenantId: string, actor: HealthActor, animalId: string, dto: { eventTypeCode: string; vetBookingId?: string; batchNo?: string; diagnosis?: string; outcome?: string; nextDueDate?: string }) {
    await this.assertAnimalParty(tenantId, actor, animalId);
    const id = uuidv7();
    await this.uow.run(tenantId, async (tx) => {
      const eventTypeId = await this.repo.resolveEventTypeId(tx, dto.eventTypeCode);
      if (!eventTypeId) throw new BadRequestError(`unknown health event type '${dto.eventTypeCode}'`);
      await this.repo.insertEvent(tx, { id, tenantId, animalId, eventTypeId, ...dto, recordedBy: actor.userId });
    }, { userId: actor.userId });
    return { id };
  }

  async listEvents(tenantId: string, actor: HealthActor, animalId: string) {
    await this.assertAnimalParty(tenantId, actor, animalId);
    return this.repo.listEvents(tenantId, animalId);
  }

  async writePrescription(tenantId: string, actor: HealthActor, vetBookingId: string, dto: { validUntil?: string; items: Array<{ drugName: string; dosage: string; durationDays?: number; isScheduleH?: boolean; productId?: string }> }) {
    const booking = await this.bookings.getById(tenantId, vetBookingId);
    if (!booking) throw new NotFoundError('booking not found');
    const myProfile = await this.vets.findByUser(tenantId, actor.userId);
    const b = booking.toProps() as { vetId: string; animalId: string | null };
    if (!myProfile || (myProfile.toProps() as { id: string }).id !== b.vetId) throw new ForbiddenError('vet-of-record only');
    if (await this.repo.getPrescriptionByBooking(tenantId, vetBookingId)) throw new ConflictError('a prescription already exists for this booking');
    const id = uuidv7();
    await this.uow.run(tenantId, async (tx) => {
      await this.repo.insertPrescription(tx, { id, tenantId, vetBookingId, vetId: b.vetId, animalId: b.animalId ?? undefined, validUntil: dto.validUntil, items: dto.items.map((it) => ({ id: uuidv7(), ...it })) });
    }, { userId: actor.userId });
    return { id };
  }

  async getPrescription(tenantId: string, actor: HealthActor, vetBookingId: string) {
    const booking = await this.bookings.getById(tenantId, vetBookingId);
    if (!booking) throw new NotFoundError('booking not found');
    const b = booking.toProps() as { farmerUserId: string; vetId: string };
    if (b.farmerUserId !== actor.userId && !actor.canManage && !actor.isAdmin) {
      const mine = await this.vets.findByUser(tenantId, actor.userId);
      if (!mine || (mine.toProps() as { id: string }).id !== b.vetId) throw new NotFoundError('booking not found');
    }
    return this.repo.getPrescriptionByBooking(tenantId, vetBookingId);
  }
}
