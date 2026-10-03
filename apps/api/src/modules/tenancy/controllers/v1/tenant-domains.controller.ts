// modules/tenancy/controllers/v1/tenant-domains.controller.ts · PC-56 TENANT-13d · W192 + W2591–W2597 (validate → authorize → delegate).
// Founder decision: DOMAIN BY PLAN (custom_domain); CNAME + TXT proof; platform edge; Host routing; ACME later. Every route — reads
// included (F-12) — needs `tenant.settings`; writes carry an Idempotency-Key; flag `tenant_domains` (default OFF). The pre-13d routes
// `POST /tenants/me/domains/:id/primary` (one person) and `DELETE /tenants/me/domains/:id` (always 42501, F-6) are replaced by proposals.
//   GET  /tenants/me/domains                         every live domain + the plan fact + the platform edge + waiting proposals (µs keyset)
//   POST /tenants/me/domains/preview                 W2592's review: plan first, reserved, claimed elsewhere, the exact CNAME + TXT records
//   POST /tenants/me/domains                         add a claim (W2593: the records again + "we check every 5 minutes")
//   POST /tenants/me/domains/:id/recheck             re-check now (once a minute)
//   GET  /tenants/me/domains/proposals[/:id]         µs keyset
//   POST /tenants/me/domains/proposals               make primary / remove (successor named for a primary)
//   POST /tenants/me/domains/proposals/:id/confirm   a DIFFERENT tenant_admin — applied in the same transaction
//   POST /tenants/me/domains/proposals/:id/refuse    with a reason
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { TenancyPermissions, tenantActorOf } from '../../policies/tenancy.policies';
import { TenantDomainService } from '../../services/tenant-domain.service';
import {
  AddDomainSchema, AddDomainDto, DomainProposeSchema, DomainProposeDto, RefuseSchema, RefuseDto, CursorQuerySchema, CursorQueryDto,
} from '../../dto/brand-domains.dto';

const ipOf = (r: Request) => r.ip || null;
const reqKey = (k: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };

@Controller({ path: 'tenants/me/domains', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('tenant_domains')
export class TenantDomainsController {
  constructor(private readonly domains: TenantDomainService) {}

  @Get() @RequirePermissions(TenancyPermissions.ManageTenant)
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(CursorQuerySchema) q: CursorQueryDto) {
    return this.domains.list(ctx.tenantId, tenantActorOf(ctx), q).then(({ items, nextCursor, ...rest }) => ({ data: { items, ...rest }, meta: { nextCursor } }));
  }
  @Post('preview') @RequirePermissions(TenancyPermissions.ManageTenant)
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(AddDomainSchema) dto: AddDomainDto) {
    return this.domains.previewAdd(ctx.tenantId, tenantActorOf(ctx), dto).then((data) => ({ data }));
  }
  @Post() @RequirePermissions(TenancyPermissions.ManageTenant)
  add(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(AddDomainSchema) dto: AddDomainDto) {
    return this.domains.add(ctx.tenantId, tenantActorOf(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post(':id/recheck') @RequirePermissions(TenancyPermissions.ManageTenant)
  recheck(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) {
    return this.domains.recheck(ctx.tenantId, tenantActorOf(ctx), id, ipOf(r)).then((data) => ({ data }));
  }
  @Get('proposals') @RequirePermissions(TenancyPermissions.ManageTenant)
  proposals(@CurrentContext() ctx: RequestContext, @ZodQuery(CursorQuerySchema) q: CursorQueryDto) {
    return this.domains.proposals(ctx.tenantId, tenantActorOf(ctx), q).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get('proposals/:id') @RequirePermissions(TenancyPermissions.ManageTenant)
  proposal(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.domains.proposal(ctx.tenantId, tenantActorOf(ctx), id).then((data) => ({ data }));
  }
  @Post('proposals') @RequirePermissions(TenancyPermissions.ManageTenant)
  propose(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(DomainProposeSchema) dto: DomainProposeDto) {
    return this.domains.propose(ctx.tenantId, tenantActorOf(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post('proposals/:id/confirm') @RequirePermissions(TenancyPermissions.ManageTenant)
  confirm(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string) {
    return this.domains.confirm(ctx.tenantId, tenantActorOf(ctx), reqKey(key), id, ipOf(r)).then((data) => ({ data }));
  }
  @Post('proposals/:id/refuse') @RequirePermissions(TenancyPermissions.ManageTenant)
  refuse(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(RefuseSchema) dto: RefuseDto) {
    return this.domains.refuse(ctx.tenantId, tenantActorOf(ctx), reqKey(key), id, dto.reason, ipOf(r)).then((data) => ({ data }));
  }
}
