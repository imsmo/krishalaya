// modules/requirements/repositories/requirement.repository.ts
// All SQL for the requirements aggregate. tenant_id in EVERY query (Law 1) + RLS (auto-applied by
// migration 0014 — requirements predates it). NO version column (add_std_columns) → mutations LOCK
// the row with SELECT … FOR UPDATE. Reads on the replica.
//
// PC-56 TENANT-11d:
//   • F-25 — every list is a µs keyset: the cursor is minted from `created_at::text` (or the need-by date) and compared as
//     `$c::timestamptz`, so no row inside a page's boundary millisecond is skipped;
//   • A7 — `box=open` honours `status` (inside open | partially_matched); `box=all` is the desk's whole-tenant board; the
//     "Need by ▴" sort is a real keyset on (COALESCE(need_by,'infinity'), id); per-status counts in one GROUP BY;
//   • F-14 — `responsesCount` is a SQL count per row (one query per page, no N+1), never a client default;
//   • W131 / W132 — the buyer's and the posting desk's names come from `users` (short-named + masked in the service);
//   • F-1 / F-9 — the jobs claim PER TENANT in kv_app's unit of work (`dueToExpire` / `dueForReminder` take a tenant);
//     the only kv_relay read is `tenants`.
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Requirement } from '../domain/requirement.entity';
import { RequirementStatus } from '../domain/requirement.state';
import { Cursor } from '../domain/cursor';

const COLS = `id, tenant_id, buyer_user_id, product_id, category_id, title, quantity, unit_code,
  budget_min_minor, budget_max_minor, currency_code, need_by, delivery_pincode, status, is_urgent, created_at,
  req_no, fulfilled_quantity::text AS fulfilled_quantity, posted_by, post_consent_id, closed_at, closed_by, close_reason,
  created_at::text AS created_at_raw, COALESCE(need_by::text, 'infinity') AS need_by_raw`;
const big = (v: any) => (v == null ? null : BigInt(v));
function toDomain(r: any): Requirement {
  return Requirement.rehydrate({
    id: r.id, tenantId: r.tenant_id, buyerUserId: r.buyer_user_id, productId: r.product_id, categoryId: r.category_id,
    title: r.title, quantity: String(r.quantity), unitCode: r.unit_code, budgetMinMinor: big(r.budget_min_minor),
    budgetMaxMinor: big(r.budget_max_minor), currencyCode: r.currency_code, needBy: r.need_by, deliveryPincode: r.delivery_pincode,
    status: r.status as RequirementStatus, isUrgent: r.is_urgent, createdAt: r.created_at,
    reqNo: r.req_no ?? null, fulfilledQuantity: r.fulfilled_quantity ?? '0.000', postedBy: r.posted_by ?? null, postConsentId: r.post_consent_id ?? null,
    closedAt: r.closed_at ?? null, closedBy: r.closed_by ?? null, closeReason: r.close_reason ?? null,
  });
}
export interface ReqRow { entity: Requirement; createdAtRaw: string; needByRaw: string }
const toRow = (r: any): ReqRow => ({ entity: toDomain(r), createdAtRaw: r.created_at_raw, needByRaw: r.need_by_raw });

export interface ReqListQuery { box: 'open' | 'mine' | 'all'; buyerUserId?: string; status?: string; categoryId?: string; sort?: 'recent' | 'need_by'; cursor?: Cursor; limit: number; }
export interface ReqFacts { responsesCount: number; buyerName: string | null; buyerPhone: string | null; postedByName: string | null; productName: string | null }

@Injectable()
export class RequirementRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, r: Requirement): Promise<string> {
    const p = r.toProps();
    const res = await tx.query<{ req_no: string }>(
      `INSERT INTO requirements (id, tenant_id, buyer_user_id, product_id, category_id, title, quantity, unit_code,
         budget_min_minor, budget_max_minor, currency_code, need_by, delivery_pincode, status, is_urgent, created_by, posted_by, post_consent_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING req_no`,
      [p.id, p.tenantId, p.buyerUserId, p.productId, p.categoryId, p.title, p.quantity, p.unitCode,
       p.budgetMinMinor?.toString() ?? null, p.budgetMaxMinor?.toString() ?? null, p.currencyCode,
       p.needBy, p.deliveryPincode, p.status, p.isUrgent, p.postedBy ?? p.buyerUserId, p.postedBy ?? null, p.postConsentId ?? null]);
    return res.rows[0]?.req_no ?? '';
  }

  /** Lock the requirement row for a status mutation (serializes concurrent shortlist/accept/close). */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Requirement | null> {
    const r = await tx.query(`SELECT ${COLS} FROM requirements WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<Requirement | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM requirements WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getInTx(tx: TxContext, tenantId: string, id: string): Promise<Requirement | null> {
    const r = await tx.query(`SELECT ${COLS} FROM requirements WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** No version column → unconditional update within the FOR UPDATE-locked tx. Persists status + the editable fields, the
   *  fulfilled quantity and the close record. */
  async update(tx: TxContext, r: Requirement): Promise<void> {
    const p = r.toProps();
    await tx.query(
      `UPDATE requirements SET status=$3, title=$4, quantity=$5, unit_code=$6, product_id=$7, category_id=$8,
         budget_min_minor=$9, budget_max_minor=$10, need_by=$11, delivery_pincode=$12, is_urgent=$13,
         fulfilled_quantity=$14, closed_at=$15, closed_by=$16, close_reason=$17, updated_at=now()
        WHERE id=$1 AND tenant_id=$2`,
      [p.id, p.tenantId, p.status, p.title, p.quantity, p.unitCode, p.productId, p.categoryId,
       p.budgetMinMinor?.toString() ?? null, p.budgetMaxMinor?.toString() ?? null, p.needBy, p.deliveryPincode, p.isUrgent,
       p.fulfilledQuantity ?? '0', p.closedAt ?? null, p.closedBy ?? null, p.closeReason ?? null]);
  }
  async setPostConsent(tx: TxContext, tenantId: string, id: string, consentId: string): Promise<void> {
    await tx.query(`UPDATE requirements SET post_consent_id=$3 WHERE id=$1 AND tenant_id=$2`, [id, tenantId, consentId]);
  }

  /** The board (A7). Keyset — never OFFSET. `recent` = (created_at DESC, id DESC); `need_by` = (need-by ASC, no need-by last, id ASC). */
  async list(tenantId: string, q: ReqListQuery): Promise<ReqRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    if (q.box === 'open') where += ` AND status IN ('open','partially_matched')`;
    if (q.box === 'mine') where += ` AND buyer_user_id=${p(q.buyerUserId)}`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.categoryId) where += ` AND category_id=${p(q.categoryId)}`;
    let order = `created_at DESC, id DESC`;
    if (q.sort === 'need_by') {
      order = `COALESCE(need_by, 'infinity'::date) ASC, id ASC`;
      if (q.cursor && q.cursor.kind === 'need_by') { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (COALESCE(need_by, 'infinity'::date) > ${cc}::date OR (COALESCE(need_by, 'infinity'::date) = ${cc}::date AND id > ${ci}::uuid))`; }
    } else if (q.cursor && q.cursor.kind === 'created') {
      const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc}::timestamptz OR (created_at = ${cc}::timestamptz AND id < ${ci}::uuid))`;
    }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM requirements WHERE ${where} ORDER BY ${order} LIMIT ${lp}`, params);
    return r.rows.map(toRow);
  }
  /** Per-status counts for the same box (W131's tabs). */
  async countByStatus(tenantId: string, q: Pick<ReqListQuery, 'box' | 'buyerUserId' | 'categoryId'>): Promise<Record<string, number>> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    if (q.box === 'open') where += ` AND status IN ('open','partially_matched')`;
    if (q.box === 'mine') { params.push(q.buyerUserId); where += ` AND buyer_user_id=$${params.length}`; }
    if (q.categoryId) { params.push(q.categoryId); where += ` AND category_id=$${params.length}`; }
    const r = await this.replica.forTenant(tenantId).query(`SELECT status::text AS s, count(*)::int AS n FROM requirements WHERE ${where} GROUP BY status`, params);
    const out: Record<string, number> = {};
    for (const x of r.rows as Array<{ s: string; n: number }>) out[x.s] = x.n;
    return out;
  }
  /** F-14 / W131 — per row: the real response count, the buyer's (and the posting desk's) name + phone, the product name.
   *  ONE query for a page. */
  async factsFor(tenantId: string, ids: string[]): Promise<Map<string, ReqFacts>> {
    const out = new Map<string, ReqFacts>();
    if (ids.length === 0) return out;
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT q.id,
              (SELECT count(*)::int FROM requirement_responses x WHERE x.tenant_id=q.tenant_id AND x.requirement_id=q.id) AS responses,
              b.full_name AS buyer_name, b.phone AS buyer_phone, d.full_name AS posted_by_name, pr.default_name AS product_name
         FROM requirements q
         JOIN users b ON b.id = q.buyer_user_id
         LEFT JOIN users d ON d.id = q.posted_by
         LEFT JOIN products pr ON pr.id = q.product_id
        WHERE q.tenant_id=$1 AND q.id = ANY($2::uuid[])`, [tenantId, ids]);
    for (const x of r.rows as any[]) out.set(x.id, { responsesCount: x.responses, buyerName: x.buyer_name, buyerPhone: x.buyer_phone, postedByName: x.posted_by_name, productName: x.product_name });
    return out;
  }

  /** Is this user an ACTIVE member (any active role) of the tenant? The desk posts only for members; lines come only from members. */
  async isActiveMember(tx: TxContext, tenantId: string, userId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM user_tenant_roles WHERE tenant_id=$1 AND user_id=$2 AND is_active = true LIMIT 1`, [tenantId, userId]);
    return (r.rowCount ?? 0) > 0;
  }
  async userName(tx: TxContext, userId: string): Promise<string | null> {
    const r = await tx.query<{ full_name: string | null }>(`SELECT full_name FROM users WHERE id=$1`, [userId]);
    return r.rows[0]?.full_name ?? null;
  }

  // ---- the cadence sweeps (F-1 / F-9): tenants as kv_relay (granted since 0014); every claim per tenant as kv_app ----
  async activeTenants(pool: Pool): Promise<string[]> {
    const r = await pool.query(`SELECT id FROM tenants WHERE deleted_at IS NULL ORDER BY id`);
    return r.rows.map((x: { id: string }) => x.id);
  }
  /** Per-tenant claim (kv_app, RLS): open / partially_matched past need_by. The act re-locks and re-checks each row. */
  async dueToExpire(tx: TxContext, tenantId: string, now: Date, limit: number): Promise<string[]> {
    const r = await tx.query(
      `SELECT id FROM requirements WHERE tenant_id=$1 AND status IN ('open','partially_matched') AND need_by IS NOT NULL
          AND need_by < ($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date AND deleted_at IS NULL
        ORDER BY need_by, id LIMIT $3`, [tenantId, now, limit]);
    return r.rows.map((x: { id: string }) => x.id);
  }
  /** The expiry act's re-check under the row lock: need_by is before TODAY in India. */
  async isPastNeedBy(tx: TxContext, tenantId: string, id: string, now: Date): Promise<boolean> {
    const r = await tx.query<{ past: boolean }>(`SELECT (need_by IS NOT NULL AND need_by < ($3::timestamptz AT TIME ZONE 'Asia/Kolkata')::date) AS past FROM requirements WHERE tenant_id=$1 AND id=$2`, [tenantId, id, now]);
    return !!r.rows[0]?.past;
  }
  /** Per-tenant claim (kv_app): OPEN requirements within the need-by horizon not yet reminded. Locked SKIP LOCKED in the tx
   *  that emits the reminder and stamps `reminded_at`, so a re-run never re-nudges. */
  async dueForReminder(tx: TxContext, tenantId: string, now: Date, horizon: Date, limit: number): Promise<Array<{ id: string; buyerUserId: string; reqNo: string | null }>> {
    const r = await tx.query(
      `SELECT id, buyer_user_id, req_no FROM requirements
        WHERE tenant_id=$1 AND status IN ('open','partially_matched') AND reminded_at IS NULL AND deleted_at IS NULL
          AND need_by IS NOT NULL AND need_by >= ($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date AND need_by <= ($3::timestamptz AT TIME ZONE 'Asia/Kolkata')::date
        ORDER BY need_by, id LIMIT $4 FOR UPDATE SKIP LOCKED`, [tenantId, now, horizon, limit]);
    return r.rows.map((x: any) => ({ id: x.id, buyerUserId: x.buyer_user_id, reqNo: x.req_no ?? null }));
  }
  /** Stamp the rows the reminder job just nudged (idempotency marker). */
  async markReminded(tx: TxContext, tenantId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await tx.query(`UPDATE requirements SET reminded_at=now() WHERE tenant_id=$1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
  }

  /** WITHIN-TENANT match finder for the listing-published handler (runs in the relay tx, tenant_id set).
   *  OPEN requirements whose product or category equals the freshly-published listing's, EXCLUDING the
   *  buyer who is also the listing's seller (never nudge someone about their own listing). Bounded
   *  (LIMIT) to cap write-amplification when a hot category matches many requirements (§4/§5). */
  async findOpenMatching(tx: TxContext, tenantId: string, m: { productId?: string | null; categoryId?: string | null; excludeUserId?: string }, limit: number): Promise<Array<{ id: string; buyerUserId: string }>> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const ors: string[] = [];
    if (m.productId) ors.push(`product_id=${p(m.productId)}`);
    if (m.categoryId) ors.push(`category_id=${p(m.categoryId)}`);
    if (ors.length === 0) return [];
    let where = `tenant_id=$1 AND status IN ('open','partially_matched') AND (${ors.join(' OR ')})`;
    if (m.excludeUserId) where += ` AND buyer_user_id <> ${p(m.excludeUserId)}`;
    const lp = p(limit);
    const r = await tx.query(`SELECT id, buyer_user_id FROM requirements WHERE ${where} ORDER BY created_at DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({ id: x.id, buyerUserId: x.buyer_user_id }));
  }
}
