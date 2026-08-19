// modules/logistics/__tests__/shipment.service.spec.ts · pure-domain unit tests: the shipment_status
// state machine (Law 5) + the Shipment aggregate, incl. the OTP-gated proof-of-delivery (constant-time
// hash compare). The service's UoW/outbox/authz/OTP-hashing are covered by the integration spec.
import { canTransition, isTerminal, isPrePickup, IllegalShipmentTransitionError, SHIPMENT_STATUSES, ShipmentStatus } from '../domain/shipment.state';
import { Shipment } from '../domain/shipment.entity';
import { ShipmentEventType } from '../domain/logistics.events';
import { InvalidDeliveryOtpError, InvalidShipmentError } from '../domain/logistics.errors';

const mk = () => Shipment.create({ id: 's1', tenantId: 't1', orderId: 'o1' });
const HASH_A = 'a'.repeat(64);   // stand-in OTP hashes (service computes the real HMAC)
const HASH_B = 'b'.repeat(64);

describe('shipment.state machine', () => {
  it('allows documented transitions, forbids illegal ones', () => {
    expect(canTransition('pending', 'assigned')).toBe(true);
    expect(canTransition('assigned', 'picked_up')).toBe(true);
    expect(canTransition('out_for_delivery', 'delivered')).toBe(true);
    expect(canTransition('pending', 'delivered')).toBe(false);
    expect(canTransition('delivered', 'cancelled')).toBe(false);
    expect(isTerminal('delivered')).toBe(true); expect(isTerminal('returned')).toBe(true); expect(isTerminal('cancelled')).toBe(true);
    expect(isPrePickup('pending')).toBe(true); expect(isPrePickup('in_transit')).toBe(false);
  });
  it('covers every status', () => { for (const s of SHIPMENT_STATUSES) expect(() => canTransition(s, 'cancelled' as ShipmentStatus)).not.toThrow(); });
});

describe('Shipment lifecycle', () => {
  it('starts pending and emits created', () => {
    const s = mk(); expect(s.status).toBe('pending');
    expect(s.pullEvents().map((e) => e.type)).toContain(ShipmentEventType.Created);
  });
  it('assign → pickup → out_for_delivery walks the legal chain', () => {
    const s = mk(); s.pullEvents();
    s.assign({ riderUserId: 'rider1' }); expect(s.status).toBe('assigned');
    s.markPickedUp(); expect(s.status).toBe('picked_up');
    s.markOutForDelivery(HASH_A); expect(s.status).toBe('out_for_delivery'); expect(s.requiresOtp).toBe(true);
  });
  it('illegal transition throws (cannot deliver a pending shipment)', () => {
    expect(() => mk().markInTransit()).toThrow(IllegalShipmentTransitionError);
  });
  it('out_for_delivery requires an OTP hash', () => {
    const s = mk(); s.assign({ riderUserId: 'r' }); s.markPickedUp();
    expect(() => s.markOutForDelivery('')).toThrow(InvalidShipmentError);
  });
  it('create rejects negative money', () => {
    expect(() => Shipment.create({ id: 's', tenantId: 't', orderId: 'o', codMinor: -1n })).toThrow(InvalidShipmentError);
  });
});

describe('OTP-gated proof-of-delivery', () => {
  const dispatched = () => { const s = mk(); s.assign({ riderUserId: 'r' }); s.markPickedUp(); s.markOutForDelivery(HASH_A); s.pullEvents(); return s; };
  it('delivers when the submitted OTP hash matches', () => {
    const s = dispatched();
    s.markDelivered(HASH_A, 'pod-media-1');
    expect(s.status).toBe('delivered');
    expect(s.toProps().deliveredAt).toBeInstanceOf(Date);
    expect(s.toProps().podMediaId).toBe('pod-media-1');
    const ev = s.pullEvents().find((e) => e.type === ShipmentEventType.Delivered)!;
    expect(ev.payload.orderId).toBe('o1');
  });
  it('rejects a wrong OTP and a missing OTP', () => {
    expect(() => dispatched().markDelivered(HASH_B, null)).toThrow(InvalidDeliveryOtpError);
    expect(() => dispatched().markDelivered(null, null)).toThrow(InvalidDeliveryOtpError);
  });
  it('rejects delivery before dispatch (no OTP issued)', () => {
    const s = mk(); s.assign({ riderUserId: 'r' }); s.markPickedUp();
    // picked_up → delivered is not a legal edge anyway, but assert the OTP guard for the dispatched-less path
    expect(() => s.markDelivered(HASH_A, null)).toThrow();
  });
});
