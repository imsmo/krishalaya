// apps/web-storefront/src/test/orders-timeline.spec.ts · the order status → progress mapping is tolerant: known
// happy-path statuses advance the bar, terminal statuses flag off-path, and an unknown status never invents
// progress (currentIndex stays -1 so the UI shows the raw status verbatim).
import { orderTimeline, ORDER_STEPS } from '../features/orders/timeline';

describe('orderTimeline', () => {
  it('maps happy-path statuses (incl. aliases) to the right step', () => {
    expect(orderTimeline('placed').currentIndex).toBe(0);
    expect(orderTimeline('created').currentIndex).toBe(0);
    expect(orderTimeline('confirmed').currentIndex).toBe(ORDER_STEPS.indexOf('confirmed'));
    expect(orderTimeline('in_transit').currentIndex).toBe(ORDER_STEPS.indexOf('ready'));
    expect(orderTimeline('completed').currentIndex).toBe(ORDER_STEPS.length - 1);
  });
  it('flags terminal off-path states', () => {
    expect(orderTimeline('cancelled').terminal).toBe('cancelled');
    // PC-56 STORE-3a · C2 (survey F-12): a refunded order is its OWN terminal state (it used to read "cancelled")
    expect(orderTimeline('refunded').terminal).toBe('refunded');
    expect(orderTimeline('partially_refunded').terminal).toBe('partially_refunded');
    expect(orderTimeline('in_dispute').terminal).toBe('disputed');
  });
  it('unknown status → no invented progress', () => {
    const m = orderTimeline('weird_status');
    expect(m.currentIndex).toBe(-1);
    expect(m.terminal).toBeNull();
  });
  it('is case/space tolerant + null-safe', () => {
    expect(orderTimeline('  CONFIRMED ').currentIndex).toBe(ORDER_STEPS.indexOf('confirmed'));
    expect(orderTimeline(null).currentIndex).toBe(-1);
  });
});
