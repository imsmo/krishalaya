// modules/tenancy/repositories/saas-invoice.repository.ts · SQL for saas_invoices (0002 + 0035 dunning cols +
// 0092 paid_minor/saas_invoice_payments + 0146 period_tag/tax_bp/bill_to_*).
//
// tenant_id in EVERY query (Law 1) + RLS. No version col → mutations lock the row FOR UPDATE. invoice_no comes
// from next_doc_number() inside the tx (gap-free per tenant). Reads on the replica; keyset on (created_at, id).
// Money is bigint minor units (stringified on the wire). The renewal worker uses SKIP LOCKED across tenants.
//
// **`allTenants` IS GONE (PC-56 TENANT-4d-2).** `list()` used to take it, and it turned the predicate into
// `WHERE 1=1` — the same shape TENANT-4b found and closed on `payout_batches`. It had no caller (there was no
// invoice route at all), so it was a cross-tenant door standing open for a future caller to walk through by
// passing a flag. Every query in this file now starts from `tenant_id = $1`, and a spec asserts it. The two
// deliberate exceptions are the worker finders at the bottom, which run as kv_relay across tenants by design
// and are named as such.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext, SqlExecutor } from '../../../core/database/unit-of-work';
import { SaasInvoice, SaasInvoiceLine } from '../domain/saas-invoice.entity';
import { InvoiceStatus } from '../domain/saas-invoice.state';
import { InvalidSaasInvoiceError } from '../domain/tenancy.errors';

/** `doc_number_series.period` is varchar(10) in 0001 §0.8. Mirrored here so a caller is refused by name rather
 *  than by a plpgsql truncation error that rolls back their whole transaction. */
export const DOC_SERIES_PERIOD_MAX = 10;

const COLS = `id, tenant_id, subscription_id, invoice_no, status, currency_code, subtotal_minor, tax_minor, total_minor,
              paid_minor, due_date, paid_at, line_items, dunning_attempts, period_tag, tax_bp, bill_to_gstin,
              bill_to_legal_name, created_at`;
const big = (v: any) => BigInt(v);
const ymd = (d: any) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));
const intOrNull = (v: any) => (v === null || v === undefined ? null : Number(v));

function toLines(raw: any): SaasInvoiceLine[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((l: any) => ({ desc: String(l.desc), qty: Number(l.qty), unitMinor: big(l.unitMinor ?? l.unit_minor ?? 0), totalMinor: big(l.totalMinor ?? l.total_minor ?? 0) }));
}
function toDomain(r: any): SaasInvoice {
  return SaasInvoice.rehydrate({
    id: r.id, tenantId: r.tenant_id, subscriptionId: r.subscription_id, invoiceNo: r.invoice_no, status: r.status as InvoiceStatus,
    currencyCode: r.currency_code, subtotalMinor: big(r.subtotal_minor), taxMinor: big(r.tax_minor), totalMinor: big(r.total_minor),
    paidMinor: big(r.paid_minor ?? 0), dueDate: ymd(r.due_date), paidAt: r.paid_at, lineItems: toLines(r.line_items),
    dunningAttempts: r.dunning_attempts ?? 0, periodTag: r.period_tag ?? null, taxBp: intOrNull(r.tax_bp),
    billToGstin: r.bill_to_gstin ?? null, billToLegalName: r.bill_to_legal_name ?? null, createdAt: r.created_at,
  });
}
function lineToJson(l: SaasInvoiceLine) { return { desc: l.desc, qty: l.qty, unit_minor: l.unitMinor.toString(), total_minor: l.totalMinor.toString() }; }

export interface InvoiceListQuery { status?: string; statuses?: readonly string[]; cursor?: { c: string; id: string }; limit: number; }

/** A gateway capture, recorded as the append-only FACT 0092 asks for rather than inferred into a status. */
export interface GatewayReceipt {
  id: string; tenantId: string; invoiceId: string; amountMinor: bigint; currencyCode: string;
  /** 0146's vocabulary. 'gateway' where the PSP reported no instrument — never a guess. */
  method: string;
  reference: string; receivedAt: Date; recordedBy: string; idempotencyKey: string; note: string | null;
}

@Injectable()
export class SaasInvoiceRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * Allocate a gap-free invoice number for the tenant within the tx.
   *
   * THE WIDTH IS CHECKED HERE, IN CODE, because it bit us: `doc_number_series.period` is varchar(10) (0001
   * §0.8), PlanChangeService was passing a 27-character key, and `next_doc_number` raised
   * "value too long for type character varying(10)" from inside a plpgsql function — which rolled back the
   * caller's whole transaction and made every mid-cycle upgrade fail with a 500 (PC-56 TENANT-4d-2). A caller
   * that gets this wrong now learns WHICH argument is wrong, before any row is touched, instead of reading a
   * truncation error with no argument name in it.
   */
  async nextInvoiceNo(tx: TxContext, tenantId: string, period: string): Promise<string> {
    if (!period || period.length > DOC_SERIES_PERIOD_MAX) {
      throw new InvalidSaasInvoiceError(`document-series period must be 1..${DOC_SERIES_PERIOD_MAX} characters (got ${period?.length ?? 0}: '${period}')`);
    }
    const r = await tx.query(`SELECT next_doc_number($1,'saas_invoice','SINV',$2) AS no`, [tenantId, period]);
    return (r.rows[0] as any).no as string;
  }

  /** The billed party's identity AS AT NOW, for snapshotting onto an invoice at issue (0146 §146.3). Returns
   *  nulls where the tenant has recorded none — a co-operative with no GSTIN is a real state. */
  async billToSnapshot(tx: TxContext, tenantId: string): Promise<{ gstin: string | null; legalName: string | null }> {
    const r = await tx.query(`SELECT gstin, legal_name FROM tenants WHERE id = $1`, [tenantId]);
    const row = r.rows[0] as any;
    return { gstin: row?.gstin ?? null, legalName: row?.legal_name ?? null };
  }

  async insert(tx: TxContext, inv: SaasInvoice): Promise<void> {
    const p = inv.toProps();
    await tx.query(
      `INSERT INTO saas_invoices (id, tenant_id, subscription_id, invoice_no, status, currency_code, subtotal_minor, tax_minor, total_minor, due_date, paid_at, line_items, period_tag, tax_bp, bill_to_gstin, bill_to_legal_name, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12::jsonb,$13,$14,$15,$16, now())`,
      [p.id, p.tenantId, p.subscriptionId, p.invoiceNo, p.status, p.currencyCode, p.subtotalMinor.toString(), p.taxMinor.toString(), p.totalMinor.toString(), p.dueDate, p.paidAt, JSON.stringify(p.lineItems.map(lineToJson)), p.periodTag, p.taxBp, p.billToGstin, p.billToLegalName]);
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<SaasInvoice | null> {
    const r = await tx.query(`SELECT ${COLS} FROM saas_invoices WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<SaasInvoice | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM saas_invoices WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Status + paid_at update (status moves via the entity's state machine; dunning_attempts is billing-ops'
   *  column, and `paid_minor` is written only by recomputePaidMinor — never incremented from here). */
  async update(tx: TxContext, inv: SaasInvoice): Promise<void> {
    const p = inv.toProps();
    await tx.query(`UPDATE saas_invoices SET status=$3, paid_at=$4, updated_at=now() WHERE id=$1 AND tenant_id=$2`, [p.id, p.tenantId, p.status, p.paidAt]);
  }

  /* ------------------------------------------------------------------------------------------------------ */
  /* PAYMENTS RECEIVED (0092's append-only table, now written by the tenant realm too — 0146 defect 1)       */
  /* ------------------------------------------------------------------------------------------------------ */

  /**
   * Record a gateway capture as a payment ROW. Returns false when this exact receipt is already recorded — the
   * unique `idempotency_key` is the guard, so an at-least-once relay redelivery cannot double-count money.
   * `ON CONFLICT DO NOTHING` rather than a read-then-write: two relay workers delivering the same event
   * concurrently must not both insert, and only the database can promise that.
   */
  async insertReceipt(tx: TxContext, r: GatewayReceipt): Promise<boolean> {
    const res = await tx.query(
      `INSERT INTO saas_invoice_payments (id, tenant_id, invoice_id, amount_minor, currency_code, method, reference, received_at, idempotency_key, recorded_by, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [r.id, r.tenantId, r.invoiceId, r.amountMinor.toString(), r.currencyCode, r.method, r.reference, r.receivedAt, r.idempotencyKey, r.recordedBy, r.note]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Re-SUM the invoice's live payment rows into `paid_minor`, in the caller's tx, and return the new total.
   * Never an increment: a retried insert cannot drift it and a reversal brings it down by construction. This
   * is deliberately the SAME statement shape as admin-api billing-ops' `recomputePaidMinor` — one arithmetic
   * over one column, so the two planes cannot hold different beliefs about one debt.
   */
  async recomputePaidMinor(tx: TxContext, tenantId: string, invoiceId: string): Promise<bigint> {
    const r = await tx.query(
      `UPDATE saas_invoices i
          SET paid_minor = COALESCE((SELECT SUM(p.amount_minor) FROM saas_invoice_payments p
                                      WHERE p.invoice_id = i.id AND p.deleted_at IS NULL), 0),
              updated_at = now()
        WHERE i.id = $1 AND i.tenant_id = $2
      RETURNING paid_minor::text AS paid_minor`, [invoiceId, tenantId]);
    return BigInt((r.rows[0] as any)?.paid_minor ?? '0');
  }

  /** W120's per-invoice receipt list (the detail screen). Newest first, bounded — a tenant disputing a balance
   *  needs to see the references, which is the whole reason 0092 made this table append-only. */
  async receiptsFor(tenantId: string, invoiceId: string, limit = 50): Promise<Array<{ id: string; amountMinor: string; currencyCode: string; method: string; reference: string; receivedAt: Date; isReversal: boolean }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, amount_minor::text AS amount_minor, currency_code, method, reference, received_at, (reverses_payment_id IS NOT NULL) AS is_reversal
         FROM saas_invoice_payments
        WHERE tenant_id = $1 AND invoice_id = $2 AND deleted_at IS NULL
        ORDER BY received_at DESC, id DESC LIMIT $3`, [tenantId, invoiceId, limit]);
    return r.rows.map((x: any) => ({ id: x.id, amountMinor: x.amount_minor, currencyCode: x.currency_code, method: x.method, reference: x.reference, receivedAt: x.received_at, isReversal: x.is_reversal }));
  }

  /* ------------------------------------------------------------------------------------------------------ */
  /* THE RENEWAL RUN'S IDEMPOTENCY (0146 defect 3)                                                          */
  /* ------------------------------------------------------------------------------------------------------ */

  /**
   * Is there already an invoice for this subscription + billing period? Now a column equality over
   * `uq_saas_invoice_subscription_period` rather than the old `invoice_no LIKE '%'||period||'%'`, which was
   * unindexable AND could not stop two overlapping ticks from double-billing — both passed the read and both
   * inserted. The read stays as a cheap fast path; the UNIQUE INDEX is what actually makes it impossible, and
   * the service treats a unique violation as "already raised" rather than as an error.
   */
  async existsForPeriod(tx: TxContext, tenantId: string, subscriptionId: string, periodTag: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM saas_invoices WHERE tenant_id=$1 AND subscription_id=$2 AND period_tag=$3 AND deleted_at IS NULL LIMIT 1`,
      [tenantId, subscriptionId, periodTag]);
    return (r.rowCount ?? 0) > 0;
  }

  /* ------------------------------------------------------------------------------------------------------ */
  /* W120's READS — every one bound to the caller's tenant                                                  */
  /* ------------------------------------------------------------------------------------------------------ */

  async list(tenantId: string, q: InvoiceListQuery): Promise<SaasInvoice[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `tenant_id = $1 AND deleted_at IS NULL`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    else if (q.statuses && q.statuses.length > 0) where += ` AND status = ANY(${p([...q.statuses])}::invoice_status[])`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM saas_invoices WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /** W120's tab counts, in ONE query. `partially_paid` is returned as its own count and the console groups it
   *  under Issued — the grouping is a display rule (domain/saas-invoice-balance.ts), never baked into SQL, so
   *  the two cannot drift. */
  async countsByStatus(tenantId: string): Promise<Record<string, number>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT status, count(*)::int AS n FROM saas_invoices WHERE tenant_id=$1 AND deleted_at IS NULL GROUP BY status`, [tenantId]);
    const out: Record<string, number> = {};
    for (const x of r.rows as any[]) out[x.status] = Number(x.n);
    return out;
  }

  /** Every invoice that still OWES money, for the open-balance figure. Bounded: a tenant with more open
   *  invoices than this has a collections problem, and the console says the figure is a partial sum rather
   *  than silently truncating (no silent caps). */
  async openInvoices(tenantId: string, limit = 200): Promise<SaasInvoice[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM saas_invoices
        WHERE tenant_id=$1 AND deleted_at IS NULL AND status IN ('issued','partially_paid','overdue')
        ORDER BY due_date ASC, id ASC LIMIT $2`, [tenantId, limit + 1]);
    return r.rows.map(toDomain);
  }

  /** The PAID invoices of one calendar year, for "paid to date". Bounded by the same rule as above.
   *  `paid_at` is the window, not `created_at`: money is counted in the year it arrived. */
  async paidInYear(tenantId: string, year: number, limit = 500): Promise<SaasInvoice[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM saas_invoices
        WHERE tenant_id=$1 AND deleted_at IS NULL AND status='paid'
          AND paid_at >= make_date($2,1,1) AND paid_at < make_date($2 + 1,1,1)
        ORDER BY paid_at DESC, id DESC LIMIT $3`, [tenantId, year, limit + 1]);
    return r.rows.map(toDomain);
  }

  /* ------------------------------------------------------------------------------------------------------ */
  /* WORKER FINDERS — cross-tenant BY DESIGN (kv_relay), named as the exceptions they are                   */
  /* ------------------------------------------------------------------------------------------------------ */

  /** Owing invoices past due_date → mark overdue. Bounded + SKIP LOCKED. */
  async findOwingPastDue(tx: SqlExecutor, asOf: string, limit: number): Promise<Array<{ id: string; tenantId: string }>> {
    const r = await tx.query(
      `SELECT id, tenant_id FROM saas_invoices WHERE status IN ('issued','partially_paid') AND due_date < $1::date
        ORDER BY due_date LIMIT $2 FOR UPDATE SKIP LOCKED`, [asOf, limit]);
    return r.rows.map((x: any) => ({ id: x.id, tenantId: x.tenant_id }));
  }
}
