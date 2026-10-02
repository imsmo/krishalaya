// modules/auctions/repositories/bid.repository.ts
// All SQL for bids — APPEND-ONLY (DB grants revoke UPDATE/DELETE; history is physics). tenant_id in
// EVERY query (Law 1) + RLS. Reads used during the bid path run on the caller's tx (consistent with
// the FOR UPDATE lock on the auction row).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Bid } from '../domain/bid.entity';

export interface HighBid { id: string; amountMinor: bigint; bidderUserId: string; }
export interface BidderFirst { bidderUserId: string; firstAmountMinor: bigint; }

@Injectable()
export class BidRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, b: Bid): Promise<void> {
    const p = b.props;
    await tx.query(
      `INSERT INTO bids (id, tenant_id, auction_id, bidder_user_id, amount_minor, is_sealed, emd_txn_id, ip, device_fingerprint)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.id, p.tenantId, p.auctionId, p.bidderUserId, p.amountMinor.toString(), p.isSealed, p.emdTxnId, p.ip, p.deviceFingerprint]);
  }

  /** Current highest bid (read on the auction-lock tx for consistency). Null if no bids. */
  async highest(tx: TxContext, tenantId: string, auctionId: string): Promise<HighBid | null> {
    const r = await tx.query(`SELECT id, amount_minor, bidder_user_id FROM bids WHERE tenant_id=$1 AND auction_id=$2 ORDER BY amount_minor DESC, created_at ASC LIMIT 1`, [tenantId, auctionId]);
    return r.rows[0] ? { id: r.rows[0].id, amountMinor: BigInt(r.rows[0].amount_minor), bidderUserId: r.rows[0].bidder_user_id } : null;
  }

  /** The bidder's first bid's EMD hold txn for this auction (reused on subsequent bids; null if none). */
  async existingEmdTxn(tx: TxContext, tenantId: string, auctionId: string, bidderUserId: string): Promise<string | null> {
    const r = await tx.query<{ emd_txn_id: string }>(`SELECT emd_txn_id FROM bids WHERE tenant_id=$1 AND auction_id=$2 AND bidder_user_id=$3 AND emd_txn_id IS NOT NULL ORDER BY created_at ASC LIMIT 1`, [tenantId, auctionId, bidderUserId]);
    return r.rows[0]?.emd_txn_id ?? null;
  }

  async distinctBidderCount(tx: TxContext, tenantId: string, auctionId: string): Promise<number> {
    const r = await tx.query<{ n: string }>(`SELECT count(DISTINCT bidder_user_id)::text n FROM bids WHERE tenant_id=$1 AND auction_id=$2`, [tenantId, auctionId]);
    return Number(r.rows[0]?.n ?? 0);
  }

  /** One bid by id (the winning bid fixed at close is re-read by id at approval — bids are immutable). */
  async bidById(tx: TxContext, tenantId: string, bidId: string): Promise<HighBid | null> {
    const r = await tx.query(`SELECT id, amount_minor, bidder_user_id FROM bids WHERE tenant_id=$1 AND id=$2`, [tenantId, bidId]);
    return r.rows[0] ? { id: r.rows[0].id, amountMinor: BigInt(r.rows[0].amount_minor), bidderUserId: r.rows[0].bidder_user_id } : null;
  }

  /** The bidder who placed a given bid (e.g. the winning bid). Null if not found / cross-tenant. */
  async bidderOfBid(tx: TxContext, tenantId: string, bidId: string): Promise<string | null> {
    const r = await tx.query<{ bidder_user_id: string }>(`SELECT bidder_user_id FROM bids WHERE tenant_id=$1 AND id=$2`, [tenantId, bidId]);
    return r.rows[0]?.bidder_user_id ?? null;
  }

  /** Read-side twin of bidderOfBid (replica) — "is the viewer the winner?" on a GET. */
  async bidderOfBidRead(tenantId: string, bidId: string): Promise<string | null> {
    const r = await this.replica.forTenant(tenantId).query<{ bidder_user_id: string }>(`SELECT bidder_user_id FROM bids WHERE tenant_id=$1 AND id=$2`, [tenantId, bidId]);
    return r.rows[0]?.bidder_user_id ?? null;
  }

  /** Each distinct bidder's FIRST bid amount (drives the EMD amount to release at close). */
  async firstBidAmounts(tx: TxContext, tenantId: string, auctionId: string): Promise<BidderFirst[]> {
    const r = await tx.query(
      `SELECT DISTINCT ON (bidder_user_id) bidder_user_id, amount_minor
         FROM bids WHERE tenant_id=$1 AND auction_id=$2 AND emd_txn_id IS NOT NULL
         ORDER BY bidder_user_id, created_at ASC`, [tenantId, auctionId]);
    return r.rows.map((x) => ({ bidderUserId: x.bidder_user_id, firstAmountMinor: BigInt(x.amount_minor) }));
  }

  /** Has this user bid in this auction before? (A11: pause-entry lets existing bidders continue.) */
  async hasBid(tx: TxContext, tenantId: string, auctionId: string, bidderUserId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM bids WHERE tenant_id=$1 AND auction_id=$2 AND bidder_user_id=$3 LIMIT 1`, [tenantId, auctionId, bidderUserId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Every distinct bidder with their first bid, in order of entry — the B1…Bn labels are this order (stable per
   *  auction: a later bid never renumbers anyone). Read-side (replica). */
  async biddersInOrder(tenantId: string, auctionId: string): Promise<Array<{ bidderUserId: string; firstAmountMinor: bigint; firstAt: Date; bids: number; hasEmd: boolean }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT bidder_user_id, (array_agg(amount_minor ORDER BY created_at, id))[1] AS first_amount, min(created_at) AS first_at,
              count(*)::int AS n, bool_or(emd_txn_id IS NOT NULL) AS has_emd
         FROM bids WHERE tenant_id=$1 AND auction_id=$2 GROUP BY bidder_user_id ORDER BY min(created_at), bidder_user_id`, [tenantId, auctionId]);
    return r.rows.map((x) => ({ bidderUserId: x.bidder_user_id, firstAmountMinor: BigInt(x.first_amount), firstAt: x.first_at, bids: Number(x.n), hasEmd: x.has_emd === true }));
  }

  /** W137 row facts for a page of auctions: the current high bid (per unit) and the distinct bidder count. */
  async statsFor(tenantId: string, auctionIds: string[]): Promise<Map<string, { highMinor: bigint | null; bidders: number }>> {
    const out = new Map<string, { highMinor: bigint | null; bidders: number }>();
    if (auctionIds.length === 0) return out;
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT auction_id, max(amount_minor)::text AS high, count(DISTINCT bidder_user_id)::int AS bidders
         FROM bids WHERE tenant_id=$1 AND auction_id = ANY($2::uuid[]) GROUP BY auction_id`, [tenantId, auctionIds]);
    for (const x of r.rows) out.set(x.auction_id, { highMinor: x.high == null ? null : BigInt(x.high), bidders: Number(x.bidders) });
    return out;
  }

  /** The caller's OWN bids across ALL auctions ("my bids"), newest-first µs keyset (F-25). Joins the auction so the
   *  read-model can show status/ends + compute the EMD hold per bid (per LOT — the auction's quantity travels). Always
   *  filtered by the caller's bidder_user_id (owner-scoped, no IDOR). */
  async listForBidder(tenantId: string, bidderUserId: string, opts: { cursor?: { c: string; id: string }; limit: number }): Promise<Array<{ id: string; auctionId: string; listingId: string; amountMinor: string; createdAt: Date; createdAtRaw: string; auctionStatus: string; endsAt: Date; emdMinor: string; emdPctBps: number | null; winningBidId: string | null; quantity: string; unitCode: string; firstAmountMinor: string }>> {
    const params: unknown[] = [tenantId, bidderUserId];
    let where = `b.tenant_id=$1 AND b.bidder_user_id=$2`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (opts.cursor) { const cc = p(opts.cursor.c), ci = p(opts.cursor.id); where += ` AND (b.created_at < ${cc}::timestamptz OR (b.created_at = ${cc}::timestamptz AND b.id < ${ci}::uuid))`; }
    const lp = p(opts.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT b.id, b.auction_id, b.amount_minor, b.created_at, b.created_at::text AS created_at_raw,
              a.listing_id, a.status AS auction_status, a.ends_at, a.emd_minor, a.emd_pct_bps, a.winning_bid_id, a.quantity::text AS quantity, a.unit_code,
              (SELECT f.amount_minor FROM bids f WHERE f.tenant_id=b.tenant_id AND f.auction_id=b.auction_id AND f.bidder_user_id=b.bidder_user_id
                ORDER BY f.created_at, f.id LIMIT 1) AS first_amount
         FROM bids b JOIN auctions a ON a.id = b.auction_id AND a.tenant_id = b.tenant_id
        WHERE ${where} ORDER BY b.created_at DESC, b.id DESC LIMIT ${lp}`, params);
    return r.rows.map((x) => ({ id: x.id, auctionId: x.auction_id, listingId: x.listing_id, amountMinor: String(x.amount_minor), createdAt: x.created_at, createdAtRaw: x.created_at_raw,
      auctionStatus: x.auction_status, endsAt: x.ends_at, emdMinor: String(x.emd_minor), emdPctBps: x.emd_pct_bps ?? null, winningBidId: x.winning_bid_id ?? null,
      quantity: String(x.quantity), unitCode: x.unit_code, firstAmountMinor: String(x.first_amount) }));
  }

  /** Bid history for an auction, µs keyset (F-25). Identities are masked by the read-model; sealed amounts too. */
  async listFor(tenantId: string, auctionId: string, opts: { cursor?: { c: string; id: string }; limit: number }): Promise<Array<{ id: string; bidderUserId: string; amountMinor: string; createdAt: Date; createdAtRaw: string }>> {
    const params: unknown[] = [tenantId, auctionId];
    let where = `tenant_id=$1 AND auction_id=$2`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (opts.cursor) { const cc = p(opts.cursor.c), ci = p(opts.cursor.id); where += ` AND (created_at < ${cc}::timestamptz OR (created_at = ${cc}::timestamptz AND id < ${ci}::uuid))`; }
    const lp = p(opts.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT id, bidder_user_id, amount_minor, created_at, created_at::text AS created_at_raw FROM bids WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map((x) => ({ id: x.id, bidderUserId: x.bidder_user_id, amountMinor: String(x.amount_minor), createdAt: x.created_at, createdAtRaw: x.created_at_raw }));
  }
}
