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
import { ShipmentNotFoundError, ShipmentForbiddenError, ShipmentExistsError } from '../domain/logistics.errors';
import { ShipmentRepository } from '../repositories/shipment.repository';
import { CreateShipmentDto } from '../dto/create-shipment.dto';
import { AssignShipmentDto, SchedulePickupDto, DeliverShipmentDto, FailShipmentDto } from '../dto/update-shipment.dto';
import { OrderService } from '../../orders/services/order.service';
import { failureOutcome, isMoneyGated, nextMilestone, pickupOtpRequired, possessionProof, transportVerdict } from '../domain/shipment-readiness';
import { OrderNotReadyForTransportError } from '../domain/logistics.errors';
import { EventFilter, TrailPoint, etaVerdict, isGpsGap, lastKnownPoint, milestoneProgress, precisionFor, resolveWindow, roundCoord } from '../domain/shipment-event-explorer';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { FLEET_FITNESS_FLAG, REQUIRE_RC_FLAG, rcVerdict, vehicleFitness } from '../domain/fleet-fitness';
import { VehicleUnfitError } from '../domain/logistics.errors';
import { VehicleRepository } from '../repositories/vehicle.repository';

export interface ShipmentActor { userId: string; canManage: boolean; }


@Injectable()
export class ShipmentService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    /** PC-56 TENANT-5a · the money gate. Another module's PUBLIC SERVICE (module blueprint), never its
     *  repositories — the order's payment state is the orders module's fact to state. */
    private readonly orders: OrderService,
    /** `logistics_pickup_otp` (Law 10). Read per call so a kill switch takes effect on the next scheduled
     *  pickup rather than on the next deploy. */
    private readonly flags: FlagsService,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly config: AppConfig,
    private readonly repo: ShipmentRepository,
    /** PC-56 TENANT-5b · the fitness gate's own read. Same module, so the repository is fair game (the module
     *  blueprint forbids reaching into ANOTHER module's repositories — the money gate goes through
     *  `OrderService` for exactly that reason). */
    private readonly vehicleRepo: VehicleRepository,
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

  /**
   * **PC-56 TENANT-5b · AND THE VEHICLE MUST BE ABLE TO TAKE IT.**
   *
   * `assign` accepted `vehicleId` as a bare uuid from a `.strict()` DTO and wrote it onto the shipment. It never
   * checked that the vehicle exists, that it belongs to this tenant, that it is active, or — the one that spoils
   * a consignment — that a `requires_cold_chain` shipment is going onto a refrigerated vehicle.
   * `shipments.requires_cold_chain` and `vehicles.is_refrigerated` have both existed since 0007 and had never
   * been read together.
   *
   * Checked INSIDE the transaction (a vehicle parked a millisecond later must not still be dispatched) and
   * refused BY NAME, so W229's own sentences reach the operator: "parked", "RC expired", "not refrigerated".
   */
  async assign(t: string, a: ShipmentActor, id: string, dto: AssignShipmentDto, ip: string | null) {
    const fitnessOn = dto.vehicleId
      ? await this.flags.isEnabled(FLEET_FITNESS_FLAG, { tenantId: t }).catch(() => false)
      : false;
    const requireRc = fitnessOn
      ? await this.flags.isEnabled(REQUIRE_RC_FLAG, { tenantId: t }).catch(() => false)
      : false;
    return this.mutate(t, a, id, 'assign', {
      manager: true,
      precheck: fitnessOn && dto.vehicleId
        ? async (tx, s) => {
            const v = await this.vehicleRepo.fitnessOf(tx, t, dto.vehicleId!);
            const verdict = vehicleFitness({
              vehicle: v ? { id: v.id, isActive: v.isActive, isRefrigerated: v.isRefrigerated, capacityKg: v.capacityKg } : null,
              rc: rcVerdict(v ? { status: v.rcStatus, validUntil: v.rcValidUntil } : null, new Date()),
              requiresColdChain: s.requiresColdChain,
              requireRcOnFile: requireRc,
              rcHeldByPartner: v?.scope === 'platform',
            });
            if (verdict.kind !== 'fit') {
              this.metrics.inc('logistics.vehicle_unfit', { reason: verdict.kind });
              throw new VehicleUnfitError(
                verdict.kind === 'rc_invalid' ? 'rc_invalid' : verdict.kind,
                verdict.kind === 'rc_invalid' ? { rc: verdict.rc, validUntil: verdict.validUntil } : {});
            }
          }
        : undefined,
    }, (s) => s.assign(dto), ip);
  }
  /**
   * Schedule the collection — and issue the PICKUP OTP, which nothing on this platform has ever done
   * (see `Shipment.schedulePickup`). The raw code goes to the SMS relay on the outbox exactly as the
   * delivery code does; only the hash is stored.
   *
   * `fromOwnPremises` says there is nobody to hand over (a collection from the tenant's own yard), and it is
   * the caller's fact to state — the entity cannot know it.
   */
  // `ip` is kept in the signature for the controller's call shape and is not used here: the audit of a
  // scheduled pickup happens inside `mutate`, which receives it. Prefixed rather than dropped so the
  // controller does not have to special-case one of the five transitions it drives.
  async schedulePickup(t: string, a: ShipmentActor, id: string, dto: SchedulePickupDto, _ip: string | null) {
    // OFF (the shipped default) reproduces the pre-wave behaviour exactly: no code is issued, pickup needs
    // none, and `possessionProof` keeps reporting `delivery_only` — which is the truth, not a downgrade.
    const flagOn = await this.flags.isEnabled('logistics_pickup_otp', { tenantId: t }).catch(() => false);
    const needsOtp = flagOn && pickupOtpRequired({ fromOwnPremises: dto.fromOwnPremises ?? false });
    const code = needsOtp ? String(randomInt(0, 1_000_000)).padStart(6, '0') : null;
    return this.mutate(t, a, id, 'schedule_pickup', {
      manager: true,
      emit: code
        ? async (tx, s) => {
            await this.outbox.write(tx, { tenantId: t, aggregateType: 'shipment', aggregateId: id,
              eventType: ShipmentEventType.PickupOtpIssued,
              payload: { v: 1, shipmentId: id, orderId: s.orderId, otp: code } });
          }
        : undefined,
    }, (s) => s.schedulePickup(new Date(dto.scheduledPickupAt), dto.windowMins ?? null, code ? this.hashOtp(code) : null), _ip);
  }
  /** Possession passes to the carrier. The seller's pickup OTP is verified when one was issued. */
  markPickedUp(t: string, a: ShipmentActor, id: string, otp: string | null, ip: string | null) {
    return this.mutate(t, a, id, 'picked_up', {}, (s) => s.markPickedUp(otp ? this.hashOtp(otp) : null), ip);
  }
  markInTransit(t: string, a: ShipmentActor, id: string, ip: string | null) { return this.mutate(t, a, id, 'in_transit', {}, (s) => s.markInTransit(), ip); }
  markAtHub(t: string, a: ShipmentActor, id: string, ip: string | null) { return this.mutate(t, a, id, 'at_hub', {}, (s) => s.markAtHub(), ip); }
  /**
   * A delivery attempt failed. The attempt is COUNTED (see `Shipment.markFailed`) and the response carries
   * what happens next — W236: "a failure without a next step cannot exist in this table". The re-attempt is
   * not booked here: WHEN it goes back out is a slot decision, and inventing a time would be this service
   * deciding a driver's afternoon. The console shows the outcome and the operator books the slot.
   */
  async markFailed(t: string, a: ShipmentActor, id: string, dto: FailShipmentDto, ip: string | null) {
    const out = await this.mutate(t, a, id, 'failed', { audit: true }, (s) => s.markFailed(dto.reason), ip);
    // `deliveryAttempts` on the response is the count AFTER this failure, and `failureOutcome` takes the
    // count BEFORE it — hence the −1. Written out rather than inlined because an off-by-one here is the
    // difference between a farmer's goods going back and a second free run.
    return { ...out, nextStep: failureOutcome(out.deliveryAttempts - 1) };
  }
  cancel(t: string, a: ShipmentActor, id: string, ip: string | null) { return this.mutate(t, a, id, 'cancel', { manager: true, audit: true }, (s) => s.cancel(), ip); }

  /** Dispatch for final delivery: generate the OTP, store its hash, emit the OTP to the (deferred) SMS relay. */
  /** Dispatch for final delivery: generate the OTP, store its hash, emit the OTP to the (deferred) SMS relay.
   *
   * **AND AUDIT IT (PC-56 TENANT-5a).** `ip` was accepted here and never used, so issuing a buyer's one-time
   * code — the act that decides whether a delivery can be proved at all — left no audit row, while `deliver`,
   * `fail` and `cancel` all write one. It is the same act as the pickup code this wave added, one end later,
   * and a support agent asking "who dispatched this and from where" deserves the same answer at both ends. */
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
        // The CODE never reaches the audit log — only the fact that one was issued. An audit row carrying a
        // live OTP would put a buyer's delivery code on every console that can read audit history.
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'shipment.out_for_delivery', entityType: 'shipment', entityId: id, oldValue: { status: from }, newValue: { status: s.status, deliveryOtpIssued: true }, ip });
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

  /* ---------------------------------------------------------------------------------------------------- */
  /* THE TRAIL — the first reads of `shipment_events` this module has ever had (PC-56 TENANT-5a)            */
  /* ---------------------------------------------------------------------------------------------------- */

  /**
   * One shipment's journey: W227's plan and W235's tracking view.
   *
   * Coordinates are rounded HERE, by viewer, and not in a template: a full-precision coordinate that reaches
   * a serializer has already left the building, and "the UI rounds it" is not a privacy control. W236:
   * "GPS coordinates round to ~100m for non-lead roles."
   */
  async trail(tenantId: string, actor: ShipmentActor, id: string) {
    const s = await this.repo.getById(tenantId, id);
    if (!s) throw new ShipmentNotFoundError(id);
    const p = s.toProps();
    const dp = precisionFor(actor.canManage);
    const raw = await this.repo.trailFor(tenantId, id);
    const points: TrailPoint[] = raw.map((e) => ({
      at: e.at.toISOString(), status: e.status, note: e.note,
      lat: roundCoord(e.lat, dp), lng: roundCoord(e.lng, dp),
    }));
    const last = lastKnownPoint(points);
    return {
      shipment: this.serialize(p),
      // Each point says whether the segment that REACHES it is a gap, so the map draws a dotted line rather
      // than a teleport (W235: "a signal gap draws a dotted segment, never a teleport").
      points: points.map((pt, i) => ({ ...pt, gapBefore: isGpsGap(points[i - 1], pt) })),
      lastKnown: last,
      progress: milestoneProgress(p.status),
      // NOT an ETA. Nothing on this platform computes one; see domain/shipment-event-explorer.ts.
      eta: etaVerdict(),
    };
  }

  /**
   * W236's explorer: every hop of every shipment in a window, filtered, keyset-paged.
   *
   * The window is resolved before the query and is never absent — that is the canon's own rule
   * ("date-bounded queries only") and it is what prunes the partitions.
   */
  async events(tenantId: string, actor: ShipmentActor, q: { from?: string; to?: string; filter: EventFilter; shipmentId?: string; cursor?: { c: string; id: string }; limit: number }) {
    const window = resolveWindow({ from: q.from, to: q.to }, new Date());
    const dp = precisionFor(actor.canManage);
    const rows = await this.repo.explore(tenantId, { ...window, filter: q.filter, shipmentId: q.shipmentId, cursor: q.cursor, limit: q.limit });
    const items = rows.map((e) => ({
      id: e.id, at: e.at.toISOString(), shipmentId: e.shipmentId, status: e.status, note: e.note,
      lat: roundCoord(e.lat, dp), lng: roundCoord(e.lng, dp),
    }));
    const last = items[items.length - 1];
    return {
      items,
      // The clamp is REPORTED, not applied silently: an operator who asked for six months and got ninety
      // days must be told, or an empty stretch reads as "nothing happened".
      window,
      precisionDp: dp,
      nextCursor: items.length === q.limit && last ? Buffer.from(`${last.at}|${last.id}`).toString('base64') : null,
    };
  }

  private async mutate(tenantId: string, actor: ShipmentActor, id: string, action: string, opts: { manager?: boolean; audit?: boolean; emit?: (tx: TxContext, s: Shipment) => Promise<void>; precheck?: (tx: TxContext, s: Shipment) => Promise<void> }, apply: (s: Shipment) => void, ip: string | null) {
    return timed(this.metrics, `logistics.${action}`, { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const s = await this.repo.getForUpdate(tx, tenantId, id);
        if (!s) throw new ShipmentNotFoundError(id);
        if (opts.manager) this.assertManager(actor); else this.assertManagerOrRider(actor, s);
        // **THE MONEY GATE (PC-56 TENANT-5a).** One check, at the ONE point every transition passes
        // through, driven by an allow-list of the actions that commit somebody — a driver's afternoon, a
        // farmer waiting at a gate, a vehicle. Read INSIDE this transaction so an order cancelled a
        // millisecond later cannot still get a driver, and refused BY NAME so the console can print the
        // reason W226 already prints ("payment clears first") instead of a generic 409.
        if (isMoneyGated(action)) {
          const v = transportVerdict(await this.orders.transportStatus(tx, tenantId, s.orderId));
          if (v.kind !== 'may_move') {
            this.metrics.inc('logistics.transport_refused', { reason: v.kind });
            throw new OrderNotReadyForTransportError(v.kind, 'orderStatus' in v ? v.orderStatus : null);
          }
        }
        // PC-56 TENANT-5b · a per-action precheck, INSIDE the transaction and BEFORE the transition, for the
        // facts only that action cares about (today: whether the vehicle being assigned can take this load).
        if (opts.precheck) await opts.precheck(tx, s);
        const from = s.status;
        apply(s);
        await this.repo.update(tx, s, from);
        if (opts.emit) await opts.emit(tx, s);
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
      codMinor: p.codMinor?.toString() ?? null, requiresColdChain: p.requiresColdChain, createdAt: p.createdAt,
      // PC-56 TENANT-5a. The attempt count makes W226's "one free re-attempt" checkable, and the possession
      // verdict is how W225's "both directions" tick stays honest: a shipment carrying only a delivery code
      // serialises as `delivery_only`, never as proof it does not hold. NEVER the hashes themselves — W227
      // is explicit that "OTP values never display here — they live on the two parties' phones only".
      deliveryAttempts: p.deliveryAttempts,
      pickupOtpIssued: p.pickupOtpHash != null,
      possessionProof: possessionProof({ pickupOtpHash: p.pickupOtpHash, deliveryOtpHash: p.deliveryOtpHash }),
      nextMilestone: nextMilestone(p.status) };
  }
  private async flush(tx: TxContext, tenantId: string, shipmentId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'shipment', aggregateId: shipmentId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
