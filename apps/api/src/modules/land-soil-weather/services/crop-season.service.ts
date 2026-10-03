// modules/land-soil-weather/services/crop-season.service.ts · crop-season tracking on an owned parcel.
// plan → sow → harvest (+ abandon). Every write verifies the parcel belongs to the caller (anti-IDOR). One
// ACID tx (UoW), state via the machine (Law 5), outbox in-tx (Law 4), authz THROWS (Law 6). No money.
//
// PC-56 TENANT-12:
//   • F-9  — a yield is stored WITH its unit: `yieldUnitCode` must be a MASS unit of the `units` registry (kg, quintal, ton…);
//            a season's actual yield is in the unit its expected yield was in. The twin prints "qtl/ha" only from these.
//   • F-11 — plan, sow, harvest and abandon write an audit row (actor · reason · before/after · ip) in the same transaction;
//   • F-19 — abandon takes its reason inside the zod `.strict()` contract (the controller's loose `@Body('reason')` is gone).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { CropSeason } from '../domain/crop-season.entity';
import { CropSeasonName, DomainEvent } from '../domain/land-soil-weather.events';
import { CropSeasonRepository } from '../repositories/crop-season.repository';
import { LandParcelRepository } from '../repositories/land-parcel.repository';
import { PlanCropSeasonDto, SowCropSeasonDto, HarvestCropSeasonDto, AbandonCropSeasonDto } from '../dto/create-crop-season.dto';
import { ParcelNotFoundError, CropSeasonNotFoundError, LandForbiddenError, YieldUnitError } from '../domain/land-soil-weather.errors';
import { LandActor } from './land-parcel.service';

/** Decimal string → thousandths, exact (no float). */
const toMilli = (s?: string): bigint | null => { if (s == null) return null; const [i, f = ''] = s.split('.'); return BigInt(i + (f + '000').slice(0, 3)); };

@Injectable()
export class CropSeasonService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: CropSeasonRepository,
    private readonly parcels: LandParcelRepository,
    private readonly audit: AuditWriter,
  ) {}

  /** F-9: the unit must be a mass unit the platform knows. */
  private async assertMassUnit(tx: TxContext, code: string | undefined | null): Promise<void> {
    if (!code) return;
    const cls = await this.repo.unitClass(tx, code);
    if (cls === null) throw new YieldUnitError('YIELD_UNIT_UNKNOWN', code);
    if (cls !== 'mass') throw new YieldUnitError('YIELD_UNIT_NOT_MASS', code);
  }

  async plan(tenantId: string, actor: LandActor, idemKey: string, dto: PlanCropSeasonDto) {
    if (!actor.canManage) throw new LandForbiddenError('requires land.manage');
    return this.idem.remember(idemKey, actor.userId, 'land.crop_season.plan', () =>
      timed(this.metrics, 'land.crop_season.plan', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const parcel = await this.parcels.getById(tenantId, dto.parcelId, tx);
          if (!parcel) throw new ParcelNotFoundError(dto.parcelId);
          parcel.assertOwner(actor.userId, actor.isAdmin);
          await this.assertMassUnit(tx, dto.yieldUnitCode);
          const c = CropSeason.plan({ id: uuidv7(), tenantId, parcelId: dto.parcelId, productId: dto.productId, season: dto.season as CropSeasonName, year: dto.year,
            sownOn: dto.sownOn ?? null, expectedHarvest: dto.expectedHarvest ?? null, expectedYieldMilli: toMilli(dto.expectedYield), yieldUnitCode: dto.yieldUnitCode ?? null });
          await this.repo.insert(tx, c);
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'land.crop_season.planned', entityType: 'crop_season', entityId: c.id,
            oldValue: null, newValue: c.toJSON(), reason: null, ip: actor.ip ?? null, requestId: actor.requestId ?? null,
          });
          await this.flush(tx, tenantId, c.id, c.pullEvents());
          return c.toJSON();
        }, { userId: actor.userId })));
  }

  async sow(tenantId: string, actor: LandActor, id: string, dto: SowCropSeasonDto) { return this.mutate(tenantId, actor, id, 'land.crop_season.sown', null, async (c) => c.sow(dto.sownOn)); }
  async harvest(tenantId: string, actor: LandActor, id: string, dto: HarvestCropSeasonDto) {
    return this.mutate(tenantId, actor, id, 'land.crop_season.harvested', null, async (c, tx) => { await this.assertMassUnit(tx, dto.yieldUnitCode); c.harvest(toMilli(dto.actualYield), dto.yieldUnitCode ?? null); });
  }
  async abandon(tenantId: string, actor: LandActor, id: string, dto: AbandonCropSeasonDto) {
    return this.mutate(tenantId, actor, id, 'land.crop_season.abandoned', dto.reason.trim(), async (c) => c.abandon(dto.reason));
  }

  async list(tenantId: string, actor: LandActor, parcelId: string, status?: string) {
    const parcel = await this.parcels.getById(tenantId, parcelId);
    if (!parcel) throw new ParcelNotFoundError(parcelId);
    if (parcel.ownerUserId !== actor.userId && !actor.isAdmin) throw new ParcelNotFoundError(parcelId); // 404, no IDOR
    return (await this.repo.listForParcel(tenantId, parcelId, status)).map((c) => c.toJSON());
  }

  private async mutate(tenantId: string, actor: LandActor, id: string, action: string, reason: string | null, fn: (c: CropSeason, tx: TxContext) => Promise<void>) {
    if (!actor.canManage && !actor.isAdmin) throw new LandForbiddenError('requires land.manage');
    return this.uow.run(tenantId, async (tx) => {
      const c = await this.repo.getForUpdate(tx, tenantId, id);
      if (!c) throw new CropSeasonNotFoundError(id);
      const parcel = await this.parcels.getById(tenantId, c.parcelId, tx);
      if (!parcel || (parcel.ownerUserId !== actor.userId && !actor.isAdmin)) throw new LandForbiddenError('only the parcel owner may act here');
      const before = c.toJSON();
      await fn(c, tx);
      await this.repo.update(tx, c);
      const after = c.toJSON();
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action, entityType: 'crop_season', entityId: c.id,
        oldValue: { status: before.status, sownOn: before.sownOn, actualYield: before.actualYield, yieldUnitCode: before.yieldUnitCode },
        newValue: { status: after.status, sownOn: after.sownOn, actualYield: after.actualYield, yieldUnitCode: after.yieldUnitCode, byOwner: parcel.ownerUserId === actor.userId },
        reason, ip: actor.ip ?? null, requestId: actor.requestId ?? null,
      });
      await this.flush(tx, tenantId, c.id, c.pullEvents());
      return after;
    }, { userId: actor.userId });
  }
  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'crop_season', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
