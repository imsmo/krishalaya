// modules/equipment/services/equipment-rate.service.ts · owner rate-card use-cases (per asset).
// One ACID tx per write (UoW), outbox in-tx (Law 4), authz THROWS (Law 6: only the asset owner).
// [PC-56 OPS-4a · OPS4-B6 / E10, survey F-7] EVERY RATE CHANGE IS RECORDED: one audit row with the line before (null when new) and after.
// A line that has already priced a hire is never overwritten in place — `RATE_ALREADY_PRICED_A_HIRE` (409), refused before any write
// (the upsert, the audit row, the outbox; pinned by an ordering spy). An omitted `effectiveFrom` is the organisation's own today (E14's
// rule), no longer the UTC date.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { EquipmentRate } from '../domain/equipment-rate.entity';
import { RateBasis, EquipmentEventType } from '../domain/equipment.events';
import { EquipmentRateRepository } from '../repositories/equipment-rate.repository';
import { EquipmentAssetRepository } from '../repositories/equipment-asset.repository';
import { CreateRateDto } from '../dto/create-equipment-rate.dto';
import { AssetNotFoundError, EquipmentForbiddenError, RateAlreadyPricedAHireError } from '../domain/equipment.errors';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { EquipmentActor } from './equipment-asset.service';

@Injectable()
export class EquipmentRateService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: EquipmentRateRepository,
    private readonly assets: EquipmentAssetRepository,
    private readonly audit: AuditWriter,
  ) {}

  async setRate(tenantId: string, actor: EquipmentActor, assetId: string, dto: CreateRateDto, ip: string | null = null) {
    if (!actor.canManage) throw new EquipmentForbiddenError('requires equipment.manage');
    return timed(this.metrics, 'equipment.rate.set', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const asset = await this.assets.getById(tenantId, assetId, tx);
        if (!asset) throw new AssetNotFoundError(assetId);
        if (asset.ownerUserId !== actor.userId && !actor.isAdmin) throw new EquipmentForbiddenError('only the owner may set rates');
        const effectiveFrom = dto.effectiveFrom ?? await this.repo.tenantDay(tx, tenantId, new Date().toISOString());
        const before = await this.repo.findAtForUpdate(tx, assetId, dto.rateBasis, effectiveFrom);
        if (before && await this.repo.hasPricedAHire(tx, tenantId, before.id)) throw new RateAlreadyPricedAHireError();
        const rate = EquipmentRate.create({ id: before?.id ?? uuidv7(), assetId, rateBasis: dto.rateBasis as RateBasis, rateMinor: BigInt(dto.rateMinor),
          includesOperator: dto.includesOperator, includesFuel: dto.includesFuel, effectiveFrom, effectiveTo: dto.effectiveTo ?? null });
        await this.repo.upsert(tx, rate);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'equipment.rate.set', entityType: 'equipment_rate', entityId: rate.id,
          oldValue: before ? before.toJSON() : null, newValue: rate.toJSON(), ip });
        await this.outbox.write(tx, { tenantId, aggregateType: 'equipment_asset', aggregateId: assetId, eventType: EquipmentEventType.RateSet, payload: { v: 1, assetId, rateBasis: dto.rateBasis, rateMinor: dto.rateMinor } });
        return rate.toJSON();
      }, { userId: actor.userId }));
  }
  async list(tenantId: string, assetId: string, activeOnly: boolean) { return (await this.repo.listByAsset(tenantId, assetId, activeOnly)).map((r) => r.toJSON()); }
}
