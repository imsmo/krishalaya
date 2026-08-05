// modules/logistics/services/shipment.service.ts
// Shipment lifecycle use-cases. Every write: one ACID tx (UoW), status via the machine (Law 5),
// outbox events in the SAME tx (Law 4), audit on the proof-of-delivery / failure / cancel actions.
// Money (charge/COD) is bigint minor units (no movement here — COD settlement is a payments concern).
// Proof-of-delivery is OTP-gated: the service generates a fresh code, stores ONLY its HMAC hash
// (server pepper) on the shipment, and hands the raw code to the (deferred) SMS relay via an outbox
// event; delivery verifies the submitted code's hash in constant time (in the entity). No version
// column → mutations lock the row FOR UPDATE.
import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomInt } from 'node:crypto';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { AppConfig } from '../../../core/config/app-config';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Shipment } from '../domain/shipment.entity';
import { DomainEvent, ShipmentEventType } from '../domain/logistics.events';
import { ShipmentStatus } from '../domain/shipment.state';
import { ShipmentNotFoundError, ShipmentForbiddenError, ShipmentExistsError } from '../domain/logistics.errors';
import { ShipmentRepository } from '../repositories/shipment.repository';
import { CreateShipmentDto } from '../dto/create-shipment.dto';
import { AssignShipmentDto, SchedulePickupDto, DeliverShipmentDto, FailShipmentDto } from '../dto/update-shipment.dto';

export interface ShipmentActor { userId: string; canManage: boolean; }

@Injectable()
export class ShipmentService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly config: AppConfig,
    private readonly repo: ShipmentRepository,
  ) {}

  private hashOtp(code: string): string { return createHmac('sha256', this.config.auth.hashPepper).update(code).digest('hex'); }

  /** Ops creates a shipment directly (the common path is the order-confirmed handler). */
  async create(tenantId: string, actor: ShipmentActor, idemKey: string, dto: CreateShipmentDto) {
    this.assertManager(actor);
    return this.idem.remember(idemKey, actor.userId, 'logistics.shipment_create', () =>
      timed(this.metrics, 'logistics.shipment_create', { tenant: tenantId }, async () => {
        const shipment = Shipment.create({
          id: uuidv7(), tenantId, orderId: dto.orderId, pickupAddressId: dto.pickupAddressId ?? null, dropAddressId: dto.dropAddressId ?? null,
          chargeMinor: dto.chargeMinor ? BigInt(dto.chargeMinor) : null, codMinor: dto.codMinor ? BigInt(dto.codMinor) : null, requiresColdChain: dto.requiresColdChain ?? false,
        });
        return this.uow.run(tenantId, async (tx) => {
          if (await this.repo.existsForOrder(tx, tenantId, dto.orderId)) throw new ShipmentExistsError(dto.orderId);
          await this.repo.insert(tx, shipment);
          const p = shipment.toProps();
          await this.flush(tx, tenantId, p.id, shipment.pullEvents());
          return this.serialize(p);
        }, { userId: actor.userId });
      }));
  }

  assign(t: string, a: ShipmentActor, id: string, dto: AssignShipmentDto, ip: string | null) {
    return this.mutate(t, a, id, 'assign', { manager: true }, (s) => s.assign(dto), ip);
  }
  schedulePickup(t: string, a: ShipmentActor, id: string, dto: SchedulePickupDto, ip: string | null) {
    return this.mutate(t, a, id, 'schedule_pickup', { manager: true }, (s) => s.schedulePickup(new Date(dto.scheduledPickupAt), dto.windowMins ?? null), ip);
  }
  markPickedUp(t: string, a: ShipmentActor, id: string, ip: string | null) { return this.mutate(t, a, id, 'picked_up', {}, (s) => s.markPickedUp(), ip); }
  markInTransit(t: string, a: ShipmentActor, id: string, ip: string | null) { return this.mutate(t, a, id, 'in_transit', {}, (s) => s.markInTransit(), ip); }
  markAtHub(t: string, a: ShipmentActor, id: string, ip: string | null) { return this.mutate(t, a, id, 'at_hub', {}, (s) => s.markAtHub(), ip); }
  markFailed(t: string, a: ShipmentActor, id: string, dto: FailShipmentDto, ip: string | null) { return this.mutate(t, a, id, 'failed', { audit: true }, (s) => s.markFailed(dto.reason), ip); }
  cancel(t: string, a: ShipmentActor, id: string, ip: string | null) { return this.mutate(t, a, id, 'cancel', { manager: true, audit: true }, (s) => s.cancel(), ip); }

  /** Dispatch for final delivery: generate the OTP, store its hash, emit the OTP to the (deferred) SMS relay. */
  async markOutForDelivery(tenantId: string, actor: ShipmentActor, id: string, ip: string | null) {
    return timed(this.metrics, 'logistics.out_for_delivery', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const s = await this.repo.getForUpdate(tx, tenantId, id);
        if (!s) throw new ShipmentNotFoundError(id);
        this.assertManagerOrRider(actor, s);
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const from = s.status;
        s.markOutForDelivery(this.hashOtp(code));
        await this.repo.update(tx, s, from);
        // hand the raw OTP to the SMS relay (notifications module — deferred). Internal outbox row only.
        await this.outbox.write(tx, { tenantId, aggregateType: 'shipment', aggregateId: id, eventType: ShipmentEventType.DeliveryOtpIssued, payload: { v: 1, shipmentId: id, orderId: s.orderId, otp: code } });
        await this.flush(tx, tenantId, id, s.pullEvents());
        return this.serialize(s.toProps());
      }, { userId: actor.userId }));
  }

  /** Proof-of-delivery: verify the buyer's OTP (constant-time, in the entity) → delivered → orders. */
  async markDelivered(tenantId: string, actor: ShipmentActor, id: string, dto: DeliverShipmentDto, ip: string | null) {
    return timed(this.metrics, 'logistics.delivered', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const s = await this.repo.getForUpdate(tx, tenantId, id);
        if (!s) throw new ShipmentNotFoundError(id);
        this.assertManagerOrRider(actor, s);
        const from = s.status;
        s.markDelivered(this.hashOtp(dto.otp), dto.podMediaId ?? null, new Date());
        await this.repo.update(tx, s, from);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'shipment.delivered', entityType: 'shipment', entityId: id, newValue: { orderId: s.orderId, podMediaId: dto.podMediaId ?? null }, ip });
        await this.flush(tx, tenantId, id, s.pullEvents());
        return this.serialize(s.toProps());
      }, { userId: actor.userId }));
  }

  /** Assigned rider (or a manager) posts a live GPS ping → appends a lat/lng tracking event at the current
   *  status (no state transition). Powers the buyer/seller tracking feed's "last seen" point. */
  async postLocation(tenantId: string, actor: ShipmentActor, id: string, loc: { lat: number; lng: number; note?: string }) {
    return timed(this.metrics, 'logistics.location_ping', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const s = await this.repo.getForUpdate(tx, tenantId, id);
        if (!s) throw new ShipmentNotFoundError(id);
        this.assertManagerOrRider(actor, s);
        await this.repo.insertLocationEvent(tx, tenantId, id, s.status, loc.lat, loc.lng, loc.note ?? null);
        return { ok: true };
      }, { userId: actor.userId }));
  }

  async getById(tenantId: string, actor: ShipmentActor, id: string) {
    const s = await this.repo.getById(tenantId, id);
    if (!s) throw new ShipmentNotFoundError(id);
    this.assertManagerOrRider(actor, s);
    return this.serialize(s.toProps());
  }

  async list(tenantId: string, actor: ShipmentActor, q: { box: 'all' | 'mine'; status?: string; orderId?: string; cursor?: { c: string; id: string }; limit: number }) {
    if (q.box === 'all') this.assertManager(actor);
    const rows = await this.repo.listFor(tenantId, {
      status: q.status, orderId: q.orderId, riderUserId: q.box === 'mine' ? actor.userId : undefined, cursor: q.cursor, limit: q.limit,
    });
    const items = rows.map((s) => this.serialize(s.toProps()));
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  private async mutate(tenantId: string, actor: ShipmentActor, id: string, action: string, opts: { manager?: boolean; audit?: boolean }, apply: (s: Shipment) => void, ip: string | null) {
    return timed(this.metrics, `logistics.${action}`, { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const s = await this.repo.getForUpdate(tx, tenantId, id);
        if (!s) throw new ShipmentNotFoundError(id);
        if (opts.manager) this.assertManager(actor); else this.assertManagerOrRider(actor, s);
        const from = s.status;
        apply(s);
        await this.repo.update(tx, s, from);
        if (opts.audit) await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `shipment.${action}`, entityType: 'shipment', entityId: id, oldValue: { status: from }, newValue: { status: s.status }, ip });
        await this.flush(tx, tenantId, id, s.pullEvents());
        return this.serialize(s.toProps());
      }, { userId: actor.userId }));
  }

  /** PC-54 W54-2 `cod-recon` read-model (logistics.manage — money oversight is an ops power). */
  async codOutstanding(tenantId: string, actor: ShipmentActor) {
    this.assertManager(actor);
    return this.repo.codOutstanding(tenantId);
  }

  private assertManager(actor: ShipmentActor): void { if (!actor.canManage) throw new ShipmentForbiddenError('requires logistics.manage'); }
  private assertManagerOrRider(actor: ShipmentActor, s: Shipment): void {
    if (actor.canManage) return;
    if (s.riderUserId && s.riderUserId === actor.userId) return;
    throw new ShipmentForbiddenError();
  }

  private serialize(p: ReturnType<Shipment['toProps']>) {
    return { id: p.id, orderId: p.orderId, status: p.status, partnerId: p.partnerId, vehicleId: p.vehicleId, riderUserId: p.riderUserId,
      awbNo: p.awbNo, scheduledPickupAt: p.scheduledPickupAt, pickedUpAt: p.pickedUpAt, deliveredAt: p.deliveredAt,
      podMediaId: p.podMediaId, requiresOtp: p.deliveryOtpHash != null, chargeMinor: p.chargeMinor?.toString() ?? null,
      codMinor: p.codMinor?.toString() ?? null, requiresColdChain: p.requiresColdChain, createdAt: p.createdAt };
  }
  private async flush(tx: TxContext, tenantId: string, shipmentId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'shipment', aggregateId: shipmentId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
