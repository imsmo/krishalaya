// modules/offers/domain/offer-read.ts · PC-56 STORE-3b · B4 / B6 / B7 (survey B14 / B15 / B18) — WHAT AN OFFER READ SAYS, FROM ONE PLACE. PURE.
//
//   • whose turn it is and which acts the CALLER may take (`yourTurn`, `allowedActs`) — the entity's own parity rule (odd round: the buyer
//     acted last → the seller answers; even: the buyer answers), live only while open / countered and before the round's deadline;
//   • the thread (`rounds`) — the 0211 history; an offer made before 0211 has none, so round 1 is SYNTHESISED from the offer row (`offer`, the
//     buyer, the offered price, its created_at) — said in 0211's header;
//   • the server's money: `offerValueMinor` = quantity × the price on the table, floored to the minor unit by THE SAME helper an order line uses
//     (orders/domain/orders.events.ts `lineTotalMinor` — bigint over thousandths), so the value the buyer reads is the subtotal the order gets;
//   • the accept's conversion state (`creating` until the relay links the order, then `converted`);
//   • the buyer's bounded status counts (Law 11 — the 3a ORDER_GROUP_COUNT_CAP pattern).
import { lineTotalMinor } from '../../orders/domain/orders.events';
import { isNegotiable, OfferStatus, OFFER_STATUSES } from './listing-offer.state';
import { OfferParty } from './offers.events';

export const OFFER_ACTS = ['accept', 'counter', 'decline'] as const;
export type OfferAct = (typeof OFFER_ACTS)[number];
export type RoundParty = OfferParty | 'system';
export const ROUND_ACTS = ['offer', 'counter', 'accept', 'decline', 'expire'] as const;
export type RoundAct = (typeof ROUND_ACTS)[number];
export interface OfferRoundView { round: number; party: RoundParty; act: RoundAct; priceMinor: string | null; at: string }

/** Founder D3 (0211): the decline reasons, platform-wide, usable by either side; `other` carries no note. */
export const OFFER_DECLINE_REASONS = ['price', 'lot_committed', 'quantity', 'timing', 'changed_mind', 'other'] as const;

/** Whose turn it is (null when the negotiation is over). The entity's parity rule — `ListingOffer.isSellersTurn / isBuyersTurn`. */
export function turnOf(status: OfferStatus, round: number): OfferParty | null {
  if (!isNegotiable(status)) return null;
  return round % 2 === 1 ? 'seller' : 'buyer';
}

/** The acts the VIEWER may take now: all three on their own turn while the round is open; none otherwise (founder D4: no "lapse" act). */
export function allowedActsFor(viewer: OfferParty, o: { status: OfferStatus; round: number; expiresAt: Date }, now: Date): OfferAct[] {
  if (turnOf(o.status, o.round) !== viewer) return [];
  if (now.getTime() >= o.expiresAt.getTime()) return [];
  return [...OFFER_ACTS];
}

/** The accept's conversion state: the relay creates the order within seconds (`creating`), then links it (`converted`). */
export function conversionOf(status: OfferStatus): 'creating' | 'converted' | null {
  return status === 'accepted' ? 'creating' : status === 'converted' ? 'converted' : null;
}

/** quantity × the per-unit price on the table, floored to the minor unit — the order line's own formula (never a client's arithmetic). */
export function offerValueMinor(quantity: string, priceMinor: bigint): string {
  return lineTotalMinor(priceMinor, quantity).toString();
}

/** The thread: the stored rounds in order; none stored (an offer made before 0211) → round 1 synthesised from the offer row. */
export function roundsOf(stored: readonly OfferRoundView[], offer: { offeredPriceMinor: bigint; createdAt: Date; round: number }): OfferRoundView[] {
  if (stored.length > 0) return [...stored];
  return [{ round: 1, party: 'buyer', act: 'offer', priceMinor: offer.offeredPriceMinor.toString(), at: offer.createdAt.toISOString() }];
}

/** The buyer's status counts (B18): every status + all, each bounded at the cap (`capped` = more exist — "cap+", never a guessed number). */
export const OFFER_COUNT_CAP = 100;
export const OFFER_COUNT_KEYS = ['all', ...OFFER_STATUSES] as const;
export type OfferCountKey = (typeof OFFER_COUNT_KEYS)[number];
export type OfferCounts = Record<OfferCountKey, { count: number; capped: boolean }>;
