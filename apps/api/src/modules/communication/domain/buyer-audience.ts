// modules/communication/domain/buyer-audience.ts · PC-56 STORE-4c · B4 (survey B14, E8) — WHICH NOTICES A BUYER CAN EVER RECEIVE. PURE.
//
// The preference matrix (`GET notifications/matrix`) lists every catalogued event — dairy bills, labour rosters, SaaS invoices — so a buyer's
// preferences page showed switches for notices that can never reach them (F-11). `?audience=buyer` filters the matrix to THIS list. It is
// decided from the bridge (`events/notification-event-map.ts`) and the catalogue, and a parity spec pins it against the map
// (`__tests__/store4c-buyer-audience.spec.ts`): every map row whose recipient key names the BUYER must be here, and every entry here except
// the broadcast must be a mapped event — so a new buyer notice cannot be added to the map without appearing on the buyer's page.
//
// Two kinds of entry:
//   • KEYED — the map row's recipient key IS the buyer: `buyerUserId` (orders, payments, disputes, offers, shipments, requirements),
//     `payerUserId` (the payment capture — STORE-4c B2), `previousBidderUserId` (outbid), `bidderUserId` (won);
//   • LISTED — the map row carries `recipientUserIds` and a buyer is one of the people the emitter resolves (named per row below).
// Not here, by name: `group_lot.*` (the pledgers are members who sell), `labour.*`, `dairy.*`, `saas.*`, `kyc.*` (the document KYC is the
// member's flow; a buyer's business-KYC review sends no notice), `weather.*`, `logistics.slot_proposed` / cold-chain breach and silence
// (operators and drivers), `insights.report_ready`, `ops.*`, `payout.credited`, `member.invited`, `resolution.*`, `tenant.setting_*`,
// `tenant.commission_rule_effective`, `tenant.brand_published`, `tenant.setup_call_requested`, `ambassador.message`, `quote.accepted` (the
// seller), `education.live_reminder`, `webhooks.endpoint_paused`.
/** The organisation's announcement event (repositories/broadcast.repository.ts `BROADCAST_EVENT` — a domain file never imports a
 *  repository; the parity spec pins the two equal). */
export const BROADCAST_EVENT_CODE = 'tenant.broadcast';

/** The recipient keys that name the buyer on a map row. */
export const BUYER_RECIPIENT_KEYS = Object.freeze(['buyerUserId', 'payerUserId', 'previousBidderUserId', 'bidderUserId'] as const);

/** Map rows that carry `recipientUserIds` where the emitter resolves a buyer among the recipients — each with who. */
export const BUYER_LISTED_EVENTS: Readonly<Record<string, string>> = Object.freeze({
  'chat.message_posted': 'the other participants of a conversation — a buyer in an order or offer thread',
  'auction.ended': 'the watchers of an auction (a buyer who followed it)',
  'auction.cancelled': 'every bidder (buyers) and the seller',
  'auction.failed_reserve': 'every bidder (buyers) and the seller',
  'auction.defaulted': 'every bidder (buyers) and the seller',
  'auction.lapsed': 'every bidder (buyers) and the seller',
  'requirement.group_quoted': 'the buyer whose requirement received a pooled quote',
  'review.prompt': 'the buyer of a completed order',
  'logistics.cold_chain_buyer_offer': 'the buyer of a shipment that left its temperature range',
});

/** Map rows keyed on a person that is any user — the buyer included (the person's own account / own request). */
export const BUYER_SELF_EVENTS: Readonly<Record<string, string>> = Object.freeze({
  'exports.export_ready': 'the requester of an export — a buyer\'s own DPDP export (STORE-4a)',
  'impersonation.session_started': 'the person whose account a platform operator opened',
  'impersonation.session_ended': 'the person whose account a platform operator opened',
});

/** Every event a buyer's matrix lists (`GET notifications/matrix?audience=buyer`). */
export const BUYER_AUDIENCE_EVENTS: ReadonlySet<string> = new Set<string>([
  // KEYED
  'order.created', 'order.confirmed', 'order.delivered', 'order.completed', 'offer.accepted', 'shipment.delivered', 'payment.success',
  'dispute.opened', 'dispute.resolved', 'dispute.refunded', 'requirement.matched', 'requirement.reminder', 'bid.outbid', 'bid.won',
  // LISTED + SELF
  ...Object.keys(BUYER_LISTED_EVENTS), ...Object.keys(BUYER_SELF_EVENTS),
  // the organisation's announcements (promotional — opt-in and consent-bound, founder D2)
  BROADCAST_EVENT_CODE,
]);

export type MatrixAudience = 'buyer';
export const MATRIX_AUDIENCES = Object.freeze(['buyer'] as const);

/** Is this catalogue event on the audience's page? No audience → every event (web-tenant's W433 is unfiltered). */
export function inAudience(code: string, audience: MatrixAudience | undefined): boolean {
  return audience === undefined ? true : BUYER_AUDIENCE_EVENTS.has(code);
}
