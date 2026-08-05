// modules/schemes/controllers/v1/applications.controller.ts · scheme application lifecycle + DBT records. `schemes` flag.
// apply/submit/resubmit/appeal = applicant (scheme.apply); verify/clarify/approve/reject/close + DBT record
// = officer (scheme.process). Money route (submit, collects the processing fee) requires an Idempotency-Key.
import { Controller, Delete, Get, Headers, Param, Post, Req, UseGuards, Query } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { SchemeApplicationService } from '../../services/scheme-application.service';
import { FieldVerificationService } from '../../services/field-verification.service';
import { GovExportService } from '../../services/gov-export.service';
import { z } from 'zod';

// PC-54 W54-3 `scheme-field-visits` DTOs (zod .strict(); evidence = media ids, never blobs).
const ScheduleVisitSchema = z.object({ scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict();
const ExportSchema = z.object({
  report: z.enum(['dbt_monitor', 'dbt_recent']),
  schemeId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).optional(),
}).strict();
const SubmitVisitSchema = z.object({
  geotag: z.array(z.object({ mediaId: z.string().uuid(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), capturedAt: z.string().datetime() }).strict()).min(1).max(50),
  measuredValues: z.record(z.unknown()).default({}),
  walkTraceMediaId: z.string().uuid().optional(),
}).strict();
import { DbtTransferService } from '../../services/dbt-transfer.service';
import { SchemeDocumentService } from '../../services/scheme-document.service';
import { ApplySchemeSchema, ApplySchemeDto, ClarifySchema, ClarifyDto, ApproveSchema, ApproveDto, RejectSchema, RejectDto } from '../../dto/create-scheme-application.dto';
import { QueryApplicationsSchema, QueryApplicationsDto } from '../../dto/query-scheme-application.dto';
import { RecordDbtSchema, RecordDbtDto } from '../../dto/create-dbt-transfer.dto';
import { AttachDocumentSchema, AttachDocumentDto } from '../../dto/attach-document.dto';
import { SchemesPermissions, canApply, canProcess } from '../../policies/schemes.policies';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'schemes/applications', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('schemes')
export class ApplicationsController {
  constructor(private readonly svc: SchemeApplicationService, private readonly dbt: DbtTransferService, private readonly docs: SchemeDocumentService, private readonly visits: FieldVerificationService, private readonly gov: GovExportService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canApply: canApply(ctx), canProcess: canProcess(ctx) }; }

  @Post() @RequirePermissions(SchemesPermissions.Apply)
  apply(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(ApplySchemeSchema) dto: ApplySchemeDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.apply(ctx.tenantId, this.actor(ctx), key, dto).then((data) => ({ data }));
  }
  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryApplicationsSchema) q: QueryApplicationsDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { box: q.box, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  // --- supporting documents (P1-16): applicant attaches clean media against required doc types; editable pre-decision ---
  @Get(':id/documents')
  listDocs(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.docs.list(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post(':id/documents') @RequirePermissions(SchemesPermissions.Apply)
  attachDoc(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(AttachDocumentSchema) dto: AttachDocumentDto) { return this.docs.attach(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data })); }
  @Delete(':id/documents/:docId') @RequirePermissions(SchemesPermissions.Apply)
  detachDoc(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Param('docId') docId: string) { return this.docs.detach(ctx.tenantId, this.actor(ctx), id, docId).then((data) => ({ data })); }

  @Post(':id/submit') @RequirePermissions(SchemesPermissions.Apply)
  submit(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Headers('idempotency-key') key: string) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.submit(ctx.tenantId, this.actor(ctx), id, key).then((data) => ({ data }));
  }
  @Post(':id/resubmit') @RequirePermissions(SchemesPermissions.Apply)
  resubmit(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.resubmit(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post(':id/appeal') @RequirePermissions(SchemesPermissions.Apply)
  appeal(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.appeal(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  @Post(':id/verify') @RequirePermissions(SchemesPermissions.Process)
  verify(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.startVerification(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
  @Post(':id/clarify') @RequirePermissions(SchemesPermissions.Process)
  clarify(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(ClarifySchema) dto: ClarifyDto) { return this.svc.requestClarification(ctx.tenantId, this.actor(ctx), id, dto).then((data) => ({ data })); }
  @Post(':id/approve') @RequirePermissions(SchemesPermissions.Process)
  approve(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ApproveSchema) dto: ApproveDto) { return this.svc.approve(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data })); }
  @Post(':id/reject') @RequirePermissions(SchemesPermissions.Process)
  reject(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(RejectSchema) dto: RejectDto) { return this.svc.reject(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data })); }
  @Post(':id/close') @RequirePermissions(SchemesPermissions.Process)
  close(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.close(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  // DBT (observed PFMS credit) — officer records; applicant/officer reads
  @Post(':id/dbt') @RequirePermissions(SchemesPermissions.Process)
  recordDbt(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(RecordDbtSchema) dto: RecordDbtDto) { return this.dbt.record(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data })); }
  // --- PC-54 W54-3 field visits (0066) — Process-gated writes; party-or-Process read via the app read itself ---
  @Post(':id/field-visits') @RequirePermissions(SchemesPermissions.Process)
  scheduleVisit(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(ScheduleVisitSchema) dto: { scheduledFor?: string }) {
    return this.visits.schedule(ctx.tenantId, this.actor(ctx), id, dto.scheduledFor).then((data) => ({ data }));
  }
  @Get(':id/field-visits')
  listVisits(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.visits.list(ctx.tenantId, id).then((data) => ({ data }));
  }
  @Post('field-visits/:visitId/submit') @RequirePermissions(SchemesPermissions.Process)
  submitVisit(@CurrentContext() ctx: RequestContext, @Param('visitId') visitId: string, @ZodBody(SubmitVisitSchema) dto: { geotag: Array<{ mediaId: string; lat: number; lng: number; capturedAt: string }>; measuredValues: Record<string, unknown>; walkTraceMediaId?: string }) {
    return this.visits.submit(ctx.tenantId, this.actor(ctx), visitId, dto).then((data) => ({ data }));
  }

  // --- PC-54 W54-10: cross-application DBT read-models + audit-stamped exports (Process-gated) ---
  @Get('dbt/monitor') @RequirePermissions(SchemesPermissions.Process)
  dbtMonitor(@CurrentContext() ctx: RequestContext) { return this.gov.monitor(ctx.tenantId, this.actor(ctx)).then((data) => ({ data })); }
  @Get('dbt/recent') @RequirePermissions(SchemesPermissions.Process)
  dbtRecent(@CurrentContext() ctx: RequestContext, @Query('schemeId') schemeId?: string, @Query('limit') limit?: string) {
    return this.gov.recent(ctx.tenantId, this.actor(ctx), schemeId, Number(limit) || 100).then((data) => ({ data }));
  }
  @Post('exports') @RequirePermissions(SchemesPermissions.Process)
  exportReport(@CurrentContext() ctx: RequestContext, @Req() r: Request, @ZodBody(ExportSchema) dto: { report: string; schemeId?: string; limit?: number }) {
    return this.gov.export(ctx.tenantId, this.actor(ctx), ipOf(r), dto).then((data) => ({ data }));
  }

  @Get(':id/dbt')
  listDbt(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.dbt.listForApplication(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }
}
