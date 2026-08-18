// modules/tenancy/controllers/v1/saas-invoices.controller.ts · W120 (Billing) — the tenant's own SaaS invoices
// (PC-56 TENANT-4d-2). validate → authorize → delegate.
//
// **THIS CONTROLLER DID NOT EXIST.** `SaasInvoiceService.list/getById` shipped in TENANT-1 with a
// `tenant.settings` gate and no route anywhere in apps/api, so a tenant could never read a bill this platform
// raised to it. There is no `:tenantId` path param here either: every route is scoped to `ctx.tenantId`, so a
// tenant can only ever read its own invoices and there is nothing to enumerate.
//
// Permission: `tenant.settings` (TenancyPermissions.ManageTenant), reusing the gate the service already
// enforced rather than minting a `billing.view` permission that nothing would grant — a permission with no
// grant is a door that looks locked and is simply absent.
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { FlagsService } from '../../../../core/feature-flags/flags.service';
import { ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { TenancyPermissions, tenantActorOf } from '../../policies/tenancy.policies';
import { SaasInvoiceService } from '../../services/saas-invoice.service';
import { BillingConsoleReadModel } from '../../read-models/billing-console.read-model';
import { QuerySaasInvoiceSchema, QuerySaasInvoiceDto } from '../../dto/query-saas-invoice.dto';
import { statusesForTab } from '../../domain/saas-invoice-balance';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'billing', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('saas_billing_console')
@RequirePermissions(TenancyPermissions.ManageTenant)
export class SaasInvoicesController {
  constructor(
    private readonly invoices: SaasInvoiceService,
    private readonly console: BillingConsoleReadModel,
    private readonly flags: FlagsService,
  ) {}

  /** W120's header: open balance, oldest-due invoice, paid-to-date, tab counts, billed identity, and the four
   *  mechanism verdicts (autopay / next debit / grace period / retry-and-notify). */
  @Get('console')
  async consoleView(@CurrentContext() ctx: RequestContext) {
    // Read, not gate: the console renders either way and says WHY the pay button is absent. `.catch(() => false)`
    // because an unreadable flag must degrade to "off", never to an unpayable-invoice error (Law 12).
    const selfPay = await this.flags.isEnabled('saas_invoice_self_pay', { tenantId: ctx.tenantId }).catch(() => false);
    return { data: await this.console.view(ctx.tenantId, new Date(), selfPay) };
  }

  /** The keyset page behind each tab. Keyset only — a tenant with ten years of monthly invoices pages in
   *  constant time, and an OFFSET would drift as new invoices are raised beneath them. */
  @Get('invoices')
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QuerySaasInvoiceSchema) q: QuerySaasInvoiceDto) {
    const statuses = q.tab ? statusesForTab(q.tab) ?? undefined : undefined;
    return this.invoices.list(ctx.tenantId, tenantActorOf(ctx), { status: q.status, statuses, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  @Get('invoices/:id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.invoices.getById(ctx.tenantId, tenantActorOf(ctx), id).then((data) => ({ data }));
  }

  /**
   * W2428's quote: exactly what is outstanding on this invoice, resolved SERVER-SIDE, plus the reason when it
   * cannot be paid. A GET on purpose — it changes nothing, and the console needs it to decide whether to show
   * the button at all rather than showing one that refuses.
   */
  @Get('invoices/:id/pay-quote')
  async payQuote(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    const selfPay = await this.flags.isEnabled('saas_invoice_self_pay', { tenantId: ctx.tenantId }).catch(() => false);
    return { data: await this.invoices.payQuote(ctx.tenantId, id, selfPay) };
  }

  // THERE IS DELIBERATELY NO `POST .../pay` HERE. Money-in belongs to the payments module, and a second route
  // that started a gateway order would be a second mechanism over one payment — the defect class this programme
  // keeps finding. W2429's confirm step re-reads the quote above and then calls `POST /v1/payments`, whose
  // `assertValidReference` now asks THIS module whether the amount is exactly what is outstanding.
}
