// modules/reviews/controllers/v1/reviews.controller.ts · verified-purchase reviews (validate→authorize→
// delegate). Submit needs review.create + Idempotency-Key (verified-purchase enforced in the service);
// edit is author-only; respond is the reviewed party; moderate needs review.moderate. Public target
// lists/summary read only published reviews. Gated by the `reviews` feature flag.
// PC-56 STORE-5a: + `GET reviews/mine?orderId=` (the author's review of one order + its lock), `GET reviews/eligibility?orderId=` (may I review
// this order, until when, did I already), `POST reviews/preview` (W3145's confirm — the server's review, no write); `PATCH :id` takes an
// optional Idempotency-Key and is audited; `respond` is the ORGANISATION's reply (any organisation role); `moderate` is no longer behind
// `review.moderate` at the route — `flag` needs `review.flag` OR `review.moderate`, hide / remove / restore `review.moderate` (the service
// decides, by name). The sub-rating vocabulary is the existing `GET /v1/lookups/values?type=review_dimension` (locale-resolved).
import { Controller, Get, Headers, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { Public } from '../../../../core/auth/public.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { clientIpOf } from '../../../../core/http/client-ip';
import { decodeKeyset, UUID_RE } from '../../../../shared/pagination/us-keyset';
import { ReviewService } from '../../services/review.service';
import { CreateReviewSchema, CreateReviewDto } from '../../dto/create-review.dto';
import { EditReviewSchema, EditReviewDto, SellerResponseSchema, SellerResponseDto, ModerateReviewSchema, ModerateReviewDto } from '../../dto/update-review.dto';
import { QueryReviewsSchema, QueryReviewsDto, ReviewSummaryQuerySchema, ReviewSummaryQueryDto, PublicReviewsQuerySchema, PublicReviewsQueryDto, ReviewOrderQuerySchema, ReviewOrderQueryDto } from '../../dto/query-review.dto';
import { ReviewPermissions, canModerateReview, canFlagReview } from '../../policies/reviews.policies';

// PC-56 HOTFIX-7 (carried rule): request audits record the client's address through the one helper (core/http/client-ip.ts)
const ipOf = (r: Request) => clientIpOf(r);
// PC-56 HOTFIX-7 · B24: the µs keyset — a pre-HOTFIX-7 millisecond cursor reads as page one, never a ms guess
const decodeCursor = (c?: string) => { const k = decodeKeyset(c, UUID_RE); return k ? { c: k.ts, id: k.id } : undefined; };

@Controller({ path: 'reviews', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canModerate: canModerateReview(ctx), canFlag: canFlagReview(ctx) }; }

  @Post() @RequirePermissions(ReviewPermissions.Create)
  submit(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreateReviewSchema) dto: CreateReviewDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.reviews.submit(ctx.tenantId, ctx.userId, key, dto).then((data) => ({ data }));
  }

  // Public aggregate rating (anonymous storefront) — only published reviews are counted. PC-56 HOTFIX-7 · B5: keyed by the ORGANISATION
  // (`targetType=organisation`); `buyer` → 422 REVIEW_PUBLIC_BUYER_REFUSED, `seller` (a person's uuid) → 422 REVIEW_PUBLIC_SELLER_REFUSED.
  @Public() @Get('summary')
  summary(@CurrentContext() ctx: RequestContext, @ZodQuery(ReviewSummaryQuerySchema) q: ReviewSummaryQueryDto) {
    return this.reviews.summary(ctx.tenantId, q.targetType).then((data) => ({ data }));
  }

  // Public individual-reviews list for a target (anonymous storefront). PII-free projection (no reviewer id),
  // published-only, keyset-paginated. Distinct from the authenticated `GET` list (which a party uses for their own).
  @Public() @Get('public')
  publicList(@CurrentContext() ctx: RequestContext, @ZodQuery(PublicReviewsQuerySchema) q: PublicReviewsQueryDto) {
    return this.reviews.publicList(ctx.tenantId, { targetType: q.targetType, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryReviewsSchema) q: QueryReviewsDto) {
    return this.reviews.list(ctx.tenantId, this.actor(ctx), { box: q.box, targetType: q.targetType, targetId: q.targetId, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  // PC-56 STORE-5a · B2: the author's own review of one order (the author's shape + `editLocksAt` + `editable`), or 404
  @Get('mine')
  mine(@CurrentContext() ctx: RequestContext, @ZodQuery(ReviewOrderQuerySchema) q: ReviewOrderQueryDto) {
    return this.reviews.mine(ctx.tenantId, ctx.userId, q.orderId).then((data) => ({ data }));
  }

  // PC-56 STORE-5a · B2: { eligible, expiresAt, windowOpen, reviewed, reviewId? } for the caller — never a counterparty id
  @Get('eligibility')
  eligibility(@CurrentContext() ctx: RequestContext, @ZodQuery(ReviewOrderQuerySchema) q: ReviewOrderQueryDto) {
    return this.reviews.eligibility(ctx.tenantId, ctx.userId, q.orderId).then((data) => ({ data }));
  }

  // PC-56 STORE-5a · B2: W3145's confirm — the server's review as it will publish (the organisation, the dimension labels, "Verified buyer",
  // the lock and the window); the same refusals as a submit; writes nothing
  @Post('preview') @RequirePermissions(ReviewPermissions.Create)
  preview(@CurrentContext() ctx: RequestContext, @ZodBody(CreateReviewSchema) dto: CreateReviewDto) {
    return this.reviews.preview(ctx.tenantId, ctx.userId, ctx.lang, dto).then((data) => ({ data }));
  }

  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.reviews.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  @Patch(':id')
  edit(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @ZodBody(EditReviewSchema) dto: EditReviewDto) {
    return this.reviews.edit(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r), key || undefined).then((data) => ({ data }));
  }

  @Post(':id/respond')
  respond(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(SellerResponseSchema) dto: SellerResponseDto) {
    return this.reviews.respond(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }

  @Post(':id/moderate')
  moderate(@CurrentContext() ctx: RequestContext, @Req() r: Request, @Param('id') id: string, @ZodBody(ModerateReviewSchema) dto: ModerateReviewDto) {
    return this.reviews.moderate(ctx.tenantId, this.actor(ctx), id, dto, ipOf(r)).then((data) => ({ data }));
  }
}
