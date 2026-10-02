// modules/esg/controllers/v1/esg.controller.ts · PC-56 TENANT-9d · ESG over HTTP.
//   • behind the `esg` flag (Law 10 — OFF answers 404, the console's "Flagged off" state);
//   • every route needs `esg.read` (0183 — the canon's "tenant compliance role" names no row; F-18); the disclosure verbs and
//     the report enqueue are judged by the SERVICE on `esg.disclose`, so a refusal is a sentence (`ESG_REFUSED`, every code
//     by name) and the review page can say "read-only for your role" instead of a bare 403;
//   • every write takes the Idempotency-Key its review / confirm page minted (Law 3);
//   • an auditor session holds no `esg.read` (9c's five reads) and is refused every non-GET here by the global guard anyway.
import { Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { UUID_RE } from '../../../../shared/pagination/us-keyset';
import { EsgActor, EsgService } from '../../services/esg.service';
import { DISCLOSURE_ACTS, DisclosureAct, isDisclosureAct } from '../../domain/esg-disclosure.state';
import { EsgExportParamsSchema } from '../../exports/esg-metrics.dataset';

/** Transport bounds only — the REVIEW judges lengths, languages and numbers. */
const DisclosureSchema = z.object({
  metricCode: z.string().max(40).optional(),
  texts: z.record(z.string().regex(/^[a-z]{2,3}$/), z.string().max(4000)).default({}),
}).strict();
const PreviewSchema = DisclosureSchema.extend({ id: z.string().regex(UUID_RE).optional() }).strict();
const ActSchema = z.object({ reasonCode: z.string().max(40).optional(), note: z.string().max(1000).optional() }).strict();

const needKey = (k?: string) => { if (!k) throw new BadRequestError('Idempotency-Key header required'); return k; };
const idOf = (id: string) => { if (!UUID_RE.test(id)) throw new BadRequestError('id must be a uuid'); return id; };
const codeOf = (c: string) => { if (!/^[a-z_]{2,40}$/.test(c)) throw new BadRequestError('not a metric code'); return c; };
const actOf = (a: string): DisclosureAct => { if (!isDisclosureAct(a)) throw new BadRequestError(`'${a}' is not a disclosure act (${DISCLOSURE_ACTS.join(', ')})`); return a; };

@Controller({ path: 'esg', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('esg')
@RequirePermissions('esg.read')
export class EsgController {
  constructor(private readonly svc: EsgService) {}
  private actor(ctx: RequestContext, req: Request): EsgActor { return { userId: ctx.userId, permissions: ctx.permissions, ip: req.ip || null, requestId: ctx.requestId || null }; }

  /** W423 — every metric with its verdict; a figure only where a published method meets a recorded fact. */
  @Get('dashboard')
  dashboard(@CurrentContext() ctx: RequestContext, @Req() req: Request) { return this.svc.dashboard(ctx.tenantId, this.actor(ctx, req)).then((data) => ({ data })); }

  /** A method page (the canon's dangling `#method-…` / `#source-…` anchors, made real). */
  @Get('methods/:code')
  method(@CurrentContext() ctx: RequestContext, @Param('code') code: string) { return this.svc.method(ctx.tenantId, codeOf(code)).then((data) => ({ data })); }

  /** W424 — the guard over every metric: what the file carries, what it leaves out and why; what is refused by name. */
  @Get('report')
  report(@CurrentContext() ctx: RequestContext, @Req() req: Request) { return this.svc.report(ctx.tenantId, this.actor(ctx, req)).then((data) => ({ data })); }

  /** W424 "Generate report" — the UNSIGNED file on the 6e-2 plane (keyed; `esg.disclose`, judged by the service). */
  @Post('report/exports')
  enqueue(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(EsgExportParamsSchema) dto: z.infer<typeof EsgExportParamsSchema>) {
    return this.svc.enqueueReport(ctx.tenantId, this.actor(ctx, req), needKey(key), dto, req.ip || null).then((data) => ({ data }));
  }

  /** The form's vocabulary: metrics, the active languages, the withdraw reasons, the bounds, and whether the caller may disclose. */
  @Get('disclosures/catalogue')
  catalogue(@CurrentContext() ctx: RequestContext, @Req() req: Request) { return this.svc.disclosureCatalogue(ctx.tenantId, this.actor(ctx, req)).then((data) => ({ data })); }

  /** W2599 — the review the API computes (read-only). */
  @Post('disclosures/preview')
  preview(@CurrentContext() ctx: RequestContext, @Req() req: Request, @ZodBody(PreviewSchema) dto: z.infer<typeof PreviewSchema>) {
    const { id, ...input } = dto;
    return this.svc.previewDisclosure(ctx.tenantId, this.actor(ctx, req), input, id).then((data) => ({ data }));
  }

  /** W2600 — create a draft (keyed). */
  @Post('disclosures')
  create(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(DisclosureSchema) dto: z.infer<typeof DisclosureSchema>) {
    return this.svc.createDisclosure(ctx.tenantId, this.actor(ctx, req), needKey(key), dto).then((data) => ({ data }));
  }

  @Get('disclosures/:id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.disclosure(ctx.tenantId, idOf(id)).then((data) => ({ data })); }

  /** Edit a draft's words (keyed). */
  @Patch('disclosures/:id')
  update(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(DisclosureSchema) dto: z.infer<typeof DisclosureSchema>) {
    return this.svc.updateDisclosure(ctx.tenantId, this.actor(ctx, req), idOf(id), needKey(key), dto).then((data) => ({ data }));
  }

  /** W2602 — the verdict at confirm (read-only): publish · withdraw. */
  @Post('disclosures/:id/acts/:act/preview')
  previewAct(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Param('id') id: string, @Param('act') act: string, @ZodBody(ActSchema) dto: z.infer<typeof ActSchema>) {
    return this.svc.previewAct(ctx.tenantId, this.actor(ctx, req), idOf(id), actOf(act), dto).then((data) => ({ data }));
  }

  /** W2603 — the act (keyed; audited with actor · time · reason · before/after). */
  @Post('disclosures/:id/acts/:act')
  act(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @Param('act') act: string, @ZodBody(ActSchema) dto: z.infer<typeof ActSchema>) {
    return this.svc.act(ctx.tenantId, this.actor(ctx, req), idOf(id), actOf(act), dto, needKey(key)).then((data) => ({ data }));
  }
}
