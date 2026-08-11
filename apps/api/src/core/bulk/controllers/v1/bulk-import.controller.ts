// core/bulk/controllers/v1/bulk-import.controller.ts · the bulk-import HTTP surface. validate (zod) → authorize
// (bulk.import) → delegate. Create needs an Idempotency-Key. The CSV is uploaded out-of-band via the media
// presign flow; the create call just references its object-store key. Gated by the `bulk_import` flag.
import { Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../http/zod.pipe';
import { CurrentContext } from '../../../tenancy-context/current-context.decorator';
import { RequestContext } from '../../../tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { BulkJobService } from '../../bulk-job.service';
import { BulkImportProcessor } from '../../csv-import.processor';
import { BulkPermissions, canBulkImport } from '../../policies/bulk.policies';
import { CreateBulkImportSchema, CreateBulkImportDto, QueryBulkImportSchema, QueryBulkImportDto, QueryErrorsSchema, QueryErrorsDto } from '../../dto/bulk-import.dto';

const ipOf = (r: Request) => r.ip || null;
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'bulk-imports', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('bulk_import')
export class BulkImportController {
  constructor(private readonly svc: BulkJobService, private readonly processor: BulkImportProcessor) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canImport: canBulkImport(ctx) }; }

  @Post() @RequirePermissions(BulkPermissions.Import)
  create(@CurrentContext() ctx: RequestContext, @Req() req: Request, @Headers('idempotency-key') key: string, @ZodBody(CreateBulkImportSchema) dto: CreateBulkImportDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.svc.create(ctx.tenantId, this.actor(ctx), key, dto, ipOf(req)).then((data) => ({ data }));
  }
  @Get() @RequirePermissions(BulkPermissions.Import)
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryBulkImportSchema) q: QueryBulkImportDto) {
    return this.svc.list(ctx.tenantId, this.actor(ctx), { status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }
  @Get(':id') @RequirePermissions(BulkPermissions.Import)
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.svc.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  @Get(':id/errors') @RequirePermissions(BulkPermissions.Import)
  errors(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodQuery(QueryErrorsSchema) q: QueryErrorsDto) {
    return this.svc.listErrors(ctx.tenantId, this.actor(ctx), id, { afterRow: q.afterRow, limit: q.limit }).then((res) => ({ data: res.items }));
  }
  /**
   * VALIDATE FIRST (PC-56 TENANT-1b-4, W156). Reads the file, judges every row, writes NOTHING but the triage and the file
   * hash, and parks the job at `validated` until somebody confirms.
   *
   * **RUN INLINE RATHER THAN QUEUED, AND THAT IS A SIZE JUDGEMENT.** The operator is standing at the screen waiting for
   * the triage — a queued pass would leave them refreshing. It is bounded by the same parse cap as processing, and the
   * pass writes nothing, so the worst case is a slow request rather than a half-applied file. A file large enough to make
   * this unacceptable is a file the parse cap already refuses (TENANT-1b-4-Q3: move it to the worker with a poll when the
   * first tenant complains).
   */
  @Post(':id/validate') @RequirePermissions(BulkPermissions.Import)
  validate(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.processor.validate(ctx.tenantId, id).then((data) => ({ data }));
  }

  /** CONFIRM the triage — W156's "Import 214 valid rows". Audited with the counts the operator was shown. */
  @Post(':id/confirm') @RequirePermissions(BulkPermissions.Import)
  confirm(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Req() req: Request) {
    return this.svc.confirm(ctx.tenantId, this.actor(ctx), id, ipOf(req)).then((data) => ({ data }));
  }

  @Post(':id/cancel') @RequirePermissions(BulkPermissions.Import)
  cancel(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @Req() req: Request) {
    return this.svc.cancel(ctx.tenantId, this.actor(ctx), id, ipOf(req)).then((data) => ({ data }));
  }
}
