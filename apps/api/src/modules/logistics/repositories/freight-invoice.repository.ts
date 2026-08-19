// modules/logistics/repositories/freight-invoice.repository.ts · SQL for `freight_invoices` +
// `freight_invoice_lines` (0070) — **the first application code these tables have ever had** (PC-56 TENANT-5c).
//
// Neither table is partitioned (0070's own reasoning: invoice-cycle-bounded, not a per-transaction stream), so no
// `uuid_v7_time` pruning applies here. `shipments` IS partitioned, and the evidence read below is bounded by the
// invoice's own billing period for exactly that reason (Law 8).
//
// `variance_minor` is GENERATED ALWAYS on both tables, so it is never written — the same protection 0152 gave
// `delivery_routes.is_active`, and PostgreSQL enforces it.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { FreightInvoice, FreightInvoiceProps, FreightLineProps } from '../domain/freight-invoice.entity';
import { DisputeReason, ReconStatus, SourceKind } from '../domain/freight-recon';
import { DuplicateFreightInvoiceError } from '../domain/logistics.errors';

const H_COLS = `id, tenant_id, carrier_id, invoice_no, source_kind, period_start, period_end, shipment_count,
  billed_minor, expected_minor, variance_minor, currency_code, recon_status, invoice_media_id, received_at,
  reconciled_at, payment_hold, payout_id, created_at`;
const L_COLS = `id, tenant_id, invoice_id, awb_no, line_no, shipment_id, billed_minor, expected_minor,
  variance_minor, billed_attempts, dispute_status, dispute_reason_code, dispute_reason, evidence, resolved_at, resolved_by`;

/**
 * A `date` column as the YYYY-MM-DD string the rest of the platform speaks.
 *
 * **This is not a formality, and the obvious two one-liners are both wrong.** `node-pg` parses PostgreSQL `date`
 * (oid 1082) into a JS `Date` at LOCAL midnight, and this repository sets no type parser — `grep -r setTypeParser`
 * returns nothing anywhere in `apps/api`. So:
 *   • `String(v).slice(0, 10)` — the shape used in several modules of this codebase — yields `"Wed Jul 01"`, which is
 *     what W241's "Jun · 86 shipments" column and every period round-trip would have printed. Found by a test that
 *     passed a real `Date` through this mapper rather than a string;
 *   • `v.toISOString().slice(0, 10)` — the other shape in this codebase — is off by ONE DAY for any process running
 *     behind UTC, because local midnight on the 1st is 18:30Z on the previous day in IST. A billing period that
 *     starts a day early silently changes which shipments the evidence read can match, which is a wrong recon rather
 *     than a wrong label.
 * Reading the local Y-M-D components is the only reading that returns the date PostgreSQL actually holds. The wider
 * pattern (two conflicting conventions across the modules, neither correct) is recorded for the programme, not fixed
 * here: rewriting every module's date mapper is its own wave with its own live proof.
 */
const day = (v: unknown): string => {
  if (v == null) return '';
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
};
const big = (v: unknown) => (v == null ? null : BigInt(String(v)));

function toHeader(r: any): FreightInvoiceProps {
  return {
    id: r.id, tenantId: r.tenant_id, carrierId: r.carrier_id, invoiceNo: r.invoice_no,
    sourceKind: r.source_kind as SourceKind, periodStart: day(r.period_start), periodEnd: day(r.period_end),
    shipmentCount: Number(r.shipment_count ?? 0), billedMinor: BigInt(String(r.billed_minor ?? '0')),
    expectedMinor: BigInt(String(r.expected_minor ?? '0')), currencyCode: r.currency_code,
    reconStatus: r.recon_status as ReconStatus, invoiceMediaId: r.invoice_media_id ?? null,
    receivedAt: r.received_at, reconciledAt: r.reconciled_at ?? null,
    paymentHold: r.payment_hold === true, payoutId: r.payout_id ?? null, createdAt: r.created_at ?? null,
  };
}
function toLine(r: any): FreightLineProps {
  return {
    id: r.id, tenantId: r.tenant_id, invoiceId: r.invoice_id, awbNo: r.awb_no ?? null,
    lineNo: Number(r.line_no ?? 0), shipmentId: r.shipment_id ?? null,
    billedMinor: BigInt(String(r.billed_minor ?? '0')), expectedMinor: big(r.expected_minor),
    billedAttempts: r.billed_attempts == null ? null : Number(r.billed_attempts),
    disputeStatus: r.dispute_status, disputeReasonCode: (r.dispute_reason_code ?? null) as DisputeReason | null,
    disputeReason: r.dispute_reason ?? null, evidence: r.evidence ?? null,
    resolvedAt: r.resolved_at ?? null, resolvedBy: r.resolved_by ?? null,
  };
}

/** One shipment's facts, for matching a carrier's line against what we know. */
export interface ShipmentEvidenceRow {
  id: string; awbNo: string | null; status: string; chargeMinor: bigint | null; deliveryAttempts: number; requiresColdChain: boolean;
}

export interface FreightListQuery { reconStatus?: string; carrierId?: string; sourceKind?: string; cursor?: { c: string; id: string }; limit: number }

@Injectable()
export class FreightInvoiceRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, inv: FreightInvoice): Promise<void> {
    const p = inv.toProps();
    try {
      await tx.query(
        `INSERT INTO freight_invoices (id, tenant_id, carrier_id, invoice_no, source_kind, period_start, period_end,
           shipment_count, billed_minor, expected_minor, currency_code, recon_status, invoice_media_id, received_at,
           payment_hold, created_at)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11,$12,$13,$14,$15, now())`,
        [p.id, p.tenantId, p.carrierId, p.invoiceNo, p.sourceKind, p.periodStart, p.periodEnd,
         p.shipmentCount, p.billedMinor.toString(), p.expectedMinor.toString(), p.currencyCode, p.reconStatus,
         p.invoiceMediaId, p.receivedAt, p.paymentHold]);
    } catch (e: any) {
      // uq_freight_invoices_no (tenant_id, invoice_no) — the monthly upload done twice.
      if (e?.code === '23505') throw new DuplicateFreightInvoiceError(p.invoiceNo);
      throw e;
    }
    for (const l of inv.toLines()) {
      await tx.query(
        `INSERT INTO freight_invoice_lines (id, tenant_id, invoice_id, awb_no, line_no, shipment_id, billed_minor,
           expected_minor, billed_attempts, dispute_status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())`,
        [l.id, l.tenantId, l.invoiceId, l.awbNo, l.lineNo, l.shipmentId, l.billedMinor.toString(),
         l.expectedMinor === null ? null : l.expectedMinor.toString(), l.billedAttempts, l.disputeStatus]);
    }
  }

  /** Header + lines, locked, for any write. One aggregate, one lock — a recon pass and a dispute on the same
   *  invoice must not interleave and produce a header that disagrees with its own lines. */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<FreightInvoice | null> {
    const h = await tx.query(`SELECT ${H_COLS} FROM freight_invoices WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    if (!h.rows[0]) return null;
    const l = await tx.query(
      `SELECT ${L_COLS} FROM freight_invoice_lines WHERE invoice_id=$1 AND tenant_id=$2 AND deleted_at IS NULL
        ORDER BY line_no FOR UPDATE`, [id, tenantId]);
    return FreightInvoice.rehydrate(toHeader(h.rows[0]), l.rows.map(toLine));
  }

  async getById(tenantId: string, id: string): Promise<FreightInvoice | null> {
    const r = this.replica.forTenant(tenantId);
    const h = await r.query(`SELECT ${H_COLS} FROM freight_invoices WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    if (!h.rows[0]) return null;
    const l = await r.query(
      `SELECT ${L_COLS} FROM freight_invoice_lines WHERE invoice_id=$1 AND tenant_id=$2 AND deleted_at IS NULL ORDER BY line_no`, [id, tenantId]);
    return FreightInvoice.rehydrate(toHeader(h.rows[0]), l.rows.map(toLine));
  }

  /** Persist the header after a recon/dispute/close. `variance_minor` is GENERATED and never named here. */
  async updateHeader(tx: TxContext, inv: FreightInvoice): Promise<void> {
    const p = inv.toProps();
    await tx.query(
      `UPDATE freight_invoices SET billed_minor=$3, expected_minor=$4, recon_status=$5, reconciled_at=$6,
         payment_hold=$7, payout_id=$8, shipment_count=$9, updated_at=now()
        WHERE id=$1 AND tenant_id=$2`,
      [p.id, p.tenantId, p.billedMinor.toString(), p.expectedMinor.toString(), p.reconStatus,
       p.reconciledAt, p.paymentHold, p.payoutId, p.shipmentCount]);
  }

  /** Persist the lines a pass touched. Written one by one rather than as one statement because each line carries
   *  its own jsonb evidence and its own dispute prose — and a batch UPDATE ... FROM VALUES with jsonb per row is
   *  harder to read than the loop, on a table bounded by an invoice's line count. */
  async updateLines(tx: TxContext, lines: readonly Readonly<FreightLineProps>[]): Promise<void> {
    for (const l of lines) {
      await tx.query(
        `UPDATE freight_invoice_lines SET shipment_id=$3, billed_minor=$4, expected_minor=$5, dispute_status=$6,
           dispute_reason_code=$7, dispute_reason=$8, evidence=$9::jsonb, resolved_at=$10, resolved_by=$11, updated_at=now()
          WHERE id=$1 AND tenant_id=$2`,
        [l.id, l.tenantId, l.shipmentId, l.billedMinor.toString(),
         l.expectedMinor === null ? null : l.expectedMinor.toString(), l.disputeStatus,
         l.disputeReasonCode, l.disputeReason, l.evidence === null ? null : JSON.stringify(l.evidence),
         l.resolvedAt, l.resolvedBy]);
    }
  }

  async list(tenantId: string, q: FreightListQuery): Promise<Array<{ header: FreightInvoiceProps; carrierName: string | null; carrierKind: string | null; disputedLines: number }>> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `f.tenant_id=$1 AND f.deleted_at IS NULL`;
    if (q.reconStatus) where += ` AND f.recon_status=${p(q.reconStatus)}`;
    if (q.carrierId) where += ` AND f.carrier_id=${p(q.carrierId)}`;
    if (q.sourceKind) where += ` AND f.source_kind=${p(q.sourceKind)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (f.received_at < ${cc} OR (f.received_at=${cc} AND f.id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${H_COLS.split(', ').map((c) => `f.${c.trim()}`).join(', ')},
              lp2.default_name AS carrier_name, lp2.partner_kind AS carrier_kind,
              (SELECT count(*) FROM freight_invoice_lines l
                WHERE l.invoice_id = f.id AND l.tenant_id = f.tenant_id AND l.dispute_status = 'disputed' AND l.deleted_at IS NULL)::int AS disputed_lines
         FROM freight_invoices f
         LEFT JOIN logistics_partners lp2 ON lp2.id = f.carrier_id
        WHERE ${where}
        ORDER BY f.received_at DESC, f.id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({ header: toHeader(x), carrierName: x.carrier_name ?? null, carrierKind: x.carrier_kind ?? null, disputedLines: Number(x.disputed_lines ?? 0) }));
  }

  /**
   * **The evidence read: what our own records say about the consignments a carrier has billed for.**
   *
   * Matched on AWB first and shipment id second, because that is how a carrier bills — an AWB is the number on the
   * carrier's own paperwork, and our shipment uuid never appears on it. A line whose AWB matches nothing comes back
   * absent, which is the `unmatched` verdict: we were billed for something we have no record of shipping.
   *
   * PRUNED (Law 8): `shipments` is partitioned by `created_at`, and this is bounded by the invoice's own billing
   * period widened by a month at each end — a consignment billed in a June cycle was created in or around June, and
   * the widening is slack rather than a guess that could silently drop a line into `unmatched`.
   */
  async evidenceFor(tenantId: string, keys: { awbNos: readonly string[]; shipmentIds: readonly string[] }, period: { from: string; to: string }): Promise<ShipmentEvidenceRow[]> {
    if (keys.awbNos.length === 0 && keys.shipmentIds.length === 0) return [];
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, awb_no, status, charge_minor, delivery_attempts, requires_cold_chain
         FROM shipments
        WHERE tenant_id=$1
          AND (awb_no = ANY($2::varchar[]) OR id = ANY($3::uuid[]))
          AND created_at >= ($4::date - interval '31 days')
          AND created_at <= ($5::date + interval '31 days')`,
      [tenantId, [...keys.awbNos], [...keys.shipmentIds], period.from, period.to]);
    return r.rows.map((x: any) => ({
      id: x.id, awbNo: x.awb_no ?? null, status: x.status,
      chargeMinor: big(x.charge_minor), deliveryAttempts: Number(x.delivery_attempts ?? 0),
      requiresColdChain: x.requires_cold_chain === true,
    }));
  }

  /**
   * **THE SAME CONSIGNMENT BILLED TWICE.**
   *
   * Neither W241 nor W242 draws this, and it is the second leakage class this wave found that the canon's
   * price-comparison cannot see: a carrier's June invoice and its July invoice both carrying AWB `DLV1234567890`.
   * Every line-by-line check passes — each invoice's own arithmetic foots, each line matches a real shipment at a
   * real price — and the tenant pays for one delivery twice. It is invisible to any check that looks at one invoice
   * at a time, which is what a "reconcile this invoice" screen does by construction.
   *
   * So the recon detail asks the question across invoices, and this is the ONE reader of `idx_freight_lines_awb`
   * (0153) — an index with no reader would have been its own defect on this programme's list. Bounded to the invoices
   * whose period is within a year of this one's, because a duplicate a carrier raises three years later is a
   * different conversation and an unbounded self-join over a growing table is a Rule Zero problem of its own.
   */
  async duplicateAwbsFor(tenantId: string, invoiceId: string): Promise<Array<{ awbNo: string; otherInvoiceId: string; otherInvoiceNo: string; billedMinor: string; periodStart: string }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT l2.awb_no, i2.id AS other_invoice_id, i2.invoice_no AS other_invoice_no,
              l2.billed_minor::text AS billed_minor, i2.period_start
         FROM freight_invoice_lines l1
         JOIN freight_invoices i1 ON i1.id = l1.invoice_id AND i1.tenant_id = l1.tenant_id
         JOIN freight_invoice_lines l2 ON l2.tenant_id = l1.tenant_id AND l2.awb_no = l1.awb_no
                                      AND l2.invoice_id <> l1.invoice_id AND l2.deleted_at IS NULL
         JOIN freight_invoices i2 ON i2.id = l2.invoice_id AND i2.tenant_id = l2.tenant_id AND i2.deleted_at IS NULL
        WHERE l1.tenant_id=$1 AND l1.invoice_id=$2 AND l1.awb_no IS NOT NULL AND l1.deleted_at IS NULL
          AND i2.period_start >= (i1.period_start - interval '365 days')
          AND i2.period_start <= (i1.period_start + interval '365 days')
        ORDER BY l2.awb_no, i2.period_start`, [tenantId, invoiceId]);
    return (r.rows as any[]).map((x) => ({
      awbNo: String(x.awb_no), otherInvoiceId: x.other_invoice_id, otherInvoiceNo: x.other_invoice_no,
      billedMinor: String(x.billed_minor), periodStart: day(x.period_start),
    }));
  }

  /** W241's footer count, per cycle: "3 of 3 invoices (Jun cycle)". Counted, not inferred from the page. */
  async cycleCounts(tenantId: string, period: { from: string; to: string }): Promise<{ total: number; byStatus: Record<string, number> }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT recon_status, count(*)::int AS n FROM freight_invoices
        WHERE tenant_id=$1 AND deleted_at IS NULL AND period_start >= $2::date AND period_end <= $3::date
        GROUP BY recon_status`, [tenantId, period.from, period.to]);
    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const x of r.rows as any[]) { byStatus[x.recon_status] = Number(x.n); total += Number(x.n); }
    return { total, byStatus };
  }

  /**
   * The recovery figure W241 quotes ("last quarter recon recovered ₹11,840"): the sum of what disputes took OFF the
   * bill. Computed from resolved lines' own evidence rather than kept as a running total nobody can audit.
   *
   * **GROUPED BY CURRENCY, and that is not decoration.** `freight_invoices.currency_code` exists because a carrier
   * can bill a tenant in something other than rupees — a Gujarat exporter FPO's air-freight consolidator bills USD —
   * and this query's first draft summed `recovered_minor` across every invoice regardless of currency, which adds
   * paise to cents and prints the total as ₹. One number for many currencies is exactly the "assumes single-currency"
   * shortcut Rule Zero refuses, and it is silent: nothing errors, the desk simply lies. Grouping is the fix, and the
   * console prints one figure per currency.
   */
  async recoveredSince(tenantId: string, sinceIso: string): Promise<Array<{ currencyCode: string; recoveredMinor: string }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT i.currency_code,
              coalesce(sum((l.evidence->>'recoveredMinor')::bigint), 0)::text AS recovered
         FROM freight_invoice_lines l
         JOIN freight_invoices i ON i.id = l.invoice_id AND i.tenant_id = l.tenant_id
        WHERE l.tenant_id=$1 AND l.dispute_status='resolved' AND l.resolved_at >= $2::timestamptz
          AND l.deleted_at IS NULL AND (l.evidence->>'recoveredMinor') IS NOT NULL
        GROUP BY i.currency_code
        ORDER BY i.currency_code`, [tenantId, sinceIso]);
    return (r.rows as any[]).map((x) => ({ currencyCode: String(x.currency_code), recoveredMinor: String(x.recovered ?? '0') }));
  }
}
