// modules/auctions/domain/auction.entity.ts
// Auction aggregate. Pure domain: money in bigint minor units, status transitions ONLY via the
// state machine (Law 5). Bid acceptance rules, anti-snipe auto-extend, reserve/min-bidders, and
// winner resolution live here. EMD (earnest-money) amounts are computed here; the actual wallet
// HOLD/RELEASE/APPLY/FORFEIT is performed by the service via the wallet boundary. english_open + sealed are
// supported; reverse/dutch are rejected at creation (flagged — needs their own rules).
//
// PC-56 TENANT-11a:
//   • F-12 (founder: PER UNIT) — the auction carries its lot (`quantity` + `unitCode`, copied from the listing at create);
//     every price on it (start, reserve, increment, every bid, the hammer) is PER UNIT; the lot value is quantity × price
//     (domain/lot.ts). The EMD stays per lot.
//   • F-15 — a bid at or after `endsAt` is refused (AUCTION_ENDED), and anti-snipe only extends INSIDE the live window: a
//     bid can no longer revive an auction whose time is up.
//   • F-13 — closing into `awaiting_approval` starts the seller-decision clock (`decisionDueAt = endedAt + window`, window
//     1–72 h, default 24); `lapse()` ends it with no sale.
//   • F-16 — `attachOrder()` records the order the settlement created, in the same transaction (`settledOrderId`).
//   • F-2 — `markDefaulted()` (settled → defaulted) when the winner does not pay the balance.
//   • A11 — `pauseEntry()` / `resumeEntry()`.
import { AuctionStatus, assertTransition, isBiddable } from './auction.state';
import { AuctionEventType, DomainEvent } from './auctions.events';
import { BidTooLowError, InvalidAuctionError, AuctionNotBiddableError, AuctionEndedError, AuctionActNotAllowedError } from './auctions.errors';
import { DEFAULT_DECISION_HOURS, MAX_DECISION_HOURS, emdForLot, lotValueMinor, qtyMilli, milliToText } from './lot';

export type AuctionKind = 'english_open' | 'sealed' | 'reverse' | 'dutch';
const SUPPORTED: AuctionKind[] = ['english_open', 'sealed'];

export interface AuctionProps {
  id: string; tenantId: string; listingId: string; kind: AuctionKind;
  /** The lot: quantity as 3-place text ("200.000") in `unitCode`. Every price below is PER UNIT. */
  quantity: string; unitCode: string; auctionNo: string | null;
  startPriceMinor: bigint; reservePriceMinor: bigint | null; minIncrementMinor: bigint;
  emdMinor: bigint; emdPctBps: number | null;
  startsAt: Date; endsAt: Date; autoExtendSecs: number; extendTriggerSecs: number;
  minBidders: number | null; requiresSellerApproval: boolean;
  decisionWindowHours: number; decisionDueAt: Date | null;
  entryPaused: boolean; entryPausedAt: Date | null; entryPausedBy: string | null;
  endedAt: Date | null; settledAt: Date | null; lapsedAt: Date | null; defaultedAt: Date | null;
  cancelledAt: Date | null; cancelledBy: string | null; cancelReason: string | null;
  status: AuctionStatus; winningBidId: string | null; settledOrderId: string | null; version: number; createdAt: Date;
  /** The row's created_at as Postgres' own text (µs) — the cursor is minted from it (F-25). Absent before insert. */
  createdAtRaw?: string | null;
}

export interface WinningBid { amountMinor: bigint; bidId: string; bidderUserId: string }

export class Auction {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: AuctionProps) {}

  static create(input: {
    id: string; tenantId: string; listingId: string; kind: AuctionKind; quantity: string | number; unitCode: string;
    startPriceMinor: bigint; reservePriceMinor?: bigint | null; minIncrementMinor?: bigint;
    emdMinor?: bigint; emdPctBps?: number | null; startsAt: Date; endsAt: Date;
    autoExtendSecs?: number; extendTriggerSecs?: number; minBidders?: number | null; requiresSellerApproval?: boolean;
    decisionWindowHours?: number; now?: Date;
  }): Auction {
    if (!SUPPORTED.includes(input.kind)) throw new InvalidAuctionError(`auction kind '${input.kind}' is not supported yet`);
    if (input.startPriceMinor <= 0n) throw new InvalidAuctionError('start price must be positive');
    if (input.endsAt.getTime() <= input.startsAt.getTime()) throw new InvalidAuctionError('endsAt must be after startsAt');
    if (input.reservePriceMinor != null && input.reservePriceMinor < input.startPriceMinor) throw new InvalidAuctionError('reserve cannot be below start price');
    const minIncrement = input.minIncrementMinor ?? 10000n;
    if (minIncrement <= 0n) throw new InvalidAuctionError('minimum increment must be positive');
    if ((input.emdMinor ?? 0n) < 0n) throw new InvalidAuctionError('EMD cannot be negative');
    let milli: bigint;
    try { milli = qtyMilli(input.quantity); } catch { throw new InvalidAuctionError('the lot quantity is not a valid number'); }
    if (milli <= 0n) throw new InvalidAuctionError('the lot quantity must be positive');
    if (!input.unitCode || input.unitCode.length > 20) throw new InvalidAuctionError('the lot unit is required');
    const window = input.decisionWindowHours ?? DEFAULT_DECISION_HOURS;
    if (!Number.isInteger(window) || window < 1 || window > MAX_DECISION_HOURS) throw new InvalidAuctionError(`the seller-decision window must be 1–${MAX_DECISION_HOURS} hours`);
    const a = new Auction({
      id: input.id, tenantId: input.tenantId, listingId: input.listingId, kind: input.kind,
      quantity: milliToText(milli), unitCode: input.unitCode, auctionNo: null,
      startPriceMinor: input.startPriceMinor, reservePriceMinor: input.reservePriceMinor ?? null, minIncrementMinor: minIncrement,
      emdMinor: input.emdMinor ?? 0n, emdPctBps: input.emdPctBps ?? null,
      startsAt: input.startsAt, endsAt: input.endsAt, autoExtendSecs: input.autoExtendSecs ?? 120, extendTriggerSecs: input.extendTriggerSecs ?? 60,
      minBidders: input.minBidders ?? null, requiresSellerApproval: input.requiresSellerApproval ?? false,
      decisionWindowHours: window, decisionDueAt: null,
      entryPaused: false, entryPausedAt: null, entryPausedBy: null,
      endedAt: null, settledAt: null, lapsedAt: null, defaultedAt: null, cancelledAt: null, cancelledBy: null, cancelReason: null,
      status: 'scheduled', winningBidId: null, settledOrderId: null, version: 1, createdAt: input.now ?? new Date(),
    });
    a.events.push({ type: AuctionEventType.Created, payload: { auctionId: a.props.id, listingId: a.props.listingId, quantity: a.props.quantity, unitCode: a.props.unitCode } });
    return a;
  }
  static rehydrate(props: AuctionProps): Auction { return new Auction(props); }

  get id() { return this.props.id; }
  get status() { return this.props.status; }
  get version() { return this.props.version; }
  get listingId() { return this.props.listingId; }
  get endsAt() { return this.props.endsAt; }
  get quantity() { return this.props.quantity; }
  toProps(): Readonly<AuctionProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }
  /** The row was written at `version`; the next optimistic update in the SAME transaction compares against version + 1. */
  markPersisted(): void { this.props.version += 1; }
  /** The trigger assigned the number at INSERT (0186); the repository hands it back. */
  assignNumber(no: string): void { if (!this.props.auctionNo) this.props.auctionNo = no; }

  /** The minimum acceptable next bid (PER UNIT) given the current high (null if no bids yet). */
  minNextBidMinor(currentHighMinor: bigint | null): bigint {
    if (this.props.kind === 'sealed' || currentHighMinor === null) return this.props.startPriceMinor;
    return currentHighMinor + this.props.minIncrementMinor;
  }
  /** quantity × a per-unit price. */
  lotValue(unitMinor: bigint): bigint { return lotValueMinor(unitMinor, this.props.quantity); }
  /** EMD to hold for a bidder whose first bid is `unitMinor` (flat emdMinor, else % of the LOT value). Per lot. */
  emdForBid(unitMinor: bigint): bigint { return emdForLot(unitMinor, this.props.quantity, this.props.emdMinor, this.props.emdPctBps); }
  /** Reserve met by this per-unit amount (true when there is no reserve). */
  reserveMetBy(unitMinor: bigint | null): boolean | null {
    if (unitMinor === null) return null;
    return this.props.reservePriceMinor == null || unitMinor >= this.props.reservePriceMinor;
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

  /** Validate a bid against the rules (the service enforces seller/qualification/concurrency). F-15: refused at or after
   *  `endsAt`, whatever the status says — the close job may not have run yet, and that gap was the window a late bid used. */
  assertBidAcceptable(amountMinor: bigint, currentHighMinor: bigint | null, now: Date = new Date()): void {
    if (!isBiddable(this.props.status)) throw new AuctionNotBiddableError(this.props.status);
    if (now.getTime() >= this.props.endsAt.getTime()) throw new AuctionEndedError();
    const min = this.minNextBidMinor(currentHighMinor);
    if (amountMinor < min) throw new BidTooLowError(min);
  }
  /** Anti-snipe: a bid in the last `extendTriggerSecs` pushes endsAt out by `autoExtendSecs` — only INSIDE the live window. */
  maybeExtend(now: Date): boolean {
    if (!isBiddable(this.props.status)) return false;
    const left = this.props.endsAt.getTime() - now.getTime();
    if (left <= 0) return false;                                          // F-15: past the end nothing extends
    if (left > this.props.extendTriggerSecs * 1000) return false;
    if (this.props.autoExtendSecs <= 0) return false;
    this.props.endsAt = new Date(now.getTime() + this.props.autoExtendSecs * 1000);
    if (this.props.status !== 'extended') this.to('extended', AuctionEventType.Extended, { endsAt: this.props.endsAt.toISOString() });
    else this.events.push({ type: AuctionEventType.Extended, payload: { auctionId: this.props.id, endsAt: this.props.endsAt.toISOString() } });
    return true;
  }

  /** Time's up → ended (no more bids). */
  closeBidding(now: Date = new Date()): void { this.to('ended', AuctionEventType.Ended); this.props.endedAt = now; }

  /** Decide the outcome from the highest bid + bidder count. */
  resolve(highest: WinningBid | null, bidderCount: number, now: Date = new Date()): void {
    const reserveMet = highest != null && (this.props.reservePriceMinor == null || highest.amountMinor >= this.props.reservePriceMinor);
    const enoughBidders = this.props.minBidders == null || bidderCount >= this.props.minBidders;
    if (!highest || !reserveMet || !enoughBidders) {
      this.to('failed_reserve', AuctionEventType.FailedReserve, { bidderCount });
      return;
    }
    this.props.winningBidId = highest.bidId;
    if (this.props.requiresSellerApproval) {
      assertTransition(this.props.status, 'awaiting_approval');
      this.props.status = 'awaiting_approval';
      this.props.decisionDueAt = new Date(now.getTime() + this.props.decisionWindowHours * 3600_000);
      this.events.push({ type: AuctionEventType.Ended, payload: { auctionId: this.props.id, awaitingApproval: true, decisionDueAt: this.props.decisionDueAt.toISOString() } });
      return;
    }
    this.markSettled(highest, now);
  }
  /** The seller (or staff with the seller's recorded consent) approves an awaiting_approval auction. */
  approve(highest: WinningBid, now: Date = new Date()): void {
    if (this.props.status !== 'awaiting_approval') throw new AuctionActNotAllowedError('approve', this.props.status);
    this.markSettled(highest, now);
  }
  /** F-16: the order the settlement created, written in the same transaction. Once. */
  attachOrder(orderId: string): void {
    if (this.props.status !== 'settled') throw new AuctionActNotAllowedError('attach an order to', this.props.status);
    if (this.props.settledOrderId && this.props.settledOrderId !== orderId) throw new InvalidAuctionError('this auction already has its order');
    this.props.settledOrderId = orderId;
  }

  /** Cancel (scheduled / live / extended by the right hand; awaiting_approval = the seller's decline). Reason recorded. */
  cancel(by: string, reason: string, now: Date = new Date()): void {
    this.to('cancelled', AuctionEventType.Cancelled, { reason });
    this.props.cancelledAt = now; this.props.cancelledBy = by; this.props.cancelReason = reason;
  }
  /** F-13: the decision clock ran out → ended, no sale. */
  lapse(now: Date = new Date()): void {
    if (this.props.status !== 'awaiting_approval') throw new AuctionActNotAllowedError('lapse', this.props.status);
    this.to('ended', AuctionEventType.Lapsed, { decisionDueAt: this.props.decisionDueAt?.toISOString() ?? null });
    this.props.lapsedAt = now;
  }
  /** F-2: the winner did not pay the balance (or cancelled the order). */
  markDefaulted(now: Date = new Date()): void {
    this.to('defaulted', AuctionEventType.Defaulted, { settledOrderId: this.props.settledOrderId });
    this.props.defaultedAt = now;
  }

  /** A11: stop NEW bidders entering. Only while biddable; idempotence is refused by name (nothing would change). */
  pauseEntry(by: string, now: Date = new Date()): void {
    if (!isBiddable(this.props.status)) throw new AuctionActNotAllowedError('pause entry on', this.props.status);
    if (this.props.entryPaused) throw new AuctionActNotAllowedError('pause entry on (already paused)', this.props.status);
    this.props.entryPaused = true; this.props.entryPausedAt = now; this.props.entryPausedBy = by;
    this.events.push({ type: AuctionEventType.EntryPaused, payload: { auctionId: this.props.id } });
  }
  resumeEntry(): void {
    if (!this.props.entryPaused) throw new AuctionActNotAllowedError('resume entry on (not paused)', this.props.status);
    this.props.entryPaused = false; this.props.entryPausedAt = null; this.props.entryPausedBy = null;
    this.events.push({ type: AuctionEventType.EntryResumed, payload: { auctionId: this.props.id } });
  }

  private markSettled(highest: WinningBid, now: Date): void {
    assertTransition(this.props.status, 'settled');
    this.props.status = 'settled';
    this.props.winningBidId = highest.bidId;
    this.props.settledAt = now;
    this.events.push({ type: AuctionEventType.Won, payload: {
      auctionId: this.props.id, listingId: this.props.listingId, winningBidId: highest.bidId, bidderUserId: highest.bidderUserId,
      // F-12: the hammer is PER UNIT; the order is quantity × it. `amountMinor` keeps its v1 meaning for old consumers that
      // read it as "the hammer" — it is the per-unit hammer; `lotValueMinor` is what the order totals.
      amountMinor: highest.amountMinor.toString(), unitPriceMinor: highest.amountMinor.toString(),
      quantity: this.props.quantity, unitCode: this.props.unitCode, lotValueMinor: this.lotValue(highest.amountMinor).toString(),
    } });
  }

  private to(status: AuctionStatus, evt: string, payload: Record<string, unknown> = {}): void {
    assertTransition(this.props.status, status);
    this.props.status = status;
    this.events.push({ type: evt, payload: { auctionId: this.props.id, ...payload } });
  }
}
