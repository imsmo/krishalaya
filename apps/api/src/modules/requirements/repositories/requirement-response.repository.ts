// modules/requirements/repositories/requirement-response.repository.ts
// All SQL for the requirement_responses (seller quotes) aggregate. tenant_id in EVERY query (Law 1) +
// RLS. UNIQUE (requirement_id, seller_user_id) — one quote per seller per requirement (insert uses
// ON CONFLICT DO NOTHING so a duplicate is detected, not a 500). No version column → FOR UPDATE.
//
// PC-56 TENANT-11d:
//   • F-27c — a seller's own view is filtered IN SQL (`seller_user_id = $n` before LIMIT), never after it;
//   • F-25 — the µs keyset (`created_at::text` cursor, compared as `::timestamptz`);
//   • A5 — the buyer / desk / moderator view carries the seller's name + phone (short-named and masked in the service), the
//     group id and the consent state;
//   • A1 / A2 — group_id, consent_id, accepted quantity / by / consent, order_id (written once, trigger trg_rr_order_once);
//   • F-1 / F-9 — the expiry claim is per tenant in kv_app's unit of work.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { RequirementResponse } from '../domain/requirement-response.entity';
import { ResponseStatus } from '../domain/requirement-response.state';
import { Cursor } from '../domain/cursor';

const COLS = `r.id, r.requirement_id, r.tenant_id, r.seller_user_id, r.listing_id, r.quoted_price_minor, r.quantity::text AS quantity, r.valid_until, r.message, r.status, r.created_at,
  r.group_id, r.consent_id, r.accepted_quantity::text AS accepted_quantity, r.accepted_at, r.accepted_by, r.decision_consent_id, r.order_id, r.submitted_by,
  r.created_at::text AS created_at_raw`;
function toDomain(r: any): RequirementResponse {
  return RequirementResponse.rehydrate({
    id: r.id, requirementId: r.requirement_id, tenantId: r.tenant_id, sellerUserId: r.seller_user_id, listingId: r.listing_id,
    quotedPriceMinor: BigInt(r.quoted_price_minor), quantity: String(r.quantity), validUntil: r.valid_until, message: r.message,
    status: r.status as ResponseStatus, createdAt: r.created_at,
    groupId: r.group_id ?? null, consentId: r.consent_id ?? null, acceptedQuantity: r.accepted_quantity ?? null, acceptedAt: r.accepted_at ?? null,
    acceptedBy: r.accepted_by ?? null, decisionConsentId: r.decision_consent_id ?? null, orderId: r.order_id ?? null, submittedBy: r.submitted_by ?? null,
  });
}
export interface RespListQuery { status?: string; sellerUserId?: string; cursor?: Cursor; limit: number; }
export interface RespRow { entity: RequirementResponse; createdAtRaw: string; sellerName: string | null; sellerPhone: string | null; listingTitle: string | null }

@Injectable()
export class RequirementResponseRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Insert a quote. Returns false on a (requirement, seller) uniqueness conflict (already quoted). */
  async insert(tx: TxContext, r: RequirementResponse): Promise<boolean> {
    const p = r.toProps();
    const res = await tx.query(
      `INSERT INTO requirement_responses (id, requirement_id, tenant_id, seller_user_id, listing_id, quoted_price_minor, quantity, valid_until, message, status,
         group_id, consent_id, submitted_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) ON CONFLICT (requirement_id, seller_user_id) DO NOTHING`,
      [p.id, p.requirementId, p.tenantId, p.sellerUserId, p.listingId, p.quotedPriceMinor.toString(), p.quantity, p.validUntil, p.message, p.status,
       p.groupId ?? null, p.consentId ?? null, p.submittedBy ?? p.sellerUserId]);
    return (res.rowCount ?? 0) > 0;
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<RequirementResponse | null> {
    const r = await tx.query(`SELECT ${COLS} FROM requirement_responses r WHERE r.id=$1 AND r.tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<RequirementResponse | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM requirement_responses r WHERE r.id=$1 AND r.tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Every response a pooled quote sent, locked (group accept / reject / withdraw decide them together). */
  async forGroupForUpdate(tx: TxContext, tenantId: string, groupId: string): Promise<RequirementResponse[]> {
    const r = await tx.query(`SELECT ${COLS} FROM requirement_responses r WHERE r.tenant_id=$1 AND r.group_id=$2 ORDER BY r.created_at, r.id FOR UPDATE`, [tenantId, groupId]);
    return r.rows.map(toDomain);
  }
  /** Members who already have a response on this requirement (one response per seller — UNIQUE). */
  async sellersWithResponse(tx: TxContext, tenantId: string, requirementId: string, sellerIds: string[]): Promise<string[]> {
    if (sellerIds.length === 0) return [];
    const r = await tx.query(`SELECT seller_user_id FROM requirement_responses WHERE tenant_id=$1 AND requirement_id=$2 AND seller_user_id = ANY($3::uuid[])`, [tenantId, requirementId, sellerIds]);
    return r.rows.map((x: { seller_user_id: string }) => x.seller_user_id);
  }
  async update(tx: TxContext, r: RequirementResponse): Promise<void> {
    const p = r.toProps();
    await tx.query(
      `UPDATE requirement_responses SET status=$3, accepted_quantity=$4, accepted_at=$5, accepted_by=$6, decision_consent_id=$7, updated_by=$8, updated_at=now()
        WHERE id=$1 AND tenant_id=$2`,
      [p.id, p.tenantId, p.status, p.acceptedQuantity ?? null, p.acceptedAt ?? null, p.acceptedBy ?? null, p.decisionConsentId ?? null, p.acceptedBy ?? null]);
  }

  /** Quotes on a requirement. Keyset — never OFFSET. `sellerUserId` narrows to one seller's own quote IN SQL (F-27c). */
  async listForRequirement(tenantId: string, requirementId: string, q: RespListQuery): Promise<RespRow[]> {
    const params: unknown[] = [tenantId, requirementId];
    let where = `r.tenant_id=$1 AND r.requirement_id=$2`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.sellerUserId) where += ` AND r.seller_user_id=${p(q.sellerUserId)}`;
    if (q.status) where += ` AND r.status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (r.created_at < ${cc}::timestamptz OR (r.created_at = ${cc}::timestamptz AND r.id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS}, u.full_name AS seller_name, u.phone AS seller_phone, l.title AS listing_title
         FROM requirement_responses r JOIN users u ON u.id = r.seller_user_id LEFT JOIN listings l ON l.id = r.listing_id
        WHERE ${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({ entity: toDomain(x), createdAtRaw: x.created_at_raw, sellerName: x.seller_name, sellerPhone: x.seller_phone, listingTitle: x.listing_title }));
  }

  // ---- orders' QuoteAcceptedHandler (through RequirementOrderService, in kv_app's unit of work) ----
  /** The accepted response, locked, with what its ONE order needs: the requirement's unit and currency. */
  async acceptedForOrder(tx: TxContext, tenantId: string, id: string): Promise<{
    id: string; status: string; orderId: string | null; requirementId: string; buyerUserId: string; sellerUserId: string; listingId: string | null;
    quotedPriceMinor: bigint; acceptedQuantity: string | null; unitCode: string; currencyCode: string; groupId: string | null;
  } | null> {
    const r = await tx.query(
      `SELECT r.id, r.status, r.order_id, r.requirement_id, q.buyer_user_id, r.seller_user_id, r.listing_id, r.quoted_price_minor::text AS price,
              r.accepted_quantity::text AS accepted_quantity, q.unit_code, q.currency_code, r.group_id
         FROM requirement_responses r JOIN requirements q ON q.id = r.requirement_id AND q.tenant_id = r.tenant_id
        WHERE r.tenant_id=$1 AND r.id=$2 FOR UPDATE OF r`, [tenantId, id]);
    const x: any = r.rows[0];
    if (!x) return null;
    return { id: x.id, status: x.status, orderId: x.order_id ?? null, requirementId: x.requirement_id, buyerUserId: x.buyer_user_id, sellerUserId: x.seller_user_id,
      listingId: x.listing_id, quotedPriceMinor: BigInt(x.price), acceptedQuantity: x.accepted_quantity ?? null, unitCode: x.unit_code, currencyCode: x.currency_code, groupId: x.group_id ?? null };
  }
  async attachOrder(tx: TxContext, tenantId: string, id: string, orderId: string): Promise<void> {
    const r = await tx.query(`UPDATE requirement_responses SET order_id=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND order_id IS NULL AND status='accepted'`, [id, tenantId, orderId]);
    if (r.rowCount !== 1) throw new Error(`requirement_responses.order_id write touched ${r.rowCount} rows for ${id}`);
  }

  /** Per-tenant claim (kv_app, RLS): live quotes past valid_until. The act re-locks and re-checks each row. */
  async dueToExpire(tx: TxContext, tenantId: string, now: Date, limit: number): Promise<string[]> {
    const r = await tx.query(
      `SELECT id FROM requirement_responses WHERE tenant_id=$1 AND status IN ('submitted','shortlisted') AND valid_until IS NOT NULL AND valid_until < $2
        ORDER BY valid_until, id LIMIT $3`, [tenantId, now, limit]);
    return r.rows.map((x: { id: string }) => x.id);
  }
}
