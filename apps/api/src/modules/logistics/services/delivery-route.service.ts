// modules/logistics/services/delivery-route.service.ts · manage a tenant's Village Run routes. Every write: one
// ACID tx (UoW) + outbox event in the SAME tx (Law 4) + audit row + idempotency on create. Authorization THROWS
// (logistics.manage). Reads on the replica, keyset, bounded. No money here.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { DeliveryRoute } from '../domain/delivery-route.entity';
import { DomainEvent } from '../domain/logistics.events';
import { DeliveryRouteNotFoundError, ShipmentForbiddenError } from '../domain/logistics.errors';
import { DeliveryRouteRepository } from '../repositories/delivery-route.repository';
import { ApproveDeliveryRouteDto, CreateDeliveryRouteDto, UpdateDeliveryRouteDto } from '../dto/create-delivery-route.dto';
import { QueryDeliveryRouteDto } from '../dto/query-delivery-route.dto';
import { FleetActor, encodeFleetCursor } from './logistics-partner.service';

@Injectable()
export class DeliveryRouteService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: DeliveryRouteRepository,
  ) {}

  private assertManager(a: FleetActor) { if (!a.canManage) throw new ShipmentForbiddenError('requires logistics.manage'); }

  async create(tenantId: string, actor: FleetActor, idemKey: string, dto: CreateDeliveryRouteDto, ip: string | null) {
    this.assertManager(actor);
    return this.idem.remember(idemKey, actor.userId, 'logistics.route_create', () =>
      timed(this.metrics, 'logistics.route_create', { tenant: tenantId }, async () => {
        const route = DeliveryRoute.create({
          id: uuidv7(), tenantId, defaultName: dto.defaultName, runWeekday: dto.runWeekday ?? null,
          villageRegionIds: dto.villageRegionIds, vehicleId: dto.vehicleId ?? null, consolidationUserId: dto.consolidationUserId ?? null,
        });
        return this.uow.run(tenantId, async (tx) => {
          await this.repo.insert(tx, route);
          const p = route.toProps();
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'logistics.delivery_route_created', entityType: 'delivery_route', entityId: p.id, newValue: { defaultName: p.defaultName, runWeekday: p.runWeekday }, ip });
          await this.flush(tx, tenantId, p.id, route.pullEvents());
          return this.serialize(p);
        }, { userId: actor.userId });
      }));
  }

  async update(tenantId: string, actor: FleetActor, id: string, dto: UpdateDeliveryRouteDto, ip: string | null) {
    this.assertManager(actor);
    return timed(this.metrics, 'logistics.route_update', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const route = await this.repo.getForUpdate(tx, tenantId, id);
        if (!route) throw new DeliveryRouteNotFoundError(id);
        const diff = route.update({ defaultName: dto.defaultName, runWeekday: dto.runWeekday, villageRegionIds: dto.villageRegionIds, vehicleId: dto.vehicleId, consolidationUserId: dto.consolidationUserId });
        await this.repo.update(tx, route);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'logistics.delivery_route_updated', entityType: 'delivery_route', entityId: id, oldValue: diff.old, newValue: diff.new, ip });
        return this.serialize(route.toProps());
      }, { userId: actor.userId }));
  }

  async setActive(tenantId: string, actor: FleetActor, id: string, isActive: boolean, ip: string | null) {
    this.assertManager(actor);
    return timed(this.metrics, 'logistics.route_set_active', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const route = await this.repo.getForUpdate(tx, tenantId, id);
        if (!route) throw new DeliveryRouteNotFoundError(id);
        const diff = route.setActive(isActive);
        await this.repo.update(tx, route);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `logistics.delivery_route_${diff.action}`, entityType: 'delivery_route', entityId: id, oldValue: diff.old, newValue: diff.new, ip });
        return this.serialize(route.toProps());
      }, { userId: actor.userId }));
  }

  /**
   * **W231's [Approve route] — the button the platform could not represent (PC-56 TENANT-5b).**
   *
   * The canon's restricted state says what it costs: "Route approval needs logistics lead (it commits a vehicle
   * + ambassador weekly)". So: `logistics.manage` (already required for every write here), the entity's own
   * `approvalVerdict` refusing by name when a commitment is missing, `approved_by` + `approved_at` recorded as
   * the evidence, an audit row, and ONE outbox event carrying what was committed rather than just the verdict.
   *
   * Idempotency-Key required, like `create`: approving twice must not write two approvals, and a double-tapped
   * button on a village network is the normal case rather than the edge one.
   */
  async approve(tenantId: string, actor: FleetActor, idemKey: string, id: string, commit: ApproveDeliveryRouteDto, ip: string | null) {
    this.assertManager(actor);
    return this.idem.remember(idemKey, actor.userId, 'logistics.route_approve', () =>
      timed(this.metrics, 'logistics.route_approve', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const route = await this.repo.getForUpdate(tx, tenantId, id);
          if (!route) throw new DeliveryRouteNotFoundError(id);
          const from = route.status;
          // The commitments may arrive WITH the approval (W231's proposal row shows `unassigned`): applied in the
          // same transaction, so a route can never end up carrying a committed vehicle with no approval.
          if (commit.vehicleId !== undefined || commit.consolidationUserId !== undefined) {
            try {
              route.update({ vehicleId: commit.vehicleId ?? undefined, consolidationUserId: commit.consolidationUserId ?? undefined });
            } catch (e) {
              // "Nothing changed" is not an error on this path: the operator re-picked the vehicle the route
              // already carried, and the approval itself is still the act.
              if ((e as { code?: string })?.code !== 'FLEET_ALREADY_IN_STATE') throw e;
            }
          }
          route.approve(actor.userId);
          await this.repo.update(tx, route);
          const p = route.toProps();
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'logistics.delivery_route_approved',
            entityType: 'delivery_route', entityId: id, oldValue: { status: from },
            newValue: { status: p.status, vehicleId: p.vehicleId, consolidationUserId: p.consolidationUserId, villages: p.villageRegionIds.length }, ip });
          await this.flush(tx, tenantId, id, route.pullEvents());
          return this.serialize(p);
        }, { userId: actor.userId })));
  }

  async getById(tenantId: string, id: string) {
    const route = await this.repo.getById(tenantId, id);
    if (!route) throw new DeliveryRouteNotFoundError(id);
    return this.serialize(route.toProps());
  }

  async list(tenantId: string, q: Omit<QueryDeliveryRouteDto, 'cursor'> & { cursor?: { c: string; id: string } }) {
    const rows = await this.repo.list(tenantId, { runWeekday: q.runWeekday, activeOnly: q.activeOnly, cursor: q.cursor, limit: q.limit });
    const items = rows.map((r) => this.serialize(r.toProps()));
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? encodeFleetCursor(last.createdAt, last.id) : null;
    return { items, nextCursor };
  }

  private serialize(p: ReturnType<DeliveryRoute['toProps']>) {
    return { id: p.id, defaultName: p.defaultName, runWeekday: p.runWeekday, villageRegionIds: p.villageRegionIds,
      vehicleId: p.vehicleId, consolidationUserId: p.consolidationUserId,
      // PC-56 TENANT-5b. `status` is the fact; `isActive` is kept on the wire as the DERIVED convenience it now
      // is in the database too, so an existing consumer reading `isActive` is not broken by the state machine.
      status: p.status, isActive: p.status === 'active',
      approvedBy: p.approvedBy, approvedAt: p.approvedAt ?? null,
      createdAt: p.createdAt ?? null };
  }
  private async flush(tx: TxContext, tenantId: string, aggregateId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'delivery_route', aggregateId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
