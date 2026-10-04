// modules/logistics/repositories/slot-proposal.repository.ts · PC-56 TENANT-SW-e · W230 — the pickup desk's read across sellers,
// the suggestion read, and `pickup_slot_proposals` (0201). tenant_id in every query (Law 1) + RLS (0175 split). Keyset cursors are
// microsecond-exact (F-14). The read across sellers carries the seller's NAME and PHONE only for the service to mask (1b) — no
// raw phone leaves the service.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { US_SQL } from '../../../shared/pagination/us-keyset';
import type { SlotWindow, PickupFact } from '../domain/logistics-ops';

export interface DeskSellerRow {
  sellerUserId: string; fullName: string | null; phone: string | null;
  windows: Array<{ weekday: number; start: string; end: string }>;
  pickups30d: number; deliveryAttempted30d: number; deliveryFirstAttempt30d: number;
  openProposalId: string | null; openProposalExpiresAt: string | null;
}
export interface ProposalRow {
  id: string; tenantId: string; sellerUserId: string; proposedBy: string; slots: SlotWindow[]; reason: string; status: string;
  expiresAt: string; decidedAt: string | null; decidedBy: string | null; channel: string | null; declineReason: string | null;
  withdrawnBy: string | null; withdrawnAt: string | null; withdrawReason: string | null; appliedSlotIds: string[]; createdAt: string; createdUs: string;
  sellerName: string | null; sellerPhone: string | null;
}
const P_COLS = `p.id, p.tenant_id, p.seller_user_id, p.proposed_by, p.slots, p.reason, p.status, p.expires_at, p.decided_at, p.decided_by, p.channel,
  p.decline_reason, p.withdrawn_by, p.withdrawn_at, p.withdraw_reason, p.applied_slot_ids, p.created_at, ${US_SQL('p.created_at')} AS created_us,
  u.full_name AS seller_name, u.phone AS seller_phone`;
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
function toProposal(r: any): ProposalRow {
  return { id: r.id, tenantId: r.tenant_id, sellerUserId: r.seller_user_id, proposedBy: r.proposed_by, slots: r.slots ?? [], reason: r.reason, status: r.status,
    expiresAt: iso(r.expires_at) as string, decidedAt: iso(r.decided_at), decidedBy: r.decided_by ?? null, channel: r.channel ?? null, declineReason: r.decline_reason ?? null,
    withdrawnBy: r.withdrawn_by ?? null, withdrawnAt: iso(r.withdrawn_at), withdrawReason: r.withdraw_reason ?? null, appliedSlotIds: r.applied_slot_ids ?? [],
    createdAt: iso(r.created_at) as string, createdUs: r.created_us, sellerName: r.seller_name ?? null, sellerPhone: r.seller_phone ?? null };
}

@Injectable()
export class SlotProposalRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * W230's table across sellers: every seller with a parcel in 90 days or a pickup window, keyset on the seller id. Pickups 30d =
   * shipments of the seller's orders PICKED UP in 30 days; the delivery attempts on them (shipments.delivery_attempts ≥ 1) and how
   * many were delivered at the FIRST attempt — DELIVERY first-attempt, labelled so; no pickup attempt is recorded anywhere.
   * Pruned on shipments.created_at (90 days — a parcel picked up in the last 30 was created within that).
   */
  async deskSellers(tenantId: string, q: { afterSellerId?: string; limit: number }): Promise<{ rows: DeskSellerRow[]; total: number }> {
    const db = this.replica.forTenant(tenantId);
    const r = await db.query(
      `WITH sellers AS (
         SELECT DISTINCT o.seller_user_id AS uid FROM shipments s JOIN orders o ON o.id = s.order_id AND o.tenant_id = s.tenant_id
          WHERE s.tenant_id=$1 AND s.created_at >= now() - interval '90 days' AND s.created_at <= now()
         UNION
         SELECT ps.seller_user_id FROM pickup_slots ps WHERE ps.tenant_id=$1 AND ps.deleted_at IS NULL
       ), facts AS (
         SELECT o.seller_user_id AS uid,
                count(*) FILTER (WHERE s.picked_up_at >= now() - interval '30 days')::int AS pickups_30d,
                count(*) FILTER (WHERE s.picked_up_at >= now() - interval '30 days' AND s.delivery_attempts >= 1)::int AS attempted,
                count(*) FILTER (WHERE s.picked_up_at >= now() - interval '30 days' AND s.status = 'delivered' AND s.delivery_attempts = 1)::int AS first_attempt
           FROM shipments s JOIN orders o ON o.id = s.order_id AND o.tenant_id = s.tenant_id
          WHERE s.tenant_id=$1 AND s.created_at >= now() - interval '90 days' AND s.created_at <= now()
          GROUP BY o.seller_user_id
       )
       SELECT u.id AS seller_user_id, u.full_name, u.phone,
              coalesce((SELECT jsonb_agg(jsonb_build_object('weekday', ps.weekday, 'start', to_char(ps.start_time,'HH24:MI'), 'end', to_char(ps.end_time,'HH24:MI'))
                                         ORDER BY ps.weekday, ps.start_time)
                          FROM pickup_slots ps WHERE ps.tenant_id=$1 AND ps.seller_user_id = u.id AND ps.is_active AND ps.deleted_at IS NULL), '[]'::jsonb) AS windows,
              coalesce(f.pickups_30d, 0) AS pickups_30d, coalesce(f.attempted, 0) AS attempted, coalesce(f.first_attempt, 0) AS first_attempt,
              (SELECT p.id FROM pickup_slot_proposals p WHERE p.tenant_id=$1 AND p.seller_user_id = u.id AND p.status = 'proposed' ORDER BY p.created_at DESC LIMIT 1) AS open_id,
              (SELECT p.expires_at FROM pickup_slot_proposals p WHERE p.tenant_id=$1 AND p.seller_user_id = u.id AND p.status = 'proposed' ORDER BY p.created_at DESC LIMIT 1) AS open_expires
         FROM sellers JOIN users u ON u.id = sellers.uid LEFT JOIN facts f ON f.uid = u.id
        WHERE ($2::uuid IS NULL OR u.id > $2::uuid)
        ORDER BY u.id LIMIT $3`, [tenantId, q.afterSellerId ?? null, q.limit]);
    const total = await db.query(
      `SELECT count(*)::int AS n FROM (
         SELECT DISTINCT o.seller_user_id FROM shipments s JOIN orders o ON o.id = s.order_id AND o.tenant_id = s.tenant_id
          WHERE s.tenant_id=$1 AND s.created_at >= now() - interval '90 days' AND s.created_at <= now()
         UNION SELECT ps.seller_user_id FROM pickup_slots ps WHERE ps.tenant_id=$1 AND ps.deleted_at IS NULL) x`, [tenantId]);
    return {
      rows: (r.rows as any[]).map((x) => ({ sellerUserId: x.seller_user_id, fullName: x.full_name ?? null, phone: x.phone ?? null, windows: x.windows ?? [],
        pickups30d: Number(x.pickups_30d), deliveryAttempted30d: Number(x.attempted), deliveryFirstAttempt30d: Number(x.first_attempt),
        openProposalId: x.open_id ?? null, openProposalExpiresAt: iso(x.open_expires) })),
      total: Number(total.rows[0]?.n ?? 0),
    };
  }

  /** The suggestion read: the seller's parcels PICKED UP in 90 days, with their delivery attempts. Nothing is written. */
  async pickupFacts(tenantId: string, sellerUserId: string, days: number): Promise<PickupFact[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT s.picked_up_at, s.delivery_attempts, (s.status = 'delivered') AS delivered
         FROM shipments s JOIN orders o ON o.id = s.order_id AND o.tenant_id = s.tenant_id
        WHERE s.tenant_id=$1 AND o.seller_user_id=$2 AND s.picked_up_at IS NOT NULL
          AND s.picked_up_at >= now() - ($3 || ' days')::interval
          AND s.created_at >= now() - (($3::int + 30) || ' days')::interval AND s.created_at <= now()
        LIMIT 5000`, [tenantId, sellerUserId, String(days)]);
    return (r.rows as any[]).map((x) => ({ pickedUpAt: new Date(x.picked_up_at), deliveryAttempts: Number(x.delivery_attempts ?? 0), delivered: !!x.delivered }));
  }

  async sellerKnown(tx: TxContext, tenantId: string, sellerUserId: string): Promise<{ phone: string; language: string } | null> {
    const r = await tx.query(
      `SELECT u.phone, u.language_code FROM users u
        WHERE u.id=$2 AND EXISTS (SELECT 1 FROM user_tenant_roles utr WHERE utr.tenant_id=$1 AND utr.user_id=u.id AND utr.is_active AND utr.deleted_at IS NULL)`,
      [tenantId, sellerUserId]);
    return r.rows[0] ? { phone: (r.rows[0] as any).phone, language: (r.rows[0] as any).language_code } : null;
  }

  async insert(tx: TxContext, p: { id: string; tenantId: string; sellerUserId: string; proposedBy: string; slots: SlotWindow[]; reason: string }): Promise<void> {
    await tx.query(
      `INSERT INTO pickup_slot_proposals (id, tenant_id, seller_user_id, proposed_by, slots, reason) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [p.id, p.tenantId, p.sellerUserId, p.proposedBy, JSON.stringify(p.slots), p.reason]);
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<ProposalRow | null> {
    const r = await tx.query(`SELECT ${P_COLS} FROM pickup_slot_proposals p JOIN users u ON u.id = p.seller_user_id WHERE p.id=$1 AND p.tenant_id=$2 FOR UPDATE OF p`, [id, tenantId]);
    return r.rows[0] ? toProposal(r.rows[0]) : null;
  }
  async get(tenantId: string, id: string): Promise<ProposalRow | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${P_COLS} FROM pickup_slot_proposals p JOIN users u ON u.id = p.seller_user_id WHERE p.id=$1 AND p.tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toProposal(r.rows[0]) : null;
  }

  async list(tenantId: string, q: { sellerUserId?: string; status?: string; cursor?: { ts: string; id: string }; limit: number }): Promise<ProposalRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `p.tenant_id=$1`;
    if (q.sellerUserId) where += ` AND p.seller_user_id=${p(q.sellerUserId)}`;
    if (q.status) where += ` AND p.status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.ts), ci = p(q.cursor.id); where += ` AND (p.created_at < ${cc}::timestamptz OR (p.created_at = ${cc}::timestamptz AND p.id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${P_COLS} FROM pickup_slot_proposals p JOIN users u ON u.id = p.seller_user_id WHERE ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT ${lp}`, params);
    return r.rows.map(toProposal);
  }

  /** The seller's acceptance: each proposed window that is not already an active window of theirs, written in THEIR session. */
  async applyWindows(tx: TxContext, tenantId: string, sellerUserId: string, windows: readonly SlotWindow[]): Promise<string[]> {
    const ids: string[] = [];
    for (const w of windows) {
      const dup = await tx.query(
        `SELECT 1 FROM pickup_slots WHERE tenant_id=$1 AND seller_user_id=$2 AND weekday=$3 AND start_time=$4::time AND end_time=$5::time AND is_active AND deleted_at IS NULL LIMIT 1`,
        [tenantId, sellerUserId, w.weekday, w.start, w.end]);
      if ((dup.rowCount ?? 0) > 0) continue;
      const r = await tx.query(
        `INSERT INTO pickup_slots (tenant_id, seller_user_id, weekday, start_time, end_time, is_active, created_by, created_at)
         VALUES ($1,$2,$3,$4::time,$5::time,true,$2, now()) RETURNING id`, [tenantId, sellerUserId, w.weekday, w.start, w.end]);
      ids.push((r.rows[0] as { id: string }).id);
    }
    return ids;
  }

  async decide(tx: TxContext, tenantId: string, id: string, d: { status: 'accepted' | 'declined'; by: string; channel: 'app' | 'otp_link'; declineReason: string | null; appliedSlotIds: string[] }): Promise<void> {
    await tx.query(
      `UPDATE pickup_slot_proposals SET status=$3, decided_at=now(), decided_by=$4, channel=$5, decline_reason=$6, applied_slot_ids=$7::jsonb, updated_at=now()
        WHERE id=$1 AND tenant_id=$2`, [id, tenantId, d.status, d.by, d.channel, d.declineReason, JSON.stringify(d.appliedSlotIds)]);
  }
  async recordApplied(tx: TxContext, tenantId: string, id: string, slotIds: string[]): Promise<void> {
    await tx.query(`UPDATE pickup_slot_proposals SET applied_slot_ids=$3::jsonb, updated_at=now() WHERE id=$1 AND tenant_id=$2`, [id, tenantId, JSON.stringify(slotIds)]);
  }
  async withdraw(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<void> {
    await tx.query(`UPDATE pickup_slot_proposals SET status='withdrawn', withdrawn_by=$3, withdrawn_at=now(), withdraw_reason=$4, updated_at=now() WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId, by, reason]);
  }
  /** The 7-day clock: proposals past their expiry move to expired (the trigger refuses an early one). */
  async expireDue(tx: TxContext, tenantId: string): Promise<number> {
    const r = await tx.query(`UPDATE pickup_slot_proposals SET status='expired', updated_at=now() WHERE tenant_id=$1 AND status='proposed' AND expires_at <= now()`, [tenantId]);
    return r.rowCount ?? 0;
  }
}
