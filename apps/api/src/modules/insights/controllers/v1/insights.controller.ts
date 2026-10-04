// modules/insights/controllers/v1/insights.controller.ts · PC-56 TENANT-SW-f — the tenant insights (W193–W196).
//
//   GET  /v1/insights/mandi-pulse              W193 — your crops (member-crop filter × modal / Δ per mandi × listed stock), alerts, refusals
//   POST /v1/insights/mandi-pulse/export       W2678 → dataset mandi_pulse_member_crops on the 6e-2 plane
//   GET  /v1/insights/demand-map               W194 — open requirements: wanted · stock fit · value | refused · reach | refused; consented rows
//   POST /v1/insights/demand-map/export        W2569 → dataset demand_map
//   GET  /v1/insights/wastage                  W195 — measured loss (90d) from recorded facts, split, share of GMV | refused, refusals
//   GET  /v1/insights/wastage/events           the facts behind it (µs cursor)
//   POST /v1/insights/wastage/export           W2824 → dataset wastage_events
//   POST /v1/insights/wastage/rerun            W2826–W2828 — re-run the backfill from facts (idempotent, reason, audited)
//   POST /v1/insights/wastage/events           a typed loss — REFUSED BY NAME (MANUAL_WASTAGE_REFUSED)
//
//   /v1/insights/reports/…                     W196 + W2738–W2740 — the bounded builder (ReportsController below)
//
// Reads need `report.view` (W193/W195: "Needs analytics scope"); each screen also sits behind its module's flag (market_intel ·
// requirements · insights_wastage · insights_reports) — the guard answers a switched-off one with the 404 the page turns into words.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { AuditorReadAct } from '../../../../core/auth/auditor-read-only.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { ExportPlaneService } from '../../../../core/exports-plane/export-plane.service';
import { InsightsService } from '../../services/insights.service';
import { ReportActor, ReportService } from '../../services/report.service';
import { InsightsRefusedError } from '../../domain/insights';
import { DEMAND_DATASET, MANDI_DATASET, WASTAGE_DATASET } from '../../exports/insights.datasets';
import {
  DefinitionBody, DefinitionBodySchema, DemandExportBodySchema, DemandQuery, DemandQuerySchema, EmptyBodySchema, ManualWastageSchema, PageQuery, PageQuerySchema,
  ReasonSchema, RunBody, RunBodySchema, ScheduleBody, ScheduleBodySchema, dtoRangeRefusal,
} from '../../dto/insights.dto';

const ipOf = (r: Request) => r.ip || null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (raw: string) => { if (!UUID.test(raw)) throw new BadRequestError('id must be a uuid'); return raw; };
const needKey = (key: string | undefined) => { if (!key) throw new BadRequestError('Idempotency-Key header required'); return key; };
const exportActor = (ctx: RequestContext) => ({ userId: ctx.userId, permissions: ctx.permissions });
const reportActor = (ctx: RequestContext, r?: Request): ReportActor => ({ userId: ctx.userId, permissions: ctx.permissions, roles: ctx.roles ?? [], ip: r ? ipOf(r) : null });

@Controller({ path: 'insights', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
export class InsightsController {
  constructor(private readonly svc: InsightsService, private readonly plane: ExportPlaneService) {}

  /* ── W193 ── */
  @Get('mandi-pulse') @FeatureFlag('market_intel') @RequirePermissions('report.view')
  mandiPulse(@CurrentContext() ctx: RequestContext, @ZodQuery(PageQuerySchema) q: PageQuery) { return this.svc.memberPulse(ctx.tenantId, q).then((data) => ({ data })); }
  @Post('mandi-pulse/export') @FeatureFlag('market_intel') @RequirePermissions('report.view')
  mandiExport(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(EmptyBodySchema) _b: Record<string, never>) {
    return this.plane.enqueue(ctx.tenantId, exportActor(ctx), needKey(key), { datasetCode: MANDI_DATASET, params: {} }, ipOf(r)).then((data) => ({ data }));
  }

  /* ── W194 ── */
  @Get('demand-map') @FeatureFlag('requirements') @RequirePermissions('report.view')
  demandMap(@CurrentContext() ctx: RequestContext, @ZodQuery(DemandQuerySchema) q: DemandQuery) { return this.svc.demandMap(ctx.tenantId, q).then((data) => ({ data })); }
  @Post('demand-map/export') @FeatureFlag('requirements') @RequirePermissions('report.view')
  demandExport(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(DemandExportBodySchema) b: { reach: 'all' | 'districts' }) {
    return this.plane.enqueue(ctx.tenantId, exportActor(ctx), needKey(key), { datasetCode: DEMAND_DATASET, params: b }, ipOf(r)).then((data) => ({ data }));
  }

  /* ── W195 ── */
  @Get('wastage') @FeatureFlag('insights_wastage') @RequirePermissions('report.view')
  wastage(@CurrentContext() ctx: RequestContext) { return this.svc.wastage(ctx.tenantId).then((data) => ({ data })); }
  @Get('wastage/events') @FeatureFlag('insights_wastage') @RequirePermissions('report.view')
  wastageEvents(@CurrentContext() ctx: RequestContext, @ZodQuery(PageQuerySchema) q: PageQuery) { return this.svc.wastageEvents(ctx.tenantId, q).then((data) => ({ data: data.items, meta: { nextCursor: data.nextCursor } })); }
  @Post('wastage/export') @FeatureFlag('insights_wastage') @RequirePermissions('report.view')
  wastageExport(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(EmptyBodySchema) _b: Record<string, never>) {
    return this.plane.enqueue(ctx.tenantId, exportActor(ctx), needKey(key), { datasetCode: WASTAGE_DATASET, params: {} }, ipOf(r)).then((data) => ({ data }));
  }
  @Post('wastage/rerun') @FeatureFlag('insights_wastage') @RequirePermissions('insights.manage')
  rerun(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(ReasonSchema) b: { reason: string }) {
    return this.svc.rerunWastage(ctx.tenantId, { userId: ctx.userId, ip: ipOf(r) }, needKey(key), b.reason).then((data) => ({ data }));
  }
  /** W2826 "record a manual wastage event" — REFUSED BY NAME: facts only (founder). The route exists so the refusal is a sentence, not a 404. */
  @Post('wastage/events') @FeatureFlag('insights_wastage') @RequirePermissions('report.view')
  manual(@ZodBody(ManualWastageSchema) _b: unknown) { return this.svc.manualWastage(); }
}

@Controller({ path: 'insights/reports', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('insights_reports')
export class ReportsController {
  constructor(private readonly svc: ReportService) {}

  @Get('catalogue') @RequirePermissions('report.run')
  catalogue(@CurrentContext() ctx: RequestContext) { return { data: this.svc.catalogue(reportActor(ctx)) }; }

  @Get('definitions') @RequirePermissions('report.run')
  definitions(@CurrentContext() ctx: RequestContext, @ZodQuery(PageQuerySchema) q: PageQuery) { return this.svc.definitions(ctx.tenantId, q).then((d) => ({ data: d.items, meta: { nextCursor: d.nextCursor } })); }
  @Get('definitions/:id') @RequirePermissions('report.run')
  definition(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.definition(ctx.tenantId, idOf(id)).then((data) => ({ data })); }
  @Post('definitions') @RequirePermissions('report.run')
  save(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(DefinitionBodySchema) b: DefinitionBody) {
    return this.svc.saveDefinition(ctx.tenantId, reportActor(ctx, r), needKey(key), b).then((data) => ({ data }));
  }
  @Post('definitions/:id/archive') @RequirePermissions('report.run')
  archive(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(ReasonSchema) b: { reason: string }) {
    return this.svc.archiveDefinition(ctx.tenantId, reportActor(ctx, r), needKey(key), idOf(id), b.reason).then((data) => ({ data }));
  }

  /** THE RUN — for the auditor, the 9c realm's named export exception (it writes a queue row, an audit row and a file; no business data). */
  @AuditorReadAct('export.enqueue')
  @Post('runs') @RequirePermissions('report.run')
  requestRun(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(RunBodySchema) b: RunBody) {
    const refusal = dtoRangeRefusal(b);
    if (refusal) throw new InsightsRefusedError(refusal, 'A report covers at most 92 days — narrow From/To', 422, { maxRangeDays: 92 });
    return this.svc.requestRun(ctx.tenantId, reportActor(ctx, r), needKey(key), b).then((data) => ({ data }));
  }
  @Get('runs') @RequirePermissions('report.run')
  runs(@CurrentContext() ctx: RequestContext, @ZodQuery(PageQuerySchema) q: PageQuery) { return this.svc.runs(ctx.tenantId, q).then((d) => ({ data: d.items, meta: { nextCursor: d.nextCursor } })); }
  @Get('runs/:id') @RequirePermissions('report.run')
  run(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.run(ctx.tenantId, idOf(id)).then((data) => ({ data })); }

  @Get('schedules') @RequirePermissions('report.run')
  schedules(@CurrentContext() ctx: RequestContext, @ZodQuery(PageQuerySchema) q: PageQuery) { return this.svc.schedules(ctx.tenantId, q).then((d) => ({ data: d.items, meta: { nextCursor: d.nextCursor } })); }
  @Post('schedules') @RequirePermissions('report.run')
  schedule(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @ZodBody(ScheduleBodySchema) b: ScheduleBody) {
    return this.svc.createSchedule(ctx.tenantId, reportActor(ctx, r), needKey(key), { ...b, weekdayIso: b.weekdayIso ?? null, monthDay: b.monthDay ?? null }).then((data) => ({ data }));
  }
  @Post('schedules/:id/deactivate') @RequirePermissions('report.run')
  deactivate(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string, @Param('id') id: string, @ZodBody(ReasonSchema) b: { reason: string }) {
    return this.svc.deactivateSchedule(ctx.tenantId, reportActor(ctx, r), needKey(key), idOf(id), b.reason).then((data) => ({ data }));
  }
}
