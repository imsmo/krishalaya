// modules/dairy/services/milk-rate-card.service.ts · cooperative-admin milk pricing (rate cards).
// One ACID tx per write (UoW), outbox in-tx (Law 4), idempotent create (Law 3), authz THROWS (Law 6).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { MilkRateCard } from '../domain/milk-rate-card.entity';
import { PricingModel, AnimalType, DairyEventType } from '../domain/dairy.events';
import { MilkRateCardRepository } from '../repositories/milk-rate-card.repository';
import { CreateRateCardDto } from '../dto/create-milk-rate-card.dto';
import { RateCardNotFoundError, DairyForbiddenError } from '../domain/dairy.errors';
import { DairyActor } from './mcc-centre.service';

const big = (s?: string) => (s == null ? null : BigInt(s));

@Injectable()
export class MilkRateCardService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: MilkRateCardRepository,
  ) {}

  async create(tenantId: string, actor: DairyActor, idemKey: string, dto: CreateRateCardDto) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(idemKey, actor.userId, 'dairy.ratecard.create', () =>
      timed(this.metrics, 'dairy.ratecard.create', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const card = MilkRateCard.create({ id: uuidv7(), tenantId, defaultName: dto.defaultName, animalType: dto.animalType as AnimalType,
            pricingModel: dto.pricingModel as PricingModel, ratePerKgFatMinor: big(dto.ratePerKgFatMinor), ratePerKgSnfMinor: big(dto.ratePerKgSnfMinor),
            baseRatePerLitreMinor: big(dto.baseRatePerLitreMinor), effectiveFrom: dto.effectiveFrom, effectiveTo: dto.effectiveTo ?? null });
          await this.repo.insert(tx, card);
          await this.outbox.write(tx, { tenantId, aggregateType: 'milk_rate_card', aggregateId: card.id, eventType: DairyEventType.RateCardCreated, payload: { v: 1, rateCardId: card.id, animalType: dto.animalType } });
          return card.toJSON();
        }, { userId: actor.userId })));
  }
  async getById(tenantId: string, id: string) { const c = await this.repo.getById(tenantId, id); if (!c) throw new RateCardNotFoundError(id); return c.toJSON(); }
  async list(tenantId: string, q: { animalType?: string; activeOnly: boolean }) { return (await this.repo.listFor(tenantId, q)).map((c) => c.toJSON()); }
}
