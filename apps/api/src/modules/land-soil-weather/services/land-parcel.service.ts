// modules/land-soil-weather/services/land-parcel.service.ts · the farm registry use-cases (farmer-owned).
// One ACID tx per write (UoW), outbox in-tx (Law 4), idempotent register (Law 3), quota on register, authz
// THROWS (Law 6: owner-only). verification_status is set by KYC/admin (deferred — registers 'none'). No money.
//
// PC-56 TENANT-12:
//   • F-2  — a boundary is a GeoJSON Polygon / MultiPolygon (validated in the entity by `domain/geojson.ts`); `{}` is refused;
//   • F-11 — register and update write an audit row (actor · reason · before/after · ip) in the same transaction; the land
//            desk (`land.admin`, which replaces the `booking.manage` ride) may edit ANOTHER member's parcel only with a reason;
//   • F-10 — the list pages on a µs keyset (`shared/pagination/us-keyset`).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { QUOTA_SERVICE, QuotaService } from '../../../core/quota/quota.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { KeysetCursor, encodeKeyset } from '../../../shared/pagination/us-keyset';
import { LandParcel } from '../domain/land-parcel.entity';
import { DomainEvent } from '../domain/land-soil-weather.events';
import { LandParcelRepository } from '../repositories/land-parcel.repository';
import { RegisterParcelDto } from '../dto/create-land-parcel.dto';
import { UpdateParcelDto } from '../dto/update-land-parcel.dto';
import { ParcelNotFoundError, LandForbiddenError, ParcelReasonRequiredError } from '../domain/land-soil-weather.errors';

const QUOTA_METRIC = 'land_parcels';
export interface LandActor { userId: string; canManage: boolean; isAdmin: boolean; ip?: string | null; requestId?: string | null }
const parseScaled = (s: string, dec: number): bigint => { const [i, f = ''] = s.split('.'); return BigInt(i + (f + '0'.repeat(dec)).slice(0, dec)); };

@Injectable()
export class LandParcelService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(QUOTA_SERVICE) private readonly quota: QuotaService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: LandParcelRepository,
    private readonly audit: AuditWriter,
  ) {}

  async register(tenantId: string, actor: LandActor, idemKey: string, dto: RegisterParcelDto) {
    if (!actor.canManage) throw new LandForbiddenError('requires land.manage');
    return this.idem.remember(idemKey, actor.userId, 'land.parcel.register', () =>
      timed(this.metrics, 'land.parcel.register', { tenant: tenantId }, async () => {
        await this.quota.assertWithinLimit(tenantId, QUOTA_METRIC);
        return this.uow.run(tenantId, async (tx) => {
          const irrigationTypeId = dto.irrigationTypeCode ? await this.repo.resolveIrrigationTypeId(tx, dto.irrigationTypeCode) : null;
          const parcel = LandParcel.register({ id: uuidv7(), tenantId, ownerUserId: actor.userId, regionId: dto.regionId ?? null, surveyNo: dto.surveyNo ?? null, bhulekhRef: dto.bhulekhRef ?? null,
            areaTenThousandth: parseScaled(dto.areaValue, 4), areaUnit: dto.areaUnit, irrigationTypeId, boundaryGeojson: (dto.boundaryGeojson as Record<string, unknown> | undefined) ?? null, isTenantFarmed: dto.isTenantFarmed });
          await this.repo.insert(tx, parcel);
          await this.quota.increment(tx, tenantId, QUOTA_METRIC, 1);
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'land.parcel.registered', entityType: 'land_parcel', entityId: parcel.id,
            oldValue: null, newValue: { ownerUserId: actor.userId, ...parcel.auditView() }, reason: null, ip: actor.ip ?? null, requestId: actor.requestId ?? null,
          });
          await this.flush(tx, tenantId, parcel.id, parcel.pullEvents());
          return parcel.toJSON();
        }, { userId: actor.userId });
      }));
  }

  async update(tenantId: string, actor: LandActor, id: string, dto: UpdateParcelDto) {
    if (!actor.canManage && !actor.isAdmin) throw new LandForbiddenError('requires land.manage');
    return this.uow.run(tenantId, async (tx) => {
      const parcel = await this.repo.getForUpdate(tx, tenantId, id);
      if (!parcel) throw new ParcelNotFoundError(id);
      parcel.assertOwner(actor.userId, actor.isAdmin);
      const crossOwner = parcel.ownerUserId !== actor.userId;
      const reason = (dto.reason ?? '').trim();
      if (crossOwner && reason.length < 3) throw new ParcelReasonRequiredError();
      const before = parcel.auditView();
      const irrigationTypeId = dto.irrigationTypeCode ? await this.repo.resolveIrrigationTypeId(tx, dto.irrigationTypeCode) : undefined;
      parcel.update({ regionId: dto.regionId, surveyNo: dto.surveyNo, bhulekhRef: dto.bhulekhRef, irrigationTypeId, boundaryGeojson: dto.boundaryGeojson as Record<string, unknown> | undefined, isTenantFarmed: dto.isTenantFarmed });
      await this.repo.update(tx, parcel);
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: crossOwner ? 'land.parcel.corrected_by_desk' : 'land.parcel.updated', entityType: 'land_parcel', entityId: parcel.id,
        oldValue: before, newValue: { ...parcel.auditView(), ownerUserId: parcel.ownerUserId }, reason: reason || null, ip: actor.ip ?? null, requestId: actor.requestId ?? null,
      });
      await this.flush(tx, tenantId, parcel.id, parcel.pullEvents());
      return parcel.toJSON();
    }, { userId: actor.userId });
  }

  async getById(tenantId: string, actor: LandActor, id: string) {
    const p = await this.repo.getById(tenantId, id);
    if (!p) throw new ParcelNotFoundError(id);
    if (p.ownerUserId !== actor.userId && !actor.isAdmin) throw new ParcelNotFoundError(id); // 404, no IDOR
    return p.toJSON();
  }
  async list(tenantId: string, actor: LandActor, q: { box: 'mine' | 'all'; regionId?: string; cursor?: KeysetCursor; limit: number }) {
    if (q.box === 'all' && !actor.isAdmin) throw new LandForbiddenError('requires land.admin');
    const rows = await this.repo.listFor(tenantId, { ownerUserId: q.box === 'mine' ? actor.userId : undefined, regionId: q.regionId, cursor: q.cursor, limit: q.limit });
    const items = rows.map((r) => r.parcel.toJSON());
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === q.limit && last ? encodeKeyset(last.createdUs, last.parcel.id) : null;
    return { items, nextCursor };
  }
  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'land_parcel', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
