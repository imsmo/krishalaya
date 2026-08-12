// modules/listings/controllers/listing-qc.controller.ts · W123 staff console + W126/W127 QC (PC-56 TENANT-2a).
//
// THE WAVE'S FINDING, ANSWERED IN DECORATORS: `listing.approve` was seeded and granted to tenant_admin in 0004
// and checked by NOTHING — every QC route below is the first code on this platform to read it. Viewing the
// staff console needs `listing.view_any` (0128's grant — W123's "marketplace staff scope"); DECIDING needs
// `listing.approve` in addition, exactly as W123's restricted state words it. No self-review is the domain's
// law (QC_OWN_LISTING / QC_OWN_DRAFT) with 0138's CHECK as the backstop.
//
// "Take next" is a READ of the oldest waiting row — no claim column, by 0138's recorded decision: a collision
// costs a duplicate look; the decide UPDATE is guarded by the status precondition, so it can never double-write.
import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../core/auth/permissions.guard';
import { FeatureFlagGuard } from '../../../core/feature-flags/flags.guard';
import { CurrentContext } from '../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../core/tenancy-context/request-context';
import { ZodBody, ZodQuery } from '../../../core/http/zod.pipe';
import { NotFoundError } from '../../../shared/errors/app-error';
import { ListingService } from '../services/listing.service';
import { ListingConsoleReadModel } from '../read-models/listing-console.read-model';
import { MandiBandReadModel } from '../read-models/mandi-band.read-model';
import { ListingPermissions, canModerate } from '../listings.policies';
import { ConsoleListSchema, ConsoleListDto, QcRejectSchema, QcRejectDto, parseConsoleCursor, buildConsoleCursor } from '../dto/listing-qc.dto';

@Controller({ path: 'listings', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
export class ListingQcController {
  constructor(
    private readonly service: ListingService,
    private readonly console: ListingConsoleReadModel,
    private readonly band: MandiBandReadModel,
  ) {}

  /** W123 — every seller's listings, one status tab at a time, keyset. (Path is two segments so the public
   *  GET :id route cannot swallow it.) */
  @Get('console/list')
  @RequirePermissions(ListingPermissions.ViewAny)
  async consoleList(@CurrentContext() ctx: RequestContext, @ZodQuery(ConsoleListSchema) q: ConsoleListDto) {
    const rows = await this.console.list(ctx.tenantId, { status: q.status, cursor: parseConsoleCursor(q.cursor), limit: q.limit });
    const nextCursor = rows.length === q.limit ? buildConsoleCursor(rows[rows.length - 1]) : null;
    return { data: { items: rows, nextCursor } };
  }

  /** W123's tabs — every status in the machine, zero included. */
  @Get('console/counts')
  @RequirePermissions(ListingPermissions.ViewAny)
  async consoleCounts(@CurrentContext() ctx: RequestContext) {
    return { data: await this.console.counts(ctx.tenantId) };
  }

  /** W126 — the queue, its KPIs and the closed rejection vocabulary in one read. "Today" is the UTC calendar
   *  day, and the payload SAYS so — a tenant-local day arrives with a tenant timezone setting, not a guess. */
  @Get('qc/queue')
  @RequirePermissions(ListingPermissions.Approve)
  async qcQueue(@CurrentContext() ctx: RequestContext) {
    const todayStartUtc = new Date(new Date().toISOString().slice(0, 10));
    const [queue, kpis, reasons] = await Promise.all([
      this.console.qcQueue(ctx.tenantId, 50),
      this.console.qcKpis(ctx.tenantId, todayStartUtc),
      this.console.rejectReasons(ctx.tenantId),
    ]);
    return { data: { queue, kpis: { ...kpis, todayBasis: 'UTC calendar day' }, reasons } };
  }

  /** W127 — one submission with everything a reviewer can HONESTLY see: the real facts, the seller's real record
   *  with this tenant, and the peer-listing price band (P10–P90 over this tenant's own published listings —
   *  labelled as what it is, null when no comparable listings exist; unknown ≠ zero). */
  @Get('qc/review/:id')
  @RequirePermissions(ListingPermissions.Approve)
  async qcReview(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    const detail = await this.console.qcReviewDetail(ctx.tenantId, id);
    if (!detail) throw new NotFoundError('listing not found');
    const [history, reasons, band] = await Promise.all([
      this.console.sellerHistory(ctx.tenantId, detail.sellerUserId),
      this.console.rejectReasons(ctx.tenantId),
      detail.regionId ? this.band.band(ctx.tenantId, detail.productId, detail.regionId) : Promise.resolve(null),
    ]);
    return { data: { detail, sellerHistory: history, reasons, band, selfReview: detail.sellerUserId === ctx.userId || detail.createdBy === ctx.userId } };
  }

  /** The seller (or a moderator) sends a draft to review — the waiting clock starts here. */
  @Post(':id/submit-qc')
  @RequirePermissions(ListingPermissions.Update)
  async submitQc(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    await this.service.submitForQc(ctx.tenantId, { userId: ctx.userId, canModerate: canModerate(ctx) }, id);
    return { data: { ok: true } };
  }

  @Post(':id/qc/approve')
  @RequirePermissions(ListingPermissions.Approve)
  async approve(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    await this.service.qcApprove(ctx.tenantId, { userId: ctx.userId }, id);
    return { data: { ok: true } };
  }

  @Post(':id/qc/reject')
  @RequirePermissions(ListingPermissions.Approve)
  async reject(@CurrentContext() ctx: RequestContext, @Param('id') id: string, @ZodBody(QcRejectSchema) dto: QcRejectDto) {
    await this.service.qcReject(ctx.tenantId, { userId: ctx.userId }, id, dto.reasonCode);
    return { data: { ok: true } };
  }

  /** W123/W124's Pause — the seller's own hand on their own sale (state machine: published → paused). */
  @Post(':id/pause')
  @RequirePermissions(ListingPermissions.Update)
  async pause(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    await this.service.pause(ctx.tenantId, { userId: ctx.userId, canModerate: canModerate(ctx) }, id);
    return { data: { ok: true } };
  }
}
