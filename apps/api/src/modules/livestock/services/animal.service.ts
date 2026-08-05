// modules/livestock/services/animal.service.ts
// Animal registry use-cases: a farmer registers + maintains their OWN animals. Every write: one ACID tx
// (UoW), domain events to the outbox in-tx (Law 4), idempotent registration (Law 3), quota on register,
// authz that THROWS (Law 6: owner-only). No version column → the row is locked FOR UPDATE on edit.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { QUOTA_SERVICE, QuotaService } from '../../../core/quota/quota.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Animal } from '../domain/animal.entity';
import { DomainEvent, AnimalRetireReason } from '../domain/livestock.events';
import { AnimalRepository } from '../repositories/animal.repository';
import { AnimalSpeciesRepository } from '../repositories/animal-species.repository';
import { AnimalBreedRepository } from '../repositories/animal-breed.repository';
import { CreateAnimalDto, UpdateAnimalDto } from '../dto/create-animal.dto';
import { AnimalNotFoundError, SpeciesNotFoundError, BreedNotFoundError, LivestockForbiddenError, PashuAadhaarExistsError } from '../domain/livestock.errors';

const QUOTA_METRIC = 'animals';
export interface AnimalActor { userId: string; canManage: boolean; isAdmin: boolean; }

@Injectable()
export class AnimalService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(QUOTA_SERVICE) private readonly quota: QuotaService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: AnimalRepository,
    private readonly species: AnimalSpeciesRepository,
    private readonly breeds: AnimalBreedRepository,
  ) {}

  async register(tenantId: string, actor: AnimalActor, idemKey: string, dto: CreateAnimalDto) {
    if (!actor.canManage) throw new LivestockForbiddenError('requires animal.manage');
    return this.idem.remember(idemKey, actor.userId, 'livestock.animal.register', () =>
      timed(this.metrics, 'livestock.animal.register', { tenant: tenantId }, async () => {
        await this.quota.assertWithinLimit(tenantId, QUOTA_METRIC);
        return this.uow.run(tenantId, async (tx) => {
          if (!(await this.species.exists(tx, dto.speciesId))) throw new SpeciesNotFoundError(dto.speciesId);
          if (dto.breedId && !(await this.breeds.belongsToSpecies(tx, dto.breedId, dto.speciesId))) throw new BreedNotFoundError(dto.breedId);
          const animal = Animal.register({
            id: uuidv7(), tenantId, ownerUserId: actor.userId, speciesId: dto.speciesId, breedId: dto.breedId ?? null,
            pashuAadhaar: dto.pashuAadhaar ?? null, name: dto.name ?? null, sex: dto.sex ?? null, dobEstimated: dto.dobEstimated ?? null,
            parity: dto.parity ?? null, lactationStage: dto.lactationStage ?? null, currentYieldLpd: dto.currentYieldLpd ?? null,
            pregnancyStatus: dto.pregnancyStatus ?? null, bodyConditionScore: dto.bodyConditionScore ?? null, acquiredVia: dto.acquiredVia ?? null,
          });
          try { await this.repo.insert(tx, animal); }
          catch (e: any) { if (e?.code === '23505') throw new PashuAadhaarExistsError(); throw e; }
          await this.quota.increment(tx, tenantId, QUOTA_METRIC, 1);
          await this.flush(tx, tenantId, animal.id, animal.pullEvents());
          return this.serialize(animal);
        }, { userId: actor.userId });
      }));
  }

  async update(tenantId: string, actor: AnimalActor, id: string, dto: UpdateAnimalDto) {
    return this.uow.run(tenantId, async (tx) => {
      const animal = await this.repo.getForUpdate(tx, tenantId, id);
      if (!animal) throw new AnimalNotFoundError(id);
      this.assertOwner(animal, actor);
      if (dto.breedId && !(await this.breeds.belongsToSpecies(tx, dto.breedId, animal.toProps().speciesId))) throw new BreedNotFoundError(dto.breedId);
      animal.updateHusbandry(dto);
      await this.repo.update(tx, animal);
      await this.flush(tx, tenantId, animal.id, animal.pullEvents());
      return this.serialize(animal);
    }, { userId: actor.userId });
  }

  async retire(tenantId: string, actor: AnimalActor, id: string, reason: AnimalRetireReason) {
    return this.uow.run(tenantId, async (tx) => {
      const animal = await this.repo.getForUpdate(tx, tenantId, id);
      if (!animal) throw new AnimalNotFoundError(id);
      this.assertOwner(animal, actor);
      animal.retire(reason);
      await this.repo.update(tx, animal);
      await this.flush(tx, tenantId, animal.id, animal.pullEvents());
      return this.serialize(animal);
    }, { userId: actor.userId });
  }

  async getById(tenantId: string, actor: AnimalActor, id: string) {
    const animal = await this.repo.getById(tenantId, id);
    if (!animal) throw new AnimalNotFoundError(id);
    if (animal.ownerUserId !== actor.userId && !actor.isAdmin) throw new AnimalNotFoundError(id); // 404, no cross-owner enumeration
    return this.serialize(animal);
  }
  async list(tenantId: string, actor: AnimalActor, q: { box: 'mine' | 'all'; speciesId?: string; pashuAadhaar?: string; status?: string; cursor?: { c: string; id: string }; limit: number }) {
    if (q.box === 'all' && !actor.isAdmin) throw new LivestockForbiddenError('requires booking.manage');
    const rows = await this.repo.listFor(tenantId, { ownerUserId: q.box === 'mine' ? actor.userId : undefined, speciesId: q.speciesId, pashuAadhaar: q.pashuAadhaar, status: q.status, cursor: q.cursor, limit: q.limit });
    const items = rows.map((a) => this.serialize(a));
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  private assertOwner(a: Animal, actor: AnimalActor) { if (a.ownerUserId !== actor.userId && !actor.isAdmin) throw new LivestockForbiddenError('only the owner may modify this animal'); }
  private serialize(a: Animal) {
    const v = a.toProps();
    return { id: v.id, ownerUserId: v.ownerUserId, speciesId: v.speciesId, breedId: v.breedId, pashuAadhaar: v.pashuAadhaar,
      name: v.name, sex: v.sex, dobEstimated: v.dobEstimated, parity: v.parity, lactationStage: v.lactationStage,
      currentYieldLpd: v.currentYieldLpd, pregnancyStatus: v.pregnancyStatus, bodyConditionScore: v.bodyConditionScore,
      status: v.status, acquiredVia: v.acquiredVia, createdAt: v.createdAt };
  }
  private async flush(tx: TxContext, tenantId: string, animalId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'animal', aggregateId: animalId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
