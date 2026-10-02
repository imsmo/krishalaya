// modules/ambassadors/controllers/v1/field-ops.controller.ts · ambassador field-ops: assisted onboarding,
// visit log, targets, leaderboard. Assisted-onboarding + visit-log require the caller to be an ACTIVE
// ambassador (enforced in the service from the token, not a client id). Setting a target needs
// ambassador.manage. The leaderboard is a tenant-scoped aggregate read. `ambassadors` flag.
// PC-56 TENANT-10a · F-14: the leaderboard needs ambassador.manage OR an ACTIVE ambassador profile in this tenant; a
// non-manager sees amounts for their own row only (others: rank + short name, earnedMinor null).
import { Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { AssistedOnboardingService } from '../../services/assisted-onboarding.service';
import { AmbassadorVisitService } from '../../services/ambassador-visit.service';
import { AmbassadorTargetService } from '../../services/ambassador-target.service';
import { OnBehalfListingService } from '../../services/on-behalf-listing.service';
import { LeaderboardReadModel } from '../../read-models/leaderboard.read-model';
import { AmbassadorsPermissions, canManageAmbassadors } from '../../policies/ambassadors.policies';
import { AmbassadorProfileRepository } from '../../repositories/ambassador-profile.repository';
import { LeaderboardForbiddenError } from '../../domain/ambassadors.errors';
import { decodeCursor } from '../../domain/cursor';
import { AssistedOnboardingSchema, AssistedOnboardingDto } from '../../dto/assisted-onboarding.dto';
import { CreateVisitSchema, CreateVisitDto, QueryVisitsSchema, QueryVisitsDto } from '../../dto/create-visit.dto';
import { SetTargetSchema, SetTargetDto, QueryLeaderboardSchema, QueryLeaderboardDto } from '../../dto/create-target.dto';
import { OnBehalfListingSchema, OnBehalfListingDto } from '../../dto/on-behalf-listing.dto';
import { SuggestFromDocsSchema, SuggestFromDocsDto } from '../../dto/suggest-from-docs.dto';

// The visit list keeps its own (visited_at, id) keyset; its cursor is decoded by the same strict decoder as every list here.

@Controller({ path: 'ambassadors', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('ambassadors')
export class FieldOpsController {
  constructor(
    private readonly assisted: AssistedOnboardingService,
    private readonly visits: AmbassadorVisitService,
    private readonly targets: AmbassadorTargetService,
    private readonly onBehalf: OnBehalfListingService,
    private readonly leaderboard: LeaderboardReadModel,
    private readonly profiles: AmbassadorProfileRepository,
  ) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canManage: canManageAmbassadors(ctx) }; }

  /** Active ambassador creates a listing ON BEHALF of an onboarded farmer — consent-gated + audited (P1-16). */
  @Post('on-behalf/listings')
  onBehalfListing(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(OnBehalfListingSchema) dto: OnBehalfListingDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.onBehalf.createListing(ctx.tenantId, this.actor(ctx), key, dto, null).then((data) => ({ data }));
  }

  /** P1-16-AI · AI-suggest listing fields from a farmer's document (OCR'd upstream). ADVISORY — the ambassador
   *  reviews + edits, then confirms via `on-behalf/listings`. Same consent gate; behind `assisted_doc_prefill`. */
  @Post('on-behalf/listings/suggest')
  @FeatureFlag('assisted_doc_prefill')
  suggestFromDocs(@CurrentContext() ctx: RequestContext, @ZodBody(SuggestFromDocsSchema) dto: SuggestFromDocsDto) {
    return this.onBehalf.suggestFromDocs(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data }));
  }

  /** Active ambassador onboards a farmer on-behalf (consent-gated, audited). Idempotent (Law 3). */
  @Post('assisted-onboarding')
  assist(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(AssistedOnboardingSchema) dto: AssistedOnboardingDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.assisted.onboard(ctx.tenantId, this.actor(ctx), key, dto, null).then((data) => ({ data }));
  }

  @Post('visits')
  logVisit(@CurrentContext() ctx: RequestContext, @ZodBody(CreateVisitSchema) dto: CreateVisitDto) {
    return this.visits.log(ctx.tenantId, ctx.userId, dto).then((data) => ({ data }));
  }
  @Get('visits')
  listVisits(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryVisitsSchema) q: QueryVisitsDto) {
    return this.visits.listMine(ctx.tenantId, ctx.userId, { cursor: decodeCursor(q.cursor), limit: q.limit }).then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  @Get('leaderboard')
  async leaderboardTop(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryLeaderboardSchema) q: QueryLeaderboardDto) {
    const canManage = canManageAmbassadors(ctx);
    if (!canManage) {
      const me = await this.profiles.findByUser(ctx.tenantId, ctx.userId);
      if (!me || !me.isActive) throw new LeaderboardForbiddenError();
    }
    return this.leaderboard.top(ctx.tenantId, { periodStart: q.periodStart, periodEnd: q.periodEnd, limit: q.limit }, { userId: ctx.userId, canManage }).then((data) => ({ data }));
  }

  @Post('targets') @RequirePermissions(AmbassadorsPermissions.Manage)
  setTarget(@CurrentContext() ctx: RequestContext, @ZodBody(SetTargetSchema) dto: SetTargetDto) {
    return this.targets.set(ctx.tenantId, this.actor(ctx), dto).then((data) => ({ data }));
  }
  /** The caller-ambassador's own targets. */
  @Get('targets/me')
  myTargets(@CurrentContext() ctx: RequestContext, @Query('limit') limit?: string) {
    return this.targets.listMine(ctx.tenantId, ctx.userId, Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 100)).then((data) => ({ data: data.items }));
  }
}
