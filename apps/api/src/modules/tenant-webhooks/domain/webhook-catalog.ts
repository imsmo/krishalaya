// modules/tenant-webhooks/domain/webhook-catalog.ts · THE PUBLIC EVENT CATALOGUE — PC-56 TENANT-13a (F-1).
//
// THE DEFECT. The old allow-list named nine dotted events (`order.created` …) and the fanout registered one handler per name — but
// the outbox emits `orders.order_created`, `payments.payout_succeeded` …, and the dispatcher looks handlers up by the EXACT
// `outbox_events.event_type`. No tenant endpoint had ever received a delivery, or could.
//
// THE CATALOGUE. A public name (what a tenant subscribes to and what the `type` of a delivered payload says) maps to the INTERNAL
// outbox type(s) that really fire it, and to a versioned payload PROJECTION. The internal types are imported from the emitting
// modules' own event constants — never retyped — so a rename there breaks this file's compile and its spec, not tenants' feeds
// silently. Fanout handlers are registered by INTERNAL type (one per distinct internal type), exactly as the dispatcher keys them.
// The model is `communication/events/notification-event-map.ts`: public codes mapped from real outbox types.
//
// THE PAYLOAD (v1). Projections are WHITELISTS: ids, amounts (minor-unit strings, Law 2), statuses, codes, counts, timestamps. Never
// a phone, a name, an address, a free-text reason, a bank fragment (`last4`), a rider's identity, an OTP. A field an emitter adds
// tomorrow does not reach a tenant's server until someone adds it here, in a new payload version if it changes meaning.
//
// WHAT THE BRIEF ASKED FOR AND WHAT EACH NAME MAPS TO (each verified against its emitter, file:line in the 13a report):
//   order.created            ← orders.order_created            (Order.create, order.entity.ts)
//   order.completed          ← orders.order_completed          (Order.complete / auto-complete)
//   order.cancelled          ← orders.order_cancelled          (Order.cancel / system cancel)
//   order.delivered          ← orders.order_delivered          (the ORDER's own delivered transition — reached by a manual mark AND by
//                                                               logistics.shipment_delivered via orders' handler; mapping the shipment
//                                                               event instead would miss every order delivered without a shipment row)
//   payment.succeeded        ← payments.payment_succeeded      (Payment.markCaptured)
//   payout.completed         ← payments.payout_succeeded       (PayoutService.execute / the RazorpayX webhook)
//   shipment.status_changed  ← logistics.shipment_* (11 hops)  (Shipment transitions; the two *_otp_issued events carry raw OTPs and
//                                                               are NOT shipment status changes — never mapped)
//   auction.ended            ← auctions.auction_ended          (Auction.closeBidding / awaiting-approval close)
//   auction.settled          ← auctions.auction_won            (Auction.markSettled — the transition INTO `settled` emits `Won`; there is
//                                                               no separate "settled" type, and `emd_applied` fires only when an EMD exists)
//   offer.accepted           ← offers.offer_accepted           (ListingOffer.accept)
//   dispute.resolved         ← disputes.dispute_resolved       (Dispute.resolve)
//   milk_bill.approved       ← dairy.bill_approved             (MilkBill.approve via MilkBillService.approve)
// Nothing in the brief's list was dropped: every name has a real emitter.
import { OrderEventType } from '../../orders/domain/orders.events';
import { PaymentEventType } from '../../payments/domain/payments.events';
import { PayoutEventType } from '../../payments/events/payments.publisher';
import { ShipmentEventType } from '../../logistics/domain/logistics.events';
import { AuctionEventType } from '../../auctions/domain/auctions.events';
import { OfferEventType } from '../../offers/domain/offers.events';
import { DisputeEventType } from '../../disputes/domain/disputes.events';
import { DairyEventType } from '../../dairy/domain/dairy.events';
import { PAYLOAD_VERSION } from './webhook-rail.state';

/** What the projection sees of a relayed outbox event. */
export interface CatalogueEvent {
  id: string;                     // outbox_events.id (bigint as text)
  eventType: string;              // the INTERNAL type
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

export type Projected = Record<string, string | number | boolean | null>;

export interface CatalogueEntry {
  /** The public name a tenant subscribes to. */
  name: string;
  /** The payload version this projection produces. */
  version: number;
  /** The internal outbox types that fire it. */
  internalTypes: readonly string[];
  /** The fields a v1 payload carries (the console prints them on the review step). */
  fields: readonly string[];
  /** The projection — a whitelist. */
  project(e: CatalogueEvent): Projected;
}

/* --------------------------------------------------------------------------------------------------------- */
/* field readers — every value is coerced to a scalar; anything else is dropped (null)                        */
/* --------------------------------------------------------------------------------------------------------- */
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'bigint' ? v.toString() : null);
const minor = (v: unknown): string | null => { const s = str(v); return s !== null && /^-?\d{1,20}$/.test(s) ? s : null; };
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const id = (v: unknown): string | null => { const s = str(v); return s !== null && /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null; };
const code = (v: unknown): string | null => { const s = str(v); return s !== null && /^[a-z][a-z0-9_]{0,59}$/.test(s) ? s : null; };
const iso = (v: unknown): string | null => { const s = str(v); return s !== null && !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}/.test(s) ? s : null; };

/** The logistics hop each internal shipment type stands for (the public `status` field). */
const SHIPMENT_STATUS: Readonly<Record<string, string>> = {
  [ShipmentEventType.Created]: 'created',
  [ShipmentEventType.Assigned]: 'assigned',
  [ShipmentEventType.PickupScheduled]: 'pickup_scheduled',
  [ShipmentEventType.PickedUp]: 'picked_up',
  [ShipmentEventType.InTransit]: 'in_transit',
  [ShipmentEventType.AtHub]: 'at_hub',
  [ShipmentEventType.OutForDelivery]: 'out_for_delivery',
  [ShipmentEventType.Delivered]: 'delivered',
  [ShipmentEventType.Failed]: 'failed',
  [ShipmentEventType.Returned]: 'returned',
  [ShipmentEventType.Cancelled]: 'cancelled',
};

export const WEBHOOK_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([
  {
    name: 'order.created', version: PAYLOAD_VERSION, internalTypes: [OrderEventType.Created],
    fields: ['orderId', 'status', 'totalMinor', 'discountMinor', 'buyerUserId', 'sellerUserId'],
    project: (e) => ({ orderId: id(e.payload.orderId) ?? id(e.aggregateId), status: 'created', totalMinor: minor(e.payload.totalMinor), discountMinor: minor(e.payload.discountMinor), buyerUserId: id(e.payload.buyerUserId), sellerUserId: id(e.payload.sellerUserId) }),
  },
  {
    name: 'order.completed', version: PAYLOAD_VERSION, internalTypes: [OrderEventType.Completed],
    fields: ['orderId', 'status', 'totalMinor', 'deliveryFeeMinor', 'platformFeeMinor', 'currencyCode', 'source', 'buyerUserId', 'sellerUserId'],
    project: (e) => ({ orderId: id(e.aggregateId), status: 'completed', totalMinor: minor(e.payload.totalMinor), deliveryFeeMinor: minor(e.payload.deliveryFeeMinor), platformFeeMinor: minor(e.payload.platformFeeMinor), currencyCode: str(e.payload.currencyCode), source: code(e.payload.source), buyerUserId: id(e.payload.buyerUserId), sellerUserId: id(e.payload.sellerUserId) }),
  },
  {
    name: 'order.cancelled', version: PAYLOAD_VERSION, internalTypes: [OrderEventType.Cancelled],
    fields: ['orderId', 'status', 'cancelledByRole', 'reasonId'],
    // `reason` (system free text) and `by` (a person) are deliberately not carried — the role and the reason CODE are.
    project: (e) => ({ orderId: id(e.aggregateId), status: 'cancelled', cancelledByRole: code(e.payload.role), reasonId: id(e.payload.reasonId) }),
  },
  {
    name: 'order.delivered', version: PAYLOAD_VERSION, internalTypes: [OrderEventType.Delivered],
    fields: ['orderId', 'status', 'buyerUserId', 'sellerUserId'],
    project: (e) => ({ orderId: id(e.aggregateId), status: 'delivered', buyerUserId: id(e.payload.buyerUserId), sellerUserId: id(e.payload.sellerUserId) }),
  },
  {
    name: 'payment.succeeded', version: PAYLOAD_VERSION, internalTypes: [PaymentEventType.Succeeded],
    fields: ['paymentId', 'status', 'amountMinor', 'currencyCode', 'referenceType', 'referenceId', 'method', 'capturedAt'],
    // payer, gateway ids: not carried (the reference names what was paid for; who paid is the order's buyer)
    project: (e) => ({ paymentId: id(e.payload.paymentId) ?? id(e.aggregateId), status: 'succeeded', amountMinor: minor(e.payload.amountMinor), currencyCode: str(e.payload.currencyCode), referenceType: code(e.payload.referenceType), referenceId: id(e.payload.referenceId), method: code(e.payload.method), capturedAt: iso(e.payload.capturedAt) }),
  },
  {
    name: 'payout.completed', version: PAYLOAD_VERSION, internalTypes: [PayoutEventType.Succeeded],
    fields: ['payoutId', 'status', 'amountMinor', 'currencyCode'],
    // `last4` (a bank-account fragment) and the payee are never carried
    project: (e) => ({ payoutId: id(e.payload.payoutId) ?? id(e.aggregateId), status: 'completed', amountMinor: minor(e.payload.amountMinor), currencyCode: str(e.payload.currencyCode) }),
  },
  {
    name: 'shipment.status_changed', version: PAYLOAD_VERSION, internalTypes: Object.keys(SHIPMENT_STATUS),
    fields: ['shipmentId', 'orderId', 'status', 'scheduledPickupAt', 'failureReasonCode', 'attemptNo'],
    // the rider's id, free-text failure reasons and every OTP stay inside the platform
    project: (e) => ({ shipmentId: id(e.payload.shipmentId) ?? id(e.aggregateId), orderId: id(e.payload.orderId), status: SHIPMENT_STATUS[e.eventType] ?? null, scheduledPickupAt: iso(e.payload.scheduledPickupAt), failureReasonCode: code(e.payload.reasonCode), attemptNo: num(e.payload.attemptNo) }),
  },
  {
    name: 'auction.ended', version: PAYLOAD_VERSION, internalTypes: [AuctionEventType.Ended],
    fields: ['auctionId', 'status', 'awaitingApproval', 'decisionDueAt'],
    project: (e) => ({ auctionId: id(e.payload.auctionId) ?? id(e.aggregateId), status: 'ended', awaitingApproval: bool(e.payload.awaitingApproval), decisionDueAt: iso(e.payload.decisionDueAt) }),
  },
  {
    name: 'auction.settled', version: PAYLOAD_VERSION, internalTypes: [AuctionEventType.Won],
    fields: ['auctionId', 'status', 'listingId', 'winningBidId', 'winnerUserId', 'unitPriceMinor', 'quantity', 'unitCode', 'lotValueMinor'],
    project: (e) => ({ auctionId: id(e.payload.auctionId) ?? id(e.aggregateId), status: 'settled', listingId: id(e.payload.listingId), winningBidId: id(e.payload.winningBidId), winnerUserId: id(e.payload.bidderUserId), unitPriceMinor: minor(e.payload.unitPriceMinor ?? e.payload.amountMinor), quantity: num(e.payload.quantity), unitCode: code(e.payload.unitCode), lotValueMinor: minor(e.payload.lotValueMinor) }),
  },
  {
    name: 'offer.accepted', version: PAYLOAD_VERSION, internalTypes: [OfferEventType.Accepted],
    fields: ['offerId', 'status', 'acceptedBy', 'agreedPriceMinor', 'quantity', 'buyerUserId'],
    project: (e) => ({ offerId: id(e.aggregateId), status: 'accepted', acceptedBy: code(e.payload.by), agreedPriceMinor: minor(e.payload.agreedPriceMinor), quantity: num(e.payload.quantity), buyerUserId: id(e.payload.buyerUserId) }),
  },
  {
    name: 'dispute.resolved', version: PAYLOAD_VERSION, internalTypes: [DisputeEventType.Resolved],
    fields: ['disputeId', 'orderId', 'status', 'resolutionType', 'resolutionAmountMinor'],
    project: (e) => ({ disputeId: id(e.payload.disputeId) ?? id(e.aggregateId), orderId: id(e.payload.orderId), status: 'resolved', resolutionType: code(e.payload.resolutionType), resolutionAmountMinor: minor(e.payload.resolutionAmountMinor) }),
  },
  {
    name: 'milk_bill.approved', version: PAYLOAD_VERSION, internalTypes: [DairyEventType.BillApproved],
    fields: ['billId', 'status', 'previousStatus'],
    project: (e) => ({ billId: id(e.payload.billId) ?? id(e.aggregateId), status: code(e.payload.to) ?? 'approved', previousStatus: code(e.payload.from) }),
  },
] as CatalogueEntry[]);

export const WEBHOOK_EVENT_NAMES: readonly string[] = WEBHOOK_CATALOGUE.map((c) => c.name);

/** Every distinct internal type the catalogue listens to — one fanout handler each. */
export const CATALOGUE_INTERNAL_TYPES: readonly string[] = [...new Set(WEBHOOK_CATALOGUE.flatMap((c) => c.internalTypes))];

export function catalogueEntry(name: string): CatalogueEntry | null {
  return WEBHOOK_CATALOGUE.find((c) => c.name === name) ?? null;
}
export function isKnownWebhookEvent(name: string): boolean {
  return WEBHOOK_EVENT_NAMES.includes(name);
}
/** The public names an internal type fires (one internal type may feed two names, e.g. none today, but the shape allows it). */
export function publicNamesFor(internalType: string): string[] {
  return WEBHOOK_CATALOGUE.filter((c) => c.internalTypes.includes(internalType)).map((c) => c.name);
}

/** The delivered body: the envelope + the projection. `id` is stable per (event, public name) so a receiver can dedupe. */
export interface WebhookEnvelope { id: string; type: string; payloadVersion: number; createdAt: string; data: Projected }
export function envelopeFor(name: string, e: CatalogueEvent, createdAtIso: string): WebhookEnvelope {
  const entry = catalogueEntry(name);
  if (!entry) throw new Error(`webhook catalogue: '${name}' is not a public event`);
  if (!entry.internalTypes.includes(e.eventType)) throw new Error(`webhook catalogue: '${e.eventType}' does not fire '${name}'`);
  const data = entry.project(e);
  // the projection's own keys and nothing else — a defensive pass, the whitelist is the rule
  const clean: Projected = {};
  for (const f of entry.fields) clean[f] = data[f] ?? null;
  return { id: `evt_${e.id}_${name.replace(/\./g, '_')}`, type: name, payloadVersion: entry.version, createdAt: createdAtIso, data: clean };
}
