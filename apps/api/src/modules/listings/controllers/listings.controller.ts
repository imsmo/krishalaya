// modules/listings/controllers/listings.controller.ts
// HTTP edge for the listings aggregate. Responsibilities ONLY: authn/authz guards,
// DTO (zod) validation, tenant/idempotency header extraction, mapping to service
// calls, and envelope shaping. No business logic lives here. Browse/detail are
// @Public (anonymous storefront; tenant resolved from token or X-Tenant-Id).
import { Controller, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../core/auth/permissions.guard';
import { Public } from '../../../core/auth/public.decorator';
import { ZodBody, ZodQuery } from '../../../core/http/zod.pipe';
import { CurrentContext } from '../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../core/tenancy-context/request-context';
import { BadRequestError, UnauthorizedError } from '../../../shared/errors/app-error';
import { FeatureFlag, FeatureFlagGuard } from '../../../core/feature-flags/flags.guard';
import { ListingService } from '../services/listing.service';
import { ListingViewService } from '../services/listing-view.service';
import { ListingInquiryService } from '../services/listing-inquiry.service';
import { ListingSearchReadModel } from '../read-models/listing-search.read-model';
import { ListingAnalyticsReadModel } from '../read-models/listing-analytics.read-model';
import { ListingGalleryReadModel } from '../read-models/listing-gallery.read-model';
import { ListingLinksReadModel } from '../read-models/listing-links.read-model';
import { MandiBandReadModel } from '../read-models/mandi-band.read-model';
import { OnBehalfConsoleService } from '../services/on-behalf-console.service';
import { ListingBoostService } from '../services/listing-boost.service';
import { CreateListingDto, CreateListingSchema } from '../dto/create-listing.dto';
import { AddListingPhotoDto, AddListingPhotoSchema } from '../dto/add-listing-photo.dto';
import { ChangePriceDto, ChangePriceSchema } from '../dto/change-price.dto';
import { RepostListingDto, RepostListingSchema } from '../dto/repost-listing.dto';
import { ExtendListingDto, ExtendListingSchema } from '../dto/extend-listing.dto';
import { ArchiveListingSchema, ArchiveListingDto, OnBehalfCreateSchema, OnBehalfCreateDto, FairPriceSchema, FairPriceDto } from '../dto/listing-detail.dto';
import { QueryListingDto, QueryListingSchema } from '../dto/query-listing.dto';
import { QueryListingInquiriesDto, QueryListingInquiriesSchema } from '../dto/query-listing-inquiries.dto';
import { ListingNotFoundError } from '../domain/listing.errors';
import { ListingPermissions, canModerate } from '../listings.policies';

// Same opaque base64 "c|id" keyset cursor grammar as communication's ConversationsController — the inquiries
// endpoint forwards straight into ConversationService's cursor, so it must decode/encode identically.
const decodeCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };

@Controller({ path: 'listings', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
export class ListingsController {
  constructor(
    private readonly service: ListingService,
    private readonly views: ListingViewService,
    private readonly inquiryService: ListingInquiryService,
    private readonly searchRM: ListingSearchReadModel,
    private readonly analyticsRM: ListingAnalyticsReadModel,
    private readonly galleryRM: ListingGalleryReadModel,
    private readonly linksRM: ListingLinksReadModel,
    private readonly boosts: ListingBoostService,
    private readonly bandRM: MandiBandReadModel,             // TENANT-2b: W125's fair-price guide
    private readonly onBehalf: OnBehalfConsoleService,       // TENANT-2b: W125's consent-gated staff create
  ) {}

  /** Public browse/search — replica-backed read-model; tenant scoped + RLS. The route stays @Public for the
   *  anonymous storefront case; `mine=true` ("my listings") is the one query shape that needs a real caller — the
   *  AuthGuard doesn't run on a @Public route, so ctx.userId is '' when no token was sent (RequestContext's
   *  documented anonymous convention) and we 401 explicitly rather than silently scoping to nothing / leaking
   *  another tenant's rows. */
  @Public() @Get()
  async search(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryListingSchema) q: QueryListingDto) {
    if (q.mine && !ctx.userId) throw new UnauthorizedError('Sign in to view your own listings');
    const res = await this.searchRM.query(ctx.tenantId, q, q.mine ? { ownerUserId: ctx.userId } : {});
    return { data: res.items, meta: { total: res.total, nextCursor: res.nextCursor } };
  }

  // Static routes BEFORE ':id' so they aren't captured as a listing id.
  /** The paid-boost tier catalogue (id + name + server price/days) — so the client shows real prices. */
  @Get('boost-tiers')
  boostTiers(@CurrentContext() ctx: RequestContext) { return this.boosts.tiers(ctx.tenantId).then((data) => ({ data })); }

  /** W125's fair-price guide (TENANT-2b): the peer band (P10–P90 of THIS tenant's published listings for the
   *  same product × area — the same read QC trusts, labelled as what it is) resolved from the form's pincode.
   *  Null band = no comparable listings or unmappable pincode; the form says which, never invents a range.
   *  Declared BEFORE the ':id' route — a single static segment would otherwise be swallowed as an id. */
  @Get('fair-price')
  async fairPrice(@CurrentContext() ctx: RequestContext, @ZodQuery(FairPriceSchema) q: FairPriceDto) {
    return { data: await this.bandRM.bandForPincode(ctx.tenantId, q.productId, q.pincode) };
  }

  @Public() @Get(':id')
  async getOne(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    // visibility-gated: non-owners only see published+public listings (no draft scraping)
    const l = await this.service.getPublicById(ctx.tenantId, id, { userId: ctx.userId, canModerate: canModerate(ctx) });
    // Enrich the detail read with NON-PII public links (trace QR token + auction). Read fresh from the replica
    // (not the cached entity) so auction status reflects the live lifecycle. getPublicById already authorized
    // the viewer for this listing; the links read-model independently re-checks public visibility.
    const links = await this.linksRM.forListing(ctx.tenantId, id);
    return { data: { ...l, ...links } };
  }

  /** Signed photo gallery (short-lived presigned GET urls; clean assets only). Public route (anonymous
   *  storefront callers get the published+public gallery only) — but when the caller IS authenticated as
   *  the owner (or a moderator), the read-model also returns their own draft/unpublished clean photos, so
   *  the farmer's OWN listing-detail screen ("Listing health" photo count) is never wrong just because the
   *  listing hasn't been published yet (KV-MF-14). */
  @Public() @Get(':id/media')
  async media(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    const g = await this.galleryRM.forListing(ctx.tenantId, id, { userId: ctx.userId, canModerate: canModerate(ctx) });
    return { data: g.items, meta: { expiresInSec: g.expiresInSec } };
  }

  /** ADD PHOTO — attach one more already-uploaded, clean IMAGE to the caller's OWN, ALREADY-CREATED listing
   *  (screen 112 "Listing health → Add more photos" cta; KV-MF-14). Distinct from `mediaIds` at create time
   *  (CreateListingSchema) — this is the missing "add to an EXISTING listing" path; without it the health
   *  row's cta had nowhere real to go. Owner-only (server re-checks ownership, moderator override allowed).
   *  Capped at 10 total (mirrors CreateListingSchema's mediaIds max). */
  @Post(':id/photos')
  @RequirePermissions(ListingPermissions.Update)
  async addPhoto(
    @CurrentContext() ctx: RequestContext, @Param('id') id: string,
    @ZodBody(AddListingPhotoSchema) dto: AddListingPhotoDto,
  ) {
    const data = await this.service.addPhoto(ctx.tenantId, { userId: ctx.userId, canModerate: canModerate(ctx) }, id, dto.mediaAssetId);
    return { data };
  }

  @Post()
  @RequirePermissions(ListingPermissions.Create)
  async create(
    @CurrentContext() ctx: RequestContext,
    @Headers('idempotency-key') idemKey: string,
    @ZodBody(CreateListingSchema) dto: CreateListingDto,
  ) {
    if (!idemKey) throw new BadRequestError('Idempotency-Key header required');
    const { id } = await this.service.create(ctx.tenantId, ctx.userId, idemKey, dto);
    return { data: { id } };
  }

  /** Seller engagement analytics for their OWN listing (offers / price changes / boosts). Owner-only:
   *  a non-owner non-moderator gets 404 (anti-IDOR, no enumeration). Derived from real data, no fake views. */
  @Get(':id/analytics')
  async analytics(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    const data = await this.analyticsRM.forSeller(ctx.tenantId, id, ctx.userId, canModerate(ctx));
    if (!data) throw new ListingNotFoundError(id);
    return { data };
  }

  /** Paginated buyer inquiries into the caller's OWN listing (screen 112, KV-BL-031). Owner-only: a non-owner
   *  non-moderator gets 404 (anti-IDOR, same convention as :id/analytics above). Keyset-paginated (opaque cursor). */
  @Get(':id/inquiries')
  async inquiries(
    @CurrentContext() ctx: RequestContext, @Param('id') id: string,
    @ZodQuery(QueryListingInquiriesSchema) q: QueryListingInquiriesDto,
  ) {
    const res = await this.inquiryService.list(
      ctx.tenantId, { userId: ctx.userId, canModerate: canModerate(ctx) }, id,
      { cursor: decodeCursor(q.cursor), limit: q.limit },
    );
    return { data: res.items, meta: { nextCursor: res.nextCursor } };
  }

  /** Record ONE per-impression view (P1-15). Authenticated (bounds abuse, gives a clean tenant) + flag-gated
   *  (`listing_views`, seeded OFF). FIRE-AND-FORGET: emits a single tiny `views.listing_viewed` outbox event onto
   *  the high-volume pipeline — counting happens off-band in the stream-processor, so there is NO synchronous
   *  hot-path cost. An emit failure is SWALLOWED (a lost impression is acceptable; never fail the caller — Law 12).
   *  No Idempotency-Key: redelivery dedup is downstream (consumer runtime, keyed on the outbox event id). */
  @Post(':id/view')
  @FeatureFlag('listing_views')
  async recordView(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    try { await this.views.record(ctx.tenantId, id, ctx.userId); } catch { /* drop the impression, never 5xx */ }
    return { data: { ok: true } };
  }

  @Post(':id/publish')
  @RequirePermissions(ListingPermissions.Publish)
  async publish(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    await this.service.publish(ctx.tenantId, { userId: ctx.userId, canModerate: canModerate(ctx) }, id);
    return { data: { ok: true } };
  }

  @Patch(':id/price')
  @RequirePermissions(ListingPermissions.Update)
  async changePrice(
    @CurrentContext() ctx: RequestContext, @Param('id') id: string,
    @ZodBody(ChangePriceSchema) dto: ChangePriceDto,
  ) {
    await this.service.changePrice(
      ctx.tenantId, { userId: ctx.userId, canModerate: canModerate(ctx) },
      id, BigInt(dto.priceMinor), dto.expectedVersion,
    );
    return { data: { ok: true } };
  }

  /** REPOST — bring an expired/sold-out listing back live for a fresh window (screen 116). Owner-only (server
   *  re-checks ownership + the domain state machine validates the source status). Optional new price applied
   *  atomically. Default window 7 days when durationDays is omitted. */
  @Post(':id/repost')
  @RequirePermissions(ListingPermissions.Update)
  async repost(
    @CurrentContext() ctx: RequestContext, @Param('id') id: string,
    @ZodBody(RepostListingSchema) dto: RepostListingDto,
  ) {
    await this.service.repost(
      ctx.tenantId, { userId: ctx.userId, canModerate: canModerate(ctx) },
      id, { newPriceMinor: dto.newPriceMinor ? BigInt(dto.newPriceMinor) : undefined, durationDays: dto.durationDays ?? 7 },
    );
    return { data: { ok: true } };
  }

  /** EXTEND — push an ACTIVE listing's expiry out by `days` WITHOUT resetting stats/views (screen 112's EXTEND
   *  cta; KV-BL-031). Distinct from repost (which relaunches a lapsed/sold-out listing with a fresh window).
   *  Owner-only (server re-checks ownership). Idempotency-keyed (Law 3) — a retried tap returns the same result. */
  @Post(':id/extend')
  @RequirePermissions(ListingPermissions.Update)
  async extend(
    @CurrentContext() ctx: RequestContext, @Param('id') id: string,
    @Headers('idempotency-key') idemKey: string,
    @ZodBody(ExtendListingSchema) dto: ExtendListingDto,
  ) {
    if (!idemKey) throw new BadRequestError('Idempotency-Key header required');
    const data = await this.service.extend(
      ctx.tenantId, { userId: ctx.userId, canModerate: canModerate(ctx) }, idemKey, id, dto.days,
    );
    return { data };
  }

  /** REMOVE — archive the seller's own listing (screen 112 Remove cta; KV-MF-08). Terminal (no transition out of
   *  'archived' — listing.state.ts); the client confirms before calling. Owner-only (server re-checks ownership);
   *  Idempotency-keyed (Law 3) — a retried tap returns the same result rather than a second illegal transition. */
  @Post(':id/archive')
  @RequirePermissions(ListingPermissions.Update)
  async archive(
    @CurrentContext() ctx: RequestContext, @Param('id') id: string,
    @Headers('idempotency-key') idemKey: string,
    @ZodBody(ArchiveListingSchema) dto: ArchiveListingDto,
  ) {
    if (!idemKey) throw new BadRequestError('Idempotency-Key header required');
    const data = await this.service.archive(
      ctx.tenantId, { userId: ctx.userId, canModerate: canModerate(ctx) }, idemKey, id, dto.reason,
    );
    return { data };
  }

  // ---- PC-56 TENANT-2b · W124/W125 ----

  /** The price trail 0005 recorded on every change and nothing ever read back. Owner-or-moderator (404 to
   *  anyone else — a competitor must not walk a seller's pricing story). */
  @Get(':id/price-history')
  async priceHistory(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.service.priceTrail(ctx.tenantId, { userId: ctx.userId, canModerate: canModerate(ctx) }, id) };
  }

  /** The way back: rejected → draft (one-tap fix-and-relist) and pending_approval → draft (withdraw). */
  @Post(':id/redraft')
  @RequirePermissions(ListingPermissions.Update)
  async redraft(@CurrentContext() ctx: RequestContext, @Param('id') id: string) {
    await this.service.redraft(ctx.tenantId, { userId: ctx.userId, canModerate: canModerate(ctx) }, id);
    return { data: { ok: true } };
  }

  /** W125 — a staff hand lists a MEMBER's produce: consent-gated (purpose on_behalf_listing, the member's own
   *  recorded yes — the same wall the ambassador path honours), created_by recorded so QC's no-self-review has
   *  the identity it needs. `listing.moderate` is the staff-authority grant that already exists — no new
   *  permission minted. Idempotency-keyed (Law 3). */
  @Post('on-behalf')
  @RequirePermissions(ListingPermissions.Moderate)
  async createOnBehalf(
    @CurrentContext() ctx: RequestContext,
    @Headers('idempotency-key') idemKey: string,
    @ZodBody(OnBehalfCreateSchema) dto: OnBehalfCreateDto,
  ) {
    if (!idemKey) throw new BadRequestError('Idempotency-Key header required');
    const { sellerUserId, ...create } = dto;
    return { data: await this.onBehalf.create(ctx.tenantId, { userId: ctx.userId }, idemKey, sellerUserId, create) };
  }
}
