// modules/land-soil-weather/services/soil-test.service.ts · record/list soil tests on an owned parcel.
// One ACID tx (UoW), outbox in-tx (Law 4), authz THROWS (Law 6: parcel owner/admin). Append-only. No money.
// PC-56 TENANT-12 (F-11): the record is keyed by the caller's Idempotency-Key (Law 3 — a retried lab entry is ONE row) and
// writes an audit row (actor · before/after · ip) in the same transaction. A soil test is the only soil "as-of" the twin can
// cite; its dates are read through core/database/pg-date (F-10b).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { SoilTest } from '../domain/soil-test.entity';
import { DomainEvent } from '../domain/land-soil-weather.events';
import { SoilTestRepository } from '../repositories/soil-test.repository';
import { LandParcelRepository } from '../repositories/land-parcel.repository';
import { RecordSoilTestDto } from '../dto/create-soil-test.dto';
import { ParcelNotFoundError, LandForbiddenError } from '../domain/land-soil-weather.errors';
import { LandActor } from './land-parcel.service';

@Injectable()
export class SoilTestService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: SoilTestRepository,
    private readonly parcels: LandParcelRepository,
    private readonly audit: AuditWriter,
  ) {}
  async record(tenantId: string, actor: LandActor, idemKey: string, dto: RecordSoilTestDto) {
    if (!actor.canManage) throw new LandForbiddenError('requires land.manage');
    return this.idem.remember(idemKey, actor.userId, 'land.soil_test.record', () =>
      timed(this.metrics, 'land.soil_test.record', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const parcel = await this.parcels.getById(tenantId, dto.parcelId, tx);
          if (!parcel) throw new ParcelNotFoundError(dto.parcelId);
          parcel.assertOwner(actor.userId, actor.isAdmin);
          const t = SoilTest.record({ id: uuidv7(), tenantId, parcelId: dto.parcelId, labName: dto.labName ?? null, shcCardNo: dto.shcCardNo ?? null, sampledOn: dto.sampledOn,
            results: dto.results, recommendations: dto.recommendations, reportMediaId: dto.reportMediaId ?? null, validUntil: dto.validUntil ?? null });
          await this.repo.insert(tx, t);
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'land.soil_test.recorded', entityType: 'soil_test', entityId: t.id,
            oldValue: null, newValue: { parcelId: dto.parcelId, labName: dto.labName ?? null, shcCardNo: dto.shcCardNo ?? null, sampledOn: dto.sampledOn, validUntil: dto.validUntil ?? null,
              resultKeys: Object.keys(dto.results).sort(), byOwner: parcel.ownerUserId === actor.userId },
            reason: null, ip: actor.ip ?? null, requestId: actor.requestId ?? null,
          });
          await this.flush(tx, tenantId, t.id, t.pullEvents());
          return t.toJSON();
        }, { userId: actor.userId })));
  }
  async list(tenantId: string, actor: LandActor, parcelId: string) {
    const parcel = await this.parcels.getById(tenantId, parcelId);
    if (!parcel) throw new ParcelNotFoundError(parcelId);
    if (parcel.ownerUserId !== actor.userId && !actor.isAdmin) throw new ParcelNotFoundError(parcelId); // 404, no IDOR
    return (await this.repo.listForParcel(tenantId, parcelId)).map((t) => t.toJSON());
  }
  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'soil_test', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
