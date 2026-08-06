// apps/admin-api/src/modules/billing-ops/services/invoice-payments.service.ts · record money RECEIVED against a
// SaaS invoice, and reverse a payment that did not really arrive (PC-56 ADMIN-1b, closes ADMIN-1-Q1; table 0092).
//
// WHY THIS SERVICE EXISTS AT ALL. `invoice_status` has always had `partially_paid` and the platform stored no
// received amount, so the honest answer to "what does this tenant owe?" was "unknown" — which is what PC-56 ADMIN-1
// had to print on the collection queue. This service makes the answer a fact:
//
//   record()  → INSERT a positive payment row, re-SUM `paid_minor` in the same tx, then let the ARITHMETIC move the
//               invoice's status. No operator ever types `paid`.
//   reverse() → INSERT a negative mirror row (append-only; the original is never touched), re-SUM, and let the same
//               arithmetic reopen the invoice. This is the bounced-cheque path, and it is the reason the invoice
//               state machine needed a separate RECONCILIATION table: `paid` is terminal for operators and must not
//               be, for arithmetic.
//
// IT MOVES NO MONEY. Recording a receipt is bookkeeping about money that already arrived in a bank account; it is not
// a wallet post, so the wallet-service is deliberately NOT called (Law 2/9 — the wallet is for value moving INSIDE
// the platform). `walletTxnId` is carried when the payment did come through the platform wallet, and left null
// otherwise rather than fabricated.
//
// One ACID tx per write (Law 4), an audit row IN THE SAME TX (§4), invoice locked FOR UPDATE so concurrent receipts
// serialise, and idempotency on the caller's key so a double-submit never books the same money twice (Law 3).
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { BillingRepository } from '../repositories/billing.repository';
import {
  assertReceiptAmount, assertReference, assertSameCurrency, assertPayable, assertReceivedAt,
  statusAfterPayments, outstandingMinor, overpaidMinor,
} from '../domain/invoice-payment';
import {
  SaasInvoiceNotFoundError, InvalidPaymentError, DuplicatePaymentError, PaymentNotFoundError,
} from '../domain/billing-ops.errors';
import { RecordPaymentDto, ReversePaymentDto } from '../dto/billing-ops.dto';

/** Postgres unique-violation. A collision here is the 0092 double-entry guard doing its job, so it becomes a 409 that
 *  names the situation rather than a 500 that hides it. */
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class InvoicePaymentsService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: BillingRepository,
  ) {}

  async record(actor: AdminRequestContext, invoiceId: string, dto: RecordPaymentDto) {
    const amount = assertReceiptAmount(BigInt(dto.amountMinor));       // 422 on zero/negative/absurd
    const reference = assertReference(dto.reference);
    const receivedAt = assertReceivedAt(new Date(dto.receivedAt), new Date());
    // Scoped per (invoice, caller key): one invoice's retry can never be mistaken for another's payment.
    const idemKey = `saas_payment:${invoiceId}:${dto.idempotencyKey}`;

    // Replay BEFORE the transaction: a retried submit must return the original row, not attempt a second insert.
    const replay = await this.repo.getPaymentByKey(idemKey);
    if (replay) return this.viewFor(invoiceId, replay);

    return this.pool.withTx(async (client) => {
      const inv = await this.repo.getInvoiceForUpdate(client, invoiceId);
      if (!inv) throw new SaasInvoiceNotFoundError(invoiceId);
      const p = inv.toJSON();
      assertPayable(inv.status);                                       // draft/paid/void refused, with the reason
      assertSameCurrency(String(p.currency), dto.currency);            // never an invented FX rate

      const id = randomUUID();
      try {
        await this.repo.insertPayment(client, {
          id, tenantId: inv.tenantId, invoiceId, amountMinor: amount, currency: dto.currency, method: dto.method,
          reference, receivedAt, walletTxnId: dto.walletTxnId ?? null, reversesPaymentId: null,
          idempotencyKey: idemKey, recordedBy: actor.userId, note: dto.note ?? null,
        });
      } catch (e: any) {
        if (e?.code === UNIQUE_VIOLATION) {
          throw new DuplicatePaymentError(`reference '${reference}' is already recorded against this invoice for method '${dto.method}' — it may already be banked`);
        }
        throw e;
      }

      // The derived truth: re-SUM, then let the arithmetic decide the status.
      const paidMinor = await this.repo.recomputePaidMinor(client, invoiceId);
      const change = this.applyDerivedStatus(inv, paidMinor);
      if (change) await this.repo.updateInvoiceStatus(client, invoiceId, inv.status, actor.userId);

      const total = BigInt(String(p.totalMinor));
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'billing.payment_recorded', entityType: 'saas_invoice', entityId: invoiceId,
        newValue: {
          paymentId: id, amountMinor: amount.toString(), method: dto.method, reference,
          paidMinor: paidMinor.toString(), outstandingMinor: outstandingMinor(total, paidMinor).toString(),
          statusFrom: change?.from ?? inv.status, statusTo: change?.to ?? inv.status,
        },
        reason: dto.note?.trim() || `payment ${reference} (${dto.method})`,
        ip: actor.ip, requestId: actor.requestId || null,
      });

      return this.buildView(invoiceId, { ...p, status: inv.status }, paidMinor, id);
    });
  }

  /** Reverse a recorded payment: the cheque bounced, or it was banked against the wrong invoice. Append-only — a
   *  negative mirror row, never an edit or a delete, so the history shows what was believed and when it changed. */
  async reverse(actor: AdminRequestContext, paymentId: string, dto: ReversePaymentDto) {
    return this.pool.withTx(async (client) => {
      const original = await this.repo.getPaymentForUpdate(client, paymentId);
      if (!original) throw new PaymentNotFoundError(paymentId);
      if (original.reversesPaymentId) throw new InvalidPaymentError('a reversal cannot itself be reversed; record a fresh payment instead');
      if (await this.repo.paymentIsReversed(client, paymentId)) {
        throw new DuplicatePaymentError('that payment has already been reversed');
      }

      const invoiceId = String(original.invoiceId);
      const inv = await this.repo.getInvoiceForUpdate(client, invoiceId);
      if (!inv) throw new SaasInvoiceNotFoundError(invoiceId);
      const p = inv.toJSON();

      const id = randomUUID();
      await this.repo.insertPayment(client, {
        id, tenantId: inv.tenantId, invoiceId, amountMinor: -BigInt(String(original.amountMinor)),
        currency: String(original.currency), method: String(original.method), reference: String(original.reference),
        receivedAt: new Date(), walletTxnId: null, reversesPaymentId: paymentId,
        idempotencyKey: `saas_payment_reversal:${paymentId}`,          // one reversal per payment, ever
        recordedBy: actor.userId, note: dto.reason,
      });

      const paidMinor = await this.repo.recomputePaidMinor(client, invoiceId);
      const change = this.applyDerivedStatus(inv, paidMinor);
      if (change) await this.repo.updateInvoiceStatus(client, invoiceId, inv.status, actor.userId);

      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'billing.payment_reversed', entityType: 'saas_invoice', entityId: invoiceId,
        newValue: {
          reversalId: id, reversedPaymentId: paymentId, amountMinor: String(original.amountMinor),
          paidMinor: paidMinor.toString(), statusFrom: change?.from ?? inv.status, statusTo: change?.to ?? inv.status,
        },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });

      return this.buildView(invoiceId, { ...p, status: inv.status }, paidMinor, id);
    });
  }

  /** Every payment on one invoice, plus the derived money picture. Read-only. */
  async list(invoiceId: string) {
    const inv = await this.repo.getInvoice(invoiceId);
    if (!inv) throw new SaasInvoiceNotFoundError(invoiceId);
    const p = inv.toJSON();
    const payments = await this.repo.listPayments(invoiceId);
    const paidMinor = payments.reduce((acc, x) => acc + BigInt(String(x.amountMinor)), 0n);
    const total = BigInt(String(p.totalMinor));
    return {
      invoiceId,
      currency: p.currency,
      totalMinor: String(p.totalMinor),
      paidMinor: paidMinor.toString(),
      outstandingMinor: outstandingMinor(total, paidMinor).toString(),
      overpaidMinor: overpaidMinor(total, paidMinor).toString(),
      payments,
    };
  }

  // ---- internals ----
  /** Move the invoice ONLY if the recorded payments say it should move, through the reconciliation table. Mutates the
   *  aggregate and returns the change (or null). `pastDue` comes from the invoice's own due date — guessing it would
   *  age a tenant's account wrongly. */
  private applyDerivedStatus(inv: { status: any; toJSON(): Record<string, unknown>; reconcileTo(next: any): { from: string; to: string } }, paidMinor: bigint) {
    const p = inv.toJSON();
    const total = BigInt(String(p.totalMinor));
    const due = String(p.dueDate ?? '').slice(0, 10);
    const pastDue = !!due && due < new Date().toISOString().slice(0, 10);
    const next = statusAfterPayments(inv.status, total, paidMinor, pastDue);
    return next ? inv.reconcileTo(next) : null;
  }

  private buildView(invoiceId: string, p: Record<string, unknown>, paidMinor: bigint, paymentId: string) {
    const total = BigInt(String(p.totalMinor));
    return {
      invoiceId, paymentId, status: p.status, currency: p.currency,
      totalMinor: String(p.totalMinor), paidMinor: paidMinor.toString(),
      outstandingMinor: outstandingMinor(total, paidMinor).toString(),
      overpaidMinor: overpaidMinor(total, paidMinor).toString(),
    };
  }

  private async viewFor(invoiceId: string, replay: Record<string, unknown>) {
    const view = await this.list(invoiceId);
    return { ...view, replayedPaymentId: replay.id };
  }
}
