// modules/auctions/domain/auction.entity.ts
// Auction aggregate. Pure domain: money in bigint minor units, status transitions ONLY via the
// state machine (Law 5). Bid acceptance rules, anti-snipe auto-extend, reserve/min-bidders, and
// winner resolution live here. EMD (earnest-money) amounts are computed here; the actual wallet
// HOLD/RELEASE is performed by the service via the wallet boundary. english_open + sealed are
// supported; reverse/dutch are rejected at creation (flagged — needs their own rules).
import { AuctionStatus, assertTransition, isBiddable } from './auction.state';
import { AuctionEventType, DomainEvent } from './auctions.events';
import { BidTooLowError, InvalidAuctionError, AuctionNotBiddableError } from './auctions.errors';
// [QA-FIX 2026-07-28] DEV-26/Q15: this file's own `emdForBid()` inlined the identical
// `(amountMinor * BigInt(bps)) / 10000n` floor-division formula that the batch's own grep was supposed to find
// and consolidate (spec_dev26.md §1 names `auctions/read-models/my-bids.read-model.ts` as the auctions-module
// site fixed, but missed this domain-entity duplicate of the SAME calculation) — now delegates to the one
// canonical helper, closing the gap without changing behavior (identical bigint floor math).
import { applyBpsFloor } from '../../../core/money/rounding';

export type AuctionKind = 'english_open' | 'sealed' | 'reverse' | 'dutch';
const SUPPORTED: AuctionKind[] = ['english_open', 'sealed'];

export interface AuctionProps {
  id: string; tenantId: string; listingId: string; kind: AuctionKind;
  startPriceMinor: bigint; reservePriceMinor: bigint | null; minIncrementMinor: bigint;
  emdMinor: bigint; emdPctBps: number | null;
  startsAt: Date; endsAt: Date; autoExtendSecs: number; extendTriggerSecs: number;
  minBidders: number | null; requiresSellerApproval: boolean;
  status: AuctionStatus; winningBidId: string | null; settledOrderId: string | null; version: number; createdAt: Date;
}

export class Auction {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: AuctionProps) {}

  static create(input: {
    id: string; tenantId: string; listingId: string; kind: AuctionKind;
    startPriceMinor: bigint; reservePriceMinor?: bigint | null; minIncrementMinor?: bigint;
    emdMinor?: bigint; emdPctBps?: number | null; startsAt: Date; endsAt: Date;
    autoExtendSecs?: number; extendTriggerSecs?: number; minBidders?: number | null; requiresSellerApproval?: boolean; now?: Date;
  }): Auction {
    if (!SUPPORTED.includes(input.kind)) throw new InvalidAuctionError(`auction kind '${input.kind}' is not supported yet`);
    if (input.startPriceMinor <= 0n) throw new InvalidAuctionError('start price must be positive');
    if (input.endsAt.getTime() <= input.startsAt.getTime()) throw new InvalidAuctionError('endsAt must be after startsAt');
    if (input.reservePriceMinor != null && input.reservePriceMinor < input.startPriceMinor) throw new InvalidAuctionError('reserve cannot be below start price');
    const minIncrement = input.minIncrementMinor ?? 10000n;
    if (minIncrement <= 0n) throw new InvalidAuctionError('minimum increment must be positive');
    if ((input.emdMinor ?? 0n) < 0n) throw new InvalidAuctionError('EMD cannot be negative');
    const a = new Auction({
      id: input.id, tenantId: input.tenantId, listingId: input.listingId, kind: input.kind,
      startPriceMinor: input.startPriceMinor, reservePriceMinor: input.reservePriceMinor ?? null, minIncrementMinor: minIncrement,
      emdMinor: input.emdMinor ?? 0n, emdPctBps: input.emdPctBps ?? null,
      startsAt: input.startsAt, endsAt: input.endsAt, autoExtendSecs: input.autoExtendSecs ?? 120, extendTriggerSecs: input.extendTriggerSecs ?? 60,
      minBidders: input.minBidders ?? null, requiresSellerApproval: input.requiresSellerApproval ?? false,
      status: 'scheduled', winningBidId: null, settledOrderId: null, version: 1, createdAt: input.now ?? new Date(),
    });
    a.events.push({ type: AuctionEventType.Created, payload: { auctionId: a.props.id, listingId: a.props.listingId } });
    return a;
  }
  static rehydrate(props: AuctionProps): Auction { return new Auction(props); }

  get id() { return this.props.id; }
  get status() { return this.props.status; }
  get version() { return this.props.version; }
  get listingId() { return this.props.listingId; }
  get endsAt() { return this.props.endsAt; }
  toProps(): Readonly<AuctionProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** The minimum acceptable next bid given the current high (null if no bids yet). */
  minNextBidMinor(currentHighMinor: bigint | null): bigint {
    if (this.props.kind === 'sealed' || currentHighMinor === null) return this.props.startPriceMinor;
    return currentHighMinor + this.props.minIncrementMinor;
  }
  /** EMD to hold for a bid of `amountMinor` (flat emdMinor, else % of the bid). */
  emdForBid(amountMinor: bigint): bigint {
    if (this.props.emdMinor > 0n) return this.props.emdMinor;
    if (this.props.emdPctBps) return applyBpsFloor(amountMinor, this.props.emdPctBps);
    return 0n;
  }

  /** Seller edits a SCHEDULED auction's terms (before it opens / any bids). Only safe knobs; identity,
   *  status and the winner are never touched here. Invariants re-validated (reserve ≥ start, ends>starts). */
  editSchedule(input: { reservePriceMinor?: bigint | null; minIncrementMinor?: bigint; startsAt?: Date; endsAt?: Date }): void {
    if (this.props.status !== 'scheduled') throw new InvalidAuctionError('only a scheduled auction can be edited');
    const startsAt = input.startsAt ?? this.props.startsAt;
    const endsAt = input.endsAt ?? this.props.endsAt;
    if (endsAt.getTime() <= startsAt.getTime()) throw new InvalidAuctionError('endsAt must be after startsAt');
    if (input.reservePriceMinor != null && input.reservePriceMinor < this.props.startPriceMinor) throw new InvalidAuctionError('reserve cannot be below the start price');
    if (input.minIncrementMinor != null && input.minIncrementMinor <= 0n) throw new InvalidAuctionError('min increment must be positive');
    if (input.reservePriceMinor !== undefined) this.props.reservePriceMinor = input.reservePriceMinor;
    if (input.minIncrementMinor !== undefined) this.props.minIncrementMinor = input.minIncrementMinor;
    this.props.startsAt = startsAt;
    this.props.endsAt = endsAt;
    this.events.push({ type: AuctionEventType.Updated, payload: { auctionId: this.props.id } });
  }

  open(): void { this.to('live', AuctionEventType.Opened); }

  /** Validate a bid against the rules (the service enforces seller/qualification/concurrency). */
  assertBidAcceptable(amountMinor: bigint, currentHighMinor: bigint | null): void {
    if (!isBiddable(this.props.status)) throw new AuctionNotBiddableError(this.props.status);
    const min = this.minNextBidMinor(currentHighMinor);
    if (amountMinor < min) throw new BidTooLowError(min);
  }
  /** Anti-snipe: a bid in the last `extendTriggerSecs` pushes endsAt out by `autoExtendSecs`. */
  maybeExtend(now: Date): boolean {
    if (!isBiddable(this.props.status)) return false;
    if (this.props.endsAt.getTime() - now.getTime() > this.props.extendTriggerSecs * 1000) return false;
    this.props.endsAt = new Date(now.getTime() + this.props.autoExtendSecs * 1000);
    if (this.props.status !== 'extended') this.to('extended', AuctionEventType.Extended, { endsAt: this.props.endsAt.toISOString() });
    else this.events.push({ type: AuctionEventType.Extended, payload: { auctionId: this.props.id, endsAt: this.props.endsAt.toISOString() } });
    return true;
  }

  /** Time's up → ended (no more bids). */
  closeBidding(): void { this.to('ended', AuctionEventType.Ended); }

  /** Decide the outcome from the highest bid + bidder count. */
  resolve(highest: { amountMinor: bigint; bidId: string } | null, bidderCount: number): void {
    const reserveMet = highest != null && (this.props.reservePriceMinor == null || highest.amountMinor >= this.props.reservePriceMinor);
    const enoughBidders = this.props.minBidders == null || bidderCount >= this.props.minBidders;
    if (!highest || !reserveMet || !enoughBidders) {
      this.to('failed_reserve', AuctionEventType.FailedReserve, { bidderCount });
      return;
    }
    this.props.winningBidId = highest.bidId;
    if (this.props.requiresSellerApproval) { assertTransition(this.props.status, 'awaiting_approval'); this.props.status = 'awaiting_approval'; this.events.push({ type: AuctionEventType.Ended, payload: { auctionId: this.props.id, awaitingApproval: true } }); return; }
    this.markSettled(highest);
  }
  /** Seller approves an awaiting_approval auction. */
  approve(highest: { amountMinor: bigint; bidId: string }): void { this.markSettled(highest); }
  cancel(): void { this.to('cancelled', AuctionEventType.Cancelled); }

  private markSettled(highest: { amountMinor: bigint; bidId: string }): void {
    assertTransition(this.props.status, 'settled');
    this.props.status = 'settled';
    this.props.winningBidId = highest.bidId;
    this.events.push({ type: AuctionEventType.Won, payload: { auctionId: this.props.id, listingId: this.props.listingId, winningBidId: highest.bidId, amountMinor: highest.amountMinor.toString() } });
  }

  private to(status: AuctionStatus, evt: string, payload: Record<string, unknown> = {}): void {
    assertTransition(this.props.status, status);
    this.props.status = status;
    this.events.push({ type: evt, payload: { auctionId: this.props.id, ...payload } });
  }
}
