// modules/tenant-api-keys/controllers/v1/api-keys.controller.ts · W190 API keys (validate → authorize → delegate) — PC-56 TENANT-13c.
//   • behind the `tenant_api` flag (OFF → 404; the console prints "Flagged off");
//   • EVERY route — read and write — needs `api.manage` (tenant_admin), declared here and re-checked in the service (F-12);
//   • the `api_access` plan feature is read for real: the list carries it (the console's Locked state) and issuing is refused
//     `PLAN_FEATURE_REQUIRED` without it;
//   • every write takes the Idempotency-Key its review / confirm page minted (Law 3) and a reason where it is an act;
//   • NO route here carries @ApiScopes: a key never manages keys (the global ApiKeyAuthGuard refuses key auth on this controller);
//   • the static `proposals` routes are declared before `:id` so they are never read as a key id.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { UUID_RE } from '../../../../shared/pagination/us-keyset';
import { ApiKeyService, ApiKeysActor } from '../../services/api-key.service';
import {
  KeyDraftDto, KeyDraftSchema, PreviewKeyDto, PreviewKeySchema, QueryKeyProposalsDto, QueryKeyProposalsSchema, QueryKeysDto, QueryKeysSchema,
  ReasonRequiredDto, ReasonRequiredSchema,
} from '../../dto/api-key.dto';

const needKey = (k?: string) => { if (!k || !/^[A-Za-z0-9_-]{8,120}$/.test(k)) throw new BadRequestError('Idempotency-Key header required'); return k; };
const idOf = (id: string) => { if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid'); return id; };
const ipOf = (r: Request) => (r.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || r.ip || null;

@Controller({ path: 'api-keys', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('tenant_api')
@RequirePermissions('api.manage')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeyService) {}
  private actor(ctx: RequestContext, r: Request): ApiKeysActor { return { userId: ctx.userId, permissions: ctx.permissions, ip: ipOf(r), requestId: ctx.requestId || null }; }

  /** W190 — the keys (never a hash, never a secret), the count, plan access, the catalogue, waiting proposals, the contract. */
  @Get()
  list(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodQuery(QueryKeysSchema) q: QueryKeysDto) {
    return this.keys.list(ctx.tenantId, this.actor(ctx, r), q).then((data) => ({ data }));
  }

  /** The scope catalogue: code, read / write, needs checker, the exact routes it unlocks. */
  @Get('scopes')
  scopes(@CurrentContext() ctx: RequestContext, @Req() r: Request) {
    return { data: this.keys.scopes(this.actor(ctx, r)) };
  }

  /** W2489 — the review. Writes nothing. */
  @Post('preview')
  preview(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodBody(PreviewKeySchema) dto: PreviewKeyDto) {
    return this.keys.preview(ctx.tenantId, this.actor(ctx, r), dto).then((data) => ({ data }));
  }

  /** W2490 — issue (keyed). The full key is in THIS response body, once. */
  @Post()
  create(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(KeyDraftSchema) dto: KeyDraftDto) {
    return this.keys.create(ctx.tenantId, this.actor(ctx, r), needKey(key), dto).then((data) => ({ data }));
  }

  @Get('proposals')
  proposals(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodQuery(QueryKeyProposalsSchema) q: QueryKeyProposalsDto) {
    return this.keys.proposals(ctx.tenantId, this.actor(ctx, r), q).then((data) => ({ data }));
  }

  @Get('proposals/:id')
  proposal(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) {
    return this.keys.proposal(ctx.tenantId, this.actor(ctx, r), idOf(id)).then((data) => ({ data }));
  }

  @Post('proposals/:id/confirm')
  confirm(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string) {
    return this.keys.confirm(ctx.tenantId, this.actor(ctx, r), needKey(key), idOf(id)).then((data) => ({ data }));
  }

  @Post('proposals/:id/refuse')
  refuse(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(ReasonRequiredSchema) dto: ReasonRequiredDto) {
    return this.keys.refuse(ctx.tenantId, this.actor(ctx, r), needKey(key), idOf(id), dto.reason).then((data) => ({ data }));
  }

  /** W2493 — revoke (keyed, reason required, permanent). */
  @Post(':id/revoke')
  revoke(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(ReasonRequiredSchema) dto: ReasonRequiredDto) {
    return this.keys.revoke(ctx.tenantId, this.actor(ctx, r), needKey(key), idOf(id), dto.reason).then((data) => ({ data }));
  }
}
