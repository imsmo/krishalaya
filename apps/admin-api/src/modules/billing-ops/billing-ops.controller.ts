// apps/admin-api/src/modules/billing-ops/billing-ops.controller.ts · god-mode SaaS-billing surface (Law 11).
// Every route: AdminAuthGuard + OwnerPermissionsGuard. MUTATIONS (invoice transition, dunning, MANUAL money
// adjustment) additionally require HardwareKeyGuard (FIDO2) + StepUpReauthGuard — JIT elevation for consequential
// billing/money controls. validate (zod) → authorize (owner perm) → delegate. No business logic here. The money
// move in POST /adjustments goes through the service → wallet-service; the controller never touches the ledger.
import { Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { SaasInvoicesAdminService } from './services/saas-invoices-admin.service';
import { DunningService } from './services/dunning.service';
import { ManualAdjustmentService } from './services/manual-adjustment.service';
import { RevenueDashboardService } from './services/revenue-dashboard.service';
import { SubscriptionViewService } from './services/subscription-view.service';
import { InvoicePaymentsService } from './services/invoice-payments.service';
import { DunningPolicyService } from './services/dunning-policy.service';
import { InvoicePdfService } from './services/invoice-pdf.service';
import { SubscriptionWriteService } from './services/subscription-write.service';
import { BillingExportService } from './services/billing-export.service';
import { InvoiceBulkService } from './services/invoice-bulk.service';
import { RevenueSeriesService } from './services/revenue-series.service';
import { RenewalVisibilityService } from './services/renewal-visibility.service';
import {
  QueryInvoicesSchema, QueryInvoicesDto, UpdateInvoiceSchema, UpdateInvoiceDto,
  QueryDunningSchema, QueryDunningDto, RecordDunningSchema, RecordDunningDto,
  QueryDunningQueueSchema, QueryDunningQueueDto,
  QueryAdjustmentsSchema, QueryAdjustmentsDto,
  RecordPaymentSchema, RecordPaymentDto, ReversePaymentSchema, ReversePaymentDto,
  RequestAdjustmentSchema, RequestAdjustmentDto, DecideAdjustmentSchema, DecideAdjustmentDto,
  PublishDunningPolicySchema, PublishDunningPolicyDto,
  ChangePlanSchema, ChangePlanDto, AddAddonSchema, AddAddonDto, CancelSubscriptionSchema, CancelSubscriptionDto,
  QueryExportSchema, QueryExportDto, BulkInvoiceSchema, BulkInvoiceDto,
  QuerySeriesSchema, QuerySeriesDto, QueryRenewalPreviewSchema, QueryRenewalPreviewDto,
  QueryRevenueSchema, QueryRevenueDto,
} from './dto/billing-ops.dto';

// the queue's cursor is (daysLate|invoiceId), not (createdAt|id) — a malformed one is IGNORED rather than 400ing,
// because a stale bookmark should show page 1, not an error.
const decodeQueueCursor = (c?: string) => {
  if (!c) return undefined;
  const [d, id] = Buffer.from(c, 'base64').toString().split('|');
  const n = Number(d);
  return Number.isInteger(n) && id ? { d: n, id } : undefined;
};
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };
const admin = (req: any): AdminRequestContext => req.admin;

@Controller({ path: 'billing', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class BillingOpsController {
  constructor(
    private readonly invoices: SaasInvoicesAdminService,
    private readonly dunning: DunningService,
    private readonly adjustments: ManualAdjustmentService,
    private readonly revenue: RevenueDashboardService,
    private readonly subscriptions: SubscriptionViewService,
    private readonly payments: InvoicePaymentsService,
    private readonly policy: DunningPolicyService,
    private readonly pdf: InvoicePdfService,
    private readonly subWrite: SubscriptionWriteService,
    private readonly exports: BillingExportService,
    private readonly bulk: InvoiceBulkService,
    private readonly series: RevenueSeriesService,
    private readonly renewals: RenewalVisibilityService,
  ) {}

  // ---- reads ----
  @Get('revenue') @RequireOwnerPermission(OwnerPermissions.BillingRead)
  revenueOverview(@ZodQuery(QueryRevenueSchema) q: QueryRevenueDto) { return this.revenue.overview(q).then((data) => ({ data })); }

  @Get('invoices') @RequireOwnerPermission(OwnerPermissions.BillingRead)
  listInvoices(@ZodQuery(QueryInvoicesSchema) q: QueryInvoicesDto) {
    return this.invoices.list({ tenantId: q.tenantId, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get('invoices/:id') @RequireOwnerPermission(OwnerPermissions.BillingRead)
  getInvoice(@Param('id') id: string) { return this.invoices.get(id).then((data) => ({ data })); }

  // PC-56 ADMIN-1 · the collection queue (must be declared BEFORE any 'dunning/:x' route would shadow it, and it
  // deliberately sits outside `invoices/` because it is not about one invoice).
  @Get('dunning') @RequireOwnerPermission(OwnerPermissions.BillingRead)
  dunningQueue(@ZodQuery(QueryDunningQueueSchema) q: QueryDunningQueueDto) {
    return this.dunning.queue({ minDaysLate: q.minDaysLate, cursor: decodeQueueCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  @Get('invoices/:id/dunning') @RequireOwnerPermission(OwnerPermissions.BillingRead)
  listDunning(@Param('id') id: string, @ZodQuery(QueryDunningSchema) q: QueryDunningDto) {
    return this.dunning.list({ invoiceId: id, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  // PC-56 ADMIN-1 · one tenant's subscription view (state + add-ons + the invoices it produced). Read-only.
  @Get('subscriptions/:tenantId') @RequireOwnerPermission(OwnerPermissions.BillingRead)
  subscriptionView(@Param('tenantId') tenantId: string) {
    return this.subscriptions.forTenant(tenantId).then((data) => ({ data }));
  }

  @Get('adjustments') @RequireOwnerPermission(OwnerPermissions.BillingRead)
  listAdjustments(@ZodQuery(QueryAdjustmentsSchema) q: QueryAdjustmentsDto) {
    return this.adjustments.list({ tenantId: q.tenantId, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  // PC-56 ADMIN-1b · every payment recorded against one invoice, plus the DERIVED money picture (paid /
  // outstanding / overpaid). This read is what replaced "balance unknown" on the collection queue.
  @Get('invoices/:id/payments') @RequireOwnerPermission(OwnerPermissions.BillingRead)
  listPayments(@Param('id') id: string) { return this.payments.list(id).then((data) => ({ data })); }

  // The ACTIVE collections ladder + its steps (null when no version is active — a real state, said plainly).
  @Get('dunning-policy') @RequireOwnerPermission(OwnerPermissions.BillingRead)
  activePolicy() { return this.policy.active().then((data) => ({ data })); }
  @Get('dunning-policy/versions') @RequireOwnerPermission(OwnerPermissions.BillingRead)
  policyVersions() { return this.policy.versions().then((data) => ({ data })); }

  // PC-56 ADMIN-1c · a time-limited link to the invoice's PDF. A READ, but an audited one: handing out a tenant's tax
  // document is an event about a real business. The route takes an INVOICE id — never an object key, which would be an
  // arbitrary-object-read endpoint in a realm that can already read every tenant (Law 11).
  @Get('invoices/:id/pdf') @RequireOwnerPermission(OwnerPermissions.BillingRead)
  invoicePdf(@Req() req: any, @Param('id') id: string) {
    return this.pdf.downloadUrl(admin(req), id).then((data) => ({ data }));
  }

  // PC-56 ADMIN-1d · reporting reads (ADMIN-1-Q7) and the renewal-run PREVIEW (ADMIN-1-Q4, rescoped to visibility —
  // the run itself is the worker job in apps/api and must stay the only invoice generator).
  @Get('series') @RequireOwnerPermission(OwnerPermissions.BillingRead)
  revenueSeries(@ZodQuery(QuerySeriesSchema) q: QuerySeriesDto) { return this.series.series(q).then((data) => ({ data })); }

  @Get('renewal-preview') @RequireOwnerPermission(OwnerPermissions.BillingRead)
  renewalPreview(@ZodQuery(QueryRenewalPreviewSchema) q: QueryRenewalPreviewDto) {
    return this.renewals.preview(q).then((data) => ({ data }));
  }

  // ---- mutations: hardware-key + step-up elevation required ----
  @Patch('invoices/:id') @RequireOwnerPermission(OwnerPermissions.BillingManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  updateInvoice(@Req() req: any, @Param('id') id: string, @ZodBody(UpdateInvoiceSchema) dto: UpdateInvoiceDto) {
    return this.invoices.update(admin(req), id, dto).then((data) => ({ data }));
  }
  @Post('invoices/:id/dunning') @RequireOwnerPermission(OwnerPermissions.BillingManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  recordDunning(@Req() req: any, @Param('id') id: string, @ZodBody(RecordDunningSchema) dto: RecordDunningDto) {
    return this.dunning.record(admin(req), id, dto).then((data) => ({ data }));
  }
  // PC-56 ADMIN-1b · MAKER-CHECKER on adjustments (0093). Three routes because they are three different acts by
  // (at least) two different people. REQUEST moves no money and therefore needs no elevation beyond the write
  // permission; DECIDE and APPLY are the consequential ones and keep FIDO2 + step-up.
  @Post('adjustments') @RequireOwnerPermission(OwnerPermissions.BillingManage)
  requestAdjustment(@Req() req: any, @ZodBody(RequestAdjustmentSchema) dto: RequestAdjustmentDto) {
    return this.adjustments.request(admin(req), dto).then((data) => ({ data }));
  }
  @Post('adjustments/:id/decision') @RequireOwnerPermission(OwnerPermissions.BillingManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  decideAdjustment(@Req() req: any, @Param('id') id: string, @ZodBody(DecideAdjustmentSchema) dto: DecideAdjustmentDto) {
    return this.adjustments.decide(admin(req), id, dto).then((data) => ({ data }));
  }
  @Post('adjustments/:id/apply') @RequireOwnerPermission(OwnerPermissions.BillingManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  applyAdjustment(@Req() req: any, @Param('id') id: string) {
    return this.adjustments.apply(admin(req), id).then((data) => ({ data }));
  }

  // PC-56 ADMIN-1b · payments (0092). Recording a receipt is consequential — it settles a tenant's invoice — so it
  // carries the same elevation as every other money control here, even though it posts nothing to the ledger.
  @Post('invoices/:id/payments') @RequireOwnerPermission(OwnerPermissions.BillingManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  recordPayment(@Req() req: any, @Param('id') id: string, @ZodBody(RecordPaymentSchema) dto: RecordPaymentDto) {
    return this.payments.record(admin(req), id, dto).then((data) => ({ data }));
  }
  @Post('payments/:id/reverse') @RequireOwnerPermission(OwnerPermissions.BillingManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  reversePayment(@Req() req: any, @Param('id') id: string, @ZodBody(ReversePaymentSchema) dto: ReversePaymentDto) {
    return this.payments.reverse(admin(req), id, dto).then((data) => ({ data }));
  }

  // PC-56 ADMIN-1c · SUBSCRIPTION WRITES (ADMIN-1-Q10). No money moves: these change what the NEXT invoice says.
  // Elevated anyway — they change what a tenant pays, which is consequential even when nothing is posted today.
  @Post('subscriptions/:tenantId/plan') @RequireOwnerPermission(OwnerPermissions.BillingManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  changePlan(@Req() req: any, @Param('tenantId') tenantId: string, @ZodBody(ChangePlanSchema) dto: ChangePlanDto) {
    return this.subWrite.changePlan(admin(req), tenantId, dto).then((data) => ({ data }));
  }
  @Post('subscriptions/:tenantId/addons') @RequireOwnerPermission(OwnerPermissions.BillingManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  addAddon(@Req() req: any, @Param('tenantId') tenantId: string, @ZodBody(AddAddonSchema) dto: AddAddonDto) {
    return this.subWrite.addAddon(admin(req), tenantId, dto).then((data) => ({ data }));
  }
  @Post('subscriptions/:tenantId/cancel-at-period-end') @RequireOwnerPermission(OwnerPermissions.BillingManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  cancelAtPeriodEnd(@Req() req: any, @Param('tenantId') tenantId: string, @ZodBody(CancelSubscriptionSchema) dto: CancelSubscriptionDto) {
    return this.subWrite.setCancelAtPeriodEnd(admin(req), tenantId, dto).then((data) => ({ data }));
  }

  // PC-56 ADMIN-1d · the AUDIT-STAMPED EXPORT (ADMIN-1-Q3). A POST because it WRITES a receipt: an export is a read
  // that leaves a trail, and a GET that mutates the audit ledger would be cached, prefetched and repeated by proxies.
  @Post('exports') @RequireOwnerPermission(OwnerPermissions.BillingRead)
  exportReport(@Req() req: any, @ZodBody(QueryExportSchema) dto: QueryExportDto) {
    return this.exports.export(admin(req), dto).then((data) => ({ data }));
  }

  // PC-56 ADMIN-1d · BULK invoice transitions (ADMIN-1-Q11). Elevated: a bulk void moves many tenants' documents at
  // once, which is more consequential than a single one, not less.
  @Post('invoices/bulk') @RequireOwnerPermission(OwnerPermissions.BillingManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  bulkInvoices(@Req() req: any, @ZodBody(BulkInvoiceSchema) dto: BulkInvoiceDto) {
    return this.bulk.run(admin(req), dto).then((data) => ({ data }));
  }

  // PC-56 ADMIN-1b · publish a NEW dunning-policy version (0094). Never an in-place edit: the old ladder is why a
  // tenant was chased the way they were, and that has to stay readable.
  @Post('dunning-policy') @RequireOwnerPermission(OwnerPermissions.BillingManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  publishPolicy(@Req() req: any, @ZodBody(PublishDunningPolicySchema) dto: PublishDunningPolicyDto) {
    return this.policy.publish(admin(req), dto).then((data) => ({ data }));
  }
}
