// modules/tenant-integrations/controllers/v1/integrations.controller.ts · the calling tenant's provider connections (validate → authorize →
// delegate) — PC-56 TENANT-13c (W187 + W2643–W2649).
//   • behind the `tenancy` flag (OFF → 404; the console prints "Flagged off");
//   • EVERY route — reads included — needs `api.manage` OR `tenant.settings` (F-12: before, any member could list connections and
//     config). PermissionsGuard requires ALL listed codes, so the OR is the service's `canManageIntegrations` (a refusal is a sentence);
//   • no direct connect / disconnect route exists any more: every provider change is a PROPOSAL a second tenant_admin confirms
//     (credentials + money paths — canon "owner + checker"); every write takes an Idempotency-Key (F-21) and a reason;
//   • NO route here carries @ApiScopes: a tenant API key never touches provider credentials;
//   • static `providers` / `preview` / `proposals` routes are declared before any `:id`.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { UUID_RE } from '../../../../shared/pagination/us-keyset';
import { IntegrationsActor, TenantIntegrationService } from '../../services/tenant-integration.service';
import {
  PreviewIntegrationDto, PreviewIntegrationSchema, ProposeIntegrationDto, ProposeIntegrationSchema, QueryProposalsDto, QueryProposalsSchema, RefuseDto, RefuseSchema,
} from '../../dto/connect-integration.dto';

const needKey = (k?: string) => { if (!k || !/^[A-Za-z0-9_-]{8,120}$/.test(k)) throw new BadRequestError('Idempotency-Key header required'); return k; };
const idOf = (id: string) => { if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid'); return id; };
const ipOf = (r: Request) => (r.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || r.ip || null;

@Controller({ path: 'integrations', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('tenancy')
export class IntegrationsController {
  constructor(private readonly integrations: TenantIntegrationService) {}
  private actor(ctx: RequestContext, r: Request): IntegrationsActor { return { userId: ctx.userId, permissions: ctx.permissions, ip: ipOf(r), requestId: ctx.requestId || null }; }

  /** The catalogue: each provider ownable (connectable) or platform-managed (refused by name). */
  @Get('providers')
  providers(@CurrentContext() ctx: RequestContext, @Req() r: Request) { return this.integrations.listProviders(ctx.tenantId, this.actor(ctx, r)).then((data) => ({ data })); }

  /** W187 — connections (masked ref, status, Health 24 h, consumers), providers, open proposals, count, platform defaults. */
  @Get()
  list(@CurrentContext() ctx: RequestContext, @Req() r: Request) { return this.integrations.list(ctx.tenantId, this.actor(ctx, r)).then((data) => ({ data })); }

  /** W2644 — the review. Writes nothing and calls no provider. */
  @Post('preview')
  preview(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodBody(PreviewIntegrationSchema) dto: PreviewIntegrationDto) {
    return this.integrations.preview(ctx.tenantId, this.actor(ctx, r), dto).then((data) => ({ data }));
  }

  @Get('proposals')
  proposals(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodQuery(QueryProposalsSchema) q: QueryProposalsDto) {
    return this.integrations.proposals(ctx.tenantId, this.actor(ctx, r), q).then((data) => ({ data }));
  }

  /** W2645 — propose connect / rotate / disconnect (keyed). A credential is verified in shadow now; a failure stores nothing. */
  @Post('proposals')
  propose(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(ProposeIntegrationSchema) dto: ProposeIntegrationDto) {
    return this.integrations.propose(ctx.tenantId, this.actor(ctx, r), needKey(key), dto).then((data) => ({ data }));
  }

  @Get('proposals/:id')
  proposal(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) {
    return this.integrations.proposal(ctx.tenantId, this.actor(ctx, r), idOf(id)).then((data) => ({ data }));
  }

  /** W2647/W2648 — confirm (a different tenant_admin; keyed): verify again → vault → write, or verify_failed with nothing stored. */
  @Post('proposals/:id/confirm')
  confirm(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string) {
    return this.integrations.confirm(ctx.tenantId, this.actor(ctx, r), needKey(key), idOf(id)).then((data) => ({ data }));
  }

  @Post('proposals/:id/refuse')
  refuse(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(RefuseSchema) dto: RefuseDto) {
    return this.integrations.refuse(ctx.tenantId, this.actor(ctx, r), needKey(key), idOf(id), dto.reason).then((data) => ({ data }));
  }
}
