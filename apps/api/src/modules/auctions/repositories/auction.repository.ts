// modules/auctions/repositories/auction.repository.ts
// All SQL for the auctions aggregate. tenant_id in EVERY query (Law 1) + RLS. The bid path locks the
// auction row (SELECT … FOR UPDATE) so concurrent bids serialize; other writes use the version
// optimistic lock. Reads on the replica; writes in the caller's tx.
//
// PC-56 TENANT-11a: the lot (`quantity`, `unit_code`), the number (`auction_no`, assigned by the 0186 trigger and read
// back with RETURNING), the decision clock, pause-entry and the lifecycle stamps; µs cursors (`created_at::text`, F-25);
// grouped tab filters + counts (W137); and the cadence claims are now PER TENANT inside the caller's kv_app unit of work
// (F-9) — the only cross-tenant read left is `tenantsWith`, on `auctions` itself, which kv_relay is granted (0014/0018).
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Auction, AuctionKind } from '../domain/auction.entity';
import { AuctionGroup, AuctionStatus, AUCTION_GROUPS, GROUP_STATUSES } from '../domain/auction.state';
import { Cursor } from '../domain/cursor';

const COLS = `id, tenant_id, listing_id, kind, quantity::text AS quantity, unit_code, auction_no, start_price_minor, reserve_price_minor, min_increment_minor,
  emd_minor, emd_pct_bps, starts_at, ends_at, auto_extend_secs, extend_trigger_secs, min_bidders,
  requires_seller_approval, decision_window_hours, decision_due_at, entry_paused, entry_paused_at, entry_paused_by,
  ended_at, settled_at, lapsed_at, defaulted_at, cancelled_at, cancelled_by, cancel_reason,
  status, winning_bid_id, settled_order_id, version, created_at, created_at::text AS created_at_raw`;
const big = (v: any) => (v == null ? null : BigInt(v));
function toDomain(r: any): Auction {
  return Auction.rehydrate({
    id: r.id, tenantId: r.tenant_id, listingId: r.listing_id, kind: r.kind as AuctionKind,
    quantity: String(r.quantity), unitCode: r.unit_code, auctionNo: r.auction_no ?? null,
    startPriceMinor: BigInt(r.start_price_minor), reservePriceMinor: big(r.reserve_price_minor), minIncrementMinor: BigInt(r.min_increment_minor), emdMinor: BigInt(r.emd_minor),
    emdPctBps: r.emd_pct_bps, startsAt: r.starts_at, endsAt: r.ends_at, autoExtendSecs: r.auto_extend_secs, extendTriggerSecs: r.extend_trigger_secs,
    minBidders: r.min_bidders, requiresSellerApproval: r.requires_seller_approval,
    decisionWindowHours: Number(r.decision_window_hours ?? 24), decisionDueAt: r.decision_due_at ?? null,
    entryPaused: r.entry_paused === true, entryPausedAt: r.entry_paused_at ?? null, entryPausedBy: r.entry_paused_by ?? null,
    endedAt: r.ended_at ?? null, settledAt: r.settled_at ?? null, lapsedAt: r.lapsed_at ?? null, defaultedAt: r.defaulted_at ?? null,
    cancelledAt: r.cancelled_at ?? null, cancelledBy: r.cancelled_by ?? null, cancelReason: r.cancel_reason ?? null,
    status: r.status as AuctionStatus, winningBidId: r.winning_bid_id, settledOrderId: r.settled_order_id, version: r.version, createdAt: r.created_at,
    createdAtRaw: r.created_at_raw ?? null,
  });
}

export type GroupCounts = Record<AuctionGroup, number>;

@Injectable()
export class AuctionRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** INSERT; the 0186 trigger assigns `auction_no`, which is read back onto the aggregate. */
  async insert(tx: TxContext, a: Auction): Promise<void> {
    const p = a.toProps();
    const r = await tx.query<{ auction_no: string }>(
      `INSERT INTO auctions (id, tenant_id, listing_id, kind, quantity, unit_code, start_price_minor, reserve_price_minor, min_increment_minor,
         emd_minor, emd_pct_bps, starts_at, ends_at, auto_extend_secs, extend_trigger_secs, min_bidders,
         requires_seller_approval, decision_window_hours, status, version)
       VALUES ($1,$2,$3,$4,$5::numeric,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING auction_no`,
      [p.id, p.tenantId, p.listingId, p.kind, p.quantity, p.unitCode, p.startPriceMinor.toString(), p.reservePriceMinor?.toString() ?? null, p.minIncrementMinor.toString(),
       p.emdMinor.toString(), p.emdPctBps, p.startsAt, p.endsAt, p.autoExtendSecs, p.extendTriggerSecs, p.minBidders,
       p.requiresSellerApproval, p.decisionWindowHours, p.status, p.version]);
    if (r.rows[0]?.auction_no) a.assignNumber(r.rows[0].auction_no);
  }

  /** Lock the auction row for the bid/close path (serializes concurrent bids). */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Auction | null> {
    const r = await tx.query(`SELECT ${COLS} FROM auctions WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Public-within-tenant read (auctions are visible to any tenant member). */
  async getVisible(tenantId: string, id: string): Promise<Auction | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM auctions WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Optimistic-locked update (version). 0 rows ⇒ concurrent modification. Writes every field an act may move. */
  async update(tx: TxContext, a: Auction): Promise<boolean> {
    const p = a.toProps();
    const r = await tx.query(
      `UPDATE auctions SET status=$3, ends_at=$4, winning_bid_id=$5, settled_order_id=$6, decision_due_at=$8,
              entry_paused=$9, entry_paused_at=$10, entry_paused_by=$11, ended_at=$12, settled_at=$13, lapsed_at=$14, defaulted_at=$15,
              cancelled_at=$16, cancelled_by=$17, cancel_reason=$18, version=version+1, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND version=$7`,
      [p.id, p.tenantId, p.status, p.endsAt, p.winningBidId, p.settledOrderId, p.version, p.decisionDueAt,
       p.entryPaused, p.entryPausedAt, p.entryPausedBy, p.endedAt, p.settledAt, p.lapsedAt, p.defaultedAt,
       p.cancelledAt, p.cancelledBy, p.cancelReason]);
    if ((r.rowCount ?? 0) > 0) a.markPersisted();
    return (r.rowCount ?? 0) > 0;
  }

  /** Optimistic-locked edit of a SCHEDULED auction's terms (reserve/min-increment/window). */
  async updateSchedule(tx: TxContext, a: Auction): Promise<boolean> {
    const p = a.toProps();
    const r = await tx.query(
      `UPDATE auctions SET reserve_price_minor=$3, min_increment_minor=$4, starts_at=$5, ends_at=$6, version=version+1, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND version=$7 AND status='scheduled'`,
      [p.id, p.tenantId, p.reservePriceMinor?.toString() ?? null, p.minIncrementMinor.toString(), p.startsAt, p.endsAt, p.version]);
    return (r.rowCount ?? 0) > 0;
  }

  async recordEvent(tx: TxContext, tenantId: string, auctionId: string, eventCode: string, meta: Record<string, unknown> = {}): Promise<void> {
    await tx.query(`INSERT INTO auction_events (tenant_id, auction_id, event_code, meta) VALUES ($1,$2,$3,$4::jsonb)`, [tenantId, auctionId, eventCode, JSON.stringify(meta)]);
  }

  /** How many times anti-snipe extended this auction (auction_events 'extended'; W138 "no extensions yet"). */
  async extensionCount(tenantId: string, auctionId: string): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query<{ n: string }>(
      `SELECT count(*)::text n FROM auction_events WHERE tenant_id=$1 AND auction_id=$2 AND event_code='extended'`, [tenantId, auctionId]);
    return Number(r.rows[0]?.n ?? 0);
  }

  /** The console list: grouped tab (or one status), newest first, µs keyset (F-25). */
  async listFor(tenantId: string, opts: { status?: string; group?: AuctionGroup; cursor?: Cursor; limit: number }): Promise<Auction[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (opts.status) where += ` AND status=${p(opts.status)}::auction_status`;
    else if (opts.group) where += ` AND status::text = ANY(${p([...GROUP_STATUSES[opts.group]])}::text[])`;
    if (opts.cursor) { const cc = p(opts.cursor.c), ci = p(opts.cursor.id); where += ` AND (created_at < ${cc}::timestamptz OR (created_at = ${cc}::timestamptz AND id < ${ci}::uuid))`; }
    const lp = p(opts.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM auctions WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /** W137's tab counts — one GROUP BY, mapped onto the five groups. */
  async groupCounts(tenantId: string): Promise<GroupCounts> {
    const r = await this.replica.forTenant(tenantId).query<{ status: string; n: string }>(
      `SELECT status::text AS status, count(*)::text n FROM auctions WHERE tenant_id=$1 GROUP BY status`, [tenantId]);
    const out = Object.fromEntries(AUCTION_GROUPS.map((g) => [g, 0])) as GroupCounts;
    for (const row of r.rows) for (const g of AUCTION_GROUPS) if ((GROUP_STATUSES[g] as readonly string[]).includes(row.status)) out[g] += Number(row.n);
    return out;
  }

  /** The tenants holding auctions in one of `statuses` — the cadence runner's ONLY cross-tenant read (kv_relay holds
   *  SELECT on `auctions`). Everything after it — the claim, the lock, the act — runs per tenant in kv_app's UoW. */
  async tenantsWith(pool: Pool, statuses: readonly AuctionStatus[], limit = 500): Promise<string[]> {
    const r = await pool.query<{ tenant_id: string }>(
      `SELECT DISTINCT tenant_id FROM auctions WHERE status::text = ANY($1::text[]) LIMIT $2`, [[...statuses], limit]);
    return r.rows.map((x) => x.tenant_id);
  }

  /** Per-tenant claims, inside the caller's kv_app tx (RLS on). Bounded; ids only — each act re-locks its row. */
  async dueToOpen(tx: TxContext, tenantId: string, now: Date, limit: number): Promise<string[]> {
    const r = await tx.query<{ id: string }>(`SELECT id FROM auctions WHERE tenant_id=$1 AND status='scheduled' AND starts_at <= $2 ORDER BY starts_at LIMIT $3`, [tenantId, now, limit]);
    return r.rows.map((x) => x.id);
  }
  async dueToClose(tx: TxContext, tenantId: string, now: Date, limit: number): Promise<string[]> {
    const r = await tx.query<{ id: string }>(`SELECT id FROM auctions WHERE tenant_id=$1 AND status IN ('live','extended') AND ends_at <= $2 ORDER BY ends_at LIMIT $3`, [tenantId, now, limit]);
    return r.rows.map((x) => x.id);
  }
  async dueToLapse(tx: TxContext, tenantId: string, now: Date, limit: number): Promise<string[]> {
    const r = await tx.query<{ id: string }>(`SELECT id FROM auctions WHERE tenant_id=$1 AND status='awaiting_approval' AND decision_due_at <= $2 ORDER BY decision_due_at LIMIT $3`, [tenantId, now, limit]);
    return r.rows.map((x) => x.id);
  }
  /** Closed in the window (the EMD-release sweeper's backstop scan). */
  async recentlyClosed(tx: TxContext, tenantId: string, since: Date, limit: number): Promise<string[]> {
    const r = await tx.query<{ id: string }>(
      `SELECT id FROM auctions WHERE tenant_id=$1 AND status IN ('ended','settled','awaiting_approval','failed_reserve','cancelled','defaulted')
          AND updated_at >= $2 ORDER BY updated_at DESC LIMIT $3`, [tenantId, since, limit]);
    return r.rows.map((x) => x.id);
  }
}
