// modules/logistics/services/vehicle.service.ts · register/manage vehicles within a tenant's fleet. Every write:
// one ACID tx (UoW) + outbox event in the SAME tx + audit + idempotency on create. Authorization THROWS
// (logistics.manage). The referenced partner must be visible to the tenant (own or platform). Reg-no uniqueness
// per partner is enforced by the DB (→ typed 409). Reads on the replica, keyset, bounded.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Vehicle } from '../domain/vehicle.entity';
import { DomainEvent } from '../domain/logistics.events';
import { VehicleNotFoundError, PartnerNotFoundError, ShipmentForbiddenError } from '../domain/logistics.errors';
import { VehicleRepository } from '../repositories/vehicle.repository';
import { LogisticsPartnerRepository } from '../repositories/logistics-partner.repository';
import { CreateVehicleDto, UpdateVehicleDto } from '../dto/create-vehicle.dto';
import { QueryVehicleDto } from '../dto/query-vehicle.dto';
import { FleetActor, encodeFleetCursor } from './logistics-partner.service';

@Injectable()
export class VehicleService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: VehicleRepository,
    private readonly partners: LogisticsPartnerRepository,
  ) {}

  private assertManager(a: FleetActor) { if (!a.canManage) throw new ShipmentForbiddenError('requires logistics.manage'); }

  async create(tenantId: string, actor: FleetActor, idemKey: string, dto: CreateVehicleDto, ip: string | null) {
    this.assertManager(actor);
    // the partner must exist and be visible to this tenant (own fleet or a platform 3PL) — fail closed otherwise.
    const partner = await this.partners.getById(tenantId, dto.partnerId);
    if (!partner) throw new PartnerNotFoundError(dto.partnerId);
    return this.idem.remember(idemKey, actor.userId, 'logistics.vehicle_create', () =>
      timed(this.metrics, 'logistics.vehicle_create', { tenant: tenantId }, async () => {
        const vehicle = Vehicle.create({
          id: uuidv7(), tenantId, partnerId: dto.partnerId, regNo: dto.regNo, vehicleTypeId: dto.vehicleTypeId ?? null,
          capacityKg: dto.capacityKg ?? null, isRefrigerated: dto.isRefrigerated, rcDocId: dto.rcDocId ?? null,
        });
        return this.uow.run(tenantId, async (tx) => {
          await this.repo.insert(tx, vehicle);
          const p = vehicle.toProps();
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'logistics.vehicle_registered', entityType: 'vehicle', entityId: p.id, newValue: { partnerId: p.partnerId, regNo: p.regNo }, ip });
          await this.flush(tx, tenantId, p.id, vehicle.pullEvents());
          return this.serialize(p);
        }, { userId: actor.userId });
      }));
  }

  async update(tenantId: string, actor: FleetActor, id: string, dto: UpdateVehicleDto, ip: string | null) {
    this.assertManager(actor);
    return timed(this.metrics, 'logistics.vehicle_update', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const vehicle = await this.repo.getForUpdate(tx, tenantId, id);
        if (!vehicle) throw new VehicleNotFoundError(id);
        const diff = vehicle.update({ vehicleTypeId: dto.vehicleTypeId, capacityKg: dto.capacityKg, isRefrigerated: dto.isRefrigerated, rcDocId: dto.rcDocId });
        await this.repo.update(tx, vehicle);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'logistics.vehicle_updated', entityType: 'vehicle', entityId: id, oldValue: diff.old, newValue: diff.new, ip });
        return this.serialize(vehicle.toProps());
      }, { userId: actor.userId }));
  }

  async setActive(tenantId: string, actor: FleetActor, id: string, isActive: boolean, ip: string | null) {
    this.assertManager(actor);
    return timed(this.metrics, 'logistics.vehicle_set_active', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const vehicle = await this.repo.getForUpdate(tx, tenantId, id);
        if (!vehicle) throw new VehicleNotFoundError(id);
        const diff = vehicle.setActive(isActive);
        await this.repo.update(tx, vehicle);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `logistics.vehicle_${diff.action}`, entityType: 'vehicle', entityId: id, oldValue: diff.old, newValue: diff.new, ip });
        return this.serialize(vehicle.toProps());
      }, { userId: actor.userId }));
  }

  async getById(tenantId: string, id: string) {
    const vehicle = await this.repo.getById(tenantId, id);
    if (!vehicle) throw new VehicleNotFoundError(id);
    return this.serialize(vehicle.toProps());
  }

  async list(tenantId: string, q: Omit<QueryVehicleDto, 'cursor'> & { cursor?: { c: string; id: string } }) {
    const rows = await this.repo.list(tenantId, { partnerId: q.partnerId, activeOnly: q.activeOnly, cursor: q.cursor, limit: q.limit });
    const items = rows.map((v) => this.serialize(v.toProps()));
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === q.limit && last ? encodeFleetCursor(last.toProps().createdUs, last.toProps().id) : null;
    return { items, nextCursor };
  }

  private serialize(p: ReturnType<Vehicle['toProps']>) {
    return { id: p.id, scope: p.tenantId == null ? 'platform' : 'tenant', partnerId: p.partnerId, regNo: p.regNo,
      vehicleTypeId: p.vehicleTypeId, capacityKg: p.capacityKg, isRefrigerated: p.isRefrigerated, rcDocId: p.rcDocId,
      isActive: p.isActive, createdAt: p.createdAt ?? null };
  }
  private async flush(tx: TxContext, tenantId: string, aggregateId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'vehicle', aggregateId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
