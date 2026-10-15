// modules/offers/domain/offers.errors.ts · typed errors with stable codes.
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class OfferNotFoundError extends NotFoundError { constructor(id: string) { super('Offer not found'); (this as any).details = { id }; } }
/** Acting on an offer that is no longer in active negotiation (rejected/expired/accepted/converted). */
export class OfferNotNegotiableError extends AppError { constructor(status: string) { super('OFFER_NOT_NEGOTIABLE', `Offer is not in active negotiation (status: ${status})`, 409, { status }); } }
/** A party tried to act when it is the other party's turn to respond. */
export class NotYourTurnError extends AppError { constructor(party: string) { super('OFFER_NOT_YOUR_TURN', `It is not the ${party}'s turn to act`, 409, { party }); } }
/** The actor is neither the buyer nor the listing's seller (nor a moderator). */
export class OfferForbiddenError extends AppError { constructor(message = 'Not a party to this offer') { super('OFFER_FORBIDDEN', message, 403); } }
/** The offer's expires_at has passed. */
export class OfferExpiredError extends AppError { constructor() { super('OFFER_EXPIRED', 'Offer has expired', 409); } }
/** Bad price/quantity/listing at make/counter time. */
export class InvalidOfferError extends DomainError { constructor(message: string) { super('OFFER_INVALID', message, 400); } }
/** Buyer cannot make an offer on their own listing (no self-deal). */
export class SellerCannotOfferError extends AppError { constructor() { super('SELLER_CANNOT_OFFER', 'The seller cannot make an offer on their own listing', 403); } }

// ---- PC-56 STORE-3b — the named refusals of the clock (founder D1), the accept guards (D2) and the decline reason (D3) -------------------
/** MAKE: the buyer's own expiresAt is later than one round (`offers.round_ttl_hours`) from now. `max` = the latest instant allowed. */
export class OfferExpiryTooLateError extends AppError { constructor(max: string) { super('OFFER_EXPIRY_TOO_LATE', 'expiresAt is later than one round of the offer clock allows', 422, { max }); } }
/** COUNTER: the new round would end after the negotiation's ceiling (`offers.max_life_hours` from the first offer). */
export class OfferMaxLifeError extends AppError { constructor(endsAt: string) { super('OFFER_MAX_LIFE', 'The negotiation ends before another round could run; it lapses by its clock', 409, { endsAt }); } }
/** ACCEPT: the organisation now has less available than the offer's quantity (`available` — the LOCKED remainder, 3-place decimal text). */
export class OfferStockShortError extends AppError { constructor(available: string) { super('OFFER_STOCK_SHORT', 'The listing no longer has the offered quantity available', 409, { available }); } }
/** ACCEPT: the listing is no longer on sale (paused, sold out, expired, withdrawn, in an auction). */
export class OfferListingUnavailableError extends AppError { constructor(status: string) { super('OFFER_LISTING_UNAVAILABLE', 'The listing is not on sale any more', 409, { status }); } }
/** ACCEPT: the organisation cannot take this sale right now (the seller is under a suspension — never said to the buyer in those words). */
export class OfferSellerUnavailableError extends AppError { constructor() { super('OFFER_SELLER_UNAVAILABLE', 'The organisation cannot take this sale right now', 409); } }
/** DECLINE: the given reason code is not an active value of the `offer_decline_reason` vocabulary (0211). */
export class OfferDeclineReasonUnknownError extends AppError { constructor(reasonCode: string) { super('OFFER_DECLINE_REASON_UNKNOWN', 'Unknown decline reason', 422, { reasonCode }); } }
