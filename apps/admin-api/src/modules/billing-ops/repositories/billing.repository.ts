// apps/admin-api/src/modules/billing-ops/repositories/billing.repository.ts · ALL SQL for billing-ops. READS:
// saas_invoices (keyset list + single + FOR UPDATE), dunning attempts (keyset), billing_adjustments (keyset +
// by-idempotency-key), and the revenue rollup over subscriptions/saas_invoices. WRITES (in the caller's tx):
// invoice status transition, dunning attempt + counter bump, billing_adjustment record. It NEVER touches
// ledger_entries/ledger_transactions/wallet_accounts — money moves only via the wallet-service (Law 2/9). Money
// is bigint, surfaced as STRING minor units (never floated). Parameterised only; keyset (never OFFSET); bounded.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import { SaasInvoice, parseLineItems } from '../domain/invoice.entity';
import { InvoiceStatus } from '../domain/invoice.state';

function toInvoice(r: any): SaasInvoice {
  return SaasInvoice.rehydrate({
    id: r.id, tenantId: r.tenant_id, subscriptionId: r.subscription_id ?? null, invoiceNo: r.invoice_no,
    status: r.status as InvoiceStatus, currencyCode: r.currency_code,
    subtotalMinor: BigInt(r.subtotal_minor), taxMinor: BigInt(r.tax_minor), totalMinor: BigInt(r.total_minor),
    dueDate: r.due_date, paidAt: r.paid_at ?? null, dunningAttempts: r.dunning_attempts ?? 0,
    lastDunnedAt: r.last_dunned_at ?? null, createdAt: r.created_at ?? null,
    // present only on the DETAIL select (the list deliberately does not carry lines — see getInvoice)
    lineItems: r.line_items === undefined ? undefined : parseLineItems(r.line_items),
    pdfMediaId: r.pdf_media_id ?? null,
  });
}

export interface InvoiceListQuery { tenantId?: string; status?: InvoiceStatus; cursor?: { c: string; id: string }; limit: number; }
export interface AdjustmentListQuery { tenantId?: string; cursor?: { c: string; id: string }; limit: number; }
export interface DunningListQuery { invoiceId: string; cursor?: { c: string; id: string }; limit: number; }

export interface AdjustmentRow {
  id: string; tenantId: string; subscriptionId: string | null; invoiceId: string | null;
  direction: string; amountMinor: string; currency: string; reason: string; walletTxnId: string; createdAt: Date | null;
}
function toAdjustment(r: any): AdjustmentRow {
  return { id: r.id, tenantId: r.tenant_id, subscriptionId: r.subscription_id ?? null, invoiceId: r.invoice_id ?? null,
    direction: r.direction, amountMinor: String(r.amount_minor), currency: r.currency_code, reason: r.reason,
    walletTxnId: r.wallet_txn_id, createdAt: r.created_at ?? null };
}

@Injectable()
export class BillingRepository {
  constructor(private readonly pool: AdminPool) {}

  /* ---------------- saas_invoices ---------------- */
  async listInvoices(q: InvoiceListQuery): Promise<SaasInvoice[]> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'deleted_at IS NULL';
    if (q.tenantId) where += ` AND tenant_id=${p(q.tenantId)}`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(
      `SELECT id, tenant_id, subscription_id, invoice_no, status, currency_code, subtotal_minor, tax_minor, total_minor,
              due_date, paid_at, dunning_attempts, last_dunned_at, created_at
         FROM saas_invoices WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toInvoice);
  }

  async getInvoice(id: string): Promise<SaasInvoice | null> {
    const r = await this.pool.query(
      `SELECT id, tenant_id, subscription_id, invoice_no, status, currency_code, subtotal_minor, tax_minor, total_minor,
              due_date, paid_at, dunning_attempts, last_dunned_at, created_at, line_items, pdf_media_id
         FROM saas_invoices WHERE id=$1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toInvoice(r.rows[0]) : null;
  }

  async getInvoiceForUpdate(client: PoolClient, id: string): Promise<SaasInvoice | null> {
    const r = await client.query(
      `SELECT id, tenant_id, subscription_id, invoice_no, status, currency_code, subtotal_minor, tax_minor, total_minor,
              due_date, paid_at, dunning_attempts, last_dunned_at, created_at
         FROM saas_invoices WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toInvoice(r.rows[0]) : null;
  }

  async updateInvoiceStatus(client: PoolClient, id: string, status: InvoiceStatus, actorUserId: string): Promise<void> {
    await client.query(`UPDATE saas_invoices SET status=$2, updated_by=$3, updated_at=now() WHERE id=$1`, [id, status, actorUserId]);
  }

  /* ---------------- dunning ---------------- */
  async insertDunningAttempt(client: PoolClient, a: { invoiceId: string; tenantId: string; attemptNo: number; channel: string; outcome: string; note: string | null; actorUserId: string }): Promise<void> {
    await client.query(
      `INSERT INTO saas_invoice_dunning_attempts (invoice_id, tenant_id, attempt_no, channel, outcome, note, actor_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [a.invoiceId, a.tenantId, a.attemptNo, a.channel, a.outcome, a.note, a.actorUserId]);
  }
  async bumpInvoiceDunning(client: PoolClient, invoiceId: string, attemptNo: number): Promise<void> {
    await client.query(`UPDATE saas_invoices SET dunning_attempts=$2, last_dunned_at=now() WHERE id=$1`, [invoiceId, attemptNo]);
  }
  async listDunning(q: DunningListQuery): Promise<any[]> {
    const params: unknown[] = [q.invoiceId]; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'invoice_id=$1';
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(
      `SELECT id, invoice_id, attempt_no, channel, outcome, note, actor_user_id, created_at
         FROM saas_invoice_dunning_attempts WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({ id: x.id, invoiceId: x.invoice_id, attemptNo: x.attempt_no, channel: x.channel, outcome: x.outcome, note: x.note ?? null, actorUserId: x.actor_user_id, createdAt: x.created_at }));
  }

  /* ---------------- billing_adjustments ---------------- */
  async tenantExists(tenantId: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM tenants WHERE id=$1`, [tenantId]);
    return (r.rowCount ?? 0) > 0;
  }
  async getAdjustmentByKey(idempotencyKey: string): Promise<AdjustmentRow | null> {
    const r = await this.pool.query(
      `SELECT id, tenant_id, subscription_id, invoice_id, direction, amount_minor, currency_code, reason, wallet_txn_id, created_at
         FROM billing_adjustments WHERE idempotency_key=$1`, [idempotencyKey]);
    return r.rows[0] ? toAdjustment(r.rows[0]) : null;
  }
  /** Insert the applied-adjustment record. Idempotent: a concurrent duplicate key yields the existing row. */
  async insertAdjustment(client: PoolClient, a: { id: string; tenantId: string; subscriptionId: string | null; invoiceId: string | null; direction: string; amountMinor: bigint; currency: string; reason: string; idempotencyKey: string; walletTxnId: string; actorUserId: string }): Promise<AdjustmentRow> {
    const r = await client.query(
      `INSERT INTO billing_adjustments (id, tenant_id, subscription_id, invoice_id, direction, amount_minor, currency_code, reason, idempotency_key, wallet_txn_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id, tenant_id, subscription_id, invoice_id, direction, amount_minor, currency_code, reason, wallet_txn_id, created_at`,
      [a.id, a.tenantId, a.subscriptionId, a.invoiceId, a.direction, a.amountMinor.toString(), a.currency, a.reason, a.idempotencyKey, a.walletTxnId, a.actorUserId]);
    if (r.rows[0]) return toAdjustment(r.rows[0]);
    const existing = await client.query(
      `SELECT id, tenant_id, subscription_id, invoice_id, direction, amount_minor, currency_code, reason, wallet_txn_id, created_at
         FROM billing_adjustments WHERE idempotency_key=$1`, [a.idempotencyKey]);
    return toAdjustment(existing.rows[0]);
  }
  async listAdjustments(q: AdjustmentListQuery): Promise<AdjustmentRow[]> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'deleted_at IS NULL';
    if (q.tenantId) where += ` AND tenant_id=${p(q.tenantId)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(
      `SELECT id, tenant_id, subscription_id, invoice_id, direction, amount_minor, currency_code, reason, wallet_txn_id, created_at
         FROM billing_adjustments WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toAdjustment);
  }

  /* ---------------- dunning QUEUE (cross-invoice collection view · PC-56 ADMIN-1) ---------------- */
  // The per-invoice attempt history already existed; what did not was the view a collections officer actually works
  // from — every unpaid invoice across every tenant, worst-first. This is a READ over saas_invoices + subscriptions,
  // no new state: `dunning_attempts` (the denormalised counter this module already bumps) IS the ladder step, and
  // days-late is arithmetic on due_date. Keyset by (days late desc, id) so a page boundary cannot hide a debtor.
  //
  // OUTSTANDING IS DELIBERATELY NULL FOR A PART-PAID INVOICE. `invoice_status` can reach 'partially_paid', but the
  // platform stores no SaaS-invoice PAYMENTS table (0002/0035) — the amount received is nowhere. Returning
  // total_minor would overstate the debt and returning 0 would understate it; both send someone to chase a wrong
  // number. Queued as a GAP-BACKEND (saas invoice payments) rather than papered over here.
  async dunningQueue(q: { minDaysLate?: number; cursor?: { d: number; id: string }; limit: number }): Promise<Array<{
    invoiceId: string; invoiceNo: string; tenantId: string; tenantSlug: string | null; status: string;
    currency: string; totalMinor: string; outstandingMinor: string | null; outstandingUnknownReason: string | null;
    dueDate: string; daysLate: number; dunningAttempts: number; lastDunnedAt: Date | null;
    subscriptionStatus: string | null; cancelAtPeriodEnd: boolean | null;
  }>> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    // 'draft' is not collectible (never sent) and 'paid'/'void' are done — the queue is exactly what is owed now.
    let where = `i.deleted_at IS NULL AND i.status IN ('issued','partially_paid','overdue')`;
    if (q.minDaysLate !== undefined) where += ` AND (CURRENT_DATE - i.due_date) >= ${p(q.minDaysLate)}`;
    if (q.cursor) {
      const cd = p(q.cursor.d), ci = p(q.cursor.id);
      where += ` AND ((CURRENT_DATE - i.due_date) < ${cd} OR ((CURRENT_DATE - i.due_date) = ${cd} AND i.id < ${ci}))`;
    }
    const lp = p(q.limit);
    const r = await this.pool.query(
      `SELECT i.id, i.invoice_no, i.tenant_id, t.slug AS tenant_slug, i.status, i.currency_code,
              i.total_minor::text AS total_minor, i.due_date::text AS due_date,
              (CURRENT_DATE - i.due_date)::int AS days_late,
              i.dunning_attempts, i.last_dunned_at,
              s.status::text AS subscription_status, s.cancel_at_period_end
         FROM saas_invoices i
         JOIN tenants t ON t.id = i.tenant_id
         LEFT JOIN subscriptions s ON s.id = i.subscription_id
        WHERE ${where}
        ORDER BY (CURRENT_DATE - i.due_date) DESC, i.id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({
      invoiceId: x.id, invoiceNo: x.invoice_no, tenantId: x.tenant_id, tenantSlug: x.tenant_slug ?? null,
      status: x.status, currency: x.currency_code, totalMinor: String(x.total_minor),
      outstandingMinor: x.status === 'partially_paid' ? null : String(x.total_minor),
      outstandingUnknownReason: x.status === 'partially_paid' ? 'part_paid_amount_not_recorded' : null,
      dueDate: x.due_date, daysLate: x.days_late ?? 0,
      dunningAttempts: x.dunning_attempts ?? 0, lastDunnedAt: x.last_dunned_at ?? null,
      subscriptionStatus: x.subscription_status ?? null,
      cancelAtPeriodEnd: x.cancel_at_period_end ?? null,
    }));
  }

  /* ---------------- subscription timeline (read-only · PC-56 ADMIN-1) ---------------- */
  // W017 asks for a "timeline". There is NO subscription-event table, so a per-transition history cannot be shown
  // and is NOT invented: what is real is the current state (subscriptions row), the add-ons attached to it, and the
  // invoices it has actually produced — which is a truthful billing history in date order. The possible NEXT
  // transitions come from the status machine on the console side, mirroring the server, and are labelled as
  // possibilities rather than as things that have happened.
  async subscriptionForTenant(tenantId: string): Promise<{
    subscription: Record<string, unknown> | null; addons: Array<Record<string, unknown>>; invoices: Array<Record<string, unknown>>;
  }> {
    const s = await this.pool.query(
      `SELECT id, plan_id::text AS plan_id, status::text AS status, billing_cycle, price_minor::text AS price_minor,
              currency_code, discount_pct::text AS discount_pct, anchor_terms,
              current_period_start::text AS period_start, current_period_end::text AS period_end,
              cancel_at_period_end, cancelled_at, created_at
         FROM subscriptions WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`, [tenantId]);
    const sub = s.rows[0];
    if (!sub) return { subscription: null, addons: [], invoices: [] };
    const [addons, invoices] = await Promise.all([
      this.pool.query(
        // real 0002 shape: price_minor (no per-addon currency — it bills in the subscription's) + starts_on/ends_on
        `SELECT id, addon_code, quantity, price_minor::text AS price_minor,
                starts_on::text AS starts_on, ends_on::text AS ends_on, created_at
           FROM subscription_addons WHERE subscription_id=$1 AND deleted_at IS NULL ORDER BY addon_code LIMIT 100`,
        [sub.id]).catch(() => ({ rows: [] as any[] })),
      // bounded: the last two years of monthly billing is 24 rows; 60 leaves room without becoming a report
      this.pool.query(
        `SELECT id, invoice_no, status::text AS status, currency_code, total_minor::text AS total_minor,
                due_date::text AS due_date, paid_at, created_at
           FROM saas_invoices WHERE subscription_id=$1 AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT 60`, [sub.id]).catch(() => ({ rows: [] as any[] })),
    ]);
    return {
      subscription: {
        id: sub.id, planId: sub.plan_id, status: sub.status, billingCycle: sub.billing_cycle,
        priceMinor: sub.price_minor, currency: sub.currency_code, discountPct: sub.discount_pct,
        anchorTerms: sub.anchor_terms ?? {}, periodStart: sub.period_start, periodEnd: sub.period_end,
        cancelAtPeriodEnd: sub.cancel_at_period_end === true, cancelledAt: sub.cancelled_at ?? null,
        createdAt: sub.created_at ?? null,
      },
      addons: addons.rows.map((a: any) => ({
        id: a.id, addonCode: a.addon_code, quantity: a.quantity ?? 1, priceMinor: String(a.price_minor),
        // an addon has no currency of its own — it bills in the subscription's, so the console formats it with that
        startsOn: a.starts_on, endsOn: a.ends_on ?? null, createdAt: a.created_at ?? null,
      })),
      invoices: invoices.rows.map((i: any) => ({
        id: i.id, invoiceNo: i.invoice_no, status: i.status, currency: i.currency_code,
        totalMinor: String(i.total_minor), dueDate: i.due_date, paidAt: i.paid_at ?? null, createdAt: i.created_at ?? null,
      })),
    };
  }

  /* ---------------- revenue rollup (read-only; float-free in SQL) ---------------- */
  async revenueRollup(currency: string, fromIso?: string, toIso?: string): Promise<{ mrrMinor: string; activeSubscriptions: number; outstandingMinor: string; collectedMinor: string; statusCounts: Record<string, number> }> {
    const subs = await this.pool.query(
      `SELECT COALESCE(SUM(CASE WHEN billing_cycle='annual' THEN price_minor/12 ELSE price_minor END),0)::text AS mrr,
              COUNT(*)::int AS active
         FROM subscriptions WHERE status IN ('active','trialing') AND currency_code=$1 AND deleted_at IS NULL`, [currency]);
    const outstanding = await this.pool.query(
      `SELECT COALESCE(SUM(total_minor),0)::text AS s FROM saas_invoices
         WHERE status IN ('issued','partially_paid','overdue') AND currency_code=$1 AND deleted_at IS NULL`, [currency]);
    const collected = await this.pool.query(
      `SELECT COALESCE(SUM(total_minor),0)::text AS s FROM saas_invoices
         WHERE status='paid' AND currency_code=$1 AND deleted_at IS NULL
           AND ($2::timestamptz IS NULL OR paid_at >= $2) AND ($3::timestamptz IS NULL OR paid_at < $3)`,
      [currency, fromIso ?? null, toIso ?? null]);
    const counts = await this.pool.query(
      `SELECT status, COUNT(*)::int AS n FROM saas_invoices WHERE currency_code=$1 AND deleted_at IS NULL GROUP BY status`, [currency]);
    const statusCounts: Record<string, number> = {};
    for (const row of counts.rows) statusCounts[row.status] = row.n;
    return {
      mrrMinor: String(subs.rows[0]?.mrr ?? '0'), activeSubscriptions: subs.rows[0]?.active ?? 0,
      outstandingMinor: String(outstanding.rows[0]?.s ?? '0'), collectedMinor: String(collected.rows[0]?.s ?? '0'), statusCounts,
    };
  }
}
