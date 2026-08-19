// modules/dairy/controllers/v1/quality-reviews.controller.ts · W168's flag protocol over HTTP (PC-56 TENANT-6b-1).
//
// **NOT behind the quality-desk flag, deliberately.** `dairy_quality_desk` gates the SCREEN (TENANT-6b-2); the flag
// protocol is a money path, and a farmer's withheld pour must not stay withheld because nobody switched a screen on.
// It sits under the same `dairy` flag as the counter itself, which is the flag that says this tenant runs a dairy at
// all — the same ruling TENANT-5d made for recording a failure reason, for the same reason.
//
// The scope compromise is TENANT-6a's, restated because W168 makes it sharper: the canon's restricted state says
// *"Flag decisions need dairy-desk scope + committee membership for repeat cases; rate cards are owner + checker"* —
// THREE distinct authorities — and `db/seeds/core/0004_roles_permissions.sql` defines exactly one dairy permission,
// `dairy.manage`. So every one of these acts currently needs the same scope that can also price milk and approve a
// bill, and "committee membership" is not a thing this platform models at all. Named, not faked: no route here pretends
// a committee reviewed anything, and the review row carries `committee_review_required` so the desk can say a review is
// OWED rather than implying one happened.
import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { MilkQualityService } from '../../services/milk-quality.service';
import { MilkQualityReviewRepository } from '../../repositories/milk-quality-review.repository';
import { RetestReviewSchema, RetestReviewDto, DecideReviewSchema, DecideReviewDto, QueryReviewsSchema, QueryReviewsDto } from '../../dto/quality-review.dto';
import { DairyPermissions, canManageDairy } from '../../policies/dairy.policies';
import { ReviewStatus } from '../../domain/milk-quality.state';

const decodeCursor = (c?: string) => { if (!c) return undefined; const [at, id] = Buffer.from(c, 'base64').toString().split('|'); return at && id ? { at, id } : undefined; };
const encodeCursor = (at: string | null, id: string) => Buffer.from(`${at ?? ''}|${id}`).toString('base64');

@Controller({ path: 'dairy/quality-reviews', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('dairy')
export class QualityReviewsController {
  constructor(
    private readonly quality: MilkQualityService,
    private readonly reviews: MilkQualityReviewRepository,
  ) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageDairy(ctx) }; }

  /** The desk's working queue and history. `status=open_any` is the queue that matters: pours whose money is held now. */
  @Get() @RequirePermissions(DairyPermissions.Manage)
  async list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryReviewsSchema) q: QueryReviewsDto) {
    const rows = await this.reviews.listFor(ctx.tenantId, {
      status: q.status as ReviewStatus | 'open_any' | undefined,
      membershipId: q.membershipId, from: q.from, to: q.to, cursor: decodeCursor(q.cursor), limit: q.limit,
    });
    const items = rows.map((r) => r.toJSON());
    const last = items[items.length - 1];
    return { data: items, meta: { nextCursor: items.length === q.limit && last ? encodeCursor(last.openedAt, last.id) : null } };
  }

  @Get(':id') @RequirePermissions(DairyPermissions.Manage)
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return this.quality.get(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data }));
  }

  /** W168 step 1 — the re-test of the sealed sample, with or without the member there, recorded either way. */
  @Post(':id/retest') @RequirePermissions(DairyPermissions.Manage)
  retest(@CurrentContext() ctx: RequestContext, @Param('id') id: string,
         @Headers('idempotency-key') key: string | undefined, @ZodBody(RetestReviewSchema) @Body() dto: RetestReviewDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.quality.retest(ctx.tenantId, this.actor(ctx), key, id, dto).then((data) => ({ data }));
  }

  /** W168 step 2 — the decision, which moves the pour's money in the same transaction. */
  @Post(':id/decide') @RequirePermissions(DairyPermissions.Manage)
  decide(@CurrentContext() ctx: RequestContext, @Param('id') id: string,
         @Headers('idempotency-key') key: string | undefined, @ZodBody(DecideReviewSchema) @Body() dto: DecideReviewDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.quality.decide(ctx.tenantId, this.actor(ctx), key, id, dto).then((data) => ({ data }));
  }
}
