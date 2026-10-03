// modules/group-lots/repositories/group-lot.repository.ts · all SQL for group_lots, group_lot_pledges, group_lot_consents
// (0005 + 0188). tenant_id in EVERY query (Law 1) + RLS. No version column on group_lots → mutations lock FOR UPDATE.
// Reads on the replica; keyset lists on the column's own TEXT (µs, F-25). Quantities are numeric(14,3) decimal strings; money
// is bigint minor.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { GroupLot } from '../domain/group-lot.entity';
import { Cursor } from '../domain/cursor';

const COLS = `g.id, g.tenant_id, g.lot_no, g.coordinator_user_id, g.product_id, g.target_quantity::text AS target_quantity,
  g.pledged_quantity::text AS pledged_quantity, g.unit_code, g.pledge_deadline, g.pledge_deadline::text AS deadline_text, g.status,
  g.coordination_fee_bps, g.created_at, g.created_at::text AS created_text, g.listing_id, g.listed_at, g.sold_at, g.sale_order_id,
  g.gross_proceeds_minor::text AS gross_proceeds_minor, g.hold_txn_id, g.settlement_txn_id, g.settled_at, g.extended_once, g.extended_at,
  g.original_deadline, g.last_nudged_at, g.ready_at, g.ready_reason, g.cancel_reason_id,
  (SELECT lv.code FROM lookup_values lv WHERE lv.id = g.cancel_reason_id) AS cancel_reason_code,
  g.cancel_reason_text, g.cancelled_at, g.cancelled_by, g.appointed_by, g.consent_id`;

const isoOf = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
function toDomain(r: any): GroupLot {
  return GroupLot.rehydrate({
    id: r.id, tenantId: r.tenant_id, lotNo: r.lot_no, coordinatorUserId: r.coordinator_user_id, productId: r.product_id,
    targetQuantity: String(r.target_quantity), pledgedQuantity: String(r.pledged_quantity), unitCode: r.unit_code,
    pledgeDeadline: isoOf(r.pledge_deadline), deadlineText: r.deadline_text ?? null,
    status: r.status, coordinationFeeBps: Number(r.coordination_fee_bps), createdAt: r.created_at, createdAtText: r.created_text ?? null,
    listingId: r.listing_id ?? null, listedAt: r.listed_at ?? null, soldAt: r.sold_at ?? null, saleOrderId: r.sale_order_id ?? null,
    grossProceedsMinor: r.gross_proceeds_minor != null ? BigInt(r.gross_proceeds_minor) : null, holdTxnId: r.hold_txn_id ?? null,
    settlementTxnId: r.settlement_txn_id ?? null, settledAt: r.settled_at ?? null, extendedOnce: !!r.extended_once, extendedAt: r.extended_at ?? null,
    originalDeadline: r.original_deadline ? isoOf(r.original_deadline) : null, lastNudgedAt: r.last_nudged_at ?? null,
    readyAt: r.ready_at ?? null, readyReason: r.ready_reason ?? null, cancelReasonId: r.cancel_reason_id ?? null, cancelReasonCode: r.cancel_reason_code ?? null,
    cancelReasonText: r.cancel_reason_text ?? null, cancelledAt: r.cancelled_at ?? null, cancelledBy: r.cancelled_by ?? null,
    appointedBy: r.appointed_by ?? null, consentId: r.consent_id ?? null,
  });
}

export interface PledgeRow {
  id: string; groupLotId: string; farmerUserId: string; quantity: string; status: 'active' | 'withdrawn' | 'released';
  qualityOk: boolean | null; settledShareMinor: string | null; settlementTxnId: string | null; recordedBy: string | null; createdAt: string; withdrawnAt: string | null;
}
const toPledge = (x: any): PledgeRow => ({
  id: x.id, groupLotId: x.group_lot_id, farmerUserId: x.farmer_user_id, quantity: String(x.quantity), status: x.status, qualityOk: x.quality_ok ?? null,
  settledShareMinor: x.settled_share_minor != null ? String(x.settled_share_minor) : null, settlementTxnId: x.settlement_txn_id ?? null,
  recordedBy: x.recorded_by ?? null, createdAt: new Date(x.created_at).toISOString(), withdrawnAt: x.withdrawn_at ? new Date(x.withdrawn_at).toISOString() : null,
});
const PLEDGE_COLS = `p.id, p.group_lot_id, p.farmer_user_id, p.quantity::text AS quantity, p.status, p.quality_ok, p.settled_share_minor, p.settlement_txn_id, p.recorded_by, p.created_at, p.withdrawn_at`;

/** A pledge as the coordinator's table shows it (F-19): who, how much, KYC per role, when. The phone is masked by the service. */
export interface PledgePersonRow extends PledgeRow { fullName: string | null; phone: string | null; roles: Array<{ roleCode: string; kycStatus: string }>; }

/** The facts a list row / header reads with the lot (one round trip per page, bounded by the page). */
export interface LotFacts {
  productName: string | null; coordinatorName: string | null; memberCount: number;
  listingStatus: string | null; auction: { id: string; auctionNo: string; status: string; endsAt: string } | null;
}

export interface ProductFacts { id: string; name: string; categoryId: string; defaultUnit: string; }
export interface CancelReason { id: string; code: string; defaultName: string; textRequired: boolean; }

@Injectable()
export class GroupLotRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private q(tenantId: string, tx?: TxContext) { return tx ?? this.replica.forTenant(tenantId); }

  async insert(tx: TxContext, g: GroupLot): Promise<{ lotNo: string; createdAt: Date }> {
    const p = g.toProps();
    const r = await tx.query<{ lot_no: string; created_at: Date }>(
      `INSERT INTO group_lots (id, tenant_id, coordinator_user_id, product_id, target_quantity, pledged_quantity, unit_code, pledge_deadline, status,
                               coordination_fee_bps, created_by, appointed_by)
       VALUES ($1,$2,$3,$4,$5::numeric,$6::numeric,$7,$8::timestamptz,$9,$10,$11,$12) RETURNING lot_no, created_at`,
      [p.id, p.tenantId, p.coordinatorUserId, p.productId, p.targetQuantity, p.pledgedQuantity, p.unitCode, p.pledgeDeadline, p.status,
        p.coordinationFeeBps, p.appointedBy ?? p.coordinatorUserId, p.appointedBy ?? null]);
    return { lotNo: r.rows[0].lot_no, createdAt: r.rows[0].created_at };
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<GroupLot | null> {
    const r = await tx.query(`SELECT ${COLS} FROM group_lots g WHERE g.id=$1 AND g.tenant_id=$2 AND g.deleted_at IS NULL FOR UPDATE OF g`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string, tx?: TxContext): Promise<GroupLot | null> {
    const r = await this.q(tenantId, tx).query(`SELECT ${COLS} FROM group_lots g WHERE g.id=$1 AND g.tenant_id=$2 AND g.deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Writes every column the lifecycle moves. The identity columns never change (trg_gl_moves refuses it anyway). */
  async update(tx: TxContext, g: GroupLot, actorUserId: string | null): Promise<void> {
    const p = g.toProps();
    const r = await tx.query(
      `UPDATE group_lots SET pledged_quantity=$3::numeric, status=$4, pledge_deadline=$5::timestamptz, listing_id=$6, listed_at=$7,
              listed_by=COALESCE(listed_by, CASE WHEN $6::uuid IS NOT NULL THEN $8::uuid END),
              sold_at=$9, sale_order_id=$10, gross_proceeds_minor=$11::bigint, hold_txn_id=$12, settlement_txn_id=$13, settled_at=$14,
              extended_once=$15, extended_at=$16, original_deadline=$17::timestamptz, last_nudged_at=$18, ready_at=$19, ready_reason=$20,
              cancel_reason_id=$21, cancel_reason_text=$22, cancelled_at=$23, cancelled_by=$24, updated_by=$8, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.pledgedQuantity, p.status, p.pledgeDeadline, p.listingId ?? null, p.listedAt ?? null, actorUserId,
        p.soldAt ?? null, p.saleOrderId ?? null, p.grossProceedsMinor != null ? p.grossProceedsMinor.toString() : null, p.holdTxnId ?? null,
        p.settlementTxnId ?? null, p.settledAt ?? null, !!p.extendedOnce, p.extendedAt ?? null, p.originalDeadline ?? null, p.lastNudgedAt ?? null,
        p.readyAt ?? null, p.readyReason ?? null, p.cancelReasonId ?? null, p.cancelReasonText ?? null, p.cancelledAt ?? null, p.cancelledBy ?? null]);
    if (r.rowCount !== 1) throw new Error(`group_lots update touched ${r.rowCount} rows for ${p.id}`);
  }

  /** A6 — one page, keyset on the column's own µs text. `recent`: created_at DESC; `deadline`: pledge_deadline ASC (W135 "Deadline ▴"). */
  async listFor(tenantId: string, q: { coordinatorUserId?: string; status?: string; sort: 'recent' | 'deadline'; cursor?: Cursor; limit: number }): Promise<GroupLot[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `g.tenant_id=$1 AND g.deleted_at IS NULL`;
    if (q.coordinatorUserId) where += ` AND g.coordinator_user_id=${p(q.coordinatorUserId)}`;
    if (q.status) where += ` AND g.status=${p(q.status)}`;
    let order = `g.created_at DESC, g.id DESC`;
    if (q.sort === 'deadline') {
      order = `g.pledge_deadline ASC, g.id ASC`;
      if (q.cursor) { const c = p(q.cursor.c), i = p(q.cursor.id); where += ` AND (g.pledge_deadline > ${c}::timestamptz OR (g.pledge_deadline = ${c}::timestamptz AND g.id > ${i}::uuid))`; }
    } else if (q.cursor) {
      const c = p(q.cursor.c), i = p(q.cursor.id); where += ` AND (g.created_at < ${c}::timestamptz OR (g.created_at = ${c}::timestamptz AND g.id < ${i}::uuid))`;
    }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM group_lots g WHERE ${where} ORDER BY ${order} LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
  async countByStatus(tenantId: string, coordinatorUserId?: string): Promise<Record<string, number>> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    if (coordinatorUserId) { params.push(coordinatorUserId); where += ` AND coordinator_user_id=$2`; }
    const r = await this.replica.forTenant(tenantId).query<{ status: string; n: string }>(`SELECT status, count(*)::text AS n FROM group_lots WHERE ${where} GROUP BY status`, params);
    const out: Record<string, number> = {};
    for (const row of r.rows) out[row.status] = Number(row.n);
    return out;
  }
  /** The names, member counts and sale links for a page of lots, in ONE query (never N+1). */
  async factsFor(tenantId: string, lots: GroupLot[], tx?: TxContext): Promise<Map<string, LotFacts>> {
    const out = new Map<string, LotFacts>();
    if (lots.length === 0) return out;
    const ids = lots.map((l) => l.id);
    const r = await this.q(tenantId, tx).query<any>(
      `SELECT g.id, pr.default_name AS product_name, u.full_name AS coordinator_name,
              (SELECT count(*)::int FROM group_lot_pledges p WHERE p.group_lot_id = g.id AND p.tenant_id = g.tenant_id AND p.status = 'active' AND p.deleted_at IS NULL) AS member_count,
              l.status::text AS listing_status,
              a.id AS auction_id, a.auction_no, a.status::text AS auction_status, a.ends_at AS auction_ends_at
         FROM group_lots g
         LEFT JOIN products pr ON pr.id = g.product_id
         LEFT JOIN users u ON u.id = g.coordinator_user_id
         LEFT JOIN listings l ON l.id = g.listing_id AND l.tenant_id = g.tenant_id
         LEFT JOIN LATERAL (SELECT x.id, x.auction_no, x.status, x.ends_at FROM auctions x WHERE x.listing_id = g.listing_id AND x.tenant_id = g.tenant_id
                             ORDER BY x.created_at DESC LIMIT 1) a ON g.listing_id IS NOT NULL
        WHERE g.tenant_id = $1 AND g.id = ANY($2::uuid[])`, [tenantId, ids]);
    for (const x of r.rows) {
      out.set(x.id, {
        productName: x.product_name ?? null, coordinatorName: x.coordinator_name ?? null, memberCount: Number(x.member_count ?? 0),
        listingStatus: x.listing_status ?? null,
        auction: x.auction_id ? { id: x.auction_id, auctionNo: x.auction_no, status: x.auction_status, endsAt: new Date(x.auction_ends_at).toISOString() } : null,
      });
    }
    return out;
  }

  // --- reference reads ----------------------------------------------------------------------------------------------------
  /** A product this tenant may pool: a platform product or the tenant's own, active. */
  async product(tx: TxContext, tenantId: string, productId: string): Promise<ProductFacts | null> {
    const r = await tx.query<any>(`SELECT id, default_name, category_id, default_unit FROM products WHERE id=$1 AND (tenant_id IS NULL OR tenant_id=$2) AND is_active AND deleted_at IS NULL`, [productId, tenantId]);
    return r.rows[0] ? { id: r.rows[0].id, name: r.rows[0].default_name, categoryId: r.rows[0].category_id, defaultUnit: r.rows[0].default_unit } : null;
  }
  async unitExists(tx: TxContext, code: string): Promise<boolean> {
    return ((await tx.query(`SELECT 1 FROM units WHERE code=$1`, [code])).rowCount ?? 0) > 0;
  }
  /** Is this user an ACTIVE member of the tenant (any active role)? Pledgers and appointees must be. */
  async isActiveMember(tx: TxContext, tenantId: string, userId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM user_tenant_roles utr JOIN users u ON u.id = utr.user_id
       WHERE utr.tenant_id=$1 AND utr.user_id=$2 AND utr.is_active AND utr.deleted_at IS NULL AND u.deleted_at IS NULL LIMIT 1`, [tenantId, userId]);
    return (r.rowCount ?? 0) > 0;
  }
  async cancelReason(tx: TxContext, code: string): Promise<CancelReason | null> {
    const r = await tx.query<any>(`SELECT id, code, default_name, COALESCE((meta->>'textRequired')::boolean, false) AS text_required FROM lookup_values
        WHERE type_code='group_lot_cancel_reason' AND code=$1 AND tenant_id IS NULL AND is_active=true`, [code]);
    return r.rows[0] ? { id: r.rows[0].id, code: r.rows[0].code, defaultName: r.rows[0].default_name, textRequired: !!r.rows[0].text_required } : null;
  }
  async cancelReasons(tenantId: string): Promise<CancelReason[]> {
    const r = await this.replica.forTenant(tenantId).query<any>(`SELECT id, code, default_name, COALESCE((meta->>'textRequired')::boolean, false) AS text_required
        FROM lookup_values WHERE type_code='group_lot_cancel_reason' AND tenant_id IS NULL AND is_active=true ORDER BY sort_order, code`);
    return r.rows.map((x: any) => ({ id: x.id, code: x.code, defaultName: x.default_name, textRequired: !!x.text_required }));
  }

  // --- consents --------------------------------------------------------------------------------------------------------------
  async insertConsent(tx: TxContext, row: { id: string; tenantId: string; groupLotId: string; coordinatorUserId: string; channel: string; mediaId: string | null; note: string | null; recordedBy: string }): Promise<void> {
    await tx.query(`INSERT INTO group_lot_consents (id, tenant_id, group_lot_id, coordinator_user_id, act, channel, media_id, note, recorded_by)
                    VALUES ($1,$2,$3,$4,'appoint',$5,$6,$7,$8)`,
      [row.id, row.tenantId, row.groupLotId, row.coordinatorUserId, row.channel, row.mediaId, row.note, row.recordedBy]);
    await tx.query(`UPDATE group_lots SET consent_id=$3 WHERE id=$1 AND tenant_id=$2`, [row.groupLotId, row.tenantId, row.id]);
  }

  // --- pledges -----------------------------------------------------------------------------------------------------------------
  async pledgeOfForUpdate(tx: TxContext, tenantId: string, groupLotId: string, farmerUserId: string): Promise<PledgeRow | null> {
    const r = await tx.query(`SELECT ${PLEDGE_COLS} FROM group_lot_pledges p WHERE p.group_lot_id=$1 AND p.tenant_id=$2 AND p.farmer_user_id=$3 AND p.deleted_at IS NULL FOR UPDATE`, [groupLotId, tenantId, farmerUserId]);
    return r.rows[0] ? toPledge(r.rows[0]) : null;
  }
  /** Re-pledging ADDS to an active pledge; a withdrawn pledge is reactivated with the NEW quantity (the old promise was let go). */
  async upsertPledge(tx: TxContext, tenantId: string, row: { id: string; groupLotId: string; farmerUserId: string; quantity: string; recordedBy: string }): Promise<PledgeRow> {
    const r = await tx.query(
      `INSERT INTO group_lot_pledges AS p (id, group_lot_id, tenant_id, farmer_user_id, quantity, status, created_by, recorded_by)
       VALUES ($1,$2,$3,$4,$5::numeric,'active',$6,$6)
       ON CONFLICT (group_lot_id, farmer_user_id) DO UPDATE SET
         quantity = CASE WHEN p.status = 'active' THEN p.quantity + EXCLUDED.quantity ELSE EXCLUDED.quantity END,
         status = 'active', withdrawn_at = NULL, recorded_by = EXCLUDED.recorded_by, updated_by = EXCLUDED.recorded_by, updated_at = now()
       RETURNING ${PLEDGE_COLS}`,
      [row.id, row.groupLotId, tenantId, row.farmerUserId, row.quantity, row.recordedBy]);
    return toPledge(r.rows[0]);
  }
  async withdrawPledge(tx: TxContext, tenantId: string, pledgeId: string, by: string): Promise<void> {
    const r = await tx.query(`UPDATE group_lot_pledges SET status='withdrawn', withdrawn_at=now(), updated_by=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND status='active'`, [pledgeId, tenantId, by]);
    if (r.rowCount !== 1) throw new Error(`group_lot_pledges withdraw touched ${r.rowCount} rows for ${pledgeId}`);
  }
  /** Cancel releases every active pledge. Returns the members to tell. */
  async releaseAll(tx: TxContext, tenantId: string, groupLotId: string, by: string): Promise<string[]> {
    const r = await tx.query<{ farmer_user_id: string }>(`UPDATE group_lot_pledges SET status='released', updated_by=$3, updated_at=now()
        WHERE group_lot_id=$1 AND tenant_id=$2 AND status='active' AND deleted_at IS NULL RETURNING farmer_user_id`, [groupLotId, tenantId, by]);
    return r.rows.map((x) => x.farmer_user_id);
  }
  async activePledgesForUpdate(tx: TxContext, tenantId: string, groupLotId: string): Promise<PledgeRow[]> {
    const r = await tx.query(`SELECT ${PLEDGE_COLS} FROM group_lot_pledges p WHERE p.group_lot_id=$1 AND p.tenant_id=$2 AND p.status='active' AND p.deleted_at IS NULL ORDER BY p.id FOR UPDATE`, [groupLotId, tenantId]);
    return r.rows.map(toPledge);
  }
  /**
   * PC-56 TENANT-13b (A4): the tenant's effective extension ceiling, in hours — its `tenant_settings` value or the registry default
   * (0192: 48, floor 1–48). A value that is missing, not an integer, or outside 1–48 falls back to 48: never a longer window than
   * the platform's, never zero.
   */
  async maxExtensionHoursTx(tx: TxContext, tenantId: string, key: string): Promise<number> {
    const r = await tx.query(
      `SELECT COALESCE(ts.value, d.default_value) AS value FROM setting_definitions d
         LEFT JOIN tenant_settings ts ON ts.key = d.key AND ts.tenant_id = $1 AND ts.deleted_at IS NULL
        WHERE d.key = $2`, [tenantId, key]);
    const n = Number(r.rows[0]?.value);
    return Number.isInteger(n) && n >= 1 && n <= 48 ? n : 48;
  }

  async activeFarmerIds(tx: TxContext, tenantId: string, groupLotId: string): Promise<string[]> {
    const r = await tx.query<{ farmer_user_id: string }>(`SELECT farmer_user_id FROM group_lot_pledges WHERE group_lot_id=$1 AND tenant_id=$2 AND status='active' AND deleted_at IS NULL`, [groupLotId, tenantId]);
    return r.rows.map((x) => x.farmer_user_id);
  }
  async pledgeOf(tenantId: string, groupLotId: string, farmerUserId: string): Promise<PledgeRow | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${PLEDGE_COLS} FROM group_lot_pledges p WHERE p.group_lot_id=$1 AND p.tenant_id=$2 AND p.farmer_user_id=$3 AND p.deleted_at IS NULL`, [groupLotId, tenantId, farmerUserId]);
    return r.rows[0] ? toPledge(r.rows[0]) : null;
  }
  /** F-19 — the coordinator's table: every pledge with the person's name, phone (masked by the caller) and per-role KYC. */
  async pledgesWithPeople(tenantId: string, groupLotId: string): Promise<PledgePersonRow[]> {
    const r = await this.replica.forTenant(tenantId).query<any>(
      `SELECT ${PLEDGE_COLS}, u.full_name, u.phone,
              COALESCE((SELECT json_agg(json_build_object('roleCode', ro.code, 'kycStatus', utr.kyc_status::text) ORDER BY ro.code)
                          FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
                         WHERE utr.user_id = p.farmer_user_id AND utr.tenant_id = p.tenant_id AND utr.is_active AND utr.deleted_at IS NULL), '[]'::json) AS roles
         FROM group_lot_pledges p LEFT JOIN users u ON u.id = p.farmer_user_id
        WHERE p.group_lot_id=$1 AND p.tenant_id=$2 AND p.deleted_at IS NULL
        ORDER BY (p.status = 'active') DESC, p.quantity DESC, p.created_at, p.id`, [groupLotId, tenantId]);
    return r.rows.map((x: any) => ({ ...toPledge(x), fullName: x.full_name ?? null, phone: x.phone ?? null, roles: Array.isArray(x.roles) ? x.roles : [] }));
  }
  async stampSettledShare(tx: TxContext, tenantId: string, pledgeId: string, shareMinor: bigint, txnId: string): Promise<void> {
    const r = await tx.query(`UPDATE group_lot_pledges SET settled_share_minor=$3, settlement_txn_id=$4, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND status='active'`,
      [pledgeId, tenantId, shareMinor.toString(), txnId]);
    if (r.rowCount !== 1) throw new Error(`group_lot_pledges stamp touched ${r.rowCount} rows for ${pledgeId}`);
  }

  // --- A5 nudge audience ---------------------------------------------------------------------------------------------------------
  /**
   * NON-PLEDGERS, defined from what the database records about crops: ACTIVE members of the tenant who either (a) have a crop
   * season of THIS product on a land parcel they own (`crop_seasons` → `land_parcels.owner_user_id`, not deleted), or (b) have
   * listed THIS product in this tenant before (`listings.seller_user_id`), and who hold NO active pledge in this lot. The
   * coordinator is never nudged about their own lot. Bounded by `limit` (the caller pages the fan-out).
   */
  async nudgeAudience(tx: TxContext, tenantId: string, lot: { id: string; productId: string; coordinatorUserId: string }, limit: number): Promise<{ userIds: string[]; truncated: boolean }> {
    const r = await tx.query<{ user_id: string }>(
      `WITH growers AS (
         SELECT lp.owner_user_id AS user_id FROM crop_seasons cs JOIN land_parcels lp ON lp.id = cs.parcel_id AND lp.tenant_id = cs.tenant_id
          WHERE cs.tenant_id = $1 AND cs.product_id = $2 AND cs.deleted_at IS NULL AND lp.deleted_at IS NULL
         UNION
         SELECT l.seller_user_id FROM listings l WHERE l.tenant_id = $1 AND l.product_id = $2 AND l.deleted_at IS NULL AND l.group_lot_id IS NULL
       )
       SELECT DISTINCT g.user_id FROM growers g
        WHERE g.user_id <> $4
          AND EXISTS (SELECT 1 FROM user_tenant_roles utr WHERE utr.user_id = g.user_id AND utr.tenant_id = $1 AND utr.is_active AND utr.deleted_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM group_lot_pledges p WHERE p.group_lot_id = $3 AND p.tenant_id = $1 AND p.farmer_user_id = g.user_id AND p.status = 'active')
        ORDER BY g.user_id LIMIT $5`, [tenantId, lot.productId, lot.id, lot.coordinatorUserId, limit + 1]);
    const ids = r.rows.map((x) => x.user_id);
    return { userIds: ids.slice(0, limit), truncated: ids.length > limit };
  }
}
