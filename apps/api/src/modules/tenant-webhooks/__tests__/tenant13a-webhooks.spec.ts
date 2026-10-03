// modules/tenant-webhooks/__tests__/tenant13a-webhooks.spec.ts · PC-56 TENANT-13a — the webhook rail's pure contract, each block a
// finding that was live at HEAD c0250c1:
//   F-1  every public name maps to an internal type a module REALLY declares (imported constants, never retyped) — and each payload
//        projection is a whitelist with no phone / name / address / free text / bank fragment / OTP;
//   F-3  the guard: every range named in the brief refused, the survey's bypasses refused, a resolved private address refused;
//   F-10 the envelope: per-row binding, KEK naming, legacy tokens open, production without a KEK refuses;
//   §B   the ladder, the state machines, the review and act verdicts, the PII mask, the computed diagnosis;
//   fanout a paused endpoint's event is HELD, not dropped; the body is the catalogue envelope, not the raw outbox payload.
import { OrderEventType } from '../../orders/domain/orders.events';
import { PaymentEventType } from '../../payments/domain/payments.events';
import { PayoutEventType } from '../../payments/events/payments.publisher';
import { ShipmentEventType } from '../../logistics/domain/logistics.events';
import { AuctionEventType } from '../../auctions/domain/auctions.events';
import { OfferEventType } from '../../offers/domain/offers.events';
import { DisputeEventType } from '../../disputes/domain/disputes.events';
import { DairyEventType } from '../../dairy/domain/dairy.events';
import { CATALOGUE_INTERNAL_TYPES, WEBHOOK_CATALOGUE, WEBHOOK_EVENT_NAMES, catalogueEntry, envelopeFor, publicNamesFor } from '../domain/webhook-catalog';
import { checkWebhookUrl, isNonPublicAddress, vetWebhookTarget } from '../domain/webhook-ssrf';
import { DEV_ONLY_KEK_HEX, isEnvelope, kekId, openEnvelope, parseKek, resolveKek, sealEnvelope } from '../../../core/secrets/secret-envelope';
import { seal as legacySeal } from '../../../core/crypto/secret-box';
import { parseSignatureHeader, signatureHeader, verifySignature } from '../domain/webhook-signature';
import {
  MAX_ATTEMPTS, afterFailure, canDeliveryMove, canEndpointMove, initialDeliveryState, ladderLabel,
} from '../domain/webhook-rail.state';
import { endpointActVerdict, generateSecret, reasonRefusal, replayVerdict, reviewRegistration, secretHint } from '../domain/webhook-rules';
import { PII_MASK, diagnose, maskPayload } from '../domain/webhook-log';
import { WebhookFanoutHandler } from '../events/handlers/webhook-fanout.handler';
import { WEBHOOK_EVENT_TYPES } from '../domain/webhook-events';

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* F-1 · the catalogue                                                                                                            */
/* ------------------------------------------------------------------------------------------------------------------------------ */
const DECLARED = new Set<string>([
  ...Object.values(OrderEventType), ...Object.values(PaymentEventType), ...Object.values(PayoutEventType), ...Object.values(ShipmentEventType),
  ...Object.values(AuctionEventType), ...Object.values(OfferEventType), ...Object.values(DisputeEventType), ...Object.values(DairyEventType),
]);

describe('F-1 · the public catalogue maps to internal types the platform really declares', () => {
  it('names exactly the twelve adjudicated events (nothing dropped: every one has an emitter)', () => {
    expect([...WEBHOOK_EVENT_NAMES].sort()).toEqual([
      'auction.ended', 'auction.settled', 'dispute.resolved', 'milk_bill.approved', 'offer.accepted', 'order.cancelled', 'order.completed',
      'order.created', 'order.delivered', 'payment.succeeded', 'payout.completed', 'shipment.status_changed',
    ]);
    expect(WEBHOOK_EVENT_TYPES).toEqual(WEBHOOK_EVENT_NAMES);
  });
  it.each(WEBHOOK_CATALOGUE.map((c) => [c.name, c]))('%s → every internal type is a declared outbox constant', (_n, c) => {
    expect(c.internalTypes.length).toBeGreaterThan(0);
    for (const t of c.internalTypes) expect(DECLARED.has(t)).toBe(true);
  });
  it('the exact mappings', () => {
    const m = Object.fromEntries(WEBHOOK_CATALOGUE.map((c) => [c.name, [...c.internalTypes].sort()]));
    expect(m['order.created']).toEqual([OrderEventType.Created]);
    expect(m['order.completed']).toEqual([OrderEventType.Completed]);
    expect(m['order.cancelled']).toEqual([OrderEventType.Cancelled]);
    expect(m['order.delivered']).toEqual([OrderEventType.Delivered]);
    expect(m['payment.succeeded']).toEqual([PaymentEventType.Succeeded]);
    expect(m['payout.completed']).toEqual(['payments.payout_succeeded']);
    expect(m['auction.ended']).toEqual([AuctionEventType.Ended]);
    expect(m['auction.settled']).toEqual([AuctionEventType.Won]);
    expect(m['offer.accepted']).toEqual([OfferEventType.Accepted]);
    expect(m['dispute.resolved']).toEqual([DisputeEventType.Resolved]);
    expect(m['milk_bill.approved']).toEqual([DairyEventType.BillApproved]);
    expect(m['shipment.status_changed']).toHaveLength(11);
    // the two OTP events carry raw codes and are NEVER a webhook
    expect(m['shipment.status_changed']).not.toContain(ShipmentEventType.DeliveryOtpIssued);
    expect(m['shipment.status_changed']).not.toContain(ShipmentEventType.PickupOtpIssued);
    expect(CATALOGUE_INTERNAL_TYPES).toHaveLength(22);   // 4 order + payment + payout + 11 shipment hops + ended + won + offer + dispute + milk bill
    expect(publicNamesFor('orders.order_created')).toEqual(['order.created']);
    expect(publicNamesFor('order.created')).toEqual([]);                 // the public name is NOT an outbox type (F-1's defect)
  });
});

/** Each emitter's real payload shape (file:line in the 13a report), with the PII it could carry planted alongside. */
const EVENTS: Record<string, { type: string; aggregateId: string; payload: Record<string, unknown>; expect: Record<string, unknown> }> = {
  'order.created': { type: OrderEventType.Created, aggregateId: 'o1', payload: { v: 1, orderId: 'o1', totalMinor: '125000', sellerUserId: 's1', buyerUserId: 'b1', discountMinor: '0', couponCode: 'DIWALI', buyerPhone: '+919800000001' }, expect: { orderId: 'o1', status: 'created', totalMinor: '125000', discountMinor: '0', buyerUserId: 'b1', sellerUserId: 's1' } },
  'order.completed': { type: OrderEventType.Completed, aggregateId: 'o1', payload: { v: 1, buyerUserId: 'b1', sellerUserId: 's1', totalMinor: '125000', deliveryFeeMinor: '5000', platformFeeMinor: '1000', currencyCode: 'INR', source: 'marketplace' }, expect: { orderId: 'o1', status: 'completed', totalMinor: '125000', currencyCode: 'INR', source: 'marketplace' } },
  'order.cancelled': { type: OrderEventType.Cancelled, aggregateId: 'o1', payload: { v: 1, reason: 'buyer called Ramesh Patel at 9800000001', by: 'u9', role: 'system' }, expect: { orderId: 'o1', status: 'cancelled', cancelledByRole: 'system', reasonId: null } },
  'order.delivered': { type: OrderEventType.Delivered, aggregateId: 'o1', payload: { v: 1, buyerUserId: 'b1', sellerUserId: 's1' }, expect: { orderId: 'o1', status: 'delivered' } },
  'payment.succeeded': { type: PaymentEventType.Succeeded, aggregateId: 'p1', payload: { v: 1, paymentId: 'p1', amountMinor: '125000', referenceType: 'order', referenceId: 'o1', payerUserId: 'b1', currencyCode: 'INR', method: 'upi', gatewayPaymentId: 'pay_X', capturedAt: '2026-10-03T10:00:00.000Z' }, expect: { paymentId: 'p1', amountMinor: '125000', referenceType: 'order', method: 'upi' } },
  'payout.completed': { type: 'payments.payout_succeeded', aggregateId: 'po1', payload: { v: 2, payoutId: 'po1', amountMinor: '980000', currencyCode: 'INR', userId: 'f1', last4: '4471' }, expect: { payoutId: 'po1', status: 'completed', amountMinor: '980000', currencyCode: 'INR' } },
  'shipment.status_changed': { type: ShipmentEventType.Failed, aggregateId: 'sh1', payload: { v: 1, shipmentId: 'sh1', orderId: 'o1', reason: 'gate locked, called Sunita on 98xxxxxx', reasonCode: 'customer_unavailable', attemptNo: 2 }, expect: { shipmentId: 'sh1', orderId: 'o1', status: 'failed', failureReasonCode: 'customer_unavailable', attemptNo: 2 } },
  'auction.ended': { type: AuctionEventType.Ended, aggregateId: 'a1', payload: { v: 1, auctionId: 'a1', awaitingApproval: true, decisionDueAt: '2026-10-04T10:00:00.000Z' }, expect: { auctionId: 'a1', status: 'ended', awaitingApproval: true } },
  'auction.settled': { type: AuctionEventType.Won, aggregateId: 'a1', payload: { v: 1, auctionId: 'a1', listingId: 'l1', winningBidId: 'bid1', bidderUserId: 'u7', amountMinor: '550000', unitPriceMinor: '550000', quantity: 12, unitCode: 'quintal', lotValueMinor: '6600000' }, expect: { auctionId: 'a1', status: 'settled', winnerUserId: 'u7', lotValueMinor: '6600000', quantity: 12 } },
  'offer.accepted': { type: OfferEventType.Accepted, aggregateId: 'of1', payload: { v: 1, by: 'seller', agreedPriceMinor: '520000', quantity: 5, buyerUserId: 'b1' }, expect: { offerId: 'of1', status: 'accepted', acceptedBy: 'seller', agreedPriceMinor: '520000' } },
  'dispute.resolved': { type: DisputeEventType.Resolved, aggregateId: 'd1', payload: { v: 1, disputeId: 'd1', orderId: 'o1', resolutionType: 'refund_partial', resolutionAmountMinor: '20000', raisedBy: 'b1', againstUser: 's1' }, expect: { disputeId: 'd1', resolutionType: 'refund_partial', resolutionAmountMinor: '20000' } },
  'milk_bill.approved': { type: DairyEventType.BillApproved, aggregateId: 'mb1', payload: { v: 1, billId: 'mb1', from: 'previewed', to: 'approved', memberName: 'Kanta Ben' }, expect: { billId: 'mb1', status: 'approved', previousStatus: 'previewed' } },
};

describe('F-1 · payload projection v1 — a whitelist, PII-free', () => {
  it.each(Object.entries(EVENTS))('%s', (name, e) => {
    const env = envelopeFor(name, { id: '42', eventType: e.type, aggregateType: 'x', aggregateId: e.aggregateId, payload: e.payload }, '2026-10-03T10:00:00.000Z');
    expect(env).toMatchObject({ id: `evt_42_${name.replace(/\./g, '_')}`, type: name, payloadVersion: 1, createdAt: '2026-10-03T10:00:00.000Z' });
    expect(env.data).toMatchObject(e.expect);
    expect(Object.keys(env.data).sort()).toEqual([...catalogueEntry(name)!.fields].sort());
    const text = JSON.stringify(env);
    for (const leak of ['+9198', '9800000001', 'Ramesh', 'Sunita', 'Kanta', '4471', 'DIWALI', 'pay_X', '"reason"', 'last4', 'Phone', 'Name']) expect(text).not.toContain(leak);
  });
  it('a type that does not fire a name is refused (no cross-wiring)', () => {
    expect(() => envelopeFor('order.created', { id: '1', eventType: OrderEventType.Completed, aggregateType: 'order', aggregateId: 'o1', payload: {} }, 'x')).toThrow();
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* F-3 · the guard                                                                                                                */
/* ------------------------------------------------------------------------------------------------------------------------------ */
describe('F-3 · every private / reserved range in the brief is refused', () => {
  const v4 = ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '127.0.0.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '100.127.255.255', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255'];
  it.each(v4)('IPv4 %s', (a) => { expect(isNonPublicAddress(a)).toBe(true); expect(checkWebhookUrl(`https://${a}/x`).ok).toBe(false); });
  const v6 = ['::1', '::', 'fc00::1', 'fdff::1', 'fe80::1', 'febf::1', 'fec0::1', 'feff::1', '::ffff:169.254.169.254', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::a9fe:a9fe', '64:ff9b::7f00:1', 'ff02::1'];
  it.each(v6)('IPv6 %s', (a) => { expect(isNonPublicAddress(a)).toBe(true); expect(checkWebhookUrl(`https://[${a}]/x`).ok).toBe(false); });
  it('public addresses pass, including a mapped / NAT64 PUBLIC v4', () => {
    for (const a of ['93.184.216.34', '8.8.8.8', '100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0', '2606:4700::1111', '::ffff:8.8.8.8', '64:ff9b::808:808']) expect(isNonPublicAddress(a)).toBe(false);
  });
  it('the survey bypasses: mapped metadata, mapped loopback, trailing dot, site-local, NAT64 metadata', () => {
    for (const u of ['https://[::ffff:169.254.169.254]/', 'https://[::ffff:127.0.0.1]/', 'https://localhost./', 'https://[fec0::1]/', 'https://[64:ff9b::a9fe:a9fe]/']) {
      expect(checkWebhookUrl(u).ok).toBe(false);
    }
    expect(checkWebhookUrl('https://intranet/hook')).toMatchObject({ ok: false, reason: 'single_label_host' });
    expect(checkWebhookUrl('https://hooks.acme.in:8443/')).toMatchObject({ ok: false, reason: 'bad_port' });
  });
  it('169.254.169.254.nip.io via a resolver → refused; any private address among several → refused; resolver failure → unresolvable', async () => {
    expect(await vetWebhookTarget('https://169.254.169.254.nip.io/', async () => [{ address: '169.254.169.254', family: 4 }])).toMatchObject({ ok: false, reason: 'private_address' });
    expect(await vetWebhookTarget('https://x.example.com/', async () => [{ address: '8.8.8.8', family: 4 }, { address: 'fd00::5', family: 6 }])).toMatchObject({ ok: false, address: 'fd00::5' });
    expect(await vetWebhookTarget('https://x.example.com/', async () => { throw new Error('ENOTFOUND'); })).toMatchObject({ ok: false, reason: 'unresolvable' });
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* F-10 · secrets                                                                                                                 */
/* ------------------------------------------------------------------------------------------------------------------------------ */
describe('F-10 · the envelope and the secret', () => {
  const kek = parseKek('ab'.repeat(32));
  it('v2 tokens name their KEK and refuse another', () => {
    const t = sealEnvelope(kek, 'whsec_a', 'webhook_endpoint:1');
    expect(isEnvelope(t)).toBe(true);
    expect(t.split('.')[1]).toBe(kekId(kek));
    expect(() => openEnvelope(parseKek('cd'.repeat(32)), t, 'webhook_endpoint:1')).toThrow(/another key/);
  });
  it('a legacy (0090) single-layer token still opens — partner endpoints and pre-0191 rows', () => {
    const legacy = legacySeal(kek, 'whsec_legacy');
    expect(openEnvelope(kek, legacy, 'ignored')).toBe('whsec_legacy');
  });
  it('production without a KEK refuses; development falls back to the documented key; a malformed KEK always throws', () => {
    expect(() => resolveKek(undefined, true)).toThrow(/must be set in production/);
    expect(() => resolveKek('', true)).toThrow();
    expect(resolveKek(undefined, false).toString('hex')).toBe(DEV_ONLY_KEK_HEX);
    expect(() => resolveKek('short', false)).toThrow();
  });
  it('whsec_ + 32 random bytes (base64url, 43 chars); hint = last 3', () => {
    const s = generateSecret();
    expect(s).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(secretHint(s)).toBe(s.slice(-3));
    expect(generateSecret()).not.toBe(s);
  });
  it('rotation window: both v1 values verify; after it only the new', () => {
    const h = signatureHeader(['whsec_new', 'whsec_old'], 'b', 100);
    expect(parseSignatureHeader(h)).toEqual({ t: 100, v1: expect.any(Array) });
    expect(verifySignature(h, 'whsec_old', 'b', 100)).toBe(true);
    expect(verifySignature(signatureHeader(['whsec_new'], 'b', 100), 'whsec_old', 'b', 100)).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* §B · the contract and the machines                                                                                             */
/* ------------------------------------------------------------------------------------------------------------------------------ */
describe('§B · the ladder and the state machines', () => {
  it('1m 5m 30m 2h 12h then exhaust; labels name the step a retry waits on', () => {
    expect(MAX_ATTEMPTS).toBe(6);
    expect([1, 2, 3, 4, 5].map((n) => afterFailure(n))).toEqual([
      { action: 'retry', step: 1, delaySec: 60, label: '1m' }, { action: 'retry', step: 2, delaySec: 300, label: '5m' },
      { action: 'retry', step: 3, delaySec: 1800, label: '30m' }, { action: 'retry', step: 4, delaySec: 7200, label: '2h' },
      { action: 'retry', step: 5, delaySec: 43200, label: '12h' }]);
    expect(afterFailure(6)).toEqual({ action: 'exhaust' });
    expect(() => afterFailure(0)).toThrow();
    expect(ladderLabel(3)).toBe('30m'); expect(ladderLabel(0)).toBeNull();
  });
  it('delivery moves', () => {
    expect(canDeliveryMove('held', 'pending')).toBe(true);
    expect(canDeliveryMove('cancelled', 'pending')).toBe(false);
    expect(canDeliveryMove('delivered', 'pending')).toBe(true);     // replay
    expect(canDeliveryMove('held', 'delivered')).toBe(false);       // a held delivery is never sent without a resume
  });
  it('endpoint moves; a paused / disabled endpoint\'s events are HELD', () => {
    expect(canEndpointMove('active', 'paused', 'manual')).toBe(true);
    expect(canEndpointMove('active', 'paused', 'unsafe_target')).toBe(false);
    expect(canEndpointMove('active', 'disabled', 'unsafe_target')).toBe(true);
    expect(canEndpointMove('paused', 'disabled', 'unsafe_target')).toBe(false);
    expect(canEndpointMove('disabled', 'active', null)).toBe(true);
    expect([initialDeliveryState('active'), initialDeliveryState('paused'), initialDeliveryState('disabled')]).toEqual(['pending', 'held', 'held']);
  });
});

describe('§B · the review and the verdicts', () => {
  const ok = { ok: true as const, host: 'erp.anandfpo.in', port: 443 as const, path: '/', addresses: [{ address: '93.184.216.34', family: 4 as const }], pinned: { address: '93.184.216.34', family: 4 as const } };
  it('registration review: every refusal against its field, events with their payload version', () => {
    expect(reviewRegistration({ url: '', eventTypes: [], developerEmail: 'nope' }, null).refusals).toEqual([
      { field: 'url', code: 'URL_REQUIRED' }, { field: 'eventTypes', code: 'EVENTS_REQUIRED' }, { field: 'developerEmail', code: 'EMAIL_INVALID' }]);
    const r = reviewRegistration({ url: 'https://erp.anandfpo.in/', eventTypes: ['order.created', 'order.created', 'payout.completed'], developerEmail: 'dev@anandfpo.in' }, ok);
    expect(r.ready).toBe(true);
    expect(r.events).toEqual([expect.objectContaining({ name: 'order.created', payloadVersion: 1 }), expect.objectContaining({ name: 'payout.completed', payloadVersion: 1 })]);
    expect(r.url).toMatchObject({ verdict: 'public', addresses: ['93.184.216.34'] });
    const bad = reviewRegistration({ url: 'https://x.nip.io/', eventTypes: ['order.created', 'orders.order_created'], developerEmail: 'd@x.in' }, { ok: false, reason: 'private_address', host: 'x.nip.io', address: '10.0.0.1' });
    expect(bad.refusals).toEqual([{ field: 'url', code: 'URL_PRIVATE_ADDRESS' }, { field: 'eventTypes', code: 'EVENT_UNKNOWN' }]);
  });
  const counts = { pending: 2, retrying: 1, delivered: 9, held: 3, exhausted: 1, cancelled: 0 };
  const now = new Date('2026-10-03T10:00:00.000Z');
  it('pause holds the queue; resume replays held + exhausted; delete cancels the open; replay-failed counts failed', () => {
    expect(endpointActVerdict('pause', { status: 'active', deleted: false, prevExpiresAt: null }, counts, 'maintenance window', now)).toMatchObject({ allowed: true, effect: { holds: 3 } });
    expect(endpointActVerdict('pause', { status: 'paused', deleted: false, prevExpiresAt: null }, counts, 'again', now).refusals).toEqual(['NOT_ACTIVE']);
    expect(endpointActVerdict('resume', { status: 'paused', deleted: false, prevExpiresAt: null }, counts, 'server back', now)).toMatchObject({ allowed: true, effect: { replays: 4 } });
    expect(endpointActVerdict('delete', { status: 'active', deleted: false, prevExpiresAt: null }, counts, 'decommissioned', now).effect.cancels).toBe(7);
    expect(endpointActVerdict('replay-failed', { status: 'active', deleted: false, prevExpiresAt: null }, counts, 'fixed the bug', now).effect.replays).toBe(2);
    expect(endpointActVerdict('replay-failed', { status: 'paused', deleted: false, prevExpiresAt: null }, counts, 'x y z', now).refusals).toEqual(['ENDPOINT_NOT_ACTIVE']);
    expect(endpointActVerdict('pause', { status: 'active', deleted: false, prevExpiresAt: null }, counts, '', now).refusals).toEqual(['REASON_REQUIRED']);
  });
  it('a disabled endpoint resumes only when the guard passes NOW', () => {
    expect(endpointActVerdict('resume', { status: 'disabled', deleted: false, prevExpiresAt: null }, counts, 'dns fixed', now, { ok: false, reason: 'private_address' }).refusals).toEqual(['GUARD_STILL_REFUSES']);
    expect(endpointActVerdict('resume', { status: 'disabled', deleted: false, prevExpiresAt: null }, counts, 'dns fixed', now, ok).allowed).toBe(true);
  });
  it('rotation states the 24 h overlap and refuses a second rotation inside a live one', () => {
    expect(endpointActVerdict('rotate', { status: 'active', deleted: false, prevExpiresAt: null }, counts, 'quarterly', now).effect.previousSignsUntil).toBe('2026-10-04T10:00:00.000Z');
    expect(endpointActVerdict('rotate', { status: 'active', deleted: false, prevExpiresAt: '2026-10-03T20:00:00.000Z' }, counts, 'again', now).refusals).toEqual(['ROTATION_OVERLAP_LIVE']);
  });
  it('replay one: only retrying / exhausted / delivered, only to an active endpoint', () => {
    expect(replayVerdict({ state: 'exhausted', endpointStatus: 'active', endpointDeleted: false }, 'fixed')).toEqual({ allowed: true, refusals: [] });
    expect(replayVerdict({ state: 'held', endpointStatus: 'active', endpointDeleted: false }, 'fixed').refusals).toEqual(['STATE_NOT_REPLAYABLE']);
    expect(replayVerdict({ state: 'delivered', endpointStatus: 'paused', endpointDeleted: false }, 'fixed').refusals).toEqual(['ENDPOINT_NOT_ACTIVE']);
    expect(reasonRefusal('x'.repeat(301))).toBe('REASON_TOO_LONG');
  });
});

describe('§B · the log helpers', () => {
  it('masks *_phone / *Name / address / email at any depth (the defensive second line)', () => {
    const m = maskPayload({ data: { orderId: 'o1', buyer_phone: '+91…', farmerName: 'Ramesh', items: [{ deliveryAddress: 'Anand', qty: 2 }], email: 'x@y' } }) as any;
    expect(m.data).toEqual({ orderId: 'o1', buyer_phone: PII_MASK, farmerName: PII_MASK, items: [{ deliveryAddress: PII_MASK, qty: 2 }], email: PII_MASK });
  });
  it('the diagnosis is computed from the failure facts — count, codes, endpoints, since', () => {
    expect(diagnose([])).toBeNull();
    const d = diagnose([
      { endpointId: 'e1', endpointHost: 'sheets-bridge.anandfpo.in', code: '504', count: 8, since: '2026-10-03T09:02:00.000000Z' },
      { endpointId: 'e1', endpointHost: 'sheets-bridge.anandfpo.in', code: '504', count: 4, since: '2026-10-03T09:10:00.000000Z' },
    ])!;
    expect(d).toEqual({ failures: 12, codes: [{ code: '504', count: 12 }], endpoints: [{ id: 'e1', host: 'sheets-bridge.anandfpo.in', count: 12 }], since: '2026-10-03T09:02:00.000000Z', singleCause: true });
    expect(diagnose([{ endpointId: 'e1', endpointHost: 'a', code: '504', count: 1, since: 'x' }, { endpointId: 'e2', endpointHost: 'b', code: 'timeout', count: 2, since: 'x' }])!.singleCause).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* fanout                                                                                                                         */
/* ------------------------------------------------------------------------------------------------------------------------------ */
describe('fanout · registered by INTERNAL type; held for a paused endpoint; the body is the envelope', () => {
  it('enqueues pending for active, held for paused / disabled, with the projection — never the raw payload', async () => {
    const enq: any[] = [];
    const repo: any = {
      endpointsForEvent: jest.fn(async (_tx: unknown, _t: string, name: string) => (name === 'order.created' ? [{ id: 'e1', status: 'active' }, { id: 'e2', status: 'paused' }, { id: 'e3', status: 'disabled' }] : [])),
      enqueue: jest.fn(async (_tx: unknown, d: unknown) => { enq.push(d); return 'id'; }),
    };
    const h = new WebhookFanoutHandler(OrderEventType.Created, repo, () => new Date('2026-10-03T10:00:00.000Z'));
    expect(h.eventType).toBe('orders.order_created');
    await h.handle({ id: '77', tenantId: 't1', aggregateType: 'order', aggregateId: 'o1', eventType: OrderEventType.Created, payload: EVENTS['order.created'].payload } as any, {} as any);
    expect(enq.map((d) => [d.endpointId, d.state, d.kind, d.eventType, d.internalType, d.sourceEventId])).toEqual([
      ['e1', 'pending', 'tenant', 'order.created', 'orders.order_created', '77'], ['e2', 'held', 'tenant', 'order.created', 'orders.order_created', '77'], ['e3', 'held', 'tenant', 'order.created', 'orders.order_created', '77']]);
    expect(enq[0].payload).toEqual({ id: 'evt_77_order_created', type: 'order.created', payloadVersion: 1, createdAt: '2026-10-03T10:00:00.000Z', data: EVENTS['order.created'].expect });
    expect(JSON.stringify(enq[0].payload)).not.toContain('+919800000001');
  });
  it('a platform-global event (no tenant) and an unmapped type enqueue nothing', async () => {
    const repo: any = { endpointsForEvent: jest.fn(async () => [{ id: 'e1', status: 'active' }]), enqueue: jest.fn() };
    await new WebhookFanoutHandler(OrderEventType.Created, repo).handle({ id: '1', tenantId: null, aggregateType: 'o', aggregateId: 'o', eventType: OrderEventType.Created, payload: {} } as any, {} as any);
    await new WebhookFanoutHandler('orders.order_packed', repo).handle({ id: '1', tenantId: 't', aggregateType: 'o', aggregateId: 'o', eventType: 'orders.order_packed', payload: {} } as any, {} as any);
    expect(repo.enqueue).not.toHaveBeenCalled();
  });
});
