// modules/listings/domain/listing.entity.ts
// Pure domain aggregate root. No framework, no SQL, no I/O. All business
// invariants live here; 95%+ unit coverage. Money is bigint minor units (Law 2).
import { Money } from '../../../shared/utils/money';
import { ListingStatus, assertTransition, isPurchasable } from './listing.state';
import {
  InsufficientStockError, InvalidPriceError, ListingNotEditableError, InvalidRepostDurationError, InvalidExtendDurationError,
  ListingSelfReviewError, ListingRejectReasonError,
} from './listing.errors';

export interface ListingProps {
  id: string;
  tenantId: string;
  sellerUserId: string;
  productId: string;
  categoryId: string;
  title: string;
  description?: string | null;
  quantityTotal: number;
  quantityAvailable: number;
  minOrderQty: number;
  unitCode: string;
  priceMinor: bigint;
  currencyCode: string;
  organicClaim: 'none' | 'natural' | 'certified';
  status: ListingStatus;
  saleType: 'direct' | 'auction' | 'both' | 'preorder' | 'service' | 'group_lot';
  pincode?: string | null;
  regionId?: string | null;
  lat?: number | null;
  lng?: number | null;
  visibility: 'tenant' | 'cross_tenant' | 'public';
  aiExtracted: boolean;
  publishAt?: Date | null;
  publishedAt?: Date | null;
  expiresAt?: Date | null;
  version: number;
  // PC-56 TENANT-2a · the QC clock (0138). Read-only from persistence; written only by the QC verbs below.
  qcSubmittedAt?: Date | null;
  qcReviewedBy?: string | null;
  qcReviewedAt?: Date | null;
  rejectReason?: string | null;   // 0005's column, written for the first time by rejectQc()
  // PC-56 TENANT-2b: recorded at create when a STAFF hand typed the draft (on-behalf) — the identity
  // QC_OWN_DRAFT turns on. NULL = the seller listed for themselves.
  createdBy?: string | null;
  harvestDate?: string | null;    // 0005's column (date), carried since TENANT-2b — W124/W125 show it
}

/** Domain events raised by the aggregate, drained by the service into the outbox. */
export type ListingDomainEvent =
  | { type: 'listing.created'; listingId: string }
  | { type: 'listing.published'; listingId: string; priceMinor: string }
  | { type: 'listing.price_changed'; listingId: string; oldPriceMinor: string; newPriceMinor: string }
  | { type: 'listing.stock_changed'; listingId: string; available: number }
  | { type: 'listing.sold_out'; listingId: string }
  | { type: 'listing.status_changed'; listingId: string; from: ListingStatus; to: ListingStatus }
  | { type: 'listing.extended'; listingId: string; expiresAt: string; days: number }
  // PC-56 TENANT-2a · the QC verbs' own events (Law 4): submission starts the clock, decisions carry the outcome
  // the member is notified with — a rejection always names its teaching reason.
  | { type: 'listing.qc_submitted'; listingId: string; sellerUserId: string }
  | { type: 'listing.redrafted'; listingId: string; sellerUserId: string }
  | { type: 'listing.archived'; listingId: string; sellerUserId: string; reason: string }
  | { type: 'listing.qc_approved'; listingId: string; sellerUserId: string; reviewedBy: string }
  | { type: 'listing.qc_rejected'; listingId: string; sellerUserId: string; reviewedBy: string; reason: string };

const EDITABLE_STATUSES: ReadonlySet<ListingStatus> = new Set(['draft', 'pending_approval', 'published', 'paused']);

export class Listing {
  private readonly events: ListingDomainEvent[] = [];

  private constructor(private props: ListingProps) {}

  /** Factory enforces creation invariants. */
  static create(input: Omit<ListingProps, 'status' | 'version' | 'quantityAvailable'> & { quantityAvailable?: number }): Listing {
    if (input.priceMinor <= 0n) throw new InvalidPriceError('Price must be greater than zero');
    if (input.quantityTotal <= 0) throw new InvalidPriceError('Quantity must be greater than zero');
    if (input.minOrderQty < 0 || input.minOrderQty > input.quantityTotal)
      throw new InvalidPriceError('Minimum order quantity is out of range');
    const l = new Listing({
      ...input,
      quantityAvailable: input.quantityAvailable ?? input.quantityTotal,
      status: 'draft',
      version: 1,
    });
    l.events.push({ type: 'listing.created', listingId: l.props.id });
    return l;
  }

  /** Rehydrate from persistence (no invariants re-run; trusted source). */
  static rehydrate(props: ListingProps): Listing { return new Listing(props); }

  // ---- getters (immutable view) ----
  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get sellerUserId() { return this.props.sellerUserId; }
  get status() { return this.props.status; }
  get version() { return this.props.version; }
  get price(): Money { return Money.of(this.props.priceMinor, this.props.currencyCode); }
  get quantityAvailable() { return this.props.quantityAvailable; }
  get isPurchasable() { return isPurchasable(this.props.status); }
  toProps(): Readonly<ListingProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): ListingDomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  // ---- behaviour ----
  private transition(to: ListingStatus): void {
    const from = this.props.status;
    assertTransition(from, to);
    this.props.status = to;
    this.events.push({ type: 'listing.status_changed', listingId: this.props.id, from, to });
  }

  submitForApproval(): void { this.transition('pending_approval'); }

  // ---- PC-56 TENANT-2a · the QC verbs (W126/W127). Until this wave, `pending_approval` was a vocabulary with no
  // verbs: submitForApproval() had zero callers, reject() none, reject_reason was never written, and the queue's
  // every number would have been invented. The reviewer rules live HERE (0138's CHECK is the backstop, not the law).

  /** SUBMIT FOR QC — starts the waiting clock W126 measures. A fresh submission clears the previous rejection's
   *  teaching reason: the reviewer must judge THIS submission, not be anchored by the last one's verdict. */
  submitForQc(now: Date = new Date()): void {
    this.transition('pending_approval');
    this.props.qcSubmittedAt = now;
    this.props.rejectReason = null;
    this.events.push({ type: 'listing.qc_submitted', listingId: this.props.id, sellerUserId: this.props.sellerUserId });
  }

  /** REDRAFT (PC-56 TENANT-2b) — the way back: a REJECTED listing returns to draft for its one-tap fix-and-relist
   *  (W127's own audit note), and a listing submitted by mistake can be WITHDRAWN from the queue. The machine
   *  validates both sources (rejected → draft, pending_approval → draft). Withdrawing stops the waiting clock —
   *  a listing not in the queue must not age in it. */
  redraft(): void {
    this.transition('draft');
    this.props.qcSubmittedAt = null;
    this.events.push({ type: 'listing.redrafted', listingId: this.props.id, sellerUserId: this.props.sellerUserId });
  }

  /** No self-review, in both identities: the SELLER may not clear their own lot, and the STAFF CREATOR (when one
   *  was recorded) may not review the draft they typed — W127's own restricted state. */
  private assertReviewer(reviewerId: string): void {
    if (reviewerId === this.props.sellerUserId) {
      throw new ListingSelfReviewError('QC_OWN_LISTING', 'the seller cannot review their own listing');
    }
    if (this.props.createdBy && reviewerId === this.props.createdBy) {
      throw new ListingSelfReviewError('QC_OWN_DRAFT', 'you created this draft — a different staff member must review it');
    }
  }

  /** APPROVE — publishes immediately (pending_approval → published) and records who decided, when. */
  approveQc(reviewerId: string, now: Date = new Date()): void {
    this.assertReviewer(reviewerId);
    this.transition('published');
    this.props.publishedAt = now;
    this.props.qcReviewedBy = reviewerId;
    this.props.qcReviewedAt = now;
    this.events.push({ type: 'listing.published', listingId: this.props.id, priceMinor: this.props.priceMinor.toString() });
    this.events.push({ type: 'listing.qc_approved', listingId: this.props.id, sellerUserId: this.props.sellerUserId, reviewedBy: reviewerId });
  }

  /** REJECT — teaches, never scolds: the reason is mandatory, comes from the closed lookup vocabulary (validated
   *  by the service against lookup_values — Law 6), and lands on the listing AND in the member's notification. */
  rejectQc(reviewerId: string, reasonCode: string, now: Date = new Date()): void {
    this.assertReviewer(reviewerId);
    if (!reasonCode || reasonCode.trim().length === 0) {
      throw new ListingRejectReasonError('a rejection without a reason teaches nothing — the reason is mandatory');
    }
    this.transition('rejected');
    this.props.rejectReason = reasonCode.trim();
    this.props.qcReviewedBy = reviewerId;
    this.props.qcReviewedAt = now;
    this.events.push({ type: 'listing.qc_rejected', listingId: this.props.id, sellerUserId: this.props.sellerUserId, reviewedBy: reviewerId, reason: reasonCode.trim() });
  }

  publish(now: Date = new Date()): void {
    this.transition('published');
    this.props.publishedAt = now;
    this.events.push({ type: 'listing.published', listingId: this.props.id, priceMinor: this.props.priceMinor.toString() });
  }

  pause(): void { this.transition('paused'); }
  reject(): void { this.transition('rejected'); }
  hide(): void { this.transition('hidden'); }
  archive(): void { this.transition('archived'); }
  expire(): void { this.transition('expired'); }

  /** REPOST — bring an expired (or sold-out / hidden / paused) listing back to 'published' for a FRESH window,
   *  keeping its photos/description/attributes (it's the same aggregate). Optionally updates the price in the same
   *  op. Sets a new expiresAt = now + durationDays so the expire-job doesn't immediately re-expire it (the bug a
   *  bare publish() would cause — publish() leaves the stale past expiry). The state machine validates the
   *  source status (expired/sold_out/hidden/paused → published); anything else throws IllegalListingTransition. */
  repost(durationDays: number, now: Date = new Date(), newPriceMinor?: bigint): void {
    if (!Number.isInteger(durationDays) || durationDays <= 0 || durationDays > 60)
      throw new InvalidRepostDurationError(durationDays);
    if (newPriceMinor !== undefined) {
      if (newPriceMinor <= 0n) throw new InvalidPriceError('Price must be greater than zero');
      if (newPriceMinor !== this.props.priceMinor) {
        const old = this.props.priceMinor;
        this.props.priceMinor = newPriceMinor;
        this.events.push({ type: 'listing.price_changed', listingId: this.props.id, oldPriceMinor: old.toString(), newPriceMinor: newPriceMinor.toString() });
      }
    }
    this.transition('published'); // validates the source status + emits status_changed
    this.props.publishedAt = now;
    this.props.expiresAt = new Date(now.getTime() + durationDays * 86_400_000);
    this.events.push({ type: 'listing.published', listingId: this.props.id, priceMinor: this.props.priceMinor.toString() });
  }

  /** EXTEND — push an ACTIVE listing's expiry out by `days`, WITHOUT resetting quantity/stats/views (screen 112's
   *  EXTEND cta; KV-BL-031). Distinct from repost(): repost relaunches a lapsed/sold-out listing with a fresh
   *  window (new publishedAt, state transition); extend only ever touches expiresAt on an already-'published'
   *  listing — no transition, no other field moves, so views/analytics/quantity are provably untouched. Extends
   *  from the CURRENT expiresAt when it's still in the future (adds to the remaining window); from `now` when
   *  expiresAt is null or already in the past (a published listing may never have had an expiry set). */
  extend(days: number, now: Date = new Date()): void {
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new InvalidExtendDurationError(days);
    if (this.props.status !== 'published') throw new ListingNotEditableError(this.props.id, this.props.status);
    const base = this.props.expiresAt && this.props.expiresAt > now ? this.props.expiresAt : now;
    this.props.expiresAt = new Date(base.getTime() + days * 86_400_000);
    this.events.push({ type: 'listing.extended', listingId: this.props.id, expiresAt: this.props.expiresAt.toISOString(), days });
  }

  changePrice(newPriceMinor: bigint): void {
    if (!EDITABLE_STATUSES.has(this.props.status))
      throw new ListingNotEditableError(this.props.id, this.props.status);
    if (newPriceMinor <= 0n) throw new InvalidPriceError('Price must be greater than zero');
    if (newPriceMinor === this.props.priceMinor) return; // no-op, no event
    const old = this.props.priceMinor;
    this.props.priceMinor = newPriceMinor;
    this.events.push({
      type: 'listing.price_changed', listingId: this.props.id,
      oldPriceMinor: old.toString(), newPriceMinor: newPriceMinor.toString(),
    });
  }

  /** Reserve stock when an order/auction wins. Auto-sold-out at zero. */
  reduceStock(qty: number): void {
    if (qty <= 0) throw new InvalidPriceError('Quantity must be positive');
    if (qty > this.props.quantityAvailable)
      throw new InsufficientStockError(qty, this.props.quantityAvailable);
    this.props.quantityAvailable -= qty;
    this.events.push({ type: 'listing.stock_changed', listingId: this.props.id, available: this.props.quantityAvailable });
    if (this.props.quantityAvailable === 0) {
      this.props.status = 'sold_out';
      this.events.push({ type: 'listing.sold_out', listingId: this.props.id });
    }
  }

  /** Return stock on cancellation/refund; re-publishes a sold-out listing. */
  restock(qty: number): void {
    if (qty <= 0) throw new InvalidPriceError('Quantity must be positive');
    this.props.quantityAvailable = Math.min(this.props.quantityTotal, this.props.quantityAvailable + qty);
    if (this.props.status === 'sold_out' && this.props.quantityAvailable > 0) {
      this.props.status = 'published';
      this.events.push({ type: 'listing.status_changed', listingId: this.props.id, from: 'sold_out', to: 'published' });
    }
    this.events.push({ type: 'listing.stock_changed', listingId: this.props.id, available: this.props.quantityAvailable });
  }
}
