// modules/insurance/controllers/v1/insurance-policies.controller.ts · policy enrolment (KV-BL-052, screens
// 283-285/287). `insurance` flag. propose/cancel = holder (insurance.enrol); list/get honour ownership
// (moderator bypass via insurance.manage, 404-not-403 anti-IDOR, mirrors fintech's loan-applications controller).
import { Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { InsurancePolicyService } from '../../services/insurance-policy.service';
import { CreatePolicyEnrolmentSchema, CreatePolicyEnrolmentDto } from '../../dto/create-insurance-policy.dto';
import { LinkAutopayMandateSchema, LinkAutopayMandateDto } from '../../dto/link-autopay-mandate.dto';
import { QueryInsurancePoliciesSchema, QueryInsurancePoliciesDto } from '../../dto/query-insurance-policy.dto';
import { InsurancePermissions, canEnrol, canManageInsurance } from '../../policies/insurance.policies';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'insurance/policies', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('insurance')
export class InsurancePoliciesController {
  constructor(private readonly svc: InsurancePolicyService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageInsurance(ctx) }; }

  /** ENROL (propose) — screens 283 (crop), 284 (livestock, N subjects → N policies atomically), 285
   *  (health+life, single self-holder). Idempotency-keyed (Law 3): a retried tap never double-enrols. */
  @Post() @RequirePermissions(InsurancePermissions.Enrol)
  propose(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreatePolicyEnrolmentSchema) dto: CreatePolicyEnrolmentDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    if (!canEnrol(ctx)) throw new BadRequestError('requires insurance.enrol'); // defence in depth; guard already enforces
    return this.svc.propose(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }

  /** "My policies" (screen 287) — keyset-paginated, holder-scoped (or all, for insurance.manage). */
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryInsurancePoliciesSchema) q: QueryInsurancePoliciesDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  /** Policy detail (screen 286). 404 (not 403) to a non-owner non-manager — anti-IDOR. */
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }

  /** CANCEL — withdraw/surrender (screen 287's "Cancelled" example). Idempotency-keyed. */
  @Post(':id/cancel') @RequirePermissions(InsurancePermissions.Enrol)
  cancel(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.cancel(ctx.tenantId, this.actor(ctx), key, id).then((data) => ({ data }));
  }

  /** INITIATE PREMIUM PAYMENT (KV-BL-053, screen 288). Creates a payments-module intent for this policy's
   *  own server-computed premium; the policy activates ONLY once the payments module later confirms a
   *  matching captured payment (PremiumPaymentSucceededHandler). Idempotency-Key required (Law 3). */
  @Post(':id/initiate-premium-payment') @RequirePermissions(InsurancePermissions.Enrol)
  initiatePremiumPayment(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.initiatePremiumPayment(ctx.tenantId, this.actor(ctx), key, id).then((data) => ({ data }));
  }

  /** AUTO-DEBIT THIN LINK (DEV-25/KV-BL-057) — links an ALREADY-REGISTERED UPI-AutoPay mandate (registered
   *  via the existing payments-module autopay endpoints) to this policy for premium-renewal purposes. Gated
   *  behind the EXISTING `autopay_execution` flag (reused, no 4th flag). Builds no money-movement code. */
  @Post(':id/autopay-mandate') @RequirePermissions(InsurancePermissions.Enrol)
  linkAutopayMandate(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(LinkAutopayMandateSchema) dto: LinkAutopayMandateDto) {
    return this.svc.linkAutopayMandate(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data }));
  }
}
