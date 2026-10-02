// modules/auctions/domain/auctions.errors.ts · typed errors with stable codes.
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class AuctionNotFoundError extends NotFoundError { constructor(id: string) { super('Auction not found'); (this as any).details = { id }; } }
export class AuctionNotBiddableError extends AppError { constructor(status: string) { super('AUCTION_NOT_BIDDABLE', `Auction is not accepting bids (status: ${status})`, 409, { status }); } }
/** Bid below start price or below current high + minimum increment. */
export class BidTooLowError extends DomainError { constructor(minMinor: bigint) { super('BID_TOO_LOW', `Bid must be at least ${minMinor}`, 409, { minMinor: minMinor.toString() }); } }
/** A bidder cannot outbid themselves (already the high bidder) / self-deal. */
export class AlreadyHighBidderError extends AppError { constructor() { super('ALREADY_HIGH_BIDDER', 'You are already the highest bidder', 409); } }
/** The listing's seller cannot bid on their own auction. */
export class SellerCannotBidError extends AppError { constructor() { super('SELLER_CANNOT_BID', 'The seller cannot bid on their own auction', 403); } }
export class BidderNotQualifiedError extends AppError { constructor(reason: string) { super('BIDDER_NOT_QUALIFIED', `Not qualified to bid: ${reason}`, 403, { reason }); } }
export class AuctionConcurrencyError extends AppError { constructor(id: string) { super('AUCTION_CONCURRENCY', 'Auction changed concurrently; retry', 409, { id }); } }
export class AuctionForbiddenError extends AppError { constructor(message = 'Not allowed on this auction') { super('AUCTION_FORBIDDEN', message, 403); } }
export class InvalidAuctionError extends DomainError { constructor(message: string) { super('AUCTION_INVALID', message, 400); } }
// ---- PC-56 TENANT-11a ----
/** F-15: a bid at or after `ends_at` is refused — it can no longer revive a closed auction. */
export class AuctionEndedError extends AppError { constructor() { super('AUCTION_ENDED', 'This auction has ended — bids are no longer accepted', 409); } }
/** A11: tenant_admin paused entry — a user with no prior bid in this auction may not join; existing bidders continue. */
export class AuctionEntryPausedError extends AppError { constructor() { super('AUCTION_ENTRY_PAUSED', 'New bidders cannot join this auction right now — entry is paused', 409); } }
/** A reason is mandatory on a cancel / decline / pause (recorded verbatim on the audit row, sent to bidders on a cancel). */
export class AuctionReasonRequiredError extends AppError { constructor() { super('REASON_REQUIRED', 'A reason (3–300 characters) is required for this act', 400); } }
/** A8: staff acted for a seller without the seller's recorded consent for THIS act. */
export class AuctionConsentRequiredError extends AppError { constructor(act: string) { super('AUCTION_CONSENT_REQUIRED', `The seller's recorded consent is required to ${act} on their behalf`, 403, { act }); } }
/** A8: a live auction is tenant_admin's to stop (auction.cancel_live); a seller may cancel only before it opens. */
export class AuctionCancelLiveForbiddenError extends AppError { constructor() { super('AUCTION_CANCEL_LIVE_FORBIDDEN', 'Only a tenant admin may cancel a live auction, with a reason', 403); } }
/** The act is not legal in the auction's current state (named, not a generic 409). */
export class AuctionActNotAllowedError extends AppError { constructor(act: string, status: string) { super('AUCTION_ACT_NOT_ALLOWED', `Cannot ${act} an auction that is ${status}`, 409, { act, status }); } }
/** A6: the listing is not published (or not the seller's), so it cannot be reserved for an auction. */
export class AuctionListingUnavailableError extends AppError { constructor(reason: string) { super('AUCTION_LISTING_UNAVAILABLE', `The listing cannot be auctioned: ${reason}`, 409, { reason }); } }
/** A9: the bid stream needs auction.bid or auction.read. */
export class AuctionReadForbiddenError extends AppError { constructor() { super('AUCTION_READ_FORBIDDEN', 'Reading the bid stream needs auction.read or auction.bid', 403); } }
