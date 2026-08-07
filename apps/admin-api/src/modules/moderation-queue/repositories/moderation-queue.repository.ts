// apps/admin-api/src/modules/moderation-queue/repositories/moderation-queue.repository.ts · ALL SQL for W090–W092.
//
// EVERY READ IS CROSS-TENANT WITH NO TENANT PREDICATE (Law 11). A fraud ring operates across tenants and a report
// queue scoped to one would be a queue nobody can work. Stated at the top so the absence reads as a decision.
//
// THIS FILE WRITES `listings.status`, WHICH IS TENANT-OWNED DATA, and that needs its justification stated once:
// `account_freeze_orders` (0033) established the pattern — the god-mode plane changes a tenant-owned row AND records
// the order in the same transaction, so who did it and why survives independently of the current state. The
// alternative shape (write a command, let apps/api apply it) was considered and rejected for this path specifically:
// W090's argument is that "a slow hold is itself harm" on perishable produce priced by the hour, and an async
// executor between the decision and the hold is exactly that slowness.
//
// The transition legality is checked in the domain against a NARROW mirror of apps/api's state machine — see
// `HOLDABLE_FROM` and the note there about why it is copied rather than imported.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import type { HoldAction, HoldSource } from '../domain/listing-hold';
import type { ReportRow, ReportStatus } from '../domain/report-triage';

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

export interface HeldListingRow {
  id: string; tenantId: string; title: string; status: string;
  priceMinor: string; quantityAvailable: string; unitCode: string;
  sellerUserId: string | null;
  heldAt: string | null; holdSlaDueAt: string | null; holdOrderId: string | null;
  holdReason: string | null; holdSource: string | null; holdActorAdminId: string | null;
  valueAtStakeMinor: string | null;
}

@Injectable()
export class ModerationQueueRepository {
  constructor(private readonly pool: AdminPool) {}

  /* ============================ W090 · the held queue ============================ */

  /** Worst-first by deadline, served by `idx_listings_held_queue` (0112). Ordered by the SLA rather than by age
   *  because the deadline is what a lead is paged on. */
  async listHeld(q: { cursor?: { d: string; id: string }; limit: number }): Promise<HeldListingRow[]> {
    const p: unknown[] = [];
    let w = 'l.held_at IS NOT NULL AND l.deleted_at IS NULL';
    if (q.cursor) { p.push(q.cursor.d, q.cursor.id); w += ` AND (l.hold_sla_due_at > $${p.length - 1} OR (l.hold_sla_due_at = $${p.length - 1} AND l.id > $${p.length}))`; }
    p.push(q.limit);
    const r = await this.pool.query(
      `SELECT l.id, l.tenant_id, l.title, l.status::text AS status, l.price_minor::text AS price_minor,
              l.quantity_available::text AS quantity_available, l.unit_code, l.seller_user_id,
              l.held_at, l.hold_sla_due_at, l.hold_order_id,
              o.reason AS hold_reason, o.source AS hold_source, o.actor_admin_id AS hold_actor,
              o.value_at_stake_minor::text AS value_at_stake_minor
         FROM listings l LEFT JOIN listing_moderation_orders o ON o.id = l.hold_order_id
        WHERE ${w} ORDER BY l.hold_sla_due_at ASC, l.id ASC LIMIT $${p.length}`, p);
    return r.rows.map(toHeld);
  }

  async getListing(id: string): Promise<HeldListingRow | null> {
    const r = await this.pool.query(
      `SELECT l.id, l.tenant_id, l.title, l.status::text AS status, l.price_minor::text AS price_minor,
              l.quantity_available::text AS quantity_available, l.unit_code, l.seller_user_id,
              l.held_at, l.hold_sla_due_at, l.hold_order_id,
              o.reason AS hold_reason, o.source AS hold_source, o.actor_admin_id AS hold_actor,
              o.value_at_stake_minor::text AS value_at_stake_minor
         FROM listings l LEFT JOIN listing_moderation_orders o ON o.id = l.hold_order_id
        WHERE l.id = $1 AND l.deleted_at IS NULL`, [id]);
    return r.rows[0] ? toHeld(r.rows[0]) : null;
  }

  async getListingForUpdate(c: PoolClient, id: string): Promise<HeldListingRow | null> {
    const r = await c.query(
      `SELECT l.id, l.tenant_id, l.title, l.status::text AS status, l.price_minor::text AS price_minor,
              l.quantity_available::text AS quantity_available, l.unit_code, l.seller_user_id,
              l.held_at, l.hold_sla_due_at, l.hold_order_id,
              NULL::text AS hold_reason, NULL::text AS hold_source, NULL::uuid AS hold_actor,
              NULL::text AS value_at_stake_minor
         FROM listings l WHERE l.id = $1 AND l.deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toHeld(r.rows[0]) : null;
  }

  /** The order row. `value_at_stake_minor` is passed as a STRING and cast in SQL — a bigint handed to node-postgres
   *  as a JS number is the one place Law 2 could be lost on the way out. */
  async insertOrder(c: PoolClient, v: {
    tenantId: string; listingId: string; action: HoldAction; source: HoldSource; sourceRef: string | null;
    reason: string; valueAtStakeMinor: bigint; actorAdminId: string; checkerAdminId?: string | null; checkerNote?: string | null;
  }): Promise<string> {
    const r = await c.query(
      `INSERT INTO listing_moderation_orders
         (tenant_id, listing_id, action, source, source_ref, reason, value_at_stake_minor, actor_admin_id,
          checker_admin_id, checked_at, checker_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7::bigint,$8,$9, CASE WHEN $9::uuid IS NULL THEN NULL ELSE now() END, $10)
       RETURNING id`,
      [v.tenantId, v.listingId, v.action, v.source, v.sourceRef, v.reason, v.valueAtStakeMinor.toString(),
        v.actorAdminId, v.checkerAdminId ?? null, v.checkerNote ?? null]);
    return r.rows[0].id;
  }

  /** Apply the hold. The status change and the hold metadata move together — a held listing with no deadline is the
   *  state `ck_listing_hold_pair` refuses, and writing them in one statement is what keeps that true. */
  async applyHold(c: PoolClient, listingId: string, orderId: string, slaDueAt: Date, actor: string): Promise<void> {
    await c.query(
      `UPDATE listings SET status = 'held', held_at = now(), hold_sla_due_at = $3, hold_order_id = $2, updated_by = $4, updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL`, [listingId, orderId, slaDueAt, actor]);
  }

  /** Release. The hold columns are CLEARED, so `held_at IS NOT NULL` (the queue's predicate) stops matching and the
   *  listing leaves the queue — rather than lingering with a satisfied flag somebody has to filter out. */
  async applyRelease(c: PoolClient, listingId: string, actor: string): Promise<void> {
    await c.query(
      `UPDATE listings SET status = 'published', held_at = NULL, hold_sla_due_at = NULL, hold_order_id = NULL, updated_by = $2, updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL`, [listingId, actor]);
  }

  /** Remove. `archived` is terminal in the listing state machine, which is what makes this irreversible — and is why
   *  it needs a second operator above the threshold. The hold columns are cleared for the same queue reason. */
  async applyRemoval(c: PoolClient, listingId: string, actor: string): Promise<void> {
    await c.query(
      `UPDATE listings SET status = 'archived', held_at = NULL, hold_sla_due_at = NULL, hold_order_id = NULL, updated_by = $2, updated_at = now()
         WHERE id = $1 AND deleted_at IS NULL`, [listingId, actor]);
  }

  async ordersFor(listingId: string, limit: number): Promise<any[]> {
    const r = await this.pool.query(
      `SELECT id, action, source, source_ref, reason, value_at_stake_minor::text AS value_at_stake_minor,
              actor_admin_id, checker_admin_id, checked_at, checker_note, created_at
         FROM listing_moderation_orders WHERE listing_id = $1 ORDER BY created_at DESC LIMIT $2`, [listingId, limit]);
    return r.rows.map((x: any) => ({
      id: x.id, action: x.action, source: x.source, sourceRef: x.source_ref ?? null, reason: x.reason,
      valueAtStakeMinor: x.value_at_stake_minor, actorAdminId: x.actor_admin_id,
      checkerAdminId: x.checker_admin_id ?? null, checkedAt: iso(x.checked_at), checkerNote: x.checker_note ?? null,
      createdAt: new Date(x.created_at).toISOString(),
    }));
  }

  /** W091's remove dialog: "logs a risk_event (fake_listing, weight −40) against the seller."
   *
   *  Written on REMOVE only, never on a hold — see 0112's closing note. `risk_events` has no FKs (hot-table
   *  convention, 0003) so the seller id goes in as a bare uuid, which is also why admin-api can write it at all. */
  async recordRiskEvent(c: PoolClient, v: { tenantId: string; userId: string; eventCode: string; weight: number; referenceId: string }): Promise<void> {
    await c.query(
      `INSERT INTO risk_events (id, tenant_id, user_id, event_code, weight, reference_type, reference_id, meta)
       VALUES (uuid_generate_v7(), $1, $2, $3, $4, 'listing_moderation_order', $5, '{}'::jsonb)`,
      [v.tenantId, v.userId, v.eventCode, v.weight, v.referenceId]);
  }

  /* ============================ W092 · the report queue ============================ */

  /** Cross-tenant, oldest-first, served by `idx_modreports_platform_queue` (0112) — the two pre-existing indexes both
   *  begin with tenant_id and cannot serve a platform queue.
   *
   *  The reason CODE is joined so triage can route on it. `reports_on_subject` is a correlated count and is allowed to
   *  be null: the domain reports an unknown count as unknown rather than as 1, because "this is the only report" is
   *  the reading that makes an operator dismiss something eighteen people flagged. */
  async listOpenReports(q: { subjectType?: string; cursor?: { c: string; id: string }; limit: number }): Promise<ReportRow[]> {
    const p: unknown[] = [];
    let w = "mr.status = 'open' AND mr.deleted_at IS NULL";
    if (q.subjectType) { p.push(q.subjectType); w += ` AND mr.subject_type = $${p.length}`; }
    if (q.cursor) { p.push(q.cursor.c, q.cursor.id); w += ` AND (mr.created_at > $${p.length - 1} OR (mr.created_at = $${p.length - 1} AND mr.id > $${p.length}))`; }
    p.push(q.limit);
    const r = await this.pool.query(
      `SELECT mr.id, mr.tenant_id, mr.subject_type, mr.subject_id, lv.code AS reason_code, mr.status,
              mr.action_taken, mr.handled_by, mr.handled_by_admin_id, mr.handled_at, mr.created_at,
              mr.reporter_user_id,
              (SELECT count(*)::int FROM moderation_reports x
                WHERE x.tenant_id = mr.tenant_id AND x.subject_type = mr.subject_type
                  AND x.subject_id = mr.subject_id AND x.deleted_at IS NULL) AS reports_on_subject
         FROM moderation_reports mr LEFT JOIN lookup_values lv ON lv.id = mr.reason_id
        WHERE ${w} ORDER BY mr.created_at ASC, mr.id ASC LIMIT $${p.length}`, p);
    return r.rows.map(toReport);
  }

  async getReportForUpdate(c: PoolClient, id: string): Promise<(ReportRow & { reporterUserId: string | null }) | null> {
    const r = await c.query(
      `SELECT mr.id, mr.tenant_id, mr.subject_type, mr.subject_id, lv.code AS reason_code, mr.status,
              mr.action_taken, mr.handled_by, mr.handled_by_admin_id, mr.handled_at, mr.created_at,
              mr.reporter_user_id, NULL::int AS reports_on_subject
         FROM moderation_reports mr LEFT JOIN lookup_values lv ON lv.id = mr.reason_id
        WHERE mr.id = $1 AND mr.deleted_at IS NULL FOR UPDATE OF mr`, [id]);
    return r.rows[0] ? (toReport(r.rows[0]) as ReportRow & { reporterUserId: string | null }) : null;
  }

  /** Record a PLATFORM decision. `handled_by` is left NULL and `handled_by_admin_id` set — exactly one, which
   *  `ck_modreport_one_handler` (0112) enforces. Writing both would be two people claiming one decision. */
  async decideReport(c: PoolClient, id: string, v: { status: ReportStatus; actionTaken: string | null; adminId: string }): Promise<void> {
    await c.query(
      `UPDATE moderation_reports
          SET status = $2, action_taken = $3, handled_by_admin_id = $4, handled_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'open' AND deleted_at IS NULL`,
      [id, v.status, v.actionTaken, v.adminId]);
  }

  async openReportCount(): Promise<number | null> {
    const r = await this.pool.query(
      `SELECT count(*)::int AS n FROM moderation_reports WHERE status = 'open' AND deleted_at IS NULL`);
    const n = r.rows[0]?.n;
    return Number.isFinite(Number(n)) ? Number(n) : null;
  }

  /* ============================ notices ============================ */

  /** Queue a decision notice. `queued` means NOTHING HAS BEEN SENT — the apps/api executor settles it through the
   *  notification spine, and nothing here ever writes `delivered`. Same law as ADMIN-1e's scheduled reports and
   *  ADMIN-2b's escalation steps. */
  async queueNotice(c: PoolClient, v: {
    tenantId: string; orderId?: string | null; reportId?: string | null;
    recipientKind: 'subject_owner' | 'reporter'; recipientUserId: string | null;
    body: string; languageCode: string; appealPath: string; idempotencyKey: string;
  }): Promise<string> {
    const r = await c.query(
      `INSERT INTO moderation_action_notices
         (tenant_id, order_id, report_id, recipient_kind, recipient_user_id, body, language_code, appeal_path, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [v.tenantId, v.orderId ?? null, v.reportId ?? null, v.recipientKind, v.recipientUserId,
        v.body, v.languageCode, v.appealPath, v.idempotencyKey]);
    return r.rows[0].id;
  }

  async noticesForOrder(orderId: string): Promise<any[]> {
    const r = await this.pool.query(
      `SELECT id, recipient_kind, recipient_user_id, status, detail, language_code, settled_at, attempts, created_at
         FROM moderation_action_notices WHERE order_id = $1 ORDER BY created_at ASC`, [orderId]);
    return r.rows.map((x: any) => ({
      id: x.id, recipientKind: x.recipient_kind, recipientUserId: x.recipient_user_id ?? null,
      status: x.status, detail: x.detail ?? null, languageCode: x.language_code,
      settledAt: iso(x.settled_at), attempts: Number(x.attempts), createdAt: new Date(x.created_at).toISOString(),
    }));
  }

  /** The active platform languages, so a notice cannot be composed in a language the spine cannot render. Same read
   *  the consent plane uses, and for the same reason: the language list is DATA. */
  async activeLanguages(): Promise<string[]> {
    const r = await this.pool.query(`SELECT code FROM languages WHERE is_active ORDER BY code`);
    return r.rows.map((x: any) => x.code);
  }
}

function toHeld(r: any): HeldListingRow {
  return {
    id: r.id, tenantId: r.tenant_id, title: r.title, status: r.status,
    priceMinor: r.price_minor, quantityAvailable: r.quantity_available, unitCode: r.unit_code,
    sellerUserId: r.seller_user_id ?? null,
    heldAt: iso(r.held_at), holdSlaDueAt: iso(r.hold_sla_due_at), holdOrderId: r.hold_order_id ?? null,
    holdReason: r.hold_reason ?? null, holdSource: r.hold_source ?? null, holdActorAdminId: r.hold_actor ?? null,
    valueAtStakeMinor: r.value_at_stake_minor ?? null,
  };
}

function toReport(r: any): ReportRow & { reporterUserId: string | null } {
  return {
    id: r.id, tenantId: r.tenant_id, subjectType: r.subject_type, subjectId: r.subject_id,
    reasonCode: r.reason_code ?? null, status: r.status, actionTaken: r.action_taken ?? null,
    handledBy: r.handled_by ?? null, handledByAdminId: r.handled_by_admin_id ?? null,
    handledAt: iso(r.handled_at), createdAt: new Date(r.created_at).toISOString(),
    reportsOnSubject: r.reports_on_subject === null || r.reports_on_subject === undefined ? null : Number(r.reports_on_subject),
    reporterUserId: r.reporter_user_id ?? null,
  };
}
