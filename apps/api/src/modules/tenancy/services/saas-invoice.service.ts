// modules/tenancy/services/saas-invoice.service.ts · the SaaS-billing-generation plane: raise + issue renewal
// invoices, RECORD payment received from the payments event, mark overdue, and let a tenant READ and PAY its own
// invoices. Money is bigint minor units and NEVER moves here — collection/void/adjustment are god-mode (admin-api
// billing-ops); this module records payment outcomes onto the invoice. tx-aware methods (raiseAndIssue /
// applyPayment) run inside the worker/relay tx so the state change + outbox event commit atomically (Law 4).
// Reads are tenant-scoped (RLS + an explicit tenant_id in every predicate).
//
// WHAT CHANGED IN PC-56 TENANT-4d-2 (see 0146's header for the full argument):
//   • `applyPayment` no longer types a status from ONE payment amount. It INSERTS the receipt into
//     `saas_invoice_payments` (0092's append-only record), re-SUMs `paid_minor` from that table, and lets the
//     arithmetic move the invoice. Two half payments now settle an invoice; before, they never did.
//   • a renewal invoice carries the tax rate actually in force and the billed party as at issue.
//   • the tenant read surface finally has a caller: controllers/v1/saas-invoices.controller.ts (W120).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { BadRequestError, ConflictError } from '../../../shared/errors/app-error';
import { SaasInvoice, SaasInvoiceLine } from '../domain/saas-invoice.entity';
import { DomainEvent } from '../domain/tenancy.events';
import { SaasInvoiceNotFoundError, TenantForbiddenError } from '../domain/tenancy.errors';
import { isPastDue, outstandingMinor, overpaidMinor, payVerdict } from '../domain/saas-invoice-balance';
import { SaasInvoiceRepository } from '../repositories/saas-invoice.repository';
import { QuerySaasInvoiceDto } from '../dto/query-saas-invoice.dto';
import { TenantActor } from '../policies/tenancy.policies';

export interface RaiseInvoiceInput {
  tenantId: string; subscriptionId: string | null; currencyCode: string; taxMinor: bigint; dueDate: string;
  lineItems: SaasInvoiceLine[]; periodTag: string;   // e.g. '202607' — the period this invoice covers
  /** The rate the tax figure was computed at, frozen onto the invoice. Null ONLY for a caller that genuinely
   *  has no rate to record; the renewal run refuses to raise in that case rather than passing null. */
  taxBp?: number | null;
  /** Set false for an invoice that covers a CHANGE rather than a period (an upgrade proration): the period tag
   *  is then not stored, so the one-per-period unique index does not apply to it. */
  periodic?: boolean;
}

/** Postgres unique-violation. A concurrent renewal tick losing this race has not failed — the invoice it was
 *  about to raise already exists, which is exactly what the index is for. */
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class SaasInvoiceService {
  private readonly log = new Logger(SaasInvoiceService.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: SaasInvoiceRepository,
  ) {}

  /**
   * Raise + issue a renewal invoice INSIDE the caller's tx (the renewal worker). Idempotent per
   * (subscription, period): returns null if one already exists — whether the pre-read saw it or the UNIQUE
   * INDEX caught a concurrent tick. Allocates a gap-free invoice_no and snapshots the billed party.
   */
  async raiseAndIssue(tx: TxContext, input: RaiseInvoiceInput): Promise<SaasInvoice | null> {
    const periodic = input.periodic !== false;
    if (periodic && input.subscriptionId && await this.repo.existsForPeriod(tx, input.tenantId, input.subscriptionId, input.periodTag)) return null;
    const invoiceNo = await this.repo.nextInvoiceNo(tx, input.tenantId, input.periodTag);
    const billTo = await this.repo.billToSnapshot(tx, input.tenantId);
    const inv = SaasInvoice.create({
      id: uuidv7(), tenantId: input.tenantId, subscriptionId: input.subscriptionId, invoiceNo,
      currencyCode: input.currencyCode, lineItems: input.lineItems, taxMinor: input.taxMinor, dueDate: input.dueDate,
      periodTag: periodic ? input.periodTag : null, taxBp: input.taxBp ?? null,
      billToGstin: billTo.gstin, billToLegalName: billTo.legalName,
    });
    inv.issue();
    try {
      await this.repo.insert(tx, inv);
    } catch (e) {
      // The index did the job the old `LIKE` read could not. Not an error: another tick raised this period's
      // invoice first, and re-raising it would double-bill a tenant.
      if ((e as { code?: string })?.code === UNIQUE_VIOLATION) return null;
      throw e;
    }
    await this.audit.write(tx, { tenantId: input.tenantId, actorUserId: 'system', action: 'tenancy.saas_invoice_issued', entityType: 'saas_invoice', entityId: inv.id, newValue: { invoiceNo, totalMinor: inv.totalMinor.toString(), taxBp: input.taxBp ?? null, periodTag: periodic ? input.periodTag : null }, ip: null });
    await this.flush(tx, input.tenantId, inv.id, inv.pullEvents());
    this.metrics.inc('tenancy.saas_invoice_issued', { tenant: input.tenantId });
    return inv;
  }

  /** uow-wrapping renewal entry point for the worker. */
  async raiseRenewal(input: RaiseInvoiceInput): Promise<{ raised: boolean; invoiceId?: string }> {
    return timed(this.metrics, 'tenancy.saas_invoice_renewal', { tenant: input.tenantId }, () =>
      this.uow.run(input.tenantId, async (tx) => {
        const inv = await this.raiseAndIssue(tx, input);
        return inv ? { raised: true, invoiceId: inv.id } : { raised: false };
      }, { userId: 'system' }));
  }

  /* ------------------------------------------------------------------------------------------------------ */
  /* MONEY RECEIVED — recorded as a fact, then the arithmetic moves the invoice                              */
  /* ------------------------------------------------------------------------------------------------------ */

  /**
   * Apply a payment to an invoice INSIDE the caller's tx (the payment-succeeded relay handler).
   *
   * The order matters and is the whole fix: INSERT the receipt → re-SUM `paid_minor` → derive the status from
   * that sum. Idempotent at two levels: the receipt's unique `idempotency_key` absorbs a redelivered event, and
   * `applyPaidTotal` returns false when the derived status is already the current one. Returns true only when
   * the invoice actually moved.
   */
  async applyPayment(tx: TxContext, tenantId: string, invoiceId: string, receipt: {
    amountMinor: bigint; at: Date; paymentId: string; method: string | null; currencyCode: string | null; payerUserId: string | null; gatewayPaymentId: string | null;
  }): Promise<boolean> {
    const inv = await this.repo.getForUpdate(tx, tenantId, invoiceId);
    if (!inv) return false;                                   // not our invoice / unknown reference → ignore
    const p = inv.toProps();

    // A payment in another currency is not a partial payment, it is an unrecorded FX conversion, and this
    // platform never invents a rate (Law 2). Refused loudly rather than summed into the wrong balance.
    if (receipt.currencyCode && receipt.currencyCode !== p.currencyCode) {
      this.log.error(`saas invoice ${invoiceId} is ${p.currencyCode} but payment ${receipt.paymentId} is ${receipt.currencyCode} — refusing to apply`);
      this.metrics.inc('tenancy.saas_invoice_payment_currency_mismatch', { tenant: tenantId });
      return false;
    }
    // `recorded_by` is NOT NULL by design (0092): a receipt nobody is attached to cannot be reconciled later.
    // Without a payer we record nothing rather than attributing the money to a system account.
    if (!receipt.payerUserId) {
      this.log.error(`payments.payment_succeeded for saas invoice ${invoiceId} carried no payer — cannot record a receipt`);
      this.metrics.inc('tenancy.saas_invoice_payment_no_payer', { tenant: tenantId });
      return false;
    }

    await this.repo.insertReceipt(tx, {
      id: uuidv7(), tenantId, invoiceId, amountMinor: receipt.amountMinor, currencyCode: p.currencyCode,
      method: mapReceiptMethod(receipt.method),
      // The reference an auditor matches against the statement. The gateway's own id when we have a USABLE
      // one, our payment id otherwise — always something that exists on the other side of the transaction.
      // The length test is not fussiness: 0092 enforces `length(btrim(reference)) >= 3` in the database, and
      // `PaymentService.handleWebhook` calls `markCaptured(event.gatewayPaymentId ?? '', ...)`, so a provider
      // that reports no id (or a stub one) would otherwise fail the CHECK inside the relay's transaction —
      // money arrived, nothing recorded, event marked failed. Fail SAFE onto our own id instead.
      reference: receiptReference(receipt.gatewayPaymentId, receipt.paymentId),
      receivedAt: receipt.at, recordedBy: receipt.payerUserId,
      idempotencyKey: `saas_inv_pay:${receipt.paymentId}`, note: null,
    });

    const paidMinor = await this.repo.recomputePaidMinor(tx, tenantId, invoiceId);
    const changed = inv.applyPaidTotal(paidMinor, receipt.at, isPastDue(p.dueDate, receipt.at));
    if (!changed) return false;
    await this.repo.update(tx, inv);
    await this.flush(tx, tenantId, inv.id, inv.pullEvents());
    this.metrics.inc('tenancy.saas_invoice_paid', { tenant: tenantId });
    return true;
  }

  /** Worker overdue sweep: issued/partially_paid past due_date → overdue (enters the dunning queue). */
  async markOverdue(tenantId: string, id: string): Promise<boolean> {
    return timed(this.metrics, 'tenancy.saas_invoice_overdue', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const inv = await this.repo.getForUpdate(tx, tenantId, id);
        if (!inv) return false;
        if (!inv.markOverdue()) return false;
        await this.repo.update(tx, inv);
        await this.flush(tx, tenantId, inv.id, inv.pullEvents());
        return true;
      }, { userId: 'system' }));
  }

  /* ------------------------------------------------------------------------------------------------------ */
  /* TENANT READS (billing visibility = tenant.settings) — W120                                             */
  /* ------------------------------------------------------------------------------------------------------ */

  async getById(tenantId: string, actor: TenantActor, id: string) {
    if (!actor.canManage) throw new TenantForbiddenError('viewing billing requires tenant.settings');
    const inv = await this.repo.getById(tenantId, id);
    if (!inv) throw new SaasInvoiceNotFoundError(id);
    return { ...this.serialize(inv), receipts: await this.repo.receiptsFor(tenantId, id) };
  }

  async list(tenantId: string, actor: TenantActor, q: Omit<QuerySaasInvoiceDto, 'cursor'> & { cursor?: { c: string; id: string }; statuses?: readonly string[] }) {
    if (!actor.canManage) throw new TenantForbiddenError('viewing billing requires tenant.settings');
    const rows = await this.repo.list(tenantId, { status: q.status, statuses: q.statuses, cursor: q.cursor, limit: q.limit });
    const items = rows.map((i) => this.serialize(i));
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last && last.createdAt ? Buffer.from(`${last.createdAt instanceof Date ? last.createdAt.toISOString() : last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  /**
   * The exact amount a tenant may pay on this invoice, resolved SERVER-SIDE. The number never comes from a
   * form: `POST /v1/payments` accepts an arbitrary `amountMinor`, so a client that could name its own figure
   * could open a gateway order for ₹1 against a ₹7,954 invoice and leave it part-paid.
   *
   * Also called by PaymentService before it creates a gateway order for referenceType 'saas_invoice' — which
   * is the "follow-on hardening" its own `assertValidReference` comment names. One quote, two callers, so the
   * screen and the gateway cannot disagree about what is owed.
   */
  async payQuote(tenantId: string, invoiceId: string, selfPayOn: boolean) {
    const inv = await this.repo.getById(tenantId, invoiceId);
    if (!inv) throw new SaasInvoiceNotFoundError(invoiceId);
    const v = payVerdict({ ...inv.toProps(), status: inv.status }, selfPayOn);
    return v.kind === 'payable'
      ? { payable: true as const, invoiceNo: inv.toProps().invoiceNo, amountMinor: v.amountMinor.toString(), currencyCode: v.currencyCode }
      : { payable: false as const, invoiceNo: inv.toProps().invoiceNo, reason: v.reason };
  }

  /** The guard PaymentService calls: refuse a gateway order whose amount is not exactly what is outstanding. */
  async assertPayableAmount(tenantId: string, invoiceId: string, amountMinor: bigint, currencyCode: string, selfPayOn: boolean): Promise<void> {
    const q = await this.payQuote(tenantId, invoiceId, selfPayOn);
    if (!q.payable) throw new ConflictError(`SaaS invoice ${q.invoiceNo} cannot be paid: ${q.reason}`);
    if (q.currencyCode !== currencyCode) throw new BadRequestError(`SaaS invoice ${q.invoiceNo} is billed in ${q.currencyCode}`);
    if (BigInt(q.amountMinor) !== amountMinor) throw new BadRequestError(`SaaS invoice ${q.invoiceNo} has ${q.amountMinor} ${q.currencyCode} outstanding`);
  }

  private serialize(inv: SaasInvoice) {
    const p = inv.toProps();
    return {
      id: p.id, invoiceNo: p.invoiceNo, subscriptionId: p.subscriptionId, status: p.status, currencyCode: p.currencyCode,
      subtotalMinor: p.subtotalMinor.toString(), taxMinor: p.taxMinor.toString(), totalMinor: p.totalMinor.toString(),
      paidMinor: p.paidMinor.toString(),
      outstandingMinor: outstandingMinor(p.totalMinor, p.paidMinor).toString(),
      overpaidMinor: overpaidMinor(p.totalMinor, p.paidMinor).toString(),
      dueDate: p.dueDate, paidAt: p.paidAt ?? null, dunningAttempts: p.dunningAttempts,
      periodTag: p.periodTag, taxBp: p.taxBp, billToGstin: p.billToGstin, billToLegalName: p.billToLegalName,
      lineItems: p.lineItems.map((l) => ({ desc: l.desc, qty: l.qty, unitMinor: l.unitMinor.toString(), totalMinor: l.totalMinor.toString() })),
      createdAt: p.createdAt ?? null,
    };
  }
  private async flush(tx: TxContext, tenantId: string, aggregateId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'saas_invoice', aggregateId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}

/**
 * 0146's method vocabulary, mapped from `payments.method` (upi|card|netbanking|cod, and NULL when the PSP told
 * us nothing). An unreported instrument becomes 'gateway' — the capture is real and the instrument is unknown,
 * which is a different statement from "paid by UPI". Nothing here guesses.
 */
/** 0092's own floor: a reference shorter than 3 characters cannot be reconciled by anyone later, and the
 *  database refuses it. Our payment id is always a uuid, so it is the safe fallback — never an empty string. */
export const MIN_RECEIPT_REFERENCE = 3;
export function receiptReference(gatewayPaymentId: string | null, paymentId: string): string {
  const gw = (gatewayPaymentId ?? '').trim();
  return gw.length >= MIN_RECEIPT_REFERENCE ? gw : paymentId;
}

export function mapReceiptMethod(method: string | null): string {
  const m = (method ?? '').trim().toLowerCase();
  return ['upi', 'card', 'netbanking', 'wallet', 'bank_transfer', 'cheque', 'cash', 'offset', 'cod'].includes(m) ? m : 'gateway';
}
