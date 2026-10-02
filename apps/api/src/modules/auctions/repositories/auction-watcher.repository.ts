// modules/auctions/repositories/auction-watcher.repository.ts
// SQL for auction_watchers (a user's watch-list). The table has NO tenant_id — it is reachable ONLY
// through auctions(id), which IS tenant-scoped + RLS-protected; so every read JOINs auctions and
// filters by auctions.tenant_id (the auction is also resolved within the tenant before a write).
// Writes run in the caller's tx; reads on the replica, keyset-paginated + bounded.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { AuctionWatcher } from '../domain/auction-watcher.entity';

export interface WatchedRow { auctionId: string; status: string; endsAt: Date; createdAt: Date; createdAtRaw: string; }

@Injectable()
export class AuctionWatcherRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Idempotent watch (composite PK (auction_id, user_id) → ON CONFLICT DO NOTHING). */
  async watch(tx: TxContext, w: AuctionWatcher): Promise<void> {
    await tx.query(`INSERT INTO auction_watchers (auction_id, user_id) VALUES ($1,$2) ON CONFLICT (auction_id, user_id) DO NOTHING`, [w.props.auctionId, w.props.userId]);
  }
  /** F-21: kv_app holds DELETE on auction_watchers since 0186 (it did not, so every unwatch was a 42501 → 500). */
  async unwatch(tx: TxContext, auctionId: string, userId: string): Promise<boolean> {
    const r = await tx.query(`DELETE FROM auction_watchers WHERE auction_id=$1 AND user_id=$2`, [auctionId, userId]);
    return (r.rowCount ?? 0) > 0;
  }
  async isWatching(tenantId: string, auctionId: string, userId: string): Promise<boolean> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT 1 FROM auction_watchers w JOIN auctions a ON a.id=w.auction_id AND a.tenant_id=$1 WHERE w.auction_id=$2 AND w.user_id=$3`,
      [tenantId, auctionId, userId]);
    return (r.rowCount ?? 0) > 0;
  }
  /** The user ids watching an auction — read INSIDE the caller's tx (the auction is already resolved + locked in
   *  this tenant) so the fanout commits atomically with the close. BOUNDED by `cap` to bound write amplification
   *  (a notification per watcher); a hugely-watched auction is capped, never unbounded. JOINs auctions on
   *  tenant_id (the table has no tenant_id of its own) — no cross-tenant leakage. */
  async listWatcherUserIds(tx: TxContext, tenantId: string, auctionId: string, cap = 5000): Promise<string[]> {
    const r = await tx.query<{ user_id: string }>(
      `SELECT w.user_id FROM auction_watchers w JOIN auctions a ON a.id=w.auction_id AND a.tenant_id=$1
        WHERE w.auction_id=$2 ORDER BY w.user_id LIMIT $3`, [tenantId, auctionId, cap]);
    return r.rows.map((x) => x.user_id);
  }

  async countForAuction(tenantId: string, auctionId: string): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query<{ n: string }>(
      `SELECT count(*)::text n FROM auction_watchers w JOIN auctions a ON a.id=w.auction_id AND a.tenant_id=$1 WHERE w.auction_id=$2`, [tenantId, auctionId]);
    return Number(r.rows[0]?.n ?? 0);
  }

  /** The caller's watched auctions (with live status/ends_at), keyset-paginated + bounded. */
  async listForUser(tenantId: string, userId: string, opts: { cursor?: { c: string; id: string }; limit: number }): Promise<WatchedRow[]> {
    const params: unknown[] = [tenantId, userId];
    let where = `a.tenant_id=$1 AND w.user_id=$2`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (opts.cursor) { const cc = p(opts.cursor.c), ci = p(opts.cursor.id); where += ` AND (w.created_at < ${cc}::timestamptz OR (w.created_at = ${cc}::timestamptz AND w.auction_id < ${ci}::uuid))`; }
    const lp = p(opts.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT w.auction_id, a.status, a.ends_at, w.created_at, w.created_at::text AS created_at_raw
         FROM auction_watchers w JOIN auctions a ON a.id=w.auction_id AND a.tenant_id=$1
        WHERE ${where} ORDER BY w.created_at DESC, w.auction_id DESC LIMIT ${lp}`, params);
    return r.rows.map((x) => ({ auctionId: x.auction_id, status: x.status, endsAt: x.ends_at, createdAt: x.created_at, createdAtRaw: x.created_at_raw }));
  }
}
