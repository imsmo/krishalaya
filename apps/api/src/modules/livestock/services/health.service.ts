// modules/livestock/services/health.service.ts · PC-54 W54-4. Lifetime health file + prescriptions.
// AUTHORITY RULES: a PRESCRIPTION is written ONLY by the VET-OF-RECORD on that booking (their registered profile must match
// booking.vetId — server-enforced; one prescription per booking).
//
// [PC-56 HOTFIX-13] HER ANIMAL'S RECORD OPENS ONLY TO HER AND HER ANIMAL'S VET (founder Q1-A, 2026-11-09; survey_ops4 F-3, C-11,
// OPS4-B3). CORRECTED: this header used to say a health event is recorded "by the animal's OWNER or a vet/manager" and that reads
// are "party-scoped (owner/farmer/vet/manage)" — `assertAnimalParty` passed anyone holding `animal.manage` (every farmer,
// pashupalak, dairy farmer and vet) and any `booking.manage` administrator, for ANY animal in the organisation. Now:
//   • the health file (read AND write) opens only to the animal's OWNER and to a VET HOLDING A BOOKING ON THAT ANIMAL in a state in
//     which the vet took the job (`VET_FILE_ACCESS_STATUSES`: accepted, en_route, in_consult, prescribed, completed). Anyone else —
//     another farmer, another vet, an administrator — gets 404, exactly as for an animal that does not exist (no existence oracle);
//   • a write that names a `vetBookingId` must name a booking ON THIS ANIMAL (and, for a vet, the vet's own booking), else
//     `HEALTH_BOOKING_NOT_THIS_ANIMAL` (422); every write is recorded — ONE audit row (who, as owner or vet, which animal, which
//     event type, which booking; the diagnosis text is NOT copied into the audit trail);
//   • a prescription is read only by the booking's farmer and the vet of record (`vet.manage` / administrators no longer open it).
// Every refusal sits before the unit of work and any write.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { HealthRepository } from '../repositories/health.repository';
import { AnimalRepository } from '../repositories/animal.repository';
import { VetProfileRepository } from '../repositories/vet-profile.repository';
import { VetBookingRepository } from '../repositories/vet-booking.repository';
import { HealthBookingNotThisAnimalError } from '../domain/livestock.errors';

/** `canManage` / `isAdmin` are still carried by the controllers' actor, and since HOTFIX-13 they open NOTHING here. */
export interface HealthActor { userId: string; canManage?: boolean; isAdmin?: boolean }
export type AnimalParty = { as: 'owner' } | { as: 'vet'; vetId: string };

@Injectable()
export class HealthService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly repo: HealthRepository,
    private readonly animals: AnimalRepository,
    private readonly vets: VetProfileRepository,
    private readonly bookings: VetBookingRepository,
    private readonly audit: AuditWriter,
  ) {}

  /** [PC-56 HOTFIX-13] the animal's owner, or a vet holding a booking on it (see the header); anyone else → 404. */
  private async assertAnimalParty(tenantId: string, actor: HealthActor, animalId: string): Promise<AnimalParty> {
    const animal = await this.animals.getById(tenantId, animalId);
    if (!animal) throw new NotFoundError('animal not found');
    const owner = (animal.toProps() as { ownerUserId: string }).ownerUserId;
    if (owner === actor.userId) return { as: 'owner' };
    const vet = await this.vets.findByUser(tenantId, actor.userId);
    const vetId = vet ? (vet.toProps() as { id: string }).id : null;
    if (vetId && await this.bookings.vetHasBookingOnAnimal(tenantId, vetId, animalId)) return { as: 'vet', vetId };
    throw new NotFoundError('animal not found'); // 404, no IDOR, no existence oracle
  }

  async recordEvent(tenantId: string, actor: HealthActor, animalId: string, dto: { eventTypeCode: string; vetBookingId?: string; batchNo?: string; diagnosis?: string; outcome?: string; nextDueDate?: string }) {
    const party = await this.assertAnimalParty(tenantId, actor, animalId);
    if (dto.vetBookingId) {
      // [PC-56 HOTFIX-13] a named booking must be a booking on THIS animal — and, for a vet, the vet's own.
      const b = await this.bookings.getById(tenantId, dto.vetBookingId);
      const bp = b ? (b.toProps() as { animalId: string | null; vetId: string }) : null;
      if (!bp || bp.animalId !== animalId || (party.as === 'vet' && bp.vetId !== party.vetId)) throw new HealthBookingNotThisAnimalError();
    }
    const id = uuidv7();
    await this.uow.run(tenantId, async (tx) => {
      const eventTypeId = await this.repo.resolveEventTypeId(tx, dto.eventTypeCode);
      if (!eventTypeId) throw new BadRequestError(`unknown health event type '${dto.eventTypeCode}'`);
      await this.repo.insertEvent(tx, { id, tenantId, animalId, eventTypeId, ...dto, recordedBy: actor.userId });
      // [PC-56 HOTFIX-13] every write is recorded — who, in which capacity, on which animal; never the diagnosis text.
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'livestock.health_event.recorded', entityType: 'animal_health_event', entityId: id,
        newValue: { animalId, eventTypeCode: dto.eventTypeCode, vetBookingId: dto.vetBookingId ?? null, recordedAs: party.as } });
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
    // [PC-56 HOTFIX-13] party-only: the booking's farmer or the vet of record — `vet.manage` / administrators open nothing here.
    if (b.farmerUserId !== actor.userId) {
      const mine = await this.vets.findByUser(tenantId, actor.userId);
      if (!mine || (mine.toProps() as { id: string }).id !== b.vetId) throw new NotFoundError('booking not found');
    }
    return this.repo.getPrescriptionByBooking(tenantId, vetBookingId);
  }
}
