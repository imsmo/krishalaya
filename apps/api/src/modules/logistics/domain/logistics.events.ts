// modules/logistics/domain/logistics.events.ts · integration events (via outbox, Law 4).
export const ShipmentEventType = {
  Created:         'logistics.shipment_created',
  Assigned:        'logistics.shipment_assigned',
  PickupScheduled: 'logistics.shipment_pickup_scheduled',
  PickedUp:        'logistics.shipment_picked_up',
  InTransit:       'logistics.shipment_in_transit',
  AtHub:           'logistics.shipment_at_hub',
  OutForDelivery:  'logistics.shipment_out_for_delivery',
  DeliveryOtpIssued: 'logistics.delivery_otp_issued',   // carries the OTP for the (deferred) SMS relay — internal only
  // PC-56 TENANT-5a · the pickup half of the two-way possession proof. Same shape and same warning as the
  // delivery one: carries the raw code for the SMS relay and must never leave the internal outbox.
  PickupOtpIssued: 'logistics.pickup_otp_issued',
  Delivered:       'logistics.shipment_delivered',      // → orders marks the order delivered (downstream)
  Failed:          'logistics.shipment_failed',
  Returned:        'logistics.shipment_returned',
  Cancelled:       'logistics.shipment_cancelled',
} as const;

// fleet registry (partners / vehicles / pickup-slots) — master-data lifecycle events
export const FleetEventType = {
  PartnerRegistered:  'logistics.partner_registered',
  VehicleRegistered:  'logistics.vehicle_registered',
  PickupSlotCreated:  'logistics.pickup_slot_created',
  // PC-56 TENANT-5b · W229: "an expired RC parks the vehicle automatically". Emitted per vehicle by the
  // RC-parking job, carrying WHICH document state parked it and until when it was valid — the evidence, not
  // just the verdict, so a consumer can tell an FPO what to renew.
  VehicleParkedRcInvalid: 'logistics.vehicle_parked_rc_invalid',
} as const;

// zones / routes / cold-chain (serviceability + Village Run + reefer telemetry)
export const ZoneRouteEventType = {
  DeliveryZoneCreated:  'logistics.delivery_zone_created',
  DeliveryRouteCreated: 'logistics.delivery_route_created',
  // PC-56 TENANT-5b · the approval W231 draws a button for and the platform could not represent.
  DeliveryRouteApproved: 'logistics.delivery_route_approved',
  ColdChainBreach:      'logistics.cold_chain_breach',     // emitted by the breach-alert worker job
  VillageRunDue:        'logistics.village_run_due',        // emitted by the village-run consolidation job
} as const;

export type DomainEvent = { type: string; payload: Record<string, unknown> };
