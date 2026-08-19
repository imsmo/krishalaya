// modules/logistics/domain/logistics.errors.ts · typed errors with stable codes.
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class ShipmentNotFoundError extends NotFoundError { constructor(id: string) { super('Shipment not found'); (this as any).details = { id }; } }
/** The actor is not a tenant logistics operator nor the assigned rider for this shipment. */
export class ShipmentForbiddenError extends AppError { constructor(message = 'Not allowed on this shipment') { super('SHIPMENT_FORBIDDEN', message, 403); } }
/** Delivery requires a valid proof-of-delivery OTP and the submitted one did not match. */
export class InvalidDeliveryOtpError extends AppError { constructor() { super('SHIPMENT_INVALID_OTP', 'Invalid or missing delivery OTP', 403); } }
/** A delivery was attempted but the shipment has no issued OTP to verify against. */
export class DeliveryOtpNotIssuedError extends AppError { constructor() { super('SHIPMENT_OTP_NOT_ISSUED', 'No delivery OTP has been issued; dispatch the shipment first', 409); } }
export class InvalidShipmentError extends DomainError { constructor(message: string) { super('SHIPMENT_INVALID', message, 400); } }
/** One shipment per order (idempotent creation). */
export class ShipmentExistsError extends AppError { constructor(orderId: string) { super('SHIPMENT_EXISTS', 'A shipment already exists for this order', 409, { orderId }); } }

// ---- fleet registry (partners / vehicles / pickup-slots) ----
export class PartnerNotFoundError extends NotFoundError { constructor(id: string) { super('Logistics partner not found'); (this as any).details = { id }; } }
export class VehicleNotFoundError extends NotFoundError { constructor(id: string) { super('Vehicle not found'); (this as any).details = { id }; } }
export class PickupSlotNotFoundError extends NotFoundError { constructor(id: string) { super('Pickup slot not found'); (this as any).details = { id }; } }
export class InvalidPartnerError extends DomainError { constructor(message: string) { super('PARTNER_INVALID', message, 422); } }
export class InvalidVehicleError extends DomainError { constructor(message: string) { super('VEHICLE_INVALID', message, 422); } }
export class InvalidPickupSlotError extends DomainError { constructor(message: string) { super('PICKUP_SLOT_INVALID', message, 422); } }
/** UNIQUE(partner_id, reg_no) — a vehicle with this plate already exists for the partner. */
export class DuplicateVehicleRegError extends AppError { constructor(regNo: string) { super('VEHICLE_REG_EXISTS', `A vehicle with reg_no ${regNo} already exists for this partner`, 409, { regNo }); } }
/** activate/deactivate (or a patch) is a no-op — the entity is already in the requested state. */
export class FleetAlreadyInStateError extends AppError { constructor(kind: string) { super('FLEET_ALREADY_IN_STATE', `${kind} is already in the requested state`, 409, { kind }); } }

// ---- zones / routes / cold-chain (serviceability + Village Run + reefer telemetry) ----
export class DeliveryZoneNotFoundError extends NotFoundError { constructor(id: string) { super('Delivery zone not found'); (this as any).details = { id }; } }
export class DeliveryRouteNotFoundError extends NotFoundError { constructor(id: string) { super('Delivery route not found'); (this as any).details = { id }; } }
export class InvalidDeliveryZoneError extends DomainError { constructor(message: string) { super('DELIVERY_ZONE_INVALID', message, 422); } }
export class InvalidDeliveryRouteError extends DomainError { constructor(message: string) { super('DELIVERY_ROUTE_INVALID', message, 422); } }
export class InvalidColdChainReadingError extends DomainError { constructor(message: string) { super('COLD_CHAIN_READING_INVALID', message, 422); } }
/** A referenced FK (charge_definition / vehicle / consolidation user) does not exist for this tenant. */
export class UnknownZoneRouteReferenceError extends AppError { constructor(ref: string) { super('ZONE_ROUTE_REF_UNKNOWN', `referenced ${ref} does not exist`, 422, { ref }); } }

/** PC-56 TENANT-5a · the pickup half of the two-way possession proof. Separate from the delivery error on
 *  purpose: a driver at a farm gate and a driver at a mill gate are different people at different moments,
 *  and a support agent reading a log must be able to tell which handover failed. */
export class InvalidPickupOtpError extends AppError { constructor() { super('SHIPMENT_INVALID_PICKUP_OTP', 'Invalid or missing pickup OTP', 403); } }

/**
 * PC-56 TENANT-5a · the wheels may not turn yet. Carries the REASON so the console can print W226's own
 * sentence ("payment clears first") rather than a bare conflict — an operator who is told "409" goes looking
 * for a bug, and one who is told "the order is still payment_pending" goes and chases the buyer.
 */
export class OrderNotReadyForTransportError extends AppError {
  constructor(reason: 'awaiting_payment' | 'order_closed' | 'unknown_order', orderStatus: string | null) {
    super('SHIPMENT_ORDER_NOT_READY',
      reason === 'awaiting_payment' ? 'The order has not been paid for yet — wheels never turn before money clears'
      : reason === 'order_closed' ? 'The order is cancelled or refunded — this shipment should be cancelled, not scheduled'
      : 'The order for this shipment could not be read — refusing to move goods on an unknown order',
      409, { reason, orderStatus });
  }
}

/**
 * PC-56 TENANT-5b · W231's [Approve route] refused, BY NAME.
 *
 * "Route approval needs logistics lead (it commits a vehicle + ambassador weekly)" — so the refusals are about
 * what is not yet committed, and each names one thing. `needs_approval` is the back-door case: switching a
 * never-approved route live through `POST :id/active` would skip the decision entirely.
 */
export class RouteNotApprovableError extends AppError {
  constructor(reason: 'needs_villages' | 'needs_vehicle' | 'needs_consolidation' | 'already_active' | 'not_proposed' | 'needs_approval') {
    super('ROUTE_NOT_APPROVABLE',
      reason === 'needs_vehicle' ? 'This route has no vehicle — approving it would commit a weekly run with nothing to carry it'
      : reason === 'needs_consolidation' ? 'This route has no consolidation point — approving it commits a named person\'s day, so there must be one'
      : reason === 'needs_villages' ? 'This route serves no villages'
      : reason === 'already_active' ? 'This route is already approved and running'
      : reason === 'needs_approval' ? 'This route has never been approved — approve it rather than switching it active'
      : 'Only a proposed route can be approved',
      409, { reason });
  }
}

/**
 * PC-56 TENANT-5b · the vehicle may not take this load. Carries the verdict so W226/W227 can print the reason
 * an operator can act on: a parked vehicle needs unparking, an expired RC needs an RTO appointment, and a
 * cold-chain consignment needs a different vehicle entirely.
 */
export class VehicleUnfitError extends AppError {
  constructor(reason: 'vehicle_unknown' | 'vehicle_parked' | 'rc_invalid' | 'rc_absent' | 'not_refrigerated', detail: Record<string, unknown> = {}) {
    super('SHIPMENT_VEHICLE_UNFIT',
      reason === 'vehicle_unknown' ? 'That vehicle does not exist for this tenant'
      : reason === 'vehicle_parked' ? 'That vehicle is parked (deactivated) and cannot be assigned'
      : reason === 'rc_invalid' ? 'That vehicle\'s registration certificate is expired or rejected — safety is not a preference'
      : reason === 'rc_absent' ? 'That vehicle has no registration certificate on file and this tenant requires one'
      : 'This shipment requires cold chain and that vehicle is not refrigerated',
      409, { reason, ...detail });
  }
}
