// modules/auctions/services/auction.service.ts
// Auction lifecycle use-cases. Every write: one ACID tx (UoW), state via the machine (Law 5),
// outbox events in the SAME tx (Law 4), audit on every human act and every system decision that moves money or a
// listing. EMD (earnest money) moves ONLY via the wallet boundary (Law 2). Seller authority is resolved from the listing
// (Law 11 — we call ListingService, never the listings repository); the order is created through the orders module's
// public AuctionOrderService.
//
// PC-56 TENANT-11a — what changed, finding by finding:
//   • F-2 (founder: APPLY + FORFEIT). The close releases the LOSERS' holds and KEEPS the winner's — in `settled` and in
//     `awaiting_approval`. Settlement APPLIES the winner's EMD to the order (winner Hold → platform Escrow, `emd-apply:`,
//     referenced to the order) and records what the winner still owes (`auction_settlements`: order value − EMD, due in
//     48 h). If the order still awaits payment at that time (or the winner cancels it), the EMD is FORFEITED to the seller
//     (Escrow → seller Main, `emd-forfeit:`), the auction is `defaulted`, the order cancelled, the listing re-published. If
//     the seller / the system cancels the order instead, the EMD goes back to the winner (`emd-return:`).
//     WHY AT SETTLEMENT AND NOT AT PAYMENT: `online_payments` is OFF (seed 0009), so an auction order is created `created`
//     (no payment step) and no `payments.payment_succeeded` ever arrives for it — an apply waiting for that event would
//     strand the winner's hold forever. Applying in the settlement transaction is the one moment that exists in BOTH
//     modes; with the flag ON the order is `payment_pending` and the payments module asks for `total − applied EMD`
//     (PaymentService.amountDueForOrderInTx), so escrow ends holding exactly the order value either way.
//   • F-12 (founder: PER UNIT). Every price is per unit; the order is quantity × hammer (AuctionOrderService refuses to write
//     an order that disagrees with the lot value computed here).
//   • F-16. The order is created in the settlement transaction and `settled_order_id` written with `status='settled'`.
//   • F-7. The listing is reserved at create (published → reserved_auction), released on cancel / lapse / failed reserve,
//     consumed at settlement, restocked on default — each inside the auction's own transaction.
//   • F-13. `awaiting_approval` carries `decision_due_at`; `lapse()` ends it with no sale and returns every EMD.
//   • F-10. Staff never decide for the seller: approve / decline by staff needs `auction.schedule_on_behalf` AND a consent
//     row recorded for THAT act; a live auction is stopped only with `auction.cancel_live` and a reason; the old
//     `listing.moderate || dispute.resolve` moderation reach (support_agent, ai_ops) is gone from every write.
//   • F-24. create / approve / decline / cancel / pause / resume / lapse / default are audited with actor, reason,
//     before / after and ip (system decisions with a NULL actor and the rule as the reason).
//   • F-27a. `reservePriceMinor` is serialized only to the seller and the auction desk.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { userMain, userHold, platform, PlatformAccount } from '../../../core/wallet/account-codes';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ListingService } from '../../listings/services/listing.service';
import { AuctionOrderService } from '../../orders/services/auction-order.service';
import { Auction, WinningBid } from '../domain/auction.entity';
import { AuctionGroup, AuctionStatus } from '../domain/auction.state';
import { DomainEvent, AuctionEventType } from '../domain/auctions.events';
import { UpdateAuctionDto } from '../dto/update-auction.dto';
import {
  AuctionNotFoundError, AuctionForbiddenError, AuctionConcurrencyError, InvalidAuctionError, AuctionReasonRequiredError,
  AuctionConsentRequiredError, AuctionCancelLiveForbiddenError, AuctionActNotAllowedError, AuctionListingUnavailableError,
} from '../domain/auctions.errors';
import { BALANCE_DUE_MS, emdApplied, emdApplyKey, emdExcessKey, emdForfeitKey, emdReleaseKey, emdReturnKey } from '../domain/lot';
import { cleanReason } from '../domain/display';
import { Cursor, encodeCursor } from '../domain/cursor';
import { AuctionRepository } from '../repositories/auction.repository';
import { BidRepository } from '../repositories/bid.repository';
import { AuctionWatcherRepository } from '../repositories/auction-watcher.repository';
import { AuctionSettlementRepository, ConsentInput, SettlementRow } from '../repositories/auction-settlement.repository';
import { AuctionsPublisher } from '../events/auctions.publisher';

/** Who is acting, and which of the auction desk's verbs they hold (resolved from the request's permissions). */
export interface AuctionActor {
  userId: string;
  /** auction.schedule_on_behalf — schedule FOR a seller; record a seller's decision WITH their consent. */
  onBehalf?: boolean;
  /** auction.cancel_live — stop a live auction (reason mandatory). */
  cancelLive?: boolean;
  /** auction.pause_entry — stop / resume new bidders. */
  pauseEntry?: boolean;
}
/** The reader: the seller and the auction desk see the reserve, the EMD totals and who bid (masked) after close. */
export interface AuctionViewer extends AuctionActor { isStaff: boolean }
export const isStaff = (a: AuctionActor) => Boolean(a.onBehalf || a.cancelLive || a.pauseEntry);

const SYSTEM = 'system';

@Injectable()
export class AuctionService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly audit: AuditWriter,
    private readonly listings: ListingService,
    private readonly repo: AuctionRepository,
    private readonly bids: BidRepository,
    private readonly watchers: AuctionWatcherRepository,
    private readonly publisher: AuctionsPublisher,
    private readonly settlements: AuctionSettlementRepository,
    private readonly auctionOrders: AuctionOrderService,
  ) {}

  private async listingOf(tenantId: string, listingId: string): Promise<any> {
    const l: any = await this.listings.getById(tenantId, listingId);
    if (!l) throw new InvalidAuctionError('listing not found');
    return l;
  }

  /* ------------------------------------------------------------------------------------------------------------ */
  /* CREATE (W2348–W2351)                                                                                          */
  /* ------------------------------------------------------------------------------------------------------------ */

  /** A seller opens an auction on THEIR published listing — or the auction desk schedules it FOR a seller, with the
   *  seller's recorded consent. The listing is reserved in the same transaction (F-7) and the lot copied from it (F-12). */
  async create(tenantId: string, actor: AuctionActor | string, idemKey: string, dto: any, ip: string | null = null) {
    const who: AuctionActor = typeof actor === 'string' ? { userId: actor } : actor;
    return this.idem.remember(idemKey, who.userId, 'auctions.create', () =>
      timed(this.metrics, 'auctions.create', { tenant: tenantId }, async () => {
        const l: any = await this.listings.getById(tenantId, dto.listingId);
        if (!l) throw new AuctionListingUnavailableError('not found');
        if (l.status !== 'published') throw new AuctionListingUnavailableError(`it is ${l.status}, not published`);
        const onBehalf = typeof dto.sellerUserId === 'string' && dto.sellerUserId !== who.userId;
        const sellerUserId: string = onBehalf ? dto.sellerUserId : who.userId;
        if (onBehalf) {
          if (!who.onBehalf) throw new AuctionForbiddenError('scheduling for a seller needs auction.schedule_on_behalf');
          if (!dto.consent) throw new AuctionConsentRequiredError('schedule an auction');
        }
        if (l.sellerUserId !== sellerUserId) throw new AuctionForbiddenError('only the listing seller\'s produce can be auctioned');
        const out = await this.uow.run(tenantId, async (tx) => {
          const lot = await this.listings.reserveForAuctionInTx(tx, tenantId, dto.listingId, sellerUserId);
          const auction = Auction.create({
            id: uuidv7(), tenantId, listingId: dto.listingId, kind: dto.kind, quantity: lot.quantity, unitCode: lot.unitCode,
            startPriceMinor: BigInt(dto.startPriceMinor),
            reservePriceMinor: dto.reservePriceMinor ? BigInt(dto.reservePriceMinor) : null, minIncrementMinor: dto.minIncrementMinor ? BigInt(dto.minIncrementMinor) : undefined,
            emdMinor: dto.emdMinor ? BigInt(dto.emdMinor) : undefined, emdPctBps: dto.emdPctBps ?? null,
            startsAt: new Date(dto.startsAt), endsAt: new Date(dto.endsAt), autoExtendSecs: dto.autoExtendSecs, extendTriggerSecs: dto.extendTriggerSecs,
            minBidders: dto.minBidders ?? null, requiresSellerApproval: dto.requiresSellerApproval, decisionWindowHours: dto.decisionWindowHours,
          });
          await this.repo.insert(tx, auction);
          const p = auction.toProps();
          await this.repo.recordEvent(tx, tenantId, p.id, 'created');
          let consentId: string | null = null;
          if (onBehalf) consentId = await this.settlements.recordConsent(tx, { tenantId, auctionId: p.id, sellerUserId, act: 'schedule', recordedBy: who.userId, ...(dto.consent as ConsentInput) });
          await this.audit.write(tx, { tenantId, actorUserId: who.userId, action: 'auction.created', entityType: 'auction', entityId: p.id, ip,
            reason: onBehalf ? 'scheduled on the seller\'s behalf with their recorded consent' : null, oldValue: null,
            newValue: { auctionNo: p.auctionNo, listingId: p.listingId, kind: p.kind, quantity: p.quantity, unitCode: p.unitCode,
              startPriceMinor: p.startPriceMinor.toString(), reservePriceMinor: p.reservePriceMinor?.toString() ?? null, minIncrementMinor: p.minIncrementMinor.toString(),
              emdMinor: p.emdMinor.toString(), emdPctBps: p.emdPctBps, startsAt: p.startsAt, endsAt: p.endsAt, requiresSellerApproval: p.requiresSellerApproval,
              decisionWindowHours: p.decisionWindowHours, sellerUserId, onBehalf, consentId, listingStatus: 'reserved_auction' } });
          await this.flush(tx, tenantId, p.id, auction.pullEvents());
          return { auctionId: p.id, auctionNo: p.auctionNo, listingId: p.listingId, status: p.status, quantity: p.quantity, unitCode: p.unitCode, startsAt: p.startsAt, endsAt: p.endsAt };
        }, { userId: who.userId });
        await this.listings.invalidate(tenantId, dto.listingId);
        return out;
      }));
  }

  /* ------------------------------------------------------------------------------------------------------------ */
  /* THE CADENCE ACTS (each in its own kv_app transaction, each idempotent)                                       */
  /* ------------------------------------------------------------------------------------------------------------ */

  /** Open a scheduled auction at starts_at. Idempotent (skips if not scheduled / not yet due). */
  async open(tenantId: string, auctionId: string, now: Date = new Date()): Promise<boolean> {
    return this.uow.run(tenantId, async (tx) => {
      const a = await this.repo.getForUpdate(tx, tenantId, auctionId);
      if (!a || a.status !== 'scheduled' || a.toProps().startsAt.getTime() > now.getTime()) return false;
      a.open();
      if (!(await this.repo.update(tx, a))) throw new AuctionConcurrencyError(auctionId);
      await this.repo.recordEvent(tx, tenantId, auctionId, 'opened');
      await this.flush(tx, tenantId, auctionId, a.pullEvents());
      return true;
    }, { userId: SYSTEM });
  }

  /** Close a due auction and resolve it (cadence job, at ends_at). The LOSERS' EMD is returned here; the winner's is kept
   *  (awaiting_approval) or applied to the order (settled) — F-2. Idempotent: skips anything not live/extended or not due. */
  async closeAndResolve(tenantId: string, auctionId: string, now: Date = new Date()): Promise<boolean> {
    let listingId: string | null = null;
    const done = await this.uow.run(tenantId, async (tx) => {
      const a = await this.repo.getForUpdate(tx, tenantId, auctionId);
      if (!a || (a.status !== 'live' && a.status !== 'extended')) return false;
      if (a.endsAt.getTime() > now.getTime()) return false;                       // not due: a close never runs early
      listingId = a.listingId;
      const highest = await this.bids.highest(tx, tenantId, auctionId);
      const bidderCount = await this.bids.distinctBidderCount(tx, tenantId, auctionId);
      a.closeBidding(now);
      a.resolve(highest ? { amountMinor: highest.amountMinor, bidId: highest.id, bidderUserId: highest.bidderUserId } : null, bidderCount, now);
      const outcome = a.status as AuctionStatus;                                  // re-read after resolve() moved it
      if (outcome === 'failed_reserve') {
        await this.releaseEmd(tx, tenantId, a, null);                               // everyone back
        await this.listings.releaseFromAuctionInTx(tx, tenantId, a.listingId);
      } else if (outcome === 'awaiting_approval') {
        await this.releaseEmd(tx, tenantId, a, highest!.bidderUserId);              // losers back; the winner's hold KEPT
      } else if (outcome === 'settled') {
        await this.settleInTx(tx, tenantId, a, { amountMinor: highest!.amountMinor, bidId: highest!.id, bidderUserId: highest!.bidderUserId }, now);
      }
      if (!(await this.repo.update(tx, a))) throw new AuctionConcurrencyError(auctionId);
      await this.repo.recordEvent(tx, tenantId, auctionId, 'ended', { status: a.status, bidderCount });
      const events = a.pullEvents();
      await this.flush(tx, tenantId, auctionId, events);
      // P1-7: fan the close out to everyone WATCHING this auction (notification spine). Bounded + atomic in this tx.
      const watcherIds = await this.watchers.listWatcherUserIds(tx, tenantId, auctionId);
      if (watcherIds.length > 0) {
        const hadWinner = events.some((e) => e.type === AuctionEventType.Won);
        await this.publisher.watchersAuctionEnded(tx, tenantId, auctionId, watcherIds, hadWinner);
      }
      return true;
    }, { userId: SYSTEM });
    if (done && listingId) await this.listings.invalidate(tenantId, listingId);
    return done;
  }

  /** F-13: the seller did not decide by decision_due_at → ended, no sale; EVERY hold returned (the winner's too); the
   *  listing back on sale. System decision, audited with the rule as its reason. Idempotent. */
  async lapse(tenantId: string, auctionId: string, now: Date = new Date()): Promise<boolean> {
    let listingId: string | null = null;
    const done = await this.uow.run(tenantId, async (tx) => {
      const a = await this.repo.getForUpdate(tx, tenantId, auctionId);
      if (!a || a.status !== 'awaiting_approval') return false;
      const due = a.toProps().decisionDueAt;
      if (!due || due.getTime() > now.getTime()) return false;
      listingId = a.listingId;
      a.lapse(now);
      await this.releaseEmd(tx, tenantId, a, null);
      await this.listings.releaseFromAuctionInTx(tx, tenantId, a.listingId);
      if (!(await this.repo.update(tx, a))) throw new AuctionConcurrencyError(auctionId);
      await this.repo.recordEvent(tx, tenantId, auctionId, 'lapsed', { decisionDueAt: due.toISOString() });
      await this.audit.write(tx, { tenantId, actorUserId: null, action: 'auction.lapsed', entityType: 'auction', entityId: auctionId, ip: null,
        reason: 'the seller did not decide by the decision deadline — the auction ended with no sale and every EMD was returned',
        oldValue: { status: 'awaiting_approval', decisionDueAt: due }, newValue: { status: 'ended', lapsedAt: now, listingStatus: 'published' } });
      await this.flush(tx, tenantId, auctionId, a.pullEvents());
      return true;
    }, { userId: SYSTEM });
    if (done && listingId) await this.listings.invalidate(tenantId, listingId);
    return done;
  }

  /** F-2 default: an online-collected settlement whose balance is still unpaid at balance_due_at. The order is cancelled,
   *  the applied EMD forfeited to the seller, the auction `defaulted`, the listing restocked. If the order has moved on
   *  (paid), the settlement is recorded `paid` instead. Idempotent. */
  async defaultIfUnpaid(tenantId: string, auctionId: string, now: Date = new Date()): Promise<'defaulted' | 'paid' | 'skipped'> {
    let listingId: string | null = null;
    const out = await this.uow.run(tenantId, async (tx) => {
      const a = await this.repo.getForUpdate(tx, tenantId, auctionId);
      if (!a || a.status !== 'settled') return 'skipped' as const;
      const s = await this.settlements.forAuctionForUpdate(tx, tenantId, auctionId);
      if (!s || s.outcome !== 'open' || s.collection !== 'online' || s.balanceDueAt.getTime() > now.getTime()) return 'skipped' as const;
      const cancelled = await this.auctionOrders.cancelForDefaultInTx(tx, tenantId, s.orderId, auctionId);
      if (!cancelled) { await this.settlements.recordOutcome(tx, tenantId, s.id, 'paid'); return 'paid' as const; }
      listingId = a.listingId;
      await this.forfeitInTx(tx, tenantId, a, s, now, 'the balance was not paid by the due time — the EMD was forfeited to the seller and the order cancelled');
      return 'defaulted' as const;
    }, { userId: SYSTEM });
    if (listingId) await this.listings.invalidate(tenantId, listingId);
    return out;
  }

  /** `orders.order_cancelled` for an auction order (kv_app UoW, F-9 — never the relay's kv_relay tx): a BUYER cancel is a
   *  walk-away → forfeit + defaulted; a seller / system cancel returns the applied EMD to the winner. Idempotent. */
  async onOrderCancelled(tenantId: string, orderId: string, role: string, now: Date = new Date()): Promise<'defaulted' | 'returned' | 'skipped'> {
    let listingId: string | null = null;
    const out = await this.uow.run(tenantId, async (tx) => {
      const s = await this.settlements.forOrderForUpdate(tx, tenantId, orderId);
      if (!s || s.outcome !== 'open') return 'skipped' as const;
      const a = await this.repo.getForUpdate(tx, tenantId, s.auctionId);
      if (!a || a.status !== 'settled') return 'skipped' as const;
      listingId = a.listingId;
      if (role === 'buyer') {
        await this.forfeitInTx(tx, tenantId, a, s, now, 'the winner cancelled the order — the EMD was forfeited to the seller');
        return 'defaulted' as const;
      }
      let retTxn: string | null = null;
      if (s.emdAppliedMinor > 0n) {
        retTxn = (await this.wallet.post(tx, { tenantId, txnType: 'emd_return', idempotencyKey: emdReturnKey(a.id), referenceType: 'order', referenceId: s.orderId, initiatedBy: SYSTEM,
          legs: [{ account: platform(PlatformAccount.Escrow), amountMinor: -s.emdAppliedMinor }, { account: userMain(s.winnerUserId), amountMinor: s.emdAppliedMinor }] })).txnId;
      }
      await this.settlements.recordOutcome(tx, tenantId, s.id, 'returned', { ret: retTxn });
      await this.listings.restockInTx(tx, tenantId, a.listingId, Number(a.quantity));
      await this.audit.write(tx, { tenantId, actorUserId: null, action: 'auction.emd_returned', entityType: 'auction', entityId: a.id, ip: null,
        reason: `the order was cancelled by the ${role === 'seller' ? 'seller' : 'system'} — the winner did not default, so the EMD went back to them`,
        oldValue: { settlement: 'open' }, newValue: { settlement: 'returned', emdReturnedMinor: s.emdAppliedMinor.toString(), orderId: s.orderId, listingStatus: 'published' } });
      await this.outbox.write(tx, { tenantId, aggregateType: 'auction', aggregateId: a.id, eventType: AuctionEventType.EmdReturned,
        payload: { v: 1, auctionId: a.id, orderId: s.orderId, bidderUserId: s.winnerUserId, amountMinor: s.emdAppliedMinor.toString() } });
      return 'returned' as const;
    }, { userId: SYSTEM });
    if (listingId) await this.listings.invalidate(tenantId, listingId);
    return out;
  }

  /** `payments.payment_succeeded` for an auction order (kv_app UoW): the balance is paid — the settlement is `paid`. */
  async onOrderPaid(tenantId: string, orderId: string): Promise<boolean> {
    return this.uow.run(tenantId, async (tx) => {
      const s = await this.settlements.forOrderForUpdate(tx, tenantId, orderId);
      if (!s || s.outcome !== 'open') return false;
      return this.settlements.recordOutcome(tx, tenantId, s.id, 'paid');
    }, { userId: SYSTEM });
  }

  /* ------------------------------------------------------------------------------------------------------------ */
  /* THE HUMAN ACTS                                                                                                */
  /* ------------------------------------------------------------------------------------------------------------ */

  /** W139 "Approve — create order": the seller, or staff with auction.schedule_on_behalf AND the seller's recorded consent
   *  for THIS decision (never staff alone). Idempotent on the caller's key (double-click safe). */
  async approve(tenantId: string, actor: AuctionActor, auctionId: string, idemKey: string, consent: ConsentInput | null, ip: string | null) {
    return this.idem.remember(idemKey, actor.userId, 'auctions.approve', async () => {
      let listingId: string | null = null;
      const out = await this.uow.run(tenantId, async (tx) => {
        const a = await this.repo.getForUpdate(tx, tenantId, auctionId);
        if (!a) throw new AuctionNotFoundError(auctionId);
        const l = await this.listingOf(tenantId, a.listingId);
        const consentId = await this.assertSellerDecision(tx, tenantId, a, l.sellerUserId, actor, 'approve', consent);
        if (a.status !== 'awaiting_approval') throw new AuctionActNotAllowedError('approve', a.status);
        const winning = a.toProps().winningBidId ? await this.bids.bidById(tx, tenantId, a.toProps().winningBidId!) : null;
        if (!winning) throw new InvalidAuctionError('no winning bid');
        const now = new Date();
        listingId = a.listingId;
        a.approve({ amountMinor: winning.amountMinor, bidId: winning.id, bidderUserId: winning.bidderUserId }, now);
        const s = await this.settleInTx(tx, tenantId, a, { amountMinor: winning.amountMinor, bidId: winning.id, bidderUserId: winning.bidderUserId }, now);
        if (!(await this.repo.update(tx, a))) throw new AuctionConcurrencyError(auctionId);
        await this.repo.recordEvent(tx, tenantId, auctionId, 'approved', { consentId });
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'auction.approved', entityType: 'auction', entityId: auctionId, ip,
          reason: consentId ? 'approved on the seller\'s behalf with their recorded consent' : 'approved by the seller',
          oldValue: { status: 'awaiting_approval' },
          newValue: { status: 'settled', winningBidId: winning.id, orderId: s.orderId, orderValueMinor: s.orderValueMinor.toString(), emdAppliedMinor: s.emdAppliedMinor.toString(),
            balanceDueMinor: s.balanceDueMinor.toString(), balanceDueAt: s.balanceDueAt, consentId } });
        await this.flush(tx, tenantId, auctionId, a.pullEvents());
        return { auctionId, status: 'settled', orderId: s.orderId, orderValueMinor: s.orderValueMinor.toString(), emdAppliedMinor: s.emdAppliedMinor.toString(), balanceDueMinor: s.balanceDueMinor.toString(), balanceDueAt: s.balanceDueAt };
      }, { userId: actor.userId });
      if (listingId) await this.listings.invalidate(tenantId, listingId);
      return out;
    });
  }

  /** Cancel / decline. scheduled: the seller or tenant_admin (auction.cancel_live); live / extended: tenant_admin ONLY;
   *  awaiting_approval: the seller's DECLINE (or staff with the seller's recorded consent). Reason mandatory, recorded
   *  verbatim and sent to every bidder; every EMD returned; the listing back on sale. */
  async cancel(tenantId: string, actor: AuctionActor, auctionId: string, reasonRaw: unknown, consent: ConsentInput | null, ip: string | null) {
    const reason = cleanReason(reasonRaw);
    if (!reason) throw new AuctionReasonRequiredError();
    let listingId: string | null = null;
    const out = await this.uow.run(tenantId, async (tx) => {
      const a = await this.repo.getForUpdate(tx, tenantId, auctionId);
      if (!a) throw new AuctionNotFoundError(auctionId);
      const l = await this.listingOf(tenantId, a.listingId);
      const isSeller = l.sellerUserId === actor.userId;
      const from = a.status;
      let consentId: string | null = null;
      if (from === 'live' || from === 'extended') {
        if (!actor.cancelLive) throw new AuctionCancelLiveForbiddenError();
      } else if (from === 'scheduled') {
        if (!isSeller && !actor.cancelLive) throw new AuctionForbiddenError('only the seller or a tenant admin may cancel a scheduled auction');
      } else if (from === 'awaiting_approval') {
        consentId = await this.assertSellerDecision(tx, tenantId, a, l.sellerUserId, actor, 'decline', consent);
      } else {
        throw new AuctionActNotAllowedError('cancel', from);
      }
      listingId = a.listingId;
      const bidders = (await this.bids.firstBidAmounts(tx, tenantId, auctionId)).map((f) => f.bidderUserId);
      const allBidders = await this.allBidderIds(tx, tenantId, auctionId);
      a.cancel(actor.userId, reason, new Date());
      await this.releaseEmd(tx, tenantId, a, null);
      await this.listings.releaseFromAuctionInTx(tx, tenantId, a.listingId);
      if (!(await this.repo.update(tx, a))) throw new AuctionConcurrencyError(auctionId);
      await this.repo.recordEvent(tx, tenantId, auctionId, from === 'awaiting_approval' ? 'declined' : 'cancelled', { reason, consentId });
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: from === 'awaiting_approval' ? 'auction.declined' : 'auction.cancelled', entityType: 'auction', entityId: auctionId, ip, reason,
        oldValue: { status: from }, newValue: { status: 'cancelled', emdReleasedTo: bidders.length, bidders: allBidders.length, consentId, listingStatus: 'published' } });
      const recipients = [...new Set([...allBidders, ...(isSeller ? [] : [l.sellerUserId])])];
      await this.flush(tx, tenantId, auctionId, a.pullEvents(), { recipientUserIds: recipients, reason, title: l.title, auctionNo: a.toProps().auctionNo });
      return { auctionId, status: 'cancelled', notified: recipients.length };
    }, { userId: actor.userId });
    if (listingId) await this.listings.invalidate(tenantId, listingId);
    return out;
  }

  /** A11: pause / resume NEW bidders (tenant_admin, reason). Existing bidders continue. */
  async setEntryPaused(tenantId: string, actor: AuctionActor, auctionId: string, paused: boolean, reasonRaw: unknown, ip: string | null) {
    if (!actor.pauseEntry) throw new AuctionForbiddenError('pausing entry needs auction.pause_entry');
    const reason = cleanReason(reasonRaw);
    if (!reason) throw new AuctionReasonRequiredError();
    return this.uow.run(tenantId, async (tx) => {
      const a = await this.repo.getForUpdate(tx, tenantId, auctionId);
      if (!a) throw new AuctionNotFoundError(auctionId);
      if (paused) a.pauseEntry(actor.userId, new Date()); else a.resumeEntry();
      if (!(await this.repo.update(tx, a))) throw new AuctionConcurrencyError(auctionId);
      await this.repo.recordEvent(tx, tenantId, auctionId, paused ? 'entry_paused' : 'entry_resumed', { reason });
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: paused ? 'auction.entry_paused' : 'auction.entry_resumed', entityType: 'auction', entityId: auctionId, ip, reason,
        oldValue: { entryPaused: !paused }, newValue: { entryPaused: paused } });
      await this.flush(tx, tenantId, auctionId, a.pullEvents());
      return { auctionId, entryPaused: paused };
    }, { userId: actor.userId });
  }

  /** Seller (or the desk scheduling for them) edits a SCHEDULED auction's terms (before it opens / any bids). */
  async updateScheduled(tenantId: string, actor: AuctionActor, auctionId: string, dto: UpdateAuctionDto, ip: string | null) {
    return this.uow.run(tenantId, async (tx) => {
      const a = await this.repo.getForUpdate(tx, tenantId, auctionId);
      if (!a) throw new AuctionNotFoundError(auctionId);
      const l = await this.listingOf(tenantId, a.listingId);
      if (l.sellerUserId !== actor.userId && !actor.onBehalf) throw new AuctionForbiddenError();
      const before = a.toProps();
      a.editSchedule({
        reservePriceMinor: dto.reservePriceMinor === undefined ? undefined : (dto.reservePriceMinor === null ? null : BigInt(dto.reservePriceMinor)),
        minIncrementMinor: dto.minIncrementMinor ? BigInt(dto.minIncrementMinor) : undefined,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
      });
      if (!(await this.repo.updateSchedule(tx, a))) throw new AuctionConcurrencyError(auctionId);
      const after = a.toProps();
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'auction.updated', entityType: 'auction', entityId: auctionId, ip,
        reason: l.sellerUserId === actor.userId ? 'edited by the seller' : 'edited by the auction desk',
        oldValue: { reservePriceMinor: before.reservePriceMinor?.toString() ?? null, minIncrementMinor: before.minIncrementMinor.toString(), startsAt: before.startsAt, endsAt: before.endsAt },
        newValue: { reservePriceMinor: after.reservePriceMinor?.toString() ?? null, minIncrementMinor: after.minIncrementMinor.toString(), startsAt: after.startsAt, endsAt: after.endsAt } });
      await this.flush(tx, tenantId, auctionId, a.pullEvents());
      return this.serialize(a.toProps(), { reserveVisible: true });
    }, { userId: actor.userId });
  }

  /** The EMD-release SWEEPER (backstop for a close the cadence missed or a crash between steps). Idempotent on the shared
   *  `emd-release:` key. It never touches a winner whose hold is kept (awaiting_approval) or applied (settled / defaulted). */
  async releaseLosingEmd(tenantId: string, auctionId: string): Promise<{ released: number }> {
    return this.uow.run(tenantId, async (tx) => {
      const a = await this.repo.getForUpdate(tx, tenantId, auctionId);
      if (!a) return { released: 0 };
      const p = a.toProps();
      if (p.status === 'live' || p.status === 'extended' || p.status === 'scheduled') return { released: 0 };
      const keepsWinner = p.status === 'awaiting_approval' || p.status === 'settled' || p.status === 'defaulted';
      const winnerUserId = keepsWinner && p.winningBidId ? await this.bids.bidderOfBid(tx, tenantId, p.winningBidId) : null;
      return { released: await this.releaseEmd(tx, tenantId, a, winnerUserId) };
    }, { userId: SYSTEM });
  }

  /* ------------------------------------------------------------------------------------------------------------ */
  /* READS                                                                                                         */
  /* ------------------------------------------------------------------------------------------------------------ */

  async getById(tenantId: string, auctionId: string, viewer?: AuctionViewer) {
    const a = await this.repo.getVisible(tenantId, auctionId);
    if (!a) throw new AuctionNotFoundError(auctionId);
    const p = a.toProps();
    const l: any = await this.listings.getById(tenantId, p.listingId);
    const isSeller = !!viewer && l?.sellerUserId === viewer.userId;
    const privileged = isSeller || !!viewer?.isStaff;
    const stats = (await this.bids.statsFor(tenantId, [p.id])).get(p.id) ?? { highMinor: null, bidders: 0 };
    const sealedHidden = p.kind === 'sealed' && (p.status === 'live' || p.status === 'extended' || p.status === 'scheduled');
    const high = sealedHidden ? null : stats.highMinor;
    const base = this.serialize(p, { reserveVisible: privileged });
    const settlement = privileged || (viewer && (await this.isWinner(tenantId, p.winningBidId, viewer.userId))) ? await this.settlements.forAuction(tenantId, p.id) : null;
    // W139 "If seller approves": the SAME arithmetic the approval will write (settleInTx), computed here from the winning bid
    // — so the console never multiplies or subtracts money itself. Seller / desk only, and only while the seller decides.
    let settlementPreview: Record<string, string> | null = null;
    if (privileged && p.status === 'awaiting_approval' && p.winningBidId) {
      const win = (await this.bids.statsFor(tenantId, [p.id])).get(p.id);
      const winner = await this.bids.bidderOfBidRead(tenantId, p.winningBidId);
      const first = (await this.bids.biddersInOrder(tenantId, p.id)).find((b) => b.bidderUserId === winner);
      if (win?.highMinor != null && first) {
        const value = a.lotValue(win.highMinor);
        const { applied } = emdApplied(first.hasEmd ? a.emdForBid(first.firstAmountMinor) : 0n, value);
        settlementPreview = { hammerUnitMinor: win.highMinor.toString(), orderValueMinor: value.toString(), emdAppliedMinor: applied.toString(), balanceDueMinor: (value - applied).toString() };
      }
    }
    return {
      ...base,
      listingTitle: l?.title ?? null, listingStatus: l?.status ?? null, sellerIsViewer: isSeller,
      highBidMinor: high?.toString() ?? null, highLotValueMinor: high !== null ? a.lotValue(high).toString() : null,
      sealedHidden, bidderCount: stats.bidders,
      reserveMet: high !== null ? a.reserveMetBy(high) : null,
      extensionCount: await this.repo.extensionCount(tenantId, p.id),
      emdHeldMinor: privileged ? (await this.settlements.emdHeldMinor(tenantId, p.id)).toString() : null,
      settlement: settlement ? this.serializeSettlement(settlement) : null, settlementPreview,
      consents: privileged ? (await this.settlements.consentsFor(tenantId, p.id)).map((c) => ({ act: c.act, channel: c.channel, hasEvidence: c.mediaId !== null, recordedAt: c.recordedAt })) : [],
      viewerCan: viewer ? this.viewerCan(p.status, isSeller, viewer) : null,
    };
  }

  async list(tenantId: string, q: { status?: string; group?: AuctionGroup; cursor?: Cursor; limit: number }, viewer?: AuctionViewer) {
    const rows = await this.repo.listFor(tenantId, q);
    const stats = await this.bids.statsFor(tenantId, rows.map((a) => a.id));
    const counts = await this.repo.groupCounts(tenantId);
    const items: Array<Record<string, unknown>> = [];
    for (const a of rows) {
      const p = a.toProps();
      const l: any = await this.listings.getById(tenantId, p.listingId);
      const privileged = !!viewer && (viewer.isStaff || l?.sellerUserId === viewer.userId);
      const st = stats.get(p.id) ?? { highMinor: null, bidders: 0 };
      const sealedHidden = p.kind === 'sealed' && (p.status === 'live' || p.status === 'extended' || p.status === 'scheduled');
      const high = sealedHidden ? null : st.highMinor;
      items.push({ ...this.serialize(p, { reserveVisible: privileged }), listingTitle: l?.title ?? null,
        highBidMinor: high?.toString() ?? null, highLotValueMinor: high !== null ? a.lotValue(high).toString() : null, sealedHidden, bidderCount: st.bidders,
        reserveMet: high !== null ? a.reserveMetBy(high) : null });
    }
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === q.limit && last ? encodeCursor(last.toProps().createdAtRaw, last.id) : null;
    const total = q.group ? counts[q.group] : q.status ? null : Object.values(counts).reduce((s, n) => s + n, 0);
    return { items, nextCursor, counts, total };
  }

  private serialize(p: ReturnType<Auction['toProps']>, o: { reserveVisible: boolean }) {
    return { auctionId: p.id, auctionNo: p.auctionNo, listingId: p.listingId, kind: p.kind, status: p.status,
      quantity: p.quantity, unitCode: p.unitCode,
      startPriceMinor: p.startPriceMinor.toString(),
      // F-27a: the reserve is the seller's and the desk's to see — a bidder reads `reserveMet`, never the number.
      reservePriceMinor: o.reserveVisible ? (p.reservePriceMinor?.toString() ?? null) : null, reserveHidden: !o.reserveVisible && p.reservePriceMinor !== null,
      hasReserve: p.reservePriceMinor !== null,
      minIncrementMinor: p.minIncrementMinor.toString(),
      // P1-8: expose the EMD requirement so a bidder sees the hold before bidding — flat emdMinor (minor-unit string)
      // or emdPctBps (% of the LOT value) — exactly as the server computes it (emdForBid). Per lot.
      emdMinor: p.emdMinor.toString(), emdPctBps: p.emdPctBps,
      autoExtendSecs: p.autoExtendSecs, extendTriggerSecs: p.extendTriggerSecs, minBidders: p.minBidders, requiresSellerApproval: p.requiresSellerApproval,
      decisionWindowHours: p.decisionWindowHours, decisionDueAt: p.decisionDueAt, entryPaused: p.entryPaused,
      startsAt: p.startsAt, endsAt: p.endsAt, endedAt: p.endedAt, settledAt: p.settledAt, lapsedAt: p.lapsedAt, defaultedAt: p.defaultedAt,
      cancelledAt: p.cancelledAt, cancelReason: p.cancelReason,
      winningBidId: p.winningBidId, settledOrderId: p.settledOrderId, createdAt: p.createdAt };
  }
  private serializeSettlement(s: SettlementRow) {
    return { orderId: s.orderId, quantity: s.quantity, unitCode: s.unitCode, hammerUnitMinor: s.hammerUnitMinor.toString(), orderValueMinor: s.orderValueMinor.toString(),
      emdAppliedMinor: s.emdAppliedMinor.toString(), balanceDueMinor: s.balanceDueMinor.toString(), balanceDueAt: s.balanceDueAt, collection: s.collection,
      settledAt: s.settledAt, outcome: s.outcome, outcomeAt: s.outcomeAt };
  }
  private viewerCan(status: string, isSeller: boolean, v: AuctionViewer) {
    const live = status === 'live' || status === 'extended';
    return {
      cancel: (live && !!v.cancelLive) || (status === 'scheduled' && (isSeller || !!v.cancelLive)),
      decide: status === 'awaiting_approval' && (isSeller || !!v.onBehalf),
      decideNeedsConsent: status === 'awaiting_approval' && !isSeller,
      pauseEntry: live && !!v.pauseEntry,
    };
  }
  private async isWinner(tenantId: string, winningBidId: string | null, userId: string): Promise<boolean> {
    if (!winningBidId) return false;
    return (await this.bids.bidderOfBidRead(tenantId, winningBidId)) === userId;
  }

  /* ------------------------------------------------------------------------------------------------------------ */
  /* MONEY                                                                                                         */
  /* ------------------------------------------------------------------------------------------------------------ */

  /** The settlement, inside the caller's tx (the close or the approval): the order (quantity × hammer), the losers' EMD
   *  back, the winner's EMD APPLIED to the order, the lot consumed, the settlement row written, `settled_order_id` set. */
  private async settleInTx(tx: TxContext, tenantId: string, a: Auction, win: WinningBid, now: Date): Promise<SettlementRow> {
    const p = a.toProps();
    const l = await this.listingOf(tenantId, p.listingId);
    const orderValue = a.lotValue(win.amountMinor);
    const order = await this.auctionOrders.createInTx(tx, {
      tenantId, auctionId: p.id, listingId: p.listingId, productId: l.productId, title: l.title, currencyCode: l.currencyCode ?? 'INR',
      sellerUserId: l.sellerUserId, buyerUserId: win.bidderUserId, quantity: p.quantity, unitCode: p.unitCode,
      unitPriceMinor: win.amountMinor, expectedLotValueMinor: orderValue, now,
    });
    a.attachOrder(order.orderId);
    await this.releaseEmd(tx, tenantId, a, win.bidderUserId);                       // losers back; the winner's hold stays
    const first = (await this.bids.firstBidAmounts(tx, tenantId, p.id)).find((f) => f.bidderUserId === win.bidderUserId);
    const emd = first ? a.emdForBid(first.firstAmountMinor) : 0n;
    const { applied, excess } = emdApplied(emd, orderValue);
    let applyTxn: string | null = null;
    if (applied > 0n) {
      applyTxn = (await this.wallet.post(tx, { tenantId, txnType: 'emd_apply', idempotencyKey: emdApplyKey(p.id), referenceType: 'order', referenceId: order.orderId, initiatedBy: SYSTEM,
        description: `auction ${p.auctionNo ?? p.id}: winner EMD applied to the order`,
        legs: [{ account: userHold(win.bidderUserId), amountMinor: -applied }, { account: platform(PlatformAccount.Escrow), amountMinor: applied }] })).txnId;
    }
    if (excess > 0n) {
      await this.wallet.post(tx, { tenantId, txnType: 'emd_hold', idempotencyKey: emdExcessKey(p.id), referenceType: 'auction', referenceId: p.id, initiatedBy: SYSTEM,
        legs: [{ account: userHold(win.bidderUserId), amountMinor: -excess }, { account: userMain(win.bidderUserId), amountMinor: excess }] });
    }
    await this.listings.consumeForAuctionInTx(tx, tenantId, p.listingId, Number(p.quantity));
    const row = {
      tenantId, auctionId: p.id, orderId: order.orderId, winnerUserId: win.bidderUserId, sellerUserId: l.sellerUserId,
      quantity: p.quantity, unitCode: p.unitCode, hammerUnitMinor: win.amountMinor, orderValueMinor: orderValue,
      emdAppliedMinor: applied, emdApplyTxnId: applyTxn, balanceDueMinor: orderValue - applied, balanceDueAt: new Date(now.getTime() + BALANCE_DUE_MS),
      collection: (order.requiresPayment ? 'online' : 'offline') as 'online' | 'offline', settledAt: now,
    };
    const id = await this.settlements.insert(tx, row);
    if (applied > 0n) {
      await this.outbox.write(tx, { tenantId, aggregateType: 'auction', aggregateId: p.id, eventType: AuctionEventType.EmdApplied,
        payload: { v: 1, auctionId: p.id, orderId: order.orderId, bidderUserId: win.bidderUserId, amountMinor: applied.toString() } });
    }
    return { ...row, id, outcome: 'open', outcomeAt: null, emdForfeitTxnId: null, emdReturnTxnId: null };
  }

  /** F-2 forfeit: the applied EMD to the seller, the auction defaulted, the listing restocked, audited. */
  private async forfeitInTx(tx: TxContext, tenantId: string, a: Auction, s: SettlementRow, now: Date, reason: string): Promise<void> {
    let forfeitTxn: string | null = null;
    if (s.emdAppliedMinor > 0n) {
      forfeitTxn = (await this.wallet.post(tx, { tenantId, txnType: 'emd_forfeit', idempotencyKey: emdForfeitKey(a.id), referenceType: 'order', referenceId: s.orderId, initiatedBy: SYSTEM,
        description: `auction ${a.toProps().auctionNo ?? a.id}: winner defaulted — EMD forfeited to the seller`,
        legs: [{ account: platform(PlatformAccount.Escrow), amountMinor: -s.emdAppliedMinor }, { account: userMain(s.sellerUserId), amountMinor: s.emdAppliedMinor }] })).txnId;
    }
    a.markDefaulted(now);
    if (!(await this.repo.update(tx, a))) throw new AuctionConcurrencyError(a.id);
    await this.settlements.recordOutcome(tx, tenantId, s.id, 'defaulted', { forfeit: forfeitTxn });
    await this.listings.restockInTx(tx, tenantId, a.listingId, Number(a.quantity));
    await this.repo.recordEvent(tx, tenantId, a.id, 'defaulted', { orderId: s.orderId });
    await this.audit.write(tx, { tenantId, actorUserId: null, action: 'auction.defaulted', entityType: 'auction', entityId: a.id, ip: null, reason,
      oldValue: { status: 'settled', settlement: 'open', balanceDueMinor: s.balanceDueMinor.toString(), balanceDueAt: s.balanceDueAt },
      newValue: { status: 'defaulted', emdForfeitedMinor: s.emdAppliedMinor.toString(), toSeller: s.sellerUserId, orderId: s.orderId, orderStatus: 'cancelled', listingStatus: 'published' } });
    const l: any = await this.listings.getById(tenantId, a.listingId);
    await this.flush(tx, tenantId, a.id, a.pullEvents(), { recipientUserIds: [s.winnerUserId, s.sellerUserId], title: l?.title ?? null, auctionNo: a.toProps().auctionNo, emdForfeitedMinor: s.emdAppliedMinor.toString() });
  }

  /** Return holds (Hold → Main) for every bidder EXCEPT `keepUserId` — idempotent per (auction, bidder). Returns the count. */
  private async releaseEmd(tx: TxContext, tenantId: string, a: Auction, keepUserId: string | null): Promise<number> {
    let n = 0;
    for (const f of await this.bids.firstBidAmounts(tx, tenantId, a.id)) {
      if (keepUserId && f.bidderUserId === keepUserId) continue;
      const emd = a.emdForBid(f.firstAmountMinor);
      if (emd <= 0n) continue;
      const r = await this.wallet.post(tx, { tenantId, txnType: 'emd_hold', idempotencyKey: emdReleaseKey(a.id, f.bidderUserId), referenceType: 'auction', referenceId: a.id, initiatedBy: SYSTEM,
        legs: [ { account: userHold(f.bidderUserId), amountMinor: -emd }, { account: userMain(f.bidderUserId), amountMinor: emd } ] });
      if (!r.alreadyApplied) {
        n++;
        await this.publisher.emdReleased(tx, tenantId, a.id, f.bidderUserId, emd);
      }
    }
    return n;
  }

  /** Staff never decide for the seller: the seller acts, or staff with auction.schedule_on_behalf record the seller's
   *  consent for THIS act (the consent row is written here, in the act's own transaction). Returns the consent id. */
  private async assertSellerDecision(tx: TxContext, tenantId: string, a: Auction, sellerUserId: string, actor: AuctionActor, act: 'approve' | 'decline', consent: ConsentInput | null): Promise<string | null> {
    if (actor.userId === sellerUserId) return null;
    if (!actor.onBehalf) throw new AuctionForbiddenError(`only the seller may ${act} — or the auction desk with the seller's recorded consent`);
    if (!consent) throw new AuctionConsentRequiredError(act === 'approve' ? 'approve the result' : 'decline the result');
    return this.settlements.recordConsent(tx, { tenantId, auctionId: a.id, sellerUserId, act, recordedBy: actor.userId, ...consent });
  }

  private async allBidderIds(tx: TxContext, tenantId: string, auctionId: string): Promise<string[]> {
    const r = await tx.query<{ bidder_user_id: string }>(`SELECT DISTINCT bidder_user_id FROM bids WHERE tenant_id=$1 AND auction_id=$2`, [tenantId, auctionId]);
    return r.rows.map((x) => x.bidder_user_id);
  }

  /** Outbox, in the tx. Outcome events carry who to tell (notification map, 0186 catalogue) and what to tell them. */
  private async flush(tx: TxContext, tenantId: string, auctionId: string, events: DomainEvent[], extra: Record<string, unknown> = {}) {
    for (const e of events) {
      let payload: Record<string, unknown> = { v: 1, ...e.payload };
      if (e.type === AuctionEventType.Cancelled || e.type === AuctionEventType.Defaulted) payload = { ...payload, ...extra };
      if (e.type === AuctionEventType.Won || e.type === AuctionEventType.FailedReserve || e.type === AuctionEventType.Lapsed) payload = { ...payload, ...(await this.outcomeFacts(tx, tenantId, auctionId, e.type)) };
      await this.outbox.write(tx, { tenantId, aggregateType: 'auction', aggregateId: auctionId, eventType: e.type, payload });
    }
  }
  private async outcomeFacts(tx: TxContext, tenantId: string, auctionId: string, type: string): Promise<Record<string, unknown>> {
    const r = await tx.query<{ auction_no: string; listing_id: string }>(`SELECT auction_no, listing_id FROM auctions WHERE tenant_id=$1 AND id=$2`, [tenantId, auctionId]);
    const l: any = r.rows[0] ? await this.listings.getById(tenantId, r.rows[0].listing_id) : null;
    const facts: Record<string, unknown> = { auctionNo: r.rows[0]?.auction_no ?? null, title: l?.title ?? null };
    if (type !== AuctionEventType.Won) facts.recipientUserIds = [...new Set([...(await this.allBidderIds(tx, tenantId, auctionId)), ...(l?.sellerUserId ? [l.sellerUserId] : [])])];
    return facts;
  }
}
