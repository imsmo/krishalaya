// modules/memberships/controllers/v1/register-imports.controller.ts · PC-56 TENANT-SW-d · W2626–W2628 — "Import register".
// Behind `memberships` AND `share_register_import`. The service decides `governance.register.import`. The CSV travels in the JSON body
// (≤ 1 MB — main.ts lifts the body limit for THIS path only; the service refuses more than 5,000 rows).
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { decodeKeyset, UUID_RE } from '../../../../shared/pagination/us-keyset';
import { RegisterImportService, ImportActor } from '../../services/register-import.service';
import { CONSENT_KINDS } from '../../domain/register-import';

const needKey = (k?: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };
const idOf = (id: string) => { if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid'); return id; };
const UploadSchema = z.object({ csv: z.string().max(1_100_000), consentMediaId: z.string().uuid(), consentKind: z.enum(CONSENT_KINDS) }).strict();
const ReasonSchema = z.object({ reason: z.string().max(500) }).strict();
const ListSchema = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(50).optional() }).strict();
const LinesSchema = z.object({ after: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(200).optional(),
  status: z.enum(['valid', 'error', 'applied', 'skipped_duplicate']).optional() }).strict();

@Controller({ path: 'governance/register/imports', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('memberships', 'share_register_import')
export class RegisterImportsController {
  constructor(private readonly svc: RegisterImportService) {}
  private actor(ctx: RequestContext, req: Request): ImportActor { return { userId: ctx.userId, permissions: ctx.permissions, ip: req.ip || null }; }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodQuery(ListSchema) q: z.infer<typeof ListSchema>) {
    return this.svc.list(ctx.tenantId, this.actor(ctx, r), decodeKeyset(q.cursor, UUID_RE), q.limit ?? 20).then((x) => ({ data: x.items, meta: { nextCursor: x.nextCursor } }));
  }
  @Post()
  upload(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(UploadSchema) dto: z.infer<typeof UploadSchema>) {
    return this.svc.upload(ctx.tenantId, this.actor(ctx, r), needKey(key), dto).then((data) => ({ data }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string) { return this.svc.get(ctx.tenantId, this.actor(ctx, r), idOf(id)).then((data) => ({ data })); }
  @Get(':id/lines')
  lines(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodQuery(LinesSchema) q: z.infer<typeof LinesSchema>) {
    return this.svc.lines(ctx.tenantId, this.actor(ctx, r), idOf(id), q.after ?? 0, q.limit ?? 100, q.status).then((x) => ({ data: x.items, meta: { nextAfterLine: x.nextAfterLine, currency: x.currency } }));
  }
  @Post(':id/propose')
  propose(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string, @ZodBody(ReasonSchema) dto: { reason: string }) {
    return this.svc.propose(ctx.tenantId, this.actor(ctx, r), idOf(id), needKey(key), dto.reason).then((data) => ({ data }));
  }
  @Post(':id/confirm')
  confirm(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    return this.svc.confirm(ctx.tenantId, this.actor(ctx, r), idOf(id), needKey(key)).then((data) => ({ data }));
  }
  @Post(':id/reject')
  reject(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ReasonSchema) dto: { reason: string }) {
    return this.svc.reject(ctx.tenantId, this.actor(ctx, r), idOf(id), dto.reason).then((data) => ({ data }));
  }
}
