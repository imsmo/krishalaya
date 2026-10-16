// modules/auctions/read-models/my-bids.read-model.ts
// Read-side (replica, CQRS): the caller's OWN auctions ("my bids"), newest activity first, keyset. Always scoped to the caller's userId (no
// IDOR). Money is bigint minor-unit strings (Law 2). No mutations.
//
// PC-56 STORE-3c · B3 (survey B20 / C-8) — what was true: ONE ROW PER BID, and the "EMD held" figure was the RULE (`emdForLot`) recomputed from
// the first bid — a deposit released at close, applied to the order, forfeited to the seller or returned to the winner still read as the same
// "held" amount. What is true now:
//   • ONE ROW PER AUCTION the caller bid in (their best bid, its time, how many bids), newest activity first — µs keyset on (last bid at, id);
//   • the lot as the public read shows it (title, quantity + unit, the ORGANISATION, the lot's currency + exponent), the status, kind, end,
//     `sealedHidden`, the current bid (null while a sealed auction hides it) and the SERVER's minimum next bid, `leading` / `outbid` exactly as
//     `auction-public.read-model.ts` computes them, `won` (the caller is the settlement's winner);
//   • `emd` — the DEPOSIT AS THE LEDGER HAS IT, read by its idempotency keys through the payments module's public read
//     (`PaymentService.ledgerTxnsByKeys`): `emd:<a>:<me>` (held) · `emd-release:<a>:<me>` (released) · and, for the winner only,
//     `emd-apply:<a>` (applied) · `emd-forfeit:<a>` (forfeited) · `emd-return:<a>` / `emd-return:<orderId>` (returned) — each with its amount and
//     time (`emdLedgerState`, pure, below). The RULE value is served separately as `emdRule` ("the deposit this auction asks");
//   • `settlement` for the winner only: the order, its value, the EMD applied, the balance and its due time (the settlement's — 48 h), the
//     outcome, the collection, and `amountDueMinor` LIVE from `PaymentService.amountDueForOrder` (total − the deposit applied in escrow — the
//     ONE rule the pay step, the wallet pay and the capture re-check use);
//   • ONE bounded batch per page: the auctions, the listings, the organisation, the bid stats, the settlements and the ledger are each one query.
// The old per-bid fields stay on each row (filled from the caller's BEST bid) for the mobile app's buckets (`bidId`, `listingId`, `amountMinor`,
// `auctionStatus`, `isWinning`, `createdAt`); `emdHeldMinor` is now the LEDGER's held amount ('0' when not held), never the rule.
import { Inject, Injectable } from '@nestjs/common';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { ListingService } from '../../listings/services/listing.service';
import { PaymentService } from '../../payments/services/payment.service';
import { BidRepository } from '../repositories/bid.repository';
import { AuctionRepository } from '../repositories/auction.repository';
import { AuctionSettlementRepository, SettlementRow } from '../repositories/auction-settlement.repository';
import { emdForLot, emdApplyKey, emdForfeitKey, emdHoldKey, emdPaidCancelReturnKey, emdReleaseKey, emdReturnKey } from '../domain/lot';
import { encodeCursor } from '../domain/cursor';

/** PURE: the EMD a bidder's FIRST bid asks of them — PC-56 TENANT-11a F-27b: the SAME rule the entity charges (domain/lot.ts `emdForLot`): the
 *  flat `emd_minor` FIRST, else `emd_pct_bps` of the LOT value of the bidder's FIRST bid. A RULE value ("the deposit this auction asks") — never
 *  what the ledger holds (STORE-3c: `emdLedgerState`). `quantity` defaults to one unit for callers that predate the lot. Exported for unit tests. */
export function emdHeldMinor(firstAmountMinor: bigint, emdMinor: bigint, emdPctBps: number | null, quantity = '1'): bigint {
  return emdForLot(firstAmountMinor, quantity, emdMinor, emdPctBps);
}

export type EmdState = 'held' | 'released' | 'applied' | 'forfeited' | 'returned' | 'none';
export interface LedgerFact { at: Date; amountMinor: bigint }
export interface EmdLedgerFacts { hold?: LedgerFact; release?: LedgerFact; apply?: LedgerFact; forfeit?: LedgerFact; returned?: LedgerFact }
export interface EmdView { state: EmdState; amountMinor: string; at: string | null }

/** PURE (STORE-3c · B3, C-8): the deposit's state FROM THE LEDGER — the latest fact wins, in the order the money can move: held (Main → Hold at
 *  the first bid) → released (Hold → Main at close, a loser / a lapse / a cancel) or applied (Hold → Escrow at settlement, the winner) → forfeited
 *  (Escrow → the seller) or returned (Escrow → the winner). No txn at all → `none` (the auction asked no deposit, or the bid never held one). */
export function emdLedgerState(f: EmdLedgerFacts): EmdView {
  const pick = (state: EmdState, x: LedgerFact): EmdView => ({ state, amountMinor: x.amountMinor.toString(), at: x.at.toISOString() });
  if (f.returned) return pick('returned', f.returned);
  if (f.forfeit) return pick('forfeited', f.forfeit);
  if (f.apply) return pick('applied', f.apply);
  if (f.release) return pick('released', f.release);
  if (f.hold) return pick('held', f.hold);
  return { state: 'none', amountMinor: '0', at: null };
}

const OPEN_STATES = ['scheduled', 'live', 'extended'];

@Injectable()
export class MyBidsReadModel {
  constructor(
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly bids: BidRepository,
    private readonly auctions: AuctionRepository,
    private readonly settlements: AuctionSettlementRepository,
    private readonly payments: PaymentService,
    private readonly listings: ListingService,
  ) {}

  async forBidder(tenantId: string, bidderUserId: string, opts: { cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.bids.auctionsForBidder(tenantId, bidderUserId, opts);
    const ids = rows.map((r) => r.auctionId);
    const auctions = await this.auctions.getVisibleMany(tenantId, ids);
    const listingIds = [...auctions.values()].map((a) => a.listingId);
    const [lots, facts, stats, won] = await Promise.all([
      this.auctions.listingFactsFor(tenantId, listingIds),
      this.listings.purchaseFacts(tenantId, listingIds),
      this.bids.statsFor(tenantId, ids),
      this.settlements.forWinner(tenantId, bidderUserId, ids),
    ]);
    // the ledger, by key — ONE query for the page
    const keys: string[] = [];
    for (const id of ids) {
      keys.push(emdHoldKey(id, bidderUserId), emdReleaseKey(id, bidderUserId));
      const s = won.get(id);
      if (s) keys.push(emdApplyKey(id), emdForfeitKey(id), emdReturnKey(id), emdPaidCancelReturnKey(s.orderId));
    }
    const ledger = await this.payments.ledgerTxnsByKeys(tenantId, keys);
    const dues = new Map<string, string>();
    for (const s of won.values()) dues.set(s.auctionId, (await this.payments.amountDueForOrder(tenantId, s.orderId, s.orderValueMinor)).dueMinor.toString());

    const items: Array<Record<string, unknown> & { auctionId: string; currencyCode: string | null }> = [];
    for (const r of rows) {
      const a = auctions.get(r.auctionId);
      if (!a) continue;
      const p = a.toProps();
      const lot = lots.get(p.listingId);
      const org = facts?.get(p.listingId)?.organisation ?? null;
      const isOpen = OPEN_STATES.includes(p.status);
      const sealedHidden = p.kind === 'sealed' && isOpen;
      const st = stats.get(p.id) ?? { highMinor: null, bidders: 0 };
      const high = sealedHidden ? null : st.highMinor;
      const leading = !sealedHidden && isOpen && high !== null && r.bestMinor === high;
      const s = won.get(p.id) ?? null;
      const emd = emdLedgerState({
        hold: ledger.get(emdHoldKey(p.id, bidderUserId)), release: ledger.get(emdReleaseKey(p.id, bidderUserId)),
        apply: s ? ledger.get(emdApplyKey(p.id)) : undefined, forfeit: s ? ledger.get(emdForfeitKey(p.id)) : undefined,
        returned: s ? (ledger.get(emdPaidCancelReturnKey(s.orderId)) ?? ledger.get(emdReturnKey(p.id))) : undefined,
      });
      items.push({
        auctionId: p.id, auctionNo: p.auctionNo, listingTitle: lot?.title ?? null, quantity: p.quantity, unitCode: p.unitCode, organisation: org,
        currencyCode: lot?.currencyCode ?? null, exponent: lot?.exponent ?? null,
        status: p.status, kind: p.kind, endsAt: p.endsAt, decisionDueAt: p.decisionDueAt, isOpen, sealedHidden,
        currentBidMinor: high !== null ? high.toString() : null, minNextBidMinor: a.minNextBidMinor(high).toString(),
        myBestMinor: r.bestMinor.toString(), myBestAt: r.bestAt, myBidCount: r.bidCount,
        leading, outbid: isOpen && !sealedHidden && !leading, won: s !== null,
        emd, emdRule: { flatMinor: p.emdMinor > 0n ? p.emdMinor.toString() : null, pctBps: p.emdMinor > 0n ? null : (p.emdPctBps ?? null) },
        settlement: s ? this.settlementView(s, dues.get(p.id) ?? null) : null,
        // the old per-bid fields (mobile's buckets) — from the caller's BEST bid; `emdHeldMinor` is the LEDGER's held amount
        bidId: r.bestBidId, listingId: p.listingId, amountMinor: r.bestMinor.toString(), emdHeldMinor: emd.state === 'held' ? emd.amountMinor : '0',
        auctionStatus: p.status, isWinning: p.winningBidId != null && p.winningBidId === r.bestBidId, createdAt: r.lastAt,
      });
    }
    const last = rows[rows.length - 1];
    this.metrics.inc('auctions.my_bids', { tenant: tenantId });
    return { items, nextCursor: rows.length === opts.limit && last ? encodeCursor(last.lastAtRaw, last.auctionId) : null };
  }

  private settlementView(s: SettlementRow, amountDueMinor: string | null) {
    return { orderId: s.orderId, outcome: s.outcome, collection: s.collection, orderValueMinor: s.orderValueMinor.toString(), emdAppliedMinor: s.emdAppliedMinor.toString(),
      balanceDueMinor: s.balanceDueMinor.toString(), balanceDueAt: s.balanceDueAt, amountDueMinor, outcomeAt: s.outcomeAt };
  }
}
