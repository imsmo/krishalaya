// modules/payments/controllers/v1/invoices.controller.ts · GST trade invoices (W151 the month view, W152 the
// document) + the GSTR-1 export + credit notes (PC-56 TENANT-3c-1).
//
// Per-order reads stay visible to that order's buyer/seller or a finance moderator (404 to anyone else — no IDOR).
// THE TENANT-WIDE surfaces are finance-scoped (`report.view`, per W151's "GST exports need finance scope"): a list of
// every invoice in the organisation, with taxable values and buyer identifiers, is not a buyer's own document.
// Generation is automatic — at CONFIRM now (W151's own words), with completion as an idempotent backstop — and there
// is deliberately no endpoint that creates an invoice by hand.
import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { NotFoundError } from '../../../../shared/errors/app-error';
import { TradeInvoiceService } from '../../services/trade-invoice.service';
import { Gstr1ExportService } from '../../services/gstr1-export.service';
import { CreditNoteService } from '../../services/credit-note.service';
import { InvoiceConsoleReadModel } from '../../read-models/invoice-console.read-model';
import { canModeratePayment, canReadFinance } from '../../policies/payments.policies';
import { periodWindow } from '../../domain/gstr1';
import {
  QueryInvoicesSchema, QueryInvoicesDto, Gstr1ExportSchema, Gstr1ExportDto,
  IssueCreditNoteSchema, IssueCreditNoteDto, parseInvoiceCursor, buildInvoiceCursor,
} from '../../dto/invoice-console.dto';

const ipOf = (r: Request) => r.ip || null;

@Controller({ path: 'invoices', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard)
export class InvoicesController {
  constructor(
    private readonly invoices: TradeInvoiceService,
    private readonly console: InvoiceConsoleReadModel,
    private readonly gstr1: Gstr1ExportService,
    private readonly creditNotes: CreditNoteService,
  ) {}

  /** W151's month view + its three KPI cards. Finance scope; keyset only. */
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryInvoicesSchema) q: QueryInvoicesDto) {
    if (!canReadFinance(ctx)) throw new NotFoundError('Not found');   // 404, not 403 — no enumeration of a finance surface
    const w = q.period ? periodWindow(q.period) : null;
    return Promise.all([
      this.console.list(ctx.tenantId, { fromIso: w?.fromIso, toIso: w?.toIso, cursor: parseInvoiceCursor(q.cursor), limit: q.limit }),
      w ? this.console.monthKpis(ctx.tenantId, w) : Promise.resolve(null),
    ]).then(([rows, kpis]) => ({
      data: rows,
      meta: {
        kpis,
        nextCursor: rows.length === q.limit && rows.length > 0 ? buildInvoiceCursor(rows[rows.length - 1]) : null,
      },
    }));
  }

  /** W151's "Export GSTR-1 data (month)". Synchronous, receipted, and it REFUSES an open period or a month too large
   *  to return whole — see the service for why each refusal is a refusal rather than a truncation. */
  @Post('gstr1')
  exportGstr1(@CurrentContext() ctx: RequestContext, @ZodBody(Gstr1ExportSchema) dto: Gstr1ExportDto) {
    return this.gstr1.export(ctx.tenantId, { userId: ctx.userId, canFinance: canReadFinance(ctx) }, dto.period)
      .then((data) => ({ data }));
  }

  /** W152's "Issue credit note (checker)" — the approval (0139's plane, subject 'credit_note') is the authority AND
   *  the amount; this endpoint spends it once. */
  @Post(':id/credit-notes')
  issueCreditNote(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(IssueCreditNoteSchema) dto: IssueCreditNoteDto) {
    return this.creditNotes.issue(ctx.tenantId, {
      userId: ctx.userId, canFinance: canReadFinance(ctx), canRefund: ctx.permissions.has('order.refund') || ctx.permissions.has('*'),
    }, { invoiceId: id, approvalId: dto.approvalId, reasonCode: dto.reasonCode, reasonText: dto.reasonText }, ipOf(r))
      .then((data) => ({ data }));
  }

  @Get('order/:orderId')
  byOrder(@CurrentContext() ctx: RequestContext, @Param('orderId') orderId: string) {
    return this.invoices.getByOrder(ctx.tenantId, { userId: ctx.userId, canModerate: canModeratePayment(ctx) }, orderId).then((data) => ({ data }));
  }

  // A short-lived presigned PDF download URL for the order's invoice — buyer/seller/finance only (404 else).
  @Get('order/:orderId/download')
  download(@CurrentContext() ctx: RequestContext, @Param('orderId') orderId: string) {
    return this.invoices.downloadUrlForOrder(ctx.tenantId, { userId: ctx.userId, canModerate: canModeratePayment(ctx) }, orderId).then((data) => ({ data }));
  }

  /** W152: the document, its lines, and the corrections against it.
   *  **DECLARED AFTER the `order/:orderId` routes on purpose**: Nest matches in declaration order, so a ':id' route
   *  above them would swallow /invoices/order/<uuid> with id='order' — a 404 on the buyer's own invoice. */
  @Get(':id')
  detail(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    if (!canReadFinance(ctx)) throw new NotFoundError('Not found');
    return Promise.all([this.console.detail(ctx.tenantId, id), this.console.creditNotesFor(ctx.tenantId, id)])
      .then(([invoice, creditNotes]) => {
        if (!invoice) throw new NotFoundError('Invoice not found');
        return { data: { ...invoice, creditNotes } };
      });
  }
}
