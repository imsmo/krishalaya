// modules/offers/repositories/listing-offer.repository.ts
// All SQL for the listing_offers aggregate. tenant_id in EVERY query (Law 1) + RLS (migration 0020
// backfills the tenant policy for listing_offers). listing_offers has NO version column
// (add_std_columns only adds created/updated/deleted_at) — so mutations LOCK the offer row with
// SELECT … FOR UPDATE (the negotiation is low-contention; the row lock serializes counter/accept/
// reject without an optimistic version). Reads go to the replica; the expiry job uses SKIP LOCKED.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { US_SQL } from '../../../shared/pagination/us-keyset';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { ListingOffer, ListingOfferProps } from '../domain/listing-offer.entity';
import { OfferStatus } from '../domain/listing-offer.state';
import { OfferParty } from '../domain/offers.events';
import { OfferClock, hoursOf, OFFER_ROUND_TTL_FALLBACK_H, OFFER_MAX_LIFE_FALLBACK_H } from '../domain/offer-clock';
import { OfferRoundView, RoundAct, RoundParty, OFFER_COUNT_KEYS, OfferCounts } from '../domain/offer-read';

// PC-56 HOTFIX-5 · B4 (Rule Zero, survey F-8): `listing_offers` has NO currency column (0015) — an offer is priced in its LISTING's currency,
// projected here (read-only, never written) so every offer read says which currency its minor units are in.
const COLS = `id, tenant_id, listing_id, buyer_user_id, quantity, offered_price_minor,
  counter_price_minor, round, status, expires_at, converted_order_id, created_at,
  (SELECT l.currency_code FROM listings l WHERE l.id = listing_offers.listing_id AND l.tenant_id = listing_offers.tenant_id) AS currency_code,
  decline_reason_code, declined_by, ${US_SQL('created_at')} AS created_at_us`;
// PC-56 STORE-3b · B4 / B8 (0211): + the decline reason and its side; + `created_at` as the database printed it (µs) for the keyset cursor.
const big = (v: any) => (v == null ? null : BigInt(v));
function toDomain(r: any): ListingOffer {
  return ListingOffer.rehydrate({
    id: r.id, tenantId: r.tenant_id, listingId: r.listing_id, buyerUserId: r.buyer_user_id,
    quantity: String(r.quantity), offeredPriceMinor: BigInt(r.offered_price_minor), counterPriceMinor: big(r.counter_price_minor),
    round: r.round, status: r.status as OfferStatus, expiresAt: r.expires_at,
    convertedOrderId: r.converted_order_id, createdAt: r.created_at,
    currencyCode: r.currency_code != null ? String(r.currency_code).trim() : null,
    declineReasonCode: r.decline_reason_code ?? null, declinedBy: (r.declined_by ?? null) as OfferParty | null, createdAtUs: r.created_at_us ?? null,
  });
}

/** PC-56 STORE-3b · B8 (survey F-20): the cursor is `{ ts, id }` with `ts` the MICROSECOND instant the database printed (us-keyset.ts) — compared
 *  as timestamptz in SQL, never through a millisecond Date (two offers written in one millisecond both page). */
export interface OfferListQuery { status?: string; cursor?: { ts: string; id: string }; limit: number; }

@Injectable()
export class ListingOfferRepository {
  private readonly log = new Logger(ListingOfferRepository.name);
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
         status=$7, converted_order_id=$8, expires_at=$9, decline_reason_code=$10, declined_by=$11, updated_at=now()
        WHERE id=$1 AND tenant_id=$2`,
      [p.id, p.tenantId, p.quantity, p.offeredPriceMinor.toString(), p.counterPriceMinor?.toString() ?? null,
       p.round, p.status, p.convertedOrderId, p.expiresAt, p.declineReasonCode ?? null, p.declinedBy ?? null]);
    // PC-56 STORE-3b: + expires_at (founder D1 — a counter resets the round's clock) and the decline reason + its side (D3).
  }

  /** Offers the buyer (ctx.userId) made. Keyset pagination (created_at DESC, id DESC) — never OFFSET. */
  async listForBuyer(tenantId: string, buyerUserId: string, q: OfferListQuery): Promise<ListingOffer[]> {
    const params: unknown[] = [tenantId, buyerUserId];
    let where = `tenant_id=$1 AND buyer_user_id=$2`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.ts), ci = p(q.cursor.id); where += ` AND (created_at, id) < (${cc}::timestamptz, ${ci}::uuid)`; }
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
    if (q.cursor) { const cc = p(q.cursor.ts), ci = p(q.cursor.id); where += ` AND (created_at, id) < (${cc}::timestamptz, ${ci}::uuid)`; }
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

  // ---- PC-56 STORE-3b -------------------------------------------------------------------------------------------------------------------

  /** B1 (founder D1, 0211) — the offer clock from the two platform settings (`kv_platform_setting`, the 0209 precedent). An absent / malformed
   *  setting falls back to its NAMED compile-time constant and says so in the log (never a silent literal). In the caller's tx when given. */
  async clock(tenantId: string, tx?: TxContext): Promise<OfferClock> {
    const sql = `SELECT (kv_platform_setting('offers.round_ttl_hours') #>> '{}') AS ttl, (kv_platform_setting('offers.max_life_hours') #>> '{}') AS life`;
    const r = tx ? await tx.query<{ ttl: string | null; life: string | null }>(sql) : await this.replica.forTenant(tenantId).query<{ ttl: string | null; life: string | null }>(sql);
    const ttl = hoursOf(r.rows[0]?.ttl); const life = hoursOf(r.rows[0]?.life);
    if (ttl === null) this.log.warn(`offers.round_ttl_hours is absent or malformed — using OFFER_ROUND_TTL_FALLBACK_H (${OFFER_ROUND_TTL_FALLBACK_H})`);
    if (life === null) this.log.warn(`offers.max_life_hours is absent or malformed — using OFFER_MAX_LIFE_FALLBACK_H (${OFFER_MAX_LIFE_FALLBACK_H})`);
    return { roundTtlHours: ttl ?? OFFER_ROUND_TTL_FALLBACK_H, maxLifeHours: life ?? OFFER_MAX_LIFE_FALLBACK_H };
  }

  /** B4 (founder D3, 0211) — one row of the negotiation's history, in the ACT's transaction (append-only: kv_app holds SELECT + INSERT). */
  async insertRound(tx: TxContext, r: { tenantId: string; offerId: string; round: number; party: RoundParty; act: RoundAct; priceMinor: bigint | null }): Promise<void> {
    await tx.query(`INSERT INTO listing_offer_rounds (tenant_id, offer_id, round, party, act, price_minor) VALUES ($1,$2,$3,$4,$5,$6)`,
      [r.tenantId, r.offerId, r.round, r.party, r.act, r.priceMinor?.toString() ?? null]);
  }

  /** The stored rounds of a PAGE of offers in one read, each offer's in order (round, then the instant, then the v7 id). */
  async roundsFor(tenantId: string, offerIds: readonly string[], tx?: TxContext): Promise<Map<string, OfferRoundView[]>> {
    const out = new Map<string, OfferRoundView[]>();
    if (offerIds.length === 0) return out;
    const sql = `SELECT offer_id, round, party, act, price_minor::text AS price, ${US_SQL('created_at')} AS at FROM listing_offer_rounds
      WHERE tenant_id=$1 AND offer_id = ANY($2::uuid[]) ORDER BY offer_id, created_at, id`;
    const r = tx ? await tx.query(sql, [tenantId, [...offerIds]]) : await this.replica.forTenant(tenantId).query(sql, [tenantId, [...offerIds]]);
    for (const x of r.rows as Array<{ offer_id: string; round: number; party: RoundParty; act: RoundAct; price: string | null; at: string }>) {
      const list = out.get(x.offer_id) ?? [];
      list.push({ round: Number(x.round), party: x.party, act: x.act, priceMinor: x.price, at: x.at });
      out.set(x.offer_id, list);
    }
    return out;
  }

  /** B4 (founder D3) — is `code` an ACTIVE platform value of `offer_decline_reason` (0211)? Read in the decline's own transaction. */
  async declineReasonActiveTx(tx: TxContext, code: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM lookup_values WHERE type_code = 'offer_decline_reason' AND tenant_id IS NULL AND code = $1 AND is_active = true LIMIT 1`, [code]);
    return (r.rowCount ?? 0) > 0;
  }

  /** B7 (survey B18, Law 11) — the buyer's OWN offers in this organisation, counted per status and in all, each bounded (`LIMIT cap + 1`). */
  async countsForBuyer(tenantId: string, buyerUserId: string, cap: number): Promise<OfferCounts> {
    const db = this.replica.forTenant(tenantId);
    const rows = await Promise.all(OFFER_COUNT_KEYS.map(async (k) => {
      const r = k === 'all'
        ? await db.query<{ n: number }>(`SELECT count(*)::int n FROM (SELECT 1 FROM listing_offers WHERE tenant_id=$1 AND buyer_user_id=$2 LIMIT $3) x`, [tenantId, buyerUserId, cap + 1])
        : await db.query<{ n: number }>(`SELECT count(*)::int n FROM (SELECT 1 FROM listing_offers WHERE tenant_id=$1 AND buyer_user_id=$2 AND status=$3 LIMIT $4) x`, [tenantId, buyerUserId, k, cap + 1]);
      const n = Number(r.rows[0]?.n ?? 0);
      return [k, { count: Math.min(n, cap), capped: n > cap }] as const;
    }));
    return Object.fromEntries(rows) as OfferCounts;
  }

  /** B6 — the ORGANISATION an offer is with: the offer's tenant (slug + display name — the 3a `organisationOf` shape). Never a person. */
  async organisationOf(tenantId: string): Promise<{ slug: string; name: string } | null> {
    const r = await this.replica.forTenant(tenantId).query<{ slug: string | null; display_name: string | null }>(`SELECT slug, display_name FROM tenants WHERE id = $1`, [tenantId]);
    const x = r.rows[0];
    return x?.slug && x.display_name ? { slug: x.slug, name: x.display_name } : null;
  }

  /** B6 — the status of each converted offer's order, ONE read for a page, scoped to THIS buyer's orders (a seller's / moderator's view passes
   *  no buyer and gets none — the console has its own order reads). Read-only; `orders` is reached here the way HOTFIX-5 reached `listings`
   *  for the currency (a projection, never a write). Partition-pruned by each id's v7 time. */
  async orderStatusesForBuyer(tenantId: string, buyerUserId: string, orderIds: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (orderIds.length === 0) return out;
    const r = await this.replica.forTenant(tenantId).query<{ id: string; status: string }>(
      `SELECT o.id, o.status::text AS status FROM unnest($3::uuid[]) AS w(id)
         JOIN orders o ON o.id = w.id AND o.tenant_id = $1 AND o.buyer_user_id = $2
                      AND o.created_at >= uuid_v7_time(w.id) - interval '5 seconds' AND o.created_at < uuid_v7_time(w.id) + interval '5 seconds'`,
      [tenantId, buyerUserId, [...orderIds]]);
    for (const x of r.rows) out.set(x.id, x.status);
    return out;
  }
}
