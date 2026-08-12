// modules/disputes/read-models/dispute-console.read-model.ts · W140's KPIs and queue, W141's money state, W142's
// returns queue (PC-56 TENANT-3b). Replica-backed, tenant-scoped (Law 1), keyset only.
//
// **A READ-MODEL IS THE ONE PLACE THAT MAY READ ANOTHER MODULE'S TABLE** (the blueprint's rule forbids importing
// another module's REPOSITORIES; TENANT-3a's order console already reads `disputes` from the orders module for the
// same reason). Here the crossings are `orders` for the order number and currency, `payments` for whether a gross was
// ever captured, and `settlement_lines` for whether the money already left escrow — none of which the disputes
// module owns, and all of which a dispute's money card must say out loud.
//
// **AND THE PAGER IS KEYSET, WITH COUNTS INSTEAD OF PAGE NUMBERS.** W140 draws "1 2" and "Showing 3 highlighted of 34
// disputes (90d)". A page-number pager needs COUNT(*) over a filtered set on every keystroke; the counts here are
// four bounded aggregates over an indexed window, and the list itself is a cursor (the roster rule, fourth
// application).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { DISPUTE_VIEWS, DisputeView, statusesInDisputeView, viewOfDisputeStatus } from '../domain/dispute-console';

export interface DisputeQueueRow {
  id: string; status: string; reasonCode: string | null; orderId: string; orderNo: string | null;
  raisedBy: string; raisedByName: string | null; againstUser: string; againstUserName: string | null;
  disputedAmountMinor: string | null; disputedQuantity: string | null; currencyCode: string | null;
  slaDueAt: string | null; sellerRespondBy: string | null; createdAt: string;
  aiTriageConfidence: string | null; aiTriageClassification: string | null;
  /** A pending refund proposal on this dispute — W140's queue must show that money is already waiting on a checker. */
  pendingApprovalId: string | null;
}

export interface DisputeKpis {
  activeCount: number;
  /** The canon's delta "both under 24h old", as the figure behind it rather than the sentence. */
  activeUnder24h: number;
  escalatedCount: number;
  /** Median resolution time over 90 days, in hours. **null MEANS NO DISPUTE CLOSED IN THE WINDOW** — not zero, which
   *  would read as "we resolve instantly" on a tenant that has never resolved anything. */
  medianResolutionHours: number | null;
  resolvedInWindow: number;
  outcomes: { raiser: number; respondent: number; amicable: number; noDecision: number };
  /** Closed disputes whose parties cannot be named (no dispute_eligibility row). Counted and SAID, never folded
   *  into one of the two sides — an unattributable outcome is not evidence about either party. */
  outcomeUnknownParty: number;
  windowDays: number;
}

export interface ReturnQueueRow {
  id: string; status: string; reasonCode: string | null; orderId: string; orderNo: string | null;
  refundAmountMinor: string | null; currencyCode: string | null; inspectedAt: string | null;
  createdAt: string; pendingApprovalId: string | null;
}

@Injectable()
export class DisputeConsoleReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Counts per W140 tab. One GROUP BY folded through the ONE status→view mapping; an unmapped status is counted as
   *  `unmapped` and surfaced rather than dropped. */
  async viewCounts(tenantId: string, windowDays = 90): Promise<Record<DisputeView, number> & { all: number; unmapped: number }> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query<{ status: string; n: number }>(
      `SELECT status, COUNT(*)::int AS n FROM disputes
        WHERE tenant_id = $1 AND deleted_at IS NULL
          -- the closed tab is a 90-day window (W140's "closed (90d)"); open work is never windowed away, because a
          -- dispute older than the window is exactly the one somebody forgot.
          AND (status NOT IN ('resolved','rejected','withdrawn') OR created_at >= now() - ($2 || ' days')::interval)
        GROUP BY status`, [tenantId, String(windowDays)]);
    const out = Object.fromEntries(DISPUTE_VIEWS.map((v) => [v, 0])) as Record<DisputeView, number> & { all: number; unmapped: number };
    out.all = 0; out.unmapped = 0;
    for (const row of r.rows) {
      const v = viewOfDisputeStatus(row.status);
      if (v) out[v] += row.n; else out.unmapped += row.n;
      out.all += row.n;
    }
    return out;
  }

  /** W140's four KPI cards. Every figure has a basis; `medianResolutionHours` is null rather than 0 when the window
   *  holds no closed dispute. */
  async kpis(tenantId: string, windowDays = 90): Promise<DisputeKpis> {
    const pool = await this.replica.forTenant(tenantId);
    const w = String(windowDays);
    const r = await pool.query(
      `WITH active AS (
         SELECT COUNT(*)::int AS n,
                COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS n24
           FROM disputes
          WHERE tenant_id = $1 AND deleted_at IS NULL AND status IN ('open','seller_responded','under_review')
       ), esc AS (
         SELECT COUNT(*)::int AS n FROM disputes
          WHERE tenant_id = $1 AND deleted_at IS NULL AND status = 'escalated'
       ), closed AS (
         SELECT d.resolution_type, d.status, d.raised_by, e.buyer_user_id, e.seller_user_id,
                EXTRACT(EPOCH FROM (d.resolved_at - d.created_at)) AS secs
           FROM disputes d
           LEFT JOIN dispute_eligibility e ON e.order_id = d.order_id AND e.tenant_id = d.tenant_id
          WHERE d.tenant_id = $1 AND d.deleted_at IS NULL
            AND d.status IN ('resolved','rejected','withdrawn')
            AND d.created_at >= now() - ($2 || ' days')::interval
       )
       SELECT (SELECT n FROM active) AS active_n, (SELECT n24 FROM active) AS active_24,
              (SELECT n FROM esc) AS escalated_n,
              (SELECT COUNT(*)::int FROM closed) AS closed_n,
              -- percentile_cont over the resolved rows only: a withdrawn dispute has no resolution TIME, and
              -- counting it as zero hours would make a tenant's median look better the more people gave up.
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) FROM closed WHERE secs IS NOT NULL) AS median_secs,
              (SELECT COUNT(*)::int FROM closed WHERE resolution_type IN ('refund_full','refund_partial')) AS side_raiser,
              (SELECT COUNT(*)::int FROM closed WHERE resolution_type = 'rejected' OR status = 'rejected') AS side_respondent,
              (SELECT COUNT(*)::int FROM closed WHERE resolution_type = 'replacement') AS side_amicable,
              (SELECT COUNT(*)::int FROM closed WHERE status = 'withdrawn') AS side_none,
              (SELECT COUNT(*)::int FROM closed WHERE buyer_user_id IS NULL) AS unknown_party`,
      [tenantId, w]);
    const x = r.rows[0] ?? {};
    const medianSecs = x.median_secs == null ? null : Number(x.median_secs);
    return {
      activeCount: x.active_n ?? 0,
      activeUnder24h: x.active_24 ?? 0,
      escalatedCount: x.escalated_n ?? 0,
      medianResolutionHours: medianSecs == null ? null : Math.round((medianSecs / 3600) * 10) / 10,
      resolvedInWindow: x.closed_n ?? 0,
      outcomes: {
        raiser: x.side_raiser ?? 0, respondent: x.side_respondent ?? 0,
        amicable: x.side_amicable ?? 0, noDecision: x.side_none ?? 0,
      },
      outcomeUnknownParty: x.unknown_party ?? 0,
      windowDays,
    };
  }

  /** W140's table. Keyset on (created_at, id); the SLA clock is computed by the caller from `slaDueAt` (no stored
   *  "breached" flag — 0139's §139.6 says why). */
  async queue(tenantId: string, q: { view?: DisputeView; cursor?: { c: string; id: string } | null; limit: number }): Promise<DisputeQueueRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `d.tenant_id = $1 AND d.deleted_at IS NULL`;
    if (q.view) where += ` AND d.status = ANY(${p(statusesInDisputeView(q.view))}::text[])`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (d.created_at < ${cc} OR (d.created_at = ${cc} AND d.id < ${ci}))`; }
    const lp = p(Math.min(Math.max(q.limit, 1), 100));
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT d.id, d.status, lv.code AS "reasonCode", d.order_id AS "orderId", o.order_no AS "orderNo",
              d.raised_by AS "raisedBy", ru.full_name AS "raisedByName",
              d.against_user AS "againstUser", au.full_name AS "againstUserName",
              d.disputed_amount_minor::text AS "disputedAmountMinor", d.disputed_quantity::text AS "disputedQuantity",
              o.currency_code AS "currencyCode",
              d.sla_due_at AS "slaDueAt", d.seller_respond_by AS "sellerRespondBy", d.created_at AS "createdAt",
              (d.ai_triage->>'confidence') AS "aiTriageConfidence",
              (d.ai_triage->>'classification') AS "aiTriageClassification",
              (SELECT ra.id FROM refund_approvals ra
                WHERE ra.tenant_id = d.tenant_id AND ra.subject_type = 'dispute' AND ra.subject_id = d.id
                  AND ra.status = 'pending' AND ra.deleted_at IS NULL LIMIT 1) AS "pendingApprovalId"
         FROM disputes d
         LEFT JOIN lookup_values lv ON lv.id = d.reason_id
         LEFT JOIN users ru ON ru.id = d.raised_by
         LEFT JOIN users au ON au.id = d.against_user
         -- the order id is not a v7-prunable key here (it comes from the dispute row), so the join carries the
         -- tenant AND the order's own partition key is not available — an order that has aged out of the pruned
         -- window shows a null order number rather than failing the whole queue (Law 12).
         LEFT JOIN orders o ON o.id = d.order_id AND o.tenant_id = d.tenant_id
        WHERE ${where}
        ORDER BY d.created_at DESC, d.id DESC LIMIT ${lp}`, params);
    return r.rows;
  }

  /** W141's money card, from the ledger's own facts: was a gross ever captured, and has it already been settled to
   *  the seller? Both answers feed `disputeMoneyState`, which composes the sentences. */
  async moneyFacts(tenantId: string, disputeId: string): Promise<{
    orderId: string; orderNo: string | null; currencyCode: string | null;
    paymentGrossMinor: string | null; settled: boolean;
    disputedAmountMinor: string | null; disputedQuantity: string | null;
    resolutionAmountMinor: string | null; resolutionTxnId: string | null;
  } | null> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT d.order_id AS "orderId", o.order_no AS "orderNo", o.currency_code AS "currencyCode",
              -- payments keys an order by (reference_type, reference_id), NOT by an order_id column — the same shape
              -- PaymentRepository.findSuccessByOrder uses. A read written against an order_id column would return
              -- NULL for every order, and the money card would say "no escrowed payment" about every dispute.
              (SELECT pm.amount_minor::text FROM payments pm
                WHERE pm.tenant_id = d.tenant_id AND pm.reference_type = 'order' AND pm.reference_id = d.order_id
                  AND pm.status = 'success'
                ORDER BY pm.created_at DESC LIMIT 1) AS "paymentGrossMinor",
              EXISTS (SELECT 1 FROM settlement_lines sl
                       WHERE sl.tenant_id = d.tenant_id AND sl.order_id = d.order_id) AS settled,
              d.disputed_amount_minor::text AS "disputedAmountMinor", d.disputed_quantity::text AS "disputedQuantity",
              d.resolution_amount_minor::text AS "resolutionAmountMinor", d.resolution_txn_id AS "resolutionTxnId"
         FROM disputes d
         LEFT JOIN orders o ON o.id = d.order_id AND o.tenant_id = d.tenant_id
        WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL
        LIMIT 1`, [tenantId, disputeId]);
    return r.rows[0] ?? null;
  }

  /** W142's returns queue: the amount 0139 gave the table, the inspection state its "Inspect" action writes, and
   *  whether a refund on this return is already waiting on a checker. */
  async returnsQueue(tenantId: string, q: { status?: string; cursor?: { c: string; id: string } | null; limit: number }): Promise<ReturnQueueRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `r.tenant_id = $1 AND r.deleted_at IS NULL`;
    if (q.status) where += ` AND r.status = ${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (r.created_at < ${cc} OR (r.created_at = ${cc} AND r.id < ${ci}))`; }
    const lp = p(Math.min(Math.max(q.limit, 1), 100));
    const pool = await this.replica.forTenant(tenantId);
    const rows = await pool.query(
      `SELECT r.id, r.status, lv.code AS "reasonCode", r.order_id AS "orderId", o.order_no AS "orderNo",
              r.refund_amount_minor::text AS "refundAmountMinor", o.currency_code AS "currencyCode",
              r.inspected_at AS "inspectedAt", r.created_at AS "createdAt",
              (SELECT ra.id FROM refund_approvals ra
                WHERE ra.tenant_id = r.tenant_id AND ra.subject_type = 'return' AND ra.subject_id = r.id
                  AND ra.status = 'pending' AND ra.deleted_at IS NULL LIMIT 1) AS "pendingApprovalId"
         FROM returns r
         LEFT JOIN lookup_values lv ON lv.id = r.reason_id
         LEFT JOIN orders o ON o.id = r.order_id AND o.tenant_id = r.tenant_id
        WHERE ${where}
        ORDER BY r.created_at DESC, r.id DESC LIMIT ${lp}`, params);
    return rows.rows;
  }

  /** W142's tab counts, over the six-state return machine. */
  async returnCounts(tenantId: string): Promise<Record<string, number> & { all: number }> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query<{ status: string; n: number }>(
      `SELECT status, COUNT(*)::int AS n FROM returns WHERE tenant_id = $1 AND deleted_at IS NULL GROUP BY status`, [tenantId]);
    const out: Record<string, number> & { all: number } = { all: 0 };
    for (const row of r.rows) { out[row.status] = row.n; out.all += row.n; }
    return out;
  }
}
