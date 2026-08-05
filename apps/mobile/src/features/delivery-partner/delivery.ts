// apps/mobile/src/features/delivery-partner/delivery.ts · PURE rider logic (PC-50 W10-5). The RIDER-side of
// the shipment state machine (domain/shipment.state.ts): which milestone buttons are legal per status
// (reflect, never grant — Law 5). assign/schedule/cancel/return are OPS actions and never appear here.
export const RIDER_ACTIONS = ['picked_up', 'in_transit', 'at_hub', 'out_for_delivery', 'deliver', 'fail'] as const;
export type RiderAction = (typeof RIDER_ACTIONS)[number];

/** Mirror of TRANSITIONS restricted to what the assigned rider may do. `deliver` requires the buyer's OTP.
 *  A `failed` shipment may be RE-ATTEMPTED (out_for_delivery); returned/cancelled are ops decisions. */
export function riderActionsFor(status: string | undefined | null): RiderAction[] {
  switch (status) {
    case 'assigned': return ['picked_up'];
    case 'pickup_scheduled': return ['picked_up', 'fail'];
    case 'picked_up': return ['in_transit', 'at_hub', 'out_for_delivery', 'fail'];
    case 'in_transit': return ['at_hub', 'out_for_delivery', 'fail'];
    case 'at_hub': return ['in_transit', 'out_for_delivery', 'fail'];
    case 'out_for_delivery': return ['deliver', 'fail'];
    case 'failed': return ['out_for_delivery']; // re-attempt; giving up (returned) is an ops call
    default: return []; // pending (unassigned) + terminal states
  }
}
export function isActiveTask(status: string): boolean {
  return !['delivered', 'returned', 'cancelled', 'pending'].includes(status);
}
export function shipmentTone(status: string | undefined): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  if (status === 'delivered') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'returned' || status === 'cancelled') return 'neutral';
  if (status === 'out_for_delivery') return 'info';
  return 'warning';
}
