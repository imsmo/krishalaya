// PC-50 W10-5 · pure rider logic. Pins the rider-side legal milestones against domain/shipment.state.ts:
// ops-only moves (assign/schedule/cancel/returned) never appear; failed is re-attemptable; deliver only
// when out_for_delivery (it's the OTP + money-adjacent step).
import { riderActionsFor, isActiveTask, shipmentTone } from '../../features/delivery-partner/delivery';

describe('riderActionsFor (reflect, never grant — Law 5)', () => {
  it('mirrors the state machine, restricted to the assigned rider', () => {
    expect(riderActionsFor('pending')).toEqual([]);                       // unassigned — not the rider's yet
    expect(riderActionsFor('assigned')).toEqual(['picked_up']);
    expect(riderActionsFor('out_for_delivery')).toEqual(['deliver', 'fail']);
    expect(riderActionsFor('failed')).toEqual(['out_for_delivery']);      // re-attempt; returned = ops call
    expect(riderActionsFor('delivered')).toEqual([]);
    expect(riderActionsFor('cancelled')).toEqual([]);
    for (const s of ['picked_up', 'in_transit', 'at_hub']) expect(riderActionsFor(s)).not.toContain('deliver');
  });
  it('today-queue membership + tones', () => {
    expect(isActiveTask('out_for_delivery')).toBe(true);
    expect(isActiveTask('pending')).toBe(false);
    expect(isActiveTask('delivered')).toBe(false);
    expect(shipmentTone('failed')).toBe('danger');
    expect(shipmentTone('delivered')).toBe('success');
  });
});
