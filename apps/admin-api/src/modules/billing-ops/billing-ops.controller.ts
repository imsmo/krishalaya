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
import {
  QueryInvoicesSchema, QueryInvoicesDto, UpdateInvoiceSchema, UpdateInvoiceDto,
  QueryDunningSchema, QueryDunningDto, RecordDunningSchema, RecordDunningDto,
  QueryDunningQueueSchema, QueryDunningQueueDto,
  QueryAdjustmentsSchema, QueryAdjustmentsDto, ApplyAdjustmentSchema, ApplyAdjustmentDto,
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
    return this.adjustments.list({ tenantId: q.tenantId, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
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
  @Post('adjustments') @RequireOwnerPermission(OwnerPermissions.BillingManage) @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  applyAdjustment(@Req() req: any, @ZodBody(ApplyAdjustmentSchema) dto: ApplyAdjustmentDto) {
    return this.adjustments.apply(admin(req), dto).then((data) => ({ data }));
  }
}
