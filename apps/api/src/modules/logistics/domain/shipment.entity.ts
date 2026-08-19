// modules/logistics/domain/shipment.entity.ts
// Shipment aggregate — the physical fulfilment of an order. Pure domain: status transitions ONLY via
// the state machine (Law 5); money (charge/COD) in bigint minor units. Proof-of-delivery is OTP-gated:
// the entity stores ONLY the HASH of the delivery OTP (the service hashes with the server pepper) and
// verifies a submitted hash in CONSTANT TIME — a DB dump never reveals the code. No version column
// (the table only has created_at/updated_at) → the service serializes mutations with SELECT … FOR UPDATE.
import { timingSafeEqual } from 'node:crypto';
import { ShipmentStatus, assertTransition } from './shipment.state';
import { ShipmentEventType, DomainEvent } from './logistics.events';
import { InvalidShipmentError, InvalidDeliveryOtpError, DeliveryOtpNotIssuedError, InvalidPickupOtpError } from './logistics.errors';

export interface ShipmentProps {
  id: string; tenantId: string; orderId: string; partnerId: string | null; vehicleId: string | null; riderUserId: string | null;
  status: ShipmentStatus; awbNo: string | null; pickupAddressId: string | null; dropAddressId: string | null;
  scheduledPickupAt: Date | null; scheduledWindowMins: number | null; pickedUpAt: Date | null; deliveredAt: Date | null;
  pickupOtpHash: string | null; deliveryOtpHash: string | null; podMediaId: string | null;
  chargeMinor: bigint | null; codMinor: bigint | null; requiresColdChain: boolean; createdAt: Date;
  /** PC-56 TENANT-5a — how many delivery attempts this shipment has already spent. W226 promises "failed
   *  deliveries auto-schedule one free re-attempt before returning" and W236 that "a failure without a next
   *  step cannot exist in this table"; `markFailed(reason)` moved the state and counted NOTHING, so "one"
   *  was an adjective and a fifth failure was indistinguishable from a first. */
  deliveryAttempts: number;
}

export class Shipment {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: ShipmentProps) {}

  static create(input: {
    id: string; tenantId: string; orderId: string; pickupAddressId?: string | null; dropAddressId?: string | null;
    chargeMinor?: bigint | null; codMinor?: bigint | null; requiresColdChain?: boolean; now?: Date;
  }): Shipment {
    if ((input.chargeMinor ?? 0n) < 0n) throw new InvalidShipmentError('charge cannot be negative');
    if ((input.codMinor ?? 0n) < 0n) throw new InvalidShipmentError('COD cannot be negative');
    const s = new Shipment({
      id: input.id, tenantId: input.tenantId, orderId: input.orderId, partnerId: null, vehicleId: null, riderUserId: null,
      status: 'pending', awbNo: null, pickupAddressId: input.pickupAddressId ?? null, dropAddressId: input.dropAddressId ?? null,
      scheduledPickupAt: null, scheduledWindowMins: null, pickedUpAt: null, deliveredAt: null,
      pickupOtpHash: null, deliveryOtpHash: null, podMediaId: null,
      chargeMinor: input.chargeMinor ?? null, codMinor: input.codMinor ?? null, requiresColdChain: input.requiresColdChain ?? false,
      createdAt: input.now ?? new Date(), deliveryAttempts: 0,
    });
    s.events.push({ type: ShipmentEventType.Created, payload: { shipmentId: s.props.id, orderId: s.props.orderId } });
    return s;
  }
  static rehydrate(props: ShipmentProps): Shipment { return new Shipment(props); }

  get id() { return this.props.id; }
  get status() { return this.props.status; }
  get orderId() { return this.props.orderId; }
  get riderUserId() { return this.props.riderUserId; }
  get requiresOtp() { return this.props.deliveryOtpHash != null; }
  /** PC-56 TENANT-5b · what the LOAD needs, which the fitness gate compares against what the vehicle IS.
   *  `requires_cold_chain` has been on this table since 0007 and had never been read against
   *  `vehicles.is_refrigerated`, so a ghee run could be loaded onto an open tempo. */
  get requiresColdChain() { return this.props.requiresColdChain; }
  toProps(): Readonly<ShipmentProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** Assign a 3PL/fleet partner, a vehicle, and/or a rider. */
  assign(input: { partnerId?: string | null; vehicleId?: string | null; riderUserId?: string | null; awbNo?: string | null }): void {
    this.props.partnerId = input.partnerId ?? this.props.partnerId;
    this.props.vehicleId = input.vehicleId ?? this.props.vehicleId;
    this.props.riderUserId = input.riderUserId ?? this.props.riderUserId;
    this.props.awbNo = input.awbNo ?? this.props.awbNo;
    this.to('assigned', ShipmentEventType.Assigned, { riderUserId: this.props.riderUserId });
  }
  /**
   * Schedule the collection — and **ISSUE THE PICKUP OTP, WHICH NOTHING HAS EVER DONE (PC-56 TENANT-5a).**
   *
   * `shipments.pickup_otp_hash` has existed since 0007 and is written by nothing in the monorepo: the entity
   * initialised it to null, `markPickedUp()` set a timestamp and moved the state, and the only OTP ever
   * issued was the DELIVERY one. So W225's philosophy line — "OTP at pickup AND delivery — possession
   * changes hands with proof, both directions" — was true in one direction, and W227's journey plan step 1
   * ("Meera Ben confirms with OTP") described a step that did not exist. A farmer handed over twelve
   * quintals at their own gate with no proof the handover happened, which is precisely the dispute W227 says
   * the ritual prevents.
   *
   * **ISSUED AT SCHEDULE TIME, NOT AT PICKUP TIME**, mirroring how `markOutForDelivery` issues the delivery
   * code before the rider reaches the door. The code has to reach the seller BEFORE the driver arrives; a
   * code generated at the gate would be read out by the driver to the person meant to be checking it, which
   * proves nothing at all.
   *
   * `pickupOtpHash` is optional so a collection from the tenant's own premises — where there is nobody to
   * hand over — schedules without one. See `pickupOtpRequired` in domain/shipment-readiness.ts.
   */
  schedulePickup(at: Date, windowMins: number | null, pickupOtpHash?: string | null): void {
    this.props.scheduledPickupAt = at; this.props.scheduledWindowMins = windowMins;
    if (pickupOtpHash) this.props.pickupOtpHash = pickupOtpHash;
    this.to('pickup_scheduled', ShipmentEventType.PickupScheduled, { scheduledPickupAt: at.toISOString(), pickupOtpIssued: !!pickupOtpHash });
  }
  /**
   * Possession passes to the carrier. **VERIFIES THE PICKUP OTP WHEN ONE WAS ISSUED (PC-56 TENANT-5a)**,
   * in constant time, exactly as `markDelivered` verifies the delivery code.
   *
   * When no pickup OTP was issued this proceeds without one, and that is deliberate rather than lax: every
   * shipment created before this wave has a null `pickup_otp_hash`, and refusing them would strand every
   * consignment in flight on the day this deploys. A collection from the tenant's own premises has nobody to
   * hand over and legitimately has none either. What the platform must never do is CLAIM the proof it does
   * not hold — `possessionProof()` reports `delivery_only` for those shipments and the console prints it.
   */
  markPickedUp(submittedOtpHash: string | null = null, now: Date = new Date()): void {
    if (this.props.pickupOtpHash && !this.pickupOtpMatches(submittedOtpHash)) throw new InvalidPickupOtpError();
    this.props.pickedUpAt = now;
    this.to('picked_up', ShipmentEventType.PickedUp, { pickupOtpVerified: !!this.props.pickupOtpHash });
  }
  markInTransit(): void { this.to('in_transit', ShipmentEventType.InTransit, {}); }
  markAtHub(): void { this.to('at_hub', ShipmentEventType.AtHub, {}); }

  /** Dispatch for final delivery. The delivery OTP hash (computed by the service from a fresh code)
   *  is stored now; the raw code is SMS'd to the buyer out-of-band (the service emits the issue event). */
  markOutForDelivery(deliveryOtpHash: string): void {
    if (!deliveryOtpHash) throw new InvalidShipmentError('delivery OTP hash required to dispatch');
    this.props.deliveryOtpHash = deliveryOtpHash;
    this.to('out_for_delivery', ShipmentEventType.OutForDelivery, {});
  }

  /** Proof-of-delivery: the rider submits the buyer's OTP (already hashed by the service). The hash
   *  must match the issued one in CONSTANT TIME. Optional POD media (signed photo) is recorded. */
  markDelivered(submittedOtpHash: string | null, podMediaId: string | null, now: Date = new Date()): void {
    if (!this.props.deliveryOtpHash) throw new DeliveryOtpNotIssuedError();
    if (!this.otpMatches(submittedOtpHash)) throw new InvalidDeliveryOtpError();
    this.props.deliveredAt = now;
    if (podMediaId) this.props.podMediaId = podMediaId;
    this.to('delivered', ShipmentEventType.Delivered, { orderId: this.props.orderId });
  }

  /**
   * A delivery attempt failed. **COUNTS IT (PC-56 TENANT-5a)** — the counter is what makes W226's "one free
   * re-attempt" a number rather than an adjective. The DECISION about what happens next is
   * `failureOutcome()` in domain/shipment-readiness.ts and the booking is the caller's; this records the
   * fact, and the event carries the attempt number so a consumer does not have to re-read the row.
   */
  /**
   * A delivery attempt failed. The attempt is COUNTED (5a) and, since PC-56 TENANT-5d, the REASON is carried into
   * the event row rather than only into an outbox payload — see `pendingEventAnnotation`.
   */
  markFailed(reason: string, reasonCode: string | null = null): void {
    this.props.deliveryAttempts += 1;
    this.to('failed', ShipmentEventType.Failed, { reason, reasonCode, attemptNo: this.props.deliveryAttempts });
    // Set AFTER `to()`, which clears any previous annotation: one hop, one annotation, and a second transition in the
    // same unit of work cannot inherit the first one's words.
    this.hop = { note: reason.trim().slice(0, 2000) || null, reasonCode };
  }
  markReturned(): void { this.to('returned', ShipmentEventType.Returned, {}); }
  cancel(): void { this.to('cancelled', ShipmentEventType.Cancelled, {}); }

  private pickupOtpMatches(submittedHash: string | null): boolean {
    return Shipment.hashEq(this.props.pickupOtpHash, submittedHash);
  }
  private otpMatches(submittedHash: string | null): boolean {
    const stored = this.props.deliveryOtpHash;
    if (!stored || !submittedHash) return false;
    return Shipment.hashEq(stored, submittedHash);
  }
  /** One constant-time comparison for both codes. Extracted so the pickup side cannot drift into a `===`
   *  the delivery side spent a wave getting right. */
  private static hashEq(stored: string | null, submitted: string | null): boolean {
    if (!stored || !submitted) return false;
    const a = Buffer.from(stored); const b = Buffer.from(submitted);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  /**
   * What the NEXT `shipment_events` row for this aggregate should carry beyond its status.
   *
   * **`ShipmentRepository.update` hardcoded `note = NULL` on every status hop since 0007** — the only writer of a
   * state change threw away everything the caller said about it, which is why the reason a delivery failed existed
   * in no column of this database and W244's chart had nothing to group. The annotation travels with the hop rather
   * than being passed alongside it, so a future transition that wants to say something cannot forget to.
   */
  pendingEventAnnotation(): { note: string | null; reasonCode: string | null } { return { ...this.hop }; }

  private hop: { note: string | null; reasonCode: string | null } = { note: null, reasonCode: null };

  private to(status: ShipmentStatus, evt: string, payload: Record<string, unknown>): void {
    assertTransition(this.props.status, status);
    this.props.status = status;
    this.hop = { note: null, reasonCode: null };
    this.events.push({ type: evt, payload: { shipmentId: this.props.id, orderId: this.props.orderId, ...payload } });
  }
}
