// modules/memberships/controllers/v1/agm-packs.controller.ts · PC-56 TENANT-SW-d · W199 + W2473–W2477 — the AGM pack.
// Behind `memberships` AND `agm_packs` (flags compose — 6d-2). The service decides `governance.agm.issue` (reads also
// `governance.manage`) so a refusal is a sentence. Every write takes the Idempotency-Key its confirm page minted (Law 3).
// The public verify read is VerifyAgmController below — no auth, no tenant, no figures.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { Public } from '../../../../core/auth/public.decorator';
import { RateLimit } from '../../../../core/http/rate-limit.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { decodeKeyset, UUID_RE } from '../../../../shared/pagination/us-keyset';
import { AgmPackService, AgmActor } from '../../services/agm-pack.service';
import { AGM_SECOND_LANGUAGES } from '../../domain/agm-pack';

const needKey = (k?: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };
const idOf = (id: string) => { if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid'); return id; };
const DraftSchema = z.object({ fyStartYear: z.number().int().min(2000).max(2100), secondLanguage: z.enum(AGM_SECOND_LANGUAGES), auditorMediaId: z.string().uuid().nullable().optional() }).strict();
const ReasonSchema = z.object({ reason: z.string().max(500) }).strict();
const AddendumSchema = z.object({ reason: z.string().max(500), auditorMediaId: z.string().uuid().nullable().optional() }).strict();
const AnnexureSchema = z.object({ mediaId: z.string().uuid().nullable() }).strict();
const ListSchema = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(50).optional() }).strict();

@Controller({ path: 'governance/agm-packs', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('memberships', 'agm_packs')
export class AgmPacksController {
  constructor(private readonly svc: AgmPackService) {}
  private actor(ctx: RequestContext, req: Request): AgmActor { return { userId: ctx.userId, permissions: ctx.permissions, ip: req.ip || null }; }

  @Get()
  overview(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodQuery(ListSchema) q: z.infer<typeof ListSchema>) {
    return this.svc.overview(ctx.tenantId, this.actor(ctx, r), decodeKeyset(q.cursor, UUID_RE), q.limit ?? 20).then((data) => ({ data }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.svc.get(ctx.tenantId, this.actor(ctx, r), idOf(id)).then((data) => ({ data })); }

  @Post()
  draft(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(DraftSchema) dto: z.infer<typeof DraftSchema>) {
    return this.svc.draft(ctx.tenantId, this.actor(ctx, r), needKey(key), dto).then((data) => ({ data }));
  }
  @Post(':id/reassemble')
  reassemble(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.svc.reassemble(ctx.tenantId, this.actor(ctx, r), idOf(id)).then((data) => ({ data })); }
  @Post(':id/annexure')
  annexure(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(AnnexureSchema) dto: z.infer<typeof AnnexureSchema>) {
    return this.svc.attachAnnexure(ctx.tenantId, this.actor(ctx, r), idOf(id), dto.mediaId).then((data) => ({ data }));
  }
  @Post(':id/issue')
  issue(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    return this.svc.requestIssue(ctx.tenantId, this.actor(ctx, r), idOf(id), needKey(key)).then((data) => ({ data }));
  }
  @Post(':id/confirm')
  confirm(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    return this.svc.confirm(ctx.tenantId, this.actor(ctx, r), idOf(id), needKey(key)).then((data) => ({ data }));
  }
  @Post(':id/send-back')
  sendBack(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(ReasonSchema) dto: { reason: string }) {
    return this.svc.sendBack(ctx.tenantId, this.actor(ctx, r), idOf(id), needKey(key), dto.reason).then((data) => ({ data }));
  }
  @Post(':id/withdraw')
  withdraw(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(ReasonSchema) dto: { reason: string }) {
    return this.svc.withdraw(ctx.tenantId, this.actor(ctx, r), idOf(id), needKey(key), dto.reason).then((data) => ({ data }));
  }
  @Post(':id/addendum')
  addendum(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(AddendumSchema) dto: z.infer<typeof AddendumSchema>) {
    return this.svc.addendum(ctx.tenantId, this.actor(ctx, r), needKey(key), idOf(id), dto).then((data) => ({ data }));
  }
}

/** `GET /v1/verify/agm/:documentId` — PUBLIC, rate-limited by IP. Issue time, FY, the two sha256s, the addendum chain. Never a figure. */
@Controller({ path: 'verify/agm', version: '1' })
@UseGuards(AuthGuard)
export class VerifyAgmController {
  constructor(private readonly svc: AgmPackService) {}
  @Public()
  @RateLimit({ limit: 60, windowSec: 60, by: 'ip' })
  @Get(':documentId')
  verify(@Param('documentId') documentId: string) { return this.svc.verify(String(documentId ?? '').toUpperCase()).then((data) => ({ data })); }
}
