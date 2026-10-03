// modules/tenancy/controllers/v1/tenant-settings.controller.ts · the calling tenant's typed settings + read-only feature overrides +
// usage (validate → authorize → delegate). All scoped to ctx.tenantId. Gated by the `tenancy` flag.
//
// PC-56 TENANT-13b · W186 + W2754–W2760 (founder decision: tenant maker-checker with platform floors, effective next midnight IST with
// member notice). EVERY settings route needs `tenant.settings` — the registry read included (F-12: it was open to every member):
//   GET  /tenant-settings                          the registry W186 prints (type · platform default · your value · effect · risk · floor ·
//                                                   pending proposal) + the admin count + the language panel
//   PUT  /tenant-settings                          an ORDINARY wired key, directly (before/after + optional reason); a trust-affecting key
//                                                   answers 409 PROPOSAL_REQUIRED
//   POST /tenant-settings/preview                  W2755's review (writes nothing)
//   GET  /tenant-settings/proposals[/:id]          the proposals, µs keyset
//   POST /tenant-settings/proposals                a trust-affecting key: a PROPOSAL (Idempotency-Key)
//   POST /tenant-settings/proposals/:id/confirm    a DIFFERENT tenant_admin (0192's trigger is the wall)
//   POST /tenant-settings/proposals/:id/refuse     a tenant_admin, with a reason
//   GET  /tenant-settings/history                  before/after per key, µs keyset
//   PUT  /tenant-settings/languages                writes tenant_languages (F-14)
// Features + usage stay READ-ONLY (Law 11 — a tenant cannot grant itself features or edit metered usage).
import { Controller, Get, Headers, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { TenancyPermissions, tenantActorOf } from '../../policies/tenancy.policies';
import { TenantService } from '../../services/tenant.service';
import { TenantSettingsService } from '../../services/tenant-settings.service';
import {
  PutTenantSettingSchema, PutTenantSettingDto, ProposeSettingSchema, ProposeSettingDto, RefuseProposalSchema, RefuseProposalDto,
  PutLanguagesSchema, PutLanguagesDto,
} from '../../dto/create-tenant-settings.dto';
import { QueryProposalsSchema, QueryProposalsDto, QueryHistorySchema, QueryHistoryDto } from '../../dto/query-tenant-settings.dto';

const ipOf = (r: Request) => r.ip || null;
const reqKey = (k: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };

@Controller({ path: 'tenant-settings', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('tenancy')
export class TenantSettingsController {
  constructor(private readonly tenants: TenantService, private readonly settings: TenantSettingsService) {}

  @Get() @RequirePermissions(TenancyPermissions.ManageTenant)
  list(@CurrentContext() ctx: RequestContext) {
    return this.settings.registry(ctx.tenantId, tenantActorOf(ctx)).then((data) => ({ data }));
  }
  @Put() @RequirePermissions(TenancyPermissions.ManageTenant)
  put(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(PutTenantSettingSchema) dto: PutTenantSettingDto) {
    return this.settings.put(ctx.tenantId, tenantActorOf(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post('preview') @RequirePermissions(TenancyPermissions.ManageTenant)
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(ProposeSettingSchema) dto: ProposeSettingDto) {
    return this.settings.preview(ctx.tenantId, tenantActorOf(ctx), dto).then((data) => ({ data }));
  }
  @Get('proposals') @RequirePermissions(TenancyPermissions.ManageTenant)
  proposals(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryProposalsSchema) q: QueryProposalsDto) {
    return this.settings.proposals(ctx.tenantId, tenantActorOf(ctx), q).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get('proposals/:id') @RequirePermissions(TenancyPermissions.ManageTenant)
  proposal(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.settings.proposal(ctx.tenantId, tenantActorOf(ctx), id).then((data) => ({ data }));
  }
  @Post('proposals') @RequirePermissions(TenancyPermissions.ManageTenant)
  propose(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(ProposeSettingSchema) dto: ProposeSettingDto) {
    return this.settings.propose(ctx.tenantId, tenantActorOf(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Post('proposals/:id/confirm') @RequirePermissions(TenancyPermissions.ManageTenant)
  confirm(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string) {
    return this.settings.confirm(ctx.tenantId, tenantActorOf(ctx), reqKey(key), id, ipOf(r)).then((data) => ({ data }));
  }
  @Post('proposals/:id/refuse') @RequirePermissions(TenancyPermissions.ManageTenant)
  refuse(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(RefuseProposalSchema) dto: RefuseProposalDto) {
    return this.settings.refuse(ctx.tenantId, tenantActorOf(ctx), reqKey(key), id, dto.reason, ipOf(r)).then((data) => ({ data }));
  }
  @Get('history') @RequirePermissions(TenancyPermissions.ManageTenant)
  history(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryHistorySchema) q: QueryHistoryDto) {
    return this.settings.history(ctx.tenantId, tenantActorOf(ctx), q).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Put('languages') @RequirePermissions(TenancyPermissions.ManageTenant)
  languages(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(PutLanguagesSchema) dto: PutLanguagesDto) {
    return this.settings.putLanguages(ctx.tenantId, tenantActorOf(ctx), reqKey(key), dto, ipOf(r)).then((data) => ({ data }));
  }
  @Get('features')
  features(@CurrentContext() ctx: RequestContext) { return this.tenants.listFeatures(ctx.tenantId).then((res) => ({ data: res.items })); }
  @Get('usage')
  usage(@CurrentContext() ctx: RequestContext) { return this.tenants.currentUsage(ctx.tenantId).then((res) => ({ data: res.items })); }
}
