// modules/offers/repositories/listing-offer.repository.ts
// All SQL for the listing_offers aggregate. tenant_id in EVERY query (Law 1) + RLS (migration 0020
// backfills the tenant policy for listing_offers). listing_offers has NO version column
// (add_std_columns only adds created/updated/deleted_at) — so mutations LOCK the offer row with
// SELECT … FOR UPDATE (the negotiation is low-contention; the row lock serializes counter/accept/
// reject without an optimistic version). Reads go to the replica; the expiry job uses SKIP LOCKED.
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { ListingOffer, ListingOfferProps } from '../domain/listing-offer.entity';
import { OfferStatus } from '../domain/listing-offer.state';

// PC-56 HOTFIX-5 · B4 (Rule Zero, survey F-8): `listing_offers` has NO currency column (0015) — an offer is priced in its LISTING's currency,
// projected here (read-only, never written) so every offer read says which currency its minor units are in.
const COLS = `id, tenant_id, listing_id, buyer_user_id, quantity, offered_price_minor,
  counter_price_minor, round, status, expires_at, converted_order_id, created_at,
  (SELECT l.currency_code FROM listings l WHERE l.id = listing_offers.listing_id AND l.tenant_id = listing_offers.tenant_id) AS currency_code`;
const big = (v: any) => (v == null ? null : BigInt(v));
function toDomain(r: any): ListingOffer {
  return ListingOffer.rehydrate({
    id: r.id, tenantId: r.tenant_id, listingId: r.listing_id, buyerUserId: r.buyer_user_id,
    quantity: String(r.quantity), offeredPriceMinor: BigInt(r.offered_price_minor), counterPriceMinor: big(r.counter_price_minor),
    round: r.round, status: r.status as OfferStatus, expiresAt: r.expires_at,
    convertedOrderId: r.converted_order_id, createdAt: r.created_at,
    currencyCode: r.currency_code != null ? String(r.currency_code).trim() : null,
  });
}

export interface OfferListQuery { status?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class ListingOfferRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, o: ListingOffer): Promise<void> {
    const p = o.toProps();
    await tx.query(
      `INSERT INTO listing_offers (id, tenant_id, listing_id, buyer_user_id, quantity, offered_price_minor,
         counter_price_minor, round, status, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [p.id, p.tenantId, p.listingId, p.buyerUserId, p.quantity, p.offeredPriceMinor.toString(),
       p.counterPriceMinor?.toString() ?? null, p.round, p.status, p.expiresAt]);
  }

  /** Lock the offer row for a counter/accept/reject/expire (serializes concurrent negotiation acts). */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<ListingOffer | null> {
    const r = await tx.query(`SELECT ${COLS} FROM listing_offers WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Single-offer read (the service authorizes that the caller is buyer/seller/moderator). */
  async getById(tenantId: string, id: string): Promise<ListingOffer | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM listing_offers WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** No version column → update is unconditional within the FOR UPDATE-locked tx. */
  async update(tx: TxContext, o: ListingOffer): Promise<void> {
    const p = o.toProps();
    await tx.query(
      `UPDATE listing_offers SET quantity=$3, offered_price_minor=$4, counter_price_minor=$5, round=$6,
         status=$7, converted_order_id=$8, updated_at=now()
        WHERE id=$1 AND tenant_id=$2`,
      [p.id, p.tenantId, p.quantity, p.offeredPriceMinor.toString(), p.counterPriceMinor?.toString() ?? null,
       p.round, p.status, p.convertedOrderId]);
  }

  /** Offers the buyer (ctx.userId) made. Keyset pagination (created_at DESC, id DESC) — never OFFSET. */
  async listForBuyer(tenantId: string, buyerUserId: string, q: OfferListQuery): Promise<ListingOffer[]> {
    const params: unknown[] = [tenantId, buyerUserId];
    let where = `tenant_id=$1 AND buyer_user_id=$2`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM listing_offers WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /** Offers on a given listing (the service verifies the caller owns the listing or is a moderator). */
  async listForListing(tenantId: string, listingId: string, q: OfferListQuery): Promise<ListingOffer[]> {
    const params: unknown[] = [tenantId, listingId];
    let where = `tenant_id=$1 AND listing_id=$2`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM listing_offers WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /** PC-56 HOTFIX-5 · B1 — the expiry clock's claim, PER TENANT in the caller's kv_app tx (RLS): open / countered offers past expires_at.
   *  Ids only, bounded, SKIP LOCKED; the act re-locks and re-checks each row. (The old cross-tenant finder ran as kv_relay, which holds no
   *  grant on listing_offers — removed.) */
  async dueToExpire(tx: TxContext, tenantId: string, now: Date, limit: number): Promise<string[]> {
    const r = await tx.query<{ id: string }>(
      `SELECT id FROM listing_offers WHERE tenant_id=$1 AND status IN ('open','countered') AND expires_at <= $2
        ORDER BY expires_at LIMIT $3 FOR UPDATE SKIP LOCKED`, [tenantId, now, limit]);
    return r.rows.map((x) => x.id);
  }
  /** The tenants the expiry clock visits, on the runner's kv_relay pool — `tenants` only (granted; kv_relay holds nothing on listing_offers). */
  async liveTenants(pool: Pool): Promise<string[]> {
    const r = await pool.query<{ id: string }>(`SELECT id FROM tenants WHERE deleted_at IS NULL ORDER BY id`);
    return r.rows.map((x) => x.id);
  }
}
