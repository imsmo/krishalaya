// modules/orders/__tests__/tracking-view.spec.ts · PC-56 HOTFIX-9 · A1 (survey F-1; founder Q3) — the pure tracking shaper, per role.
// A buyer: milestones and times, the attempt count, the AWB and `riderAssigned` — every note, the rider's id and every coordinate `null`
// (not rounded). The seller and a moderator: the full row unchanged, plus the same two fields.
import { trackingFor, OrderTrackingFull } from '../domain/tracking-view';
import { viewerRoleOf } from '../domain/order-event-roles';

const RIDER = '01922222-2222-7222-8222-222222222222';
const full = (over: Partial<OrderTrackingFull> = {}): OrderTrackingFull => ({
  orderId: 'o1', status: 'confirmed', createdAt: '2026-10-17T04:00:00.000Z', completedAt: null,
  orderEvents: [
    { fromStatus: null, toStatus: 'created', at: '2026-10-17T04:00:00.000Z', note: null },
    { fromStatus: 'created', toStatus: 'confirmed', at: '2026-10-17T04:05:00.000Z', note: 'Call Ramesh on +91 98250 11111 before loading' },
  ],
  shipment: {
    id: 's1', status: 'failed', riderUserId: RIDER, awbNo: 'AWB-77120',
    scheduledPickupAt: null, pickedUpAt: '2026-10-17T05:00:00.000Z', deliveredAt: null, deliveryAttempts: 1,
  },
  shipmentEvents: [
    { status: 'assigned', at: '2026-10-17T04:30:00.000Z', lat: null, lng: null, note: null },
    { status: 'in_transit', at: '2026-10-17T05:10:00.000Z', lat: 23.587812, lng: 72.369145, note: 'near Unjha, gate code 4411' },
    { status: 'failed', at: '2026-10-17T06:00:00.000Z', lat: null, lng: null, note: 'Buyer not home; neighbour Suresh said call later' },
  ],
  ...over,
});

describe('PC-56 HOTFIX-9 · trackingFor — a buyer sees the journey, never the driver', () => {
  it('the BUYER: every note null, riderUserId null, every lat/lng null (not rounded); milestones, times, AWB, attempts and riderAssigned kept', () => {
    const f = full();
    const b = trackingFor('buyer', f);
    expect(b.orderEvents.map((e) => e.note)).toEqual([null, null]);
    expect(b.orderEvents.map((e) => [e.fromStatus, e.toStatus, e.at])).toEqual(f.orderEvents.map((e) => [e.fromStatus, e.toStatus, e.at]));
    expect(b.shipment).toEqual({
      id: 's1', status: 'failed', riderUserId: null, riderAssigned: true, awbNo: 'AWB-77120',
      scheduledPickupAt: null, pickedUpAt: '2026-10-17T05:00:00.000Z', deliveredAt: null, deliveryAttempts: 1,
    });
    expect(b.shipmentEvents).toEqual(f.shipmentEvents.map((e) => ({ status: e.status, at: e.at, lat: null, lng: null, note: null })));
    // nothing of the person, the place or the words survives anywhere in the answer
    const wire = JSON.stringify(b);
    for (const leak of [RIDER, '23.58', '72.36', 'Ramesh', '98250', '4411', 'Suresh']) expect({ leak, found: wire.includes(leak) }).toEqual({ leak, found: false });
    // the response SHAPE is kept: the four person/place/word fields are present (as null), never dropped
    expect(Object.keys(b.shipment!)).toEqual(expect.arrayContaining(['riderUserId']));
    expect(Object.keys(b.shipmentEvents[1]).sort()).toEqual(['at', 'lat', 'lng', 'note', 'status']);
    expect(Object.keys(b.orderEvents[1]).sort()).toEqual(['at', 'fromStatus', 'note', 'toStatus']);
  });

  it('the SELLER and a MODERATOR: the full row unchanged, plus riderAssigned and deliveryAttempts', () => {
    for (const role of ['seller', 'moderator'] as const) {
      const f = full();
      const r = trackingFor(role, f);
      expect(r.orderEvents).toEqual(f.orderEvents);
      expect(r.shipmentEvents).toEqual(f.shipmentEvents);
      expect(r.shipment).toEqual({ ...f.shipment, riderAssigned: true });
      expect(r.shipment!.riderUserId).toBe(RIDER);
      expect(r.shipment!.deliveryAttempts).toBe(1);
      expect(r.shipmentEvents[1]).toMatchObject({ lat: 23.587812, lng: 72.369145, note: 'near Unjha, gate code 4411' });
    }
  });

  it('no shipment yet → shipment null for every role; a shipment with no rider → riderAssigned false, attempts 0', () => {
    for (const role of ['buyer', 'seller', 'moderator'] as const) {
      expect(trackingFor(role, full({ shipment: null, shipmentEvents: [] })).shipment).toBeNull();
      const pending = trackingFor(role, full({ shipment: { id: 's2', status: 'pending', riderUserId: null, awbNo: null, scheduledPickupAt: null, pickedUpAt: null, deliveredAt: null, deliveryAttempts: 0 }, shipmentEvents: [] }));
      expect(pending.shipment).toMatchObject({ riderAssigned: false, riderUserId: null, deliveryAttempts: 0, awbNo: null });
    }
  });

  it('the role is the CALLER\'s on THIS order (viewerRoleOf): a plain party → buyer shape; the seller → full; a moderator who is the buyer → full', () => {
    const order = { buyerUserId: 'u-buyer', sellerUserId: 'u-seller' };
    expect(trackingFor(viewerRoleOf({ userId: 'u-buyer', canModerate: false }, order), full()).shipment!.riderUserId).toBeNull();
    expect(trackingFor(viewerRoleOf({ userId: 'u-seller', canModerate: false }, order), full()).shipment!.riderUserId).toBe(RIDER);
    expect(trackingFor(viewerRoleOf({ userId: 'u-buyer', canModerate: true }, order), full()).shipment!.riderUserId).toBe(RIDER);
  });

  it('pure: the input is not mutated', () => {
    const f = full();
    const snapshot = JSON.stringify(f);
    trackingFor('buyer', f); trackingFor('seller', f);
    expect(JSON.stringify(f)).toBe(snapshot);
  });
});
