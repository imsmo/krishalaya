// modules/payments/services/credit-note.service.ts · W152's "Issue credit note (checker)" (PC-56 TENANT-3c-1).
//
// **THIS SERVICE RIDES 0139's REFUND APPROVAL PLANE INSTEAD OF GROWING A SECOND MAKER-CHECKER.** 0140 widened that
// table's subject CHECK to include 'credit_note' for exactly this: one threshold setting, one maker≠checker rule,
// one audit shape, one place to get it wrong. The dependency is on the disputes module's PUBLIC SERVICE
// (`RefundApprovalService`, which DisputesModule exports) — never on its repository, per the module blueprint.
//
// THE DIRECTION OF THAT DEPENDENCY IS WORTH NAMING: payments → disputes, while disputes consumes payments' events.
// It is not a cycle (DisputesModule imports nothing), and the plane is generic infrastructure that now serves three
// subjects — so it belongs in `core/approval` alongside admin-api's two-person rule. Moving it is a refactor of a
// live money gate and is recorded as a follow-up rather than done inside this wave.
//
// NO MONEY MOVES HERE (Law 2). A credit note is a DOCUMENT: it records that part of an invoice is reversed. Where the
// money also comes back, that is a refund, and a refund is the dispute/return path with its own wallet legs.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { AppError, NotFoundError } from '../../../shared/errors/app-error';
import { RefundApprovalService } from '../../disputes/services/refund-approval.service';
import { TradeInvoiceRepository } from '../repositories/trade-invoice.repository';
import { CreditNoteRepository } from '../repositories/credit-note.repository';
import {
  CREDIT_NOTE_REASONS, MIN_REASON_CHARS, apportionCredit, creditNoteGate, inheritSupply, isCreditNoteReason,
} from '../domain/credit-note';
import { InvoiceLine, RateBasis, SupplyType } from '../domain/invoice-tax';

export interface CreditNoteActor { userId: string; canFinance: boolean; canRefund: boolean }

export class InvoiceNotFoundForCreditError extends NotFoundError {
  constructor(id: string) { super('Invoice not found'); (this as any).details = { id }; }
}
export class CreditNoteRefusedError extends AppError {
  constructor(code: string, message: string, details?: Record<string, unknown>) { super(code, message, 409, details); }
}
export class CreditNoteForbiddenError extends AppError {
  constructor(perm: string) { super('CREDIT_NOTE_FORBIDDEN', `Requires ${perm}`, 403, { permission: perm }); }
}

@Injectable()
export class CreditNoteService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly invoices: TradeInvoiceRepository,
    private readonly notes: CreditNoteRepository,
    private readonly approvals: RefundApprovalService,
  ) {}

  /**
   * Issue the credit note an APPROVED proposal authorises.
   *
   * The proposal is the authority and the amount both: 0139 pins the figure on the approval row, so a note can only
   * be issued for exactly what a second person signed for. The approval is consumed (marked applied) in the SAME
   * transaction as the document — a rollback leaves the signature usable, a commit spends it once
   * (uq_credit_note_approval and 0139's uq_refund_approval_applied say the same thing from two directions).
   */
  async issue(tenantId: string, actor: CreditNoteActor, input: { invoiceId: string; approvalId: string; reasonCode: string; reasonText: string }, ip: string | null = null) {
    if (!actor.canFinance) throw new CreditNoteForbiddenError('report.view');
    if (!isCreditNoteReason(input.reasonCode)) {
      throw new CreditNoteRefusedError('CREDIT_NOTE_REASON_INVALID', `reason must be one of: ${CREDIT_NOTE_REASONS.join(', ')}`);
    }
    const reason = (input.reasonText ?? '').trim();
    if (reason.length < MIN_REASON_CHARS) {
      throw new CreditNoteRefusedError('CREDIT_NOTE_REASON_TOO_SHORT', `a reason of at least ${MIN_REASON_CHARS} characters is required`, { min: MIN_REASON_CHARS });
    }

    return this.uow.run(tenantId, async (tx) => {
      // Lock the invoice: the remaining-credit check and the insert must be one serialised act, or two notes of half
      // the invoice each could both pass their own check and together exceed it.
      const invoice = await this.invoices.getByIdForUpdate(tx, tenantId, input.invoiceId);
      if (!invoice) throw new InvoiceNotFoundForCreditError(input.invoiceId);

      const gateState = await this.approvals.gateInTx(tx, tenantId, 'credit_note', input.invoiceId, 0n);
      const approval = gateState.approval;
      if (!approval || approval.id !== input.approvalId) {
        throw new CreditNoteRefusedError('CREDIT_NOTE_NO_APPROVAL', 'no current approval for this invoice matches the one supplied');
      }
      if (approval.status !== 'approved') {
        throw new CreditNoteRefusedError('CREDIT_NOTE_NOT_APPROVED', `the proposal is ${approval.status}, not approved`, { status: approval.status });
      }
      if (await this.notes.existsForApproval(tx, tenantId, approval.id)) {
        throw new CreditNoteRefusedError('CREDIT_NOTE_ALREADY_ISSUED', 'a credit note has already been issued for this approval');
      }

      const already = await this.invoices.creditedTotal(tx, tenantId, input.invoiceId);
      const lines = parseLines(invoice.lines);
      const gate = creditNoteGate({
        amountMinor: approval.amountMinor,
        invoiceTotalMinor: BigInt(invoice.totalMinor),
        alreadyCreditedMinor: already,
        invoiceHasBreakdown: invoice.taxableMinor != null && lines.length > 0,
      });
      if (gate.kind === 'invoice_has_no_breakdown') {
        throw new CreditNoteRefusedError('CREDIT_NOTE_INVOICE_NOT_BROKEN_DOWN',
          'this invoice was issued before its tax breakdown was recorded, so a credit note cannot state its own split');
      }
      if (gate.kind === 'exceeds_remaining') {
        throw new CreditNoteRefusedError('CREDIT_NOTE_EXCEEDS_INVOICE',
          'the approved amount exceeds what is left of this invoice', { remainingMinor: gate.remainingMinor.toString() });
      }
      if (gate.kind === 'not_positive') throw new CreditNoteRefusedError('CREDIT_NOTE_NOT_POSITIVE', 'amount must be positive');

      const amounts = apportionCredit(gate.amountMinor, lines, BigInt(invoice.totalMinor));
      const supply = inheritSupply({ placeOfSupplyCode: invoice.placeOfSupplyCode, supplyType: invoice.supplyType as SupplyType | null });
      const issuedAt = new Date();
      const period = `${issuedAt.getUTCFullYear()}-${String(issuedAt.getUTCMonth() + 1).padStart(2, '0')}`;
      const creditNoteNo = await this.invoices.nextCreditNoteNumber(tx, tenantId, period);
      const id = uuidv7();
      await this.notes.insert(tx, {
        id, tenantId, invoiceId: invoice.id, orderId: invoice.orderId, creditNoteNo,
        reasonCode: input.reasonCode, reasonText: reason,
        totalMinor: amounts.totalMinor, taxableMinor: amounts.taxableMinor, exemptMinor: amounts.exemptMinor, taxMinor: amounts.taxMinor,
        lines: amounts.lines, placeOfSupplyCode: supply.placeOfSupplyCode, supplyType: supply.supplyType,
        approvalId: approval.id, issuedBy: actor.userId,
      });
      await this.approvals.markApplied(tx, tenantId, approval.id);
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: 'invoice.credit_note_issued', entityType: 'trade_invoice', entityId: invoice.id,
        newValue: { creditNoteNo, totalMinor: amounts.totalMinor.toString(), taxMinor: amounts.taxMinor.toString(), reasonCode: input.reasonCode, approvalId: approval.id },
        reason, ip,
      });
      this.metrics.inc('payments.credit_note_issued', { tenant: tenantId });
      return {
        id, creditNoteNo, invoiceId: invoice.id, totalMinor: amounts.totalMinor.toString(),
        taxableMinor: amounts.taxableMinor.toString(), exemptMinor: amounts.exemptMinor.toString(),
        taxMinor: amounts.taxMinor.toString(), reasonCode: input.reasonCode, issuedAt,
      };
    }, { userId: actor.userId });
  }
}

/** Rehydrate the invoice's stored lines (jsonb strings) into the bigint domain shape. A malformed line set reads as
 *  NO lines, which the gate then refuses — better than crediting against a shape nobody can parse. */
export function parseLines(raw: unknown[] | null): InvoiceLine[] {
  if (!Array.isArray(raw)) return [];
  const out: InvoiceLine[] = [];
  for (const l of raw as Array<Record<string, unknown>>) {
    try {
      out.push({
        key: String(l.key) as InvoiceLine['key'],
        hsn: (l.hsn as string | null) ?? null,
        grossMinor: BigInt(String(l.grossMinor)),
        taxableMinor: BigInt(String(l.taxableMinor)),
        exemptMinor: BigInt(String(l.exemptMinor)),
        rateBps: Number(l.rateBps ?? 0),
        taxMinor: BigInt(String(l.taxMinor)),
        rateBasis: String(l.rateBasis) as RateBasis,
        legalRef: (l.legalRef as string | null) ?? null,
      });
    } catch { return []; }
  }
  return out;
}
