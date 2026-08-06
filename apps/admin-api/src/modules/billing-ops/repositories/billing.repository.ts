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

const PAYMENT_COLS = `id, tenant_id, invoice_id, amount_minor::text AS amount_minor, currency_code, method,
              reference, received_at, wallet_txn_id, reverses_payment_id, recorded_by, note, created_at`;
function toPayment(r: any): Record<string, unknown> {
  return {
    id: r.id, tenantId: r.tenant_id, invoiceId: r.invoice_id, amountMinor: String(r.amount_minor),
    currency: r.currency_code, method: r.method, reference: r.reference, receivedAt: r.received_at,
    walletTxnId: r.wallet_txn_id ?? null, reversesPaymentId: r.reverses_payment_id ?? null,
    recordedBy: r.recorded_by, note: r.note ?? null, createdAt: r.created_at ?? null,
  };
}

const ADJ_COLS = `id, tenant_id, subscription_id, invoice_id, direction, amount_minor::text AS amount_minor,
              currency_code, reason, status, requested_by, decided_by, decided_at, decision_note,
              applied_at, wallet_txn_id, idempotency_key, created_at`;
function toAdjustmentRow(r: any): Record<string, unknown> {
  return {
    id: r.id, tenantId: r.tenant_id, subscriptionId: r.subscription_id ?? null, invoiceId: r.invoice_id ?? null,
    direction: r.direction, amountMinor: String(r.amount_minor), currency: r.currency_code, reason: r.reason,
    status: r.status, requestedBy: r.requested_by ?? null, decidedBy: r.decided_by ?? null,
    decidedAt: r.decided_at ?? null, decisionNote: r.decision_note ?? null, appliedAt: r.applied_at ?? null,
    walletTxnId: r.wallet_txn_id ?? null, idempotencyKey: r.idempotency_key ?? null, createdAt: r.created_at ?? null,
  };
}

function toSchedule(x: any): Record<string, unknown> {
  return {
    id: x.id, report: x.report, cadence: x.cadence, hourIst: x.hour_ist,
    weekdayIso: x.weekday_iso === null ? null : Number(x.weekday_iso),
    recipients: x.recipients ?? [], isActive: x.is_active === true,
    nextRunAt: x.next_run_at ?? null, lastRunAt: x.last_run_at ?? null,
    notes: x.notes ?? null, createdAt: x.created_at ?? null,
  };
}

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
export interface AdjustmentListQuery { tenantId?: string; status?: string; cursor?: { c: string; id: string }; limit: number; }
export interface DunningListQuery { invoiceId: string; cursor?: { c: string; id: string }; limit: number; }

export interface AdjustmentRow {
  id: string; tenantId: string; subscriptionId: string | null; invoiceId: string | null; direction: string;
  amountMinor: string; currency: string; reason: string;
  // PC-56 ADMIN-1b (0093): the maker-checker workflow. walletTxnId is null until APPLIED — the row exists from the
  // moment it is requested, and its existence no longer means the money moved.
  status: string; requestedBy: string | null; decidedBy: string | null; decidedAt: Date | null;
  decisionNote: string | null; appliedAt: Date | null; walletTxnId: string | null; createdAt: Date | null;
}
function toAdjustment(r: any): AdjustmentRow {
  return { id: r.id, tenantId: r.tenant_id, subscriptionId: r.subscription_id ?? null, invoiceId: r.invoice_id ?? null,
    direction: r.direction, amountMinor: String(r.amount_minor), currency: r.currency_code, reason: r.reason,
    // PC-56 ADMIN-1b: the workflow columns (0093). `walletTxnId` is now NULLABLE and its absence is meaningful —
    // it is precisely the difference between "an operator asked for this money to move" and "it moved".
    status: r.status ?? 'applied', requestedBy: r.requested_by ?? null, decidedBy: r.decided_by ?? null,
    decidedAt: r.decided_at ?? null, decisionNote: r.decision_note ?? null, appliedAt: r.applied_at ?? null,
    walletTxnId: r.wallet_txn_id ?? null, createdAt: r.created_at ?? null };
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
      `SELECT ${ADJ_COLS} FROM billing_adjustments WHERE idempotency_key=$1`, [idempotencyKey]);
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
      `SELECT ${ADJ_COLS} FROM billing_adjustments WHERE idempotency_key=$1`, [a.idempotencyKey]);
    return toAdjustment(existing.rows[0]);
  }
  async listAdjustments(q: AdjustmentListQuery): Promise<AdjustmentRow[]> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'deleted_at IS NULL';
    if (q.tenantId) where += ` AND tenant_id=${p(q.tenantId)}`;
    // the approval queue is this list filtered, not a second endpoint — one read, one set of guards
    if (q.status) where += ` AND status=${p(q.status)}::billing_adjustment_status`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(
      `SELECT ${ADJ_COLS} FROM billing_adjustments WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toAdjustment);
  }

  /* ---------------- saas_invoice_payments (0092 · PC-56 ADMIN-1b) ---------------- */
  // Every read/write here is about money the platform RECEIVED. Two invariants live in this block and nowhere else:
  //   • `paid_minor` on the invoice is always recomputed as a SUM over the live payment rows inside the same tx as
  //     the insert — never `paid_minor = paid_minor + x`, because a retried insert would drift an increment while a
  //     re-SUM is idempotent by construction, and a reversal is handled by the same line of code.
  //   • payments are append-only: `reversePayment` INSERTS a negative mirror row instead of touching the original.
  async insertPayment(client: PoolClient, p: {
    id: string; tenantId: string; invoiceId: string; amountMinor: bigint; currency: string; method: string;
    reference: string; receivedAt: Date; walletTxnId: string | null; reversesPaymentId: string | null;
    idempotencyKey: string; recordedBy: string; note: string | null;
  }): Promise<void> {
    await client.query(
      `INSERT INTO saas_invoice_payments
         (id, tenant_id, invoice_id, amount_minor, currency_code, method, reference, received_at,
          wallet_txn_id, reverses_payment_id, idempotency_key, recorded_by, note, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$12,$12)`,
      [p.id, p.tenantId, p.invoiceId, p.amountMinor.toString(), p.currency, p.method, p.reference, p.receivedAt,
       p.walletTxnId, p.reversesPaymentId, p.idempotencyKey, p.recordedBy, p.note]);
  }

  /** Recompute and store `saas_invoices.paid_minor` from the live payment rows, returning the new total. Called in
   *  the same transaction as every payment write — see the invariant note above. */
  async recomputePaidMinor(client: PoolClient, invoiceId: string): Promise<bigint> {
    const r = await client.query(
      `UPDATE saas_invoices i
          SET paid_minor = COALESCE((
                SELECT SUM(p.amount_minor) FROM saas_invoice_payments p
                 WHERE p.invoice_id = i.id AND p.deleted_at IS NULL), 0),
              updated_at = now()
        WHERE i.id = $1
      RETURNING paid_minor::text AS paid_minor`, [invoiceId]);
    return BigInt(r.rows[0]?.paid_minor ?? '0');
  }

  async getPaymentByKey(idempotencyKey: string): Promise<Record<string, unknown> | null> {
    const r = await this.pool.query(
      `SELECT ${PAYMENT_COLS} FROM saas_invoice_payments WHERE idempotency_key=$1`, [idempotencyKey]);
    return r.rows[0] ? toPayment(r.rows[0]) : null;
  }
  async getPaymentForUpdate(client: PoolClient, id: string): Promise<Record<string, unknown> | null> {
    const r = await client.query(
      `SELECT ${PAYMENT_COLS} FROM saas_invoice_payments WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toPayment(r.rows[0]) : null;
  }
  /** Is this payment already reversed? (the 0092 unique index also enforces it — this is the friendly 409 path) */
  async paymentIsReversed(client: PoolClient, id: string): Promise<boolean> {
    const r = await client.query(
      `SELECT 1 FROM saas_invoice_payments WHERE reverses_payment_id=$1 AND deleted_at IS NULL LIMIT 1`, [id]);
    return (r.rowCount ?? 0) > 0;
  }
  async listPayments(invoiceId: string, limit = 100): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT ${PAYMENT_COLS} FROM saas_invoice_payments
        WHERE invoice_id=$1 AND deleted_at IS NULL ORDER BY received_at DESC, id DESC LIMIT $2`, [invoiceId, limit]);
    return r.rows.map(toPayment);
  }

  /** The stored PDF for an invoice: its media row's s3 key + mime, or null when no PDF has been generated.
   *  Joined rather than trusted from a client: the caller names an INVOICE, and this decides which object key that
   *  entitles them to — a route that accepted a key would be an arbitrary-object-read hole with a friendly name. */
  async invoicePdfAsset(invoiceId: string): Promise<{ mediaId: string; s3Key: string; mimeType: string; bytes: string; invoiceNo: string } | null> {
    const r = await this.pool.query(
      `SELECT m.id, m.s3_key, m.mime_type, m.bytes::text AS bytes, i.invoice_no
         FROM saas_invoices i
         JOIN media_assets m ON m.id = i.pdf_media_id
        WHERE i.id = $1 AND i.deleted_at IS NULL AND m.deleted_at IS NULL`, [invoiceId]);
    const x = r.rows[0];
    return x ? { mediaId: x.id, s3Key: x.s3_key, mimeType: x.mime_type, bytes: String(x.bytes), invoiceNo: x.invoice_no } : null;
  }

  /* ---------------- billing_adjustments maker-checker (0093 · PC-56 ADMIN-1b) ---------------- */
  async insertAdjustmentRequest(client: PoolClient, a: {
    id: string; tenantId: string; subscriptionId: string | null; invoiceId: string | null; direction: string;
    amountMinor: bigint; currency: string; reason: string; requestedBy: string;
  }): Promise<Record<string, unknown>> {
    const r = await client.query(
      `INSERT INTO billing_adjustments
         (id, tenant_id, subscription_id, invoice_id, direction, amount_minor, currency_code, reason,
          status, requested_by, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'awaiting_approval',$9,$9,$9)
       RETURNING ${ADJ_COLS}`,
      [a.id, a.tenantId, a.subscriptionId, a.invoiceId, a.direction, a.amountMinor.toString(), a.currency, a.reason, a.requestedBy]);
    return toAdjustmentRow(r.rows[0]);
  }
  async getAdjustmentForUpdate(client: PoolClient, id: string): Promise<Record<string, unknown> | null> {
    const r = await client.query(
      `SELECT ${ADJ_COLS} FROM billing_adjustments WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toAdjustmentRow(r.rows[0]) : null;
  }
  /** Record a decision (approve / return / reject). The DB's own CHECK refuses decided_by = requested_by, so this
   *  cannot become the only place the maker-checker rule lives. */
  async decideAdjustment(client: PoolClient, id: string, status: string, decidedBy: string, note: string | null): Promise<void> {
    await client.query(
      `UPDATE billing_adjustments
          SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4, updated_by=$3, updated_at=now()
        WHERE id=$1`, [id, status, decidedBy, note]);
  }
  /** Stamp the money leg once the wallet-service has posted it. Only ever called after a successful post. */
  async markAdjustmentApplied(client: PoolClient, id: string, walletTxnId: string, idempotencyKey: string, actorUserId: string): Promise<void> {
    await client.query(
      `UPDATE billing_adjustments
          SET status='applied', wallet_txn_id=$2, idempotency_key=$3, applied_at=now(), updated_by=$4, updated_at=now()
        WHERE id=$1`, [id, walletTxnId, idempotencyKey, actorUserId]);
  }

  /* ---------------- subscription writes (PC-56 ADMIN-1c · ADMIN-1-Q10) ---------------- */
  // `subscriptions` has no version column, so every mutation locks the row FOR UPDATE inside the caller's tx (the
  // same discipline as saas_invoices). One subscription per tenant is the current model: the newest row wins, which is
  // what `subscriptionForTenant` already reads.
  async getSubscriptionForUpdate(client: PoolClient, tenantId: string): Promise<Record<string, unknown> | null> {
    const r = await client.query(
      `SELECT id, plan_id::text AS plan_id, status::text AS status, billing_cycle, price_minor::text AS price_minor,
              currency_code, discount_pct::text AS discount_pct, current_period_end::text AS period_end,
              cancel_at_period_end
         FROM subscriptions WHERE tenant_id=$1 AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [tenantId]);
    const x = r.rows[0];
    return x ? {
      id: x.id, planId: x.plan_id, status: x.status, billingCycle: x.billing_cycle, priceMinor: x.price_minor,
      currency: x.currency_code, discountPct: x.discount_pct, periodEnd: x.period_end,
      cancelAtPeriodEnd: x.cancel_at_period_end === true,
    } : null;
  }
  async planExists(client: PoolClient, planId: string): Promise<boolean> {
    const r = await client.query(`SELECT 1 FROM plans WHERE id=$1 AND deleted_at IS NULL`, [planId]);
    return (r.rowCount ?? 0) > 0;
  }
  /** The plan/price/cycle change. `discount_pct` is only written when the caller stated one — passing null must not
   *  wipe a negotiated discount that is still part of the agreement. */
  async updateSubscriptionPlan(client: PoolClient, id: string, p: {
    planId: string; priceMinor: bigint; billingCycle: string; discountPct: string | null; actorUserId: string;
  }): Promise<void> {
    await client.query(
      `UPDATE subscriptions
          SET plan_id=$2, price_minor=$3, billing_cycle=$4,
              discount_pct = COALESCE($5::numeric, discount_pct),
              updated_by=$6, updated_at=now()
        WHERE id=$1`,
      [id, p.planId, p.priceMinor.toString(), p.billingCycle, p.discountPct, p.actorUserId]);
  }
  async insertSubscriptionAddon(client: PoolClient, a: {
    id: string; subscriptionId: string; addonCode: string; quantity: number; priceMinor: bigint;
    startsOn: string; endsOn: string | null; actorUserId: string;
  }): Promise<void> {
    await client.query(
      `INSERT INTO subscription_addons (id, subscription_id, addon_code, quantity, price_minor, starts_on, ends_on, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
      [a.id, a.subscriptionId, a.addonCode, a.quantity, a.priceMinor.toString(), a.startsOn, a.endsOn, a.actorUserId]);
  }
  async setSubscriptionCancelAtPeriodEnd(client: PoolClient, id: string, cancel: boolean, actorUserId: string): Promise<void> {
    await client.query(
      `UPDATE subscriptions SET cancel_at_period_end=$2, updated_by=$3, updated_at=now() WHERE id=$1`,
      [id, cancel, actorUserId]);
  }

  /* ---------------- dunning_policies (0094 · PC-56 ADMIN-1b) ---------------- */
  /** The ACTIVE ladder plus its steps, or null when no version is active. Null is a real state and the console says
   *  so — a platform with no collections policy should admit it rather than show an empty ladder as if it were one. */
  async activeDunningPolicy(): Promise<{ policy: Record<string, unknown>; steps: Array<Record<string, unknown>> } | null> {
    const p = await this.pool.query(
      `SELECT id, version, name, is_active, effective_from::text AS effective_from,
              suspend_after_days, notes, created_at
         FROM dunning_policies WHERE is_active AND deleted_at IS NULL LIMIT 1`);
    if (!p.rows[0]) return null;
    const s = await this.pool.query(
      `SELECT id, day_offset, channel, template_code, escalate
         FROM dunning_policy_steps WHERE policy_id=$1 AND deleted_at IS NULL ORDER BY day_offset, channel`, [p.rows[0].id]);
    return {
      policy: {
        id: p.rows[0].id, version: p.rows[0].version, name: p.rows[0].name, isActive: p.rows[0].is_active === true,
        effectiveFrom: p.rows[0].effective_from, suspendAfterDays: p.rows[0].suspend_after_days ?? null,
        notes: p.rows[0].notes ?? null, createdAt: p.rows[0].created_at ?? null,
      },
      steps: s.rows.map((x: any) => ({
        id: x.id, dayOffset: x.day_offset, channel: x.channel,
        templateCode: x.template_code ?? null, escalate: x.escalate === true,
      })),
    };
  }
  async listDunningPolicyVersions(limit = 50): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT id, version, name, is_active, effective_from::text AS effective_from, suspend_after_days, created_at
         FROM dunning_policies WHERE deleted_at IS NULL ORDER BY version DESC LIMIT $1`, [limit]);
    return r.rows.map((x: any) => ({
      id: x.id, version: x.version, name: x.name, isActive: x.is_active === true,
      effectiveFrom: x.effective_from, suspendAfterDays: x.suspend_after_days ?? null, createdAt: x.created_at ?? null,
    }));
  }
  async nextDunningPolicyVersion(client: PoolClient): Promise<number> {
    const r = await client.query(`SELECT COALESCE(MAX(version), 0) + 1 AS v FROM dunning_policies`);
    return Number(r.rows[0].v);
  }
  /** Publish a NEW version and deactivate the old one, in one tx. Never an in-place edit: the previous ladder is why
   *  a tenant was chased the way they were, and that has to stay readable. */
  async insertDunningPolicy(client: PoolClient, p: {
    id: string; version: number; name: string; effectiveFrom: string; suspendAfterDays: number | null;
    notes: string | null; actorUserId: string;
    steps: Array<{ dayOffset: number; channel: string; templateCode: string | null; escalate: boolean }>;
  }): Promise<void> {
    await client.query(`UPDATE dunning_policies SET is_active=false, updated_at=now(), updated_by=$1 WHERE is_active`, [p.actorUserId]);
    await client.query(
      `INSERT INTO dunning_policies (id, version, name, is_active, effective_from, suspend_after_days, notes, created_by, updated_by)
       VALUES ($1,$2,$3,true,$4,$5,$6,$7,$7)`,
      [p.id, p.version, p.name, p.effectiveFrom, p.suspendAfterDays, p.notes, p.actorUserId]);
    for (const s of p.steps) {
      await client.query(
        `INSERT INTO dunning_policy_steps (policy_id, day_offset, channel, template_code, escalate, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$6)`,
        [p.id, s.dayOffset, s.channel, s.templateCode, s.escalate, p.actorUserId]);
    }
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

  /* ---------------- scheduled reports (0095 · PC-56 ADMIN-1e · ADMIN-1-Q9) ---------------- */
  async listSchedules(limit = 50): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT id, report, cadence::text AS cadence, hour_ist, weekday_iso, recipients, is_active,
              next_run_at, last_run_at, notes, created_at
         FROM scheduled_reports WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1`, [limit]);
    return r.rows.map(toSchedule);
  }
  async getSchedule(id: string): Promise<Record<string, unknown> | null> {
    const r = await this.pool.query(
      `SELECT id, report, cadence::text AS cadence, hour_ist, weekday_iso, recipients, is_active,
              next_run_at, last_run_at, notes, created_at
         FROM scheduled_reports WHERE id=$1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toSchedule(r.rows[0]) : null;
  }
  async insertSchedule(client: PoolClient, s: {
    id: string; report: string; cadence: string; hourIst: number; weekdayIso: number | null;
    recipients: string[]; notes: string | null; nextRunAt: Date; actorUserId: string;
  }): Promise<void> {
    await client.query(
      `INSERT INTO scheduled_reports (id, report, cadence, hour_ist, weekday_iso, recipients, notes, next_run_at, created_by, updated_by)
       VALUES ($1,$2,$3::scheduled_report_cadence,$4,$5,$6,$7,$8,$9,$9)`,
      [s.id, s.report, s.cadence, s.hourIst, s.weekdayIso, s.recipients, s.notes, s.nextRunAt, s.actorUserId]);
  }
  /** Pause or resume. A paused schedule keeps its `next_run_at` so resuming does not fire immediately — the service
   *  recomputes it, because a schedule paused for a month would otherwise be instantly overdue on resume. */
  async setScheduleActive(client: PoolClient, id: string, active: boolean, nextRunAt: Date | null, actorUserId: string): Promise<void> {
    await client.query(
      `UPDATE scheduled_reports
          SET is_active=$2, next_run_at = COALESCE($3, next_run_at), updated_by=$4, updated_at=now()
        WHERE id=$1`, [id, active, nextRunAt, actorUserId]);
  }
  /** The run history — the answer to "I never got the Monday report". */
  async listScheduleRuns(scheduleId: string, limit = 30): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT id, ran_at, status::text AS status, summary, row_count, recipients, detail,
              period_start::text AS period_start, period_end::text AS period_end
         FROM scheduled_report_runs WHERE schedule_id=$1 AND deleted_at IS NULL
        ORDER BY ran_at DESC LIMIT $2`, [scheduleId, limit]);
    return r.rows.map((x: any) => ({
      id: x.id, ranAt: x.ran_at, status: x.status, summary: x.summary ?? {}, rowCount: x.row_count ?? 0,
      recipients: x.recipients ?? [], detail: x.detail ?? null,
      periodStart: x.period_start ?? null, periodEnd: x.period_end ?? null,
    }));
  }

  /* ---------------- LIVE money events (PC-56 ADMIN-1e · ADMIN-1-Q8) ---------------- */
  // A CURSOR, NOT A ROLLUP. The old "live ticker" idea was to re-read a point-in-time revenue rollup on a timer, which
  // looks live and is stale — and worse, it can MISS events entirely (two payments between polls collapse into one
  // changed number). This reads money events AFTER a cursor, so every event is delivered exactly once, in order, and a
  // reconnect resumes from where the client got to. That is what makes the stream honest.
  //
  // The cursor is (created_at, id): monotonic and unique, so it cannot skip a row that arrived in the same millisecond.
  async moneyEventsSince(cursor: { at: string; id: string } | null, limit: number): Promise<Array<{
    id: string; at: string; kind: 'payment' | 'invoice_issued'; tenantSlug: string | null;
    invoiceNo: string | null; amountMinor: string; currency: string;
  }>> {
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    // Two sources UNIONed because both are money moments an operator watches: cash arriving (0092 payments) and
    // invoices going out (the renewal run). Neither is derived from the other.
    const after = cursor
      ? `AND (e.at, e.id) > (${p(cursor.at)}::timestamptz, ${p(cursor.id)}::uuid)`
      : '';
    const lp = p(limit);
    const r = await this.pool.query(
      `WITH e AS (
         SELECT pmt.id, pmt.created_at AS at, 'payment'::text AS kind, t.slug AS tenant_slug,
                i.invoice_no, pmt.amount_minor::text AS amount_minor, pmt.currency_code
           FROM saas_invoice_payments pmt
           JOIN saas_invoices i ON i.id = pmt.invoice_id
           JOIN tenants t ON t.id = pmt.tenant_id
          WHERE pmt.deleted_at IS NULL
         UNION ALL
         SELECT i2.id, i2.created_at AS at, 'invoice_issued'::text AS kind, t2.slug AS tenant_slug,
                i2.invoice_no, i2.total_minor::text AS amount_minor, i2.currency_code
           FROM saas_invoices i2
           JOIN tenants t2 ON t2.id = i2.tenant_id
          WHERE i2.deleted_at IS NULL AND i2.status <> 'draft'
       )
       SELECT * FROM e WHERE true ${after} ORDER BY e.at, e.id LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({
      id: x.id, at: x.at?.toISOString?.() ?? String(x.at), kind: x.kind,
      tenantSlug: x.tenant_slug ?? null, invoiceNo: x.invoice_no ?? null,
      amountMinor: String(x.amount_minor), currency: x.currency_code,
    }));
  }

  /** Today's money by HOUR (canon W112's chart), in the caller's timezone offset — computed in SQL so the bucket
   *  boundaries are the database's single source of truth rather than each client's clock. */
  async todayByHour(currency: string, tzOffsetMinutes: number): Promise<Array<{ hour: string; receivedMinor: string; issuedMinor: string }>> {
    const r = await this.pool.query(
      `WITH bounds AS (
         SELECT date_trunc('day', now() + ($2::int * interval '1 minute')) - ($2::int * interval '1 minute') AS day_start
       )
       SELECT to_char(date_trunc('hour', s.at + ($2::int * interval '1 minute')), 'HH24:00') AS hour,
              COALESCE(SUM(s.received), 0)::text AS received_minor,
              COALESCE(SUM(s.issued), 0)::text AS issued_minor
         FROM bounds b,
              (SELECT pmt.created_at AS at, pmt.amount_minor AS received, 0::bigint AS issued
                 FROM saas_invoice_payments pmt, bounds b2
                WHERE pmt.deleted_at IS NULL AND pmt.currency_code = $1 AND pmt.created_at >= b2.day_start
               UNION ALL
               SELECT i.created_at AS at, 0::bigint AS received, i.total_minor AS issued
                 FROM saas_invoices i, bounds b3
                WHERE i.deleted_at IS NULL AND i.status <> 'draft' AND i.currency_code = $1 AND i.created_at >= b3.day_start
              ) s
        WHERE s.at >= b.day_start
        GROUP BY 1 ORDER BY 1`, [currency, tzOffsetMinutes]);
    return r.rows.map((x: any) => ({ hour: x.hour, receivedMinor: String(x.received_minor), issuedMinor: String(x.issued_minor) }));
  }

  /* ---------------- EXPORT reads (PC-56 ADMIN-1d · ADMIN-1-Q3) ---------------- */
  // Every one of these selects an EXPLICIT column list matching `domain/billing-export.ts`. No `SELECT *`: an export
  // that widened itself when a table gained a column would be how PII leaves the building without anyone deciding.
  async exportTenants(limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT slug, status::text AS status, risk_score, created_at, approved_at
         FROM tenants WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1`, [limit]);
    return r.rows.map((x: any) => ({
      slug: x.slug, status: x.status, riskScore: x.risk_score,
      createdAt: x.created_at?.toISOString?.() ?? x.created_at, approvedAt: x.approved_at?.toISOString?.() ?? x.approved_at,
    }));
  }

  async exportPlans(limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT code, version, default_name, currency_code,
              monthly_price_minor::text AS monthly_price_minor, annual_price_minor::text AS annual_price_minor,
              setup_fee_minor::text AS setup_fee_minor, is_public, status::text AS status
         FROM plans WHERE deleted_at IS NULL ORDER BY code, version DESC LIMIT $1`, [limit]);
    return r.rows.map((x: any) => ({
      code: x.code, version: x.version, defaultName: x.default_name, currency: x.currency_code,
      monthlyPriceMinor: String(x.monthly_price_minor), annualPriceMinor: String(x.annual_price_minor),
      setupFeeMinor: String(x.setup_fee_minor), isPublic: x.is_public === true, status: x.status,
    }));
  }

  async exportInvoices(q: { tenantId?: string; status?: string; from?: string; to?: string; limit: number }): Promise<Array<Record<string, unknown>>> {
    const params: unknown[] = []; const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = 'i.deleted_at IS NULL';
    if (q.tenantId) where += ` AND i.tenant_id=${p(q.tenantId)}`;
    if (q.status) where += ` AND i.status=${p(q.status)}::invoice_status`;
    if (q.from) where += ` AND i.created_at >= ${p(q.from)}::date`;
    // `to` is INCLUSIVE of the whole day: a finance user asking for 1–31 July means the 31st, not up to its midnight
    if (q.to) where += ` AND i.created_at < (${p(q.to)}::date + interval '1 day')`;
    const lp = p(q.limit);
    const r = await this.pool.query(
      `SELECT i.invoice_no, t.slug AS tenant_slug, i.status::text AS status, i.currency_code,
              i.subtotal_minor::text AS subtotal_minor, i.tax_minor::text AS tax_minor,
              i.total_minor::text AS total_minor, i.paid_minor::text AS paid_minor,
              i.due_date::text AS due_date, i.paid_at, i.created_at
         FROM saas_invoices i JOIN tenants t ON t.id = i.tenant_id
        WHERE ${where} ORDER BY i.created_at DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({
      invoiceNo: x.invoice_no, tenantSlug: x.tenant_slug, status: x.status, currency: x.currency_code,
      subtotalMinor: String(x.subtotal_minor), taxMinor: String(x.tax_minor), totalMinor: String(x.total_minor),
      paidMinor: String(x.paid_minor), dueDate: x.due_date,
      paidAt: x.paid_at?.toISOString?.() ?? x.paid_at, createdAt: x.created_at?.toISOString?.() ?? x.created_at,
    }));
  }

  /**
   * The GST return extract. Fields exactly as filed on each invoice — NOTHING is recomputed (an export that
   * re-derived GST would produce a return that disagrees with the invoices tenants hold).
   *
   * `place_of_supply` is not a column anywhere, so it is taken from the FIRST TWO DIGITS OF THE TENANT'S GSTIN, which
   * IS the state code by construction (a documented deterministic property of a GSTIN, not a guess). A tenant with no
   * GSTIN yields EMPTY — and that emptiness is the finding: a GST return cannot be filed for them, and the export
   * should show that rather than invent a state.
   */
  async exportGstr(q: { from: string; to: string; limit: number }): Promise<Array<Record<string, unknown>>> {
    const r = await this.pool.query(
      `SELECT i.invoice_no, i.created_at::date::text AS invoice_date, t.slug AS tenant_slug,
              t.gstin AS tenant_gstin,
              CASE WHEN t.gstin ~ '^[0-9]{2}' THEN substring(t.gstin from 1 for 2) ELSE NULL END AS place_of_supply,
              i.subtotal_minor::text AS taxable_value_minor, i.tax_minor::text AS tax_minor,
              i.total_minor::text AS total_minor, i.currency_code
         FROM saas_invoices i JOIN tenants t ON t.id = i.tenant_id
        WHERE i.deleted_at IS NULL
          -- a filing covers what was ISSUED in the period; drafts were never sent and void invoices were withdrawn
          AND i.status NOT IN ('draft','void')
          AND i.created_at >= $1::date AND i.created_at < ($2::date + interval '1 day')
        ORDER BY i.created_at, i.invoice_no LIMIT $3`, [q.from, q.to, q.limit]);
    return r.rows.map((x: any) => ({
      invoiceNo: x.invoice_no, invoiceDate: x.invoice_date, tenantSlug: x.tenant_slug,
      tenantGstin: x.tenant_gstin ?? '', placeOfSupply: x.place_of_supply ?? '',
      taxableValueMinor: String(x.taxable_value_minor), taxMinor: String(x.tax_minor),
      totalMinor: String(x.total_minor), currency: x.currency_code,
    }));
  }

  /** The 12-month billed series, in export shape (same numbers the reports page charts — one query, one truth). */
  async exportRevenueByMonth(currency: string, months: number): Promise<Array<Record<string, unknown>>> {
    const rows = await this.billedByMonth(currency, months);
    return rows.map((r) => ({ month: r.month, invoices: r.invoices, issuedMinor: r.issuedMinor, paidMinor: r.paidMinor }));
  }

  /* ---------------- revenue TIME SERIES + cohorts (PC-56 ADMIN-1d · ADMIN-1-Q7) ---------------- */
  // WHY THESE COME FROM INVOICES AND NOT FROM SUBSCRIPTIONS. The canon asks for "MRR movement — 12 months". The
  // platform stores no subscription HISTORY (there is one current row per tenant — the same gap the W017 page refuses
  // to paper over), so a month-by-month MRR series cannot be reconstructed from subscriptions without inventing it.
  // What IS real and dated is the invoices that were issued: they are facts, one per subscription per period, with the
  // price that was actually charged. So the series is BILLED REVENUE per month, labelled as exactly that. It is not
  // MRR by another name and the console does not call it MRR.
  //
  // All arithmetic stays in SQL on bigint (no float, Law 2); amounts leave as strings.
  async billedByMonth(currency: string, months: number): Promise<Array<{ month: string; issuedMinor: string; paidMinor: string; invoices: number }>> {
    const r = await this.pool.query(
      `SELECT to_char(date_trunc('month', i.created_at), 'YYYY-MM') AS month,
              COALESCE(SUM(i.total_minor), 0)::text AS issued_minor,
              -- what was RECEIVED against invoices issued that month (0092). Not "collected in that month" — that is a
              -- different question, and conflating the two is how a cash-flow chart ends up disagreeing with the bank.
              COALESCE(SUM(i.paid_minor), 0)::text AS paid_minor,
              count(*)::int AS invoices
         FROM saas_invoices i
        WHERE i.deleted_at IS NULL AND i.currency_code = $1 AND i.status <> 'void'
          AND i.created_at >= date_trunc('month', now()) - ($2::int - 1) * interval '1 month'
        GROUP BY 1 ORDER BY 1`, [currency, months]);
    return r.rows.map((x: any) => ({ month: x.month, issuedMinor: String(x.issued_minor), paidMinor: String(x.paid_minor), invoices: x.invoices }));
  }

  /** Plan mix: how many live subscriptions sit on each plan and what they are worth per month. Annual prices are
   *  normalised by INTEGER division (÷12) exactly as the MRR rollup does — never a float, and the remainder is dropped
   *  consistently rather than rounded up, so the mix never sums to more than the book. */
  async planMix(currency: string): Promise<Array<{ planId: string; planCode: string; subscriptions: number; monthlyMinor: string }>> {
    const r = await this.pool.query(
      `SELECT s.plan_id::text AS plan_id, p.code AS plan_code, count(*)::int AS subscriptions,
              COALESCE(SUM(CASE WHEN s.billing_cycle = 'annual' THEN s.price_minor / 12 ELSE s.price_minor END), 0)::text AS monthly_minor
         FROM subscriptions s
         JOIN plans p ON p.id = s.plan_id
        WHERE s.deleted_at IS NULL AND s.currency_code = $1 AND s.status IN ('trialing','active','past_due')
        GROUP BY 1, 2 ORDER BY monthly_minor DESC`, [currency]);
    return r.rows.map((x: any) => ({ planId: x.plan_id, planCode: x.plan_code, subscriptions: x.subscriptions, monthlyMinor: String(x.monthly_minor) }));
  }

  /**
   * Cohort retention by signup quarter, measured in TENANTS STILL BILLING — not in revenue.
   *
   * The canon says "net revenue by signup quarter". Revenue retention needs a per-month revenue series per cohort, and
   * with invoices only issued monthly per subscription that is derivable but fragile on a young book (one tenant's
   * annual invoice would swing a quarter by 12×). Counting tenants that still have a LIVE subscription is a fact this
   * database can state exactly, so that is what is returned — and the console labels it "tenants retained", not
   * revenue. A retention chart that silently means something other than its axis label is worse than a simpler one.
   */
  async cohortRetention(quarters: number): Promise<Array<{ cohort: string; tenants: number; stillBilling: number }>> {
    const r = await this.pool.query(
      `WITH cohorts AS (
         SELECT t.id, to_char(date_trunc('quarter', t.created_at), 'YYYY-"Q"Q') AS cohort
           FROM tenants t
          WHERE t.deleted_at IS NULL
            AND t.created_at >= date_trunc('quarter', now()) - ($1::int - 1) * interval '3 months'
       )
       SELECT c.cohort, count(*)::int AS tenants,
              count(*) FILTER (
                WHERE EXISTS (SELECT 1 FROM subscriptions s
                               WHERE s.tenant_id = c.id AND s.deleted_at IS NULL
                                 AND s.status IN ('trialing','active','past_due'))
              )::int AS still_billing
         FROM cohorts c GROUP BY 1 ORDER BY 1`, [quarters]);
    return r.rows.map((x: any) => ({ cohort: x.cohort, tenants: x.tenants, stillBilling: x.still_billing }));
  }

  /* ---------------- billing-cycle VISIBILITY (PC-56 ADMIN-1d · ADMIN-1-Q4, rescoped) ---------------- */
  // THE RENEWAL RUN ALREADY EXISTS: apps/api's `RenewalInvoicesJob` (worker, kv_relay) raises one invoice per
  // subscription per period, idempotent on (subscription, period). Adding a "run the cycle" button here would have
  // created a SECOND invoice generator in a different app — the most expensive kind of duplicate, because the failure
  // mode is double-billing real tenants. So admin gets VISIBILITY instead: what the next run would bill, and what the
  // last one did. No writer.
  /** Subscriptions the renewal run would pick up at `through` — the dry run. Mirrors the job's own finder condition
   *  (active/trialing, period ending on or before the date) but takes NO locks and writes nothing. */
  async renewalDuePreview(through: string, limit: number): Promise<Array<{
    tenantId: string; tenantSlug: string | null; subscriptionId: string; planCode: string | null;
    priceMinor: string; currency: string; billingCycle: string; periodEnd: string; alreadyInvoiced: boolean;
  }>> {
    const r = await this.pool.query(
      `SELECT s.tenant_id, t.slug AS tenant_slug, s.id AS subscription_id, p.code AS plan_code,
              s.price_minor::text AS price_minor, s.currency_code, s.billing_cycle,
              s.current_period_end::text AS period_end,
              -- the job is idempotent per (subscription, period); showing which rows it would SKIP is the difference
              -- between "the run will bill 40 tenants" and "the run will bill 40 tenants, 6 of them already invoiced"
              EXISTS (
                SELECT 1 FROM saas_invoices i
                 WHERE i.subscription_id = s.id AND i.deleted_at IS NULL
                   AND to_char(s.current_period_end, 'YYYYMM') = to_char(i.due_date, 'YYYYMM')
              ) AS already_invoiced
         FROM subscriptions s
         JOIN tenants t ON t.id = s.tenant_id
         LEFT JOIN plans p ON p.id = s.plan_id
        WHERE s.deleted_at IS NULL AND s.status IN ('trialing','active')
          AND s.current_period_end <= $1::date
        ORDER BY s.current_period_end, s.id LIMIT $2`, [through, limit]);
    return r.rows.map((x: any) => ({
      tenantId: x.tenant_id, tenantSlug: x.tenant_slug ?? null, subscriptionId: x.subscription_id,
      planCode: x.plan_code ?? null, priceMinor: String(x.price_minor), currency: x.currency_code,
      billingCycle: x.billing_cycle, periodEnd: x.period_end, alreadyInvoiced: x.already_invoiced === true,
    }));
  }

  /** What the renewal run actually did lately, read from the AUDIT LEDGER (the job audits every issue as
   *  `tenancy.saas_invoice_issued` with actor 'system'). The audit log is the only honest source here: it is written by
   *  the job itself, so it cannot drift from what the job did. */
  async recentRenewalRuns(days: number): Promise<Array<{ day: string; invoicesIssued: number }>> {
    const r = await this.pool.query(
      `SELECT to_char(date_trunc('day', a.created_at), 'YYYY-MM-DD') AS day, count(*)::int AS n
         FROM audit_log a
        WHERE a.action = 'tenancy.saas_invoice_issued'
          AND a.created_at >= now() - ($1::int * interval '1 day')
        GROUP BY 1 ORDER BY 1 DESC`, [days]).catch(() => ({ rows: [] as any[] }));
    return r.rows.map((x: any) => ({ day: x.day, invoicesIssued: x.n }));
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
