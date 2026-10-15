// modules/offers/controllers/v1/offers.controller.ts · offer negotiation (validate→authorize→delegate).
// Make needs offer.create + an Idempotency-Key. counter/accept/reject are party-authorized in the
// service (buyer vs the listing's seller). List/get are scoped to the caller's own offers (buyer) or
// the listings they own (seller). Gated by the `offers` feature flag (default OFF).
import { createHash } from 'node:crypto';
import { Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import { UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../../core/auth/auth.guard';
import { PermissionsGuard, RequirePermissions } from '../../../../core/auth/permissions.guard';
import { FeatureFlag, FeatureFlagGuard } from '../../../../core/feature-flags/flags.guard';
import { ZodBody, ZodQuery } from '../../../../core/http/zod.pipe';
import { CurrentContext } from '../../../../core/tenancy-context/current-context.decorator';
import { RequestContext } from '../../../../core/tenancy-context/request-context';
import { BadRequestError } from '../../../../shared/errors/app-error';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../../core/idempotency/idempotency.service';
import { decodeKeyset, UUID_RE } from '../../../../shared/pagination/us-keyset';
import { ListingOfferService } from '../../services/listing-offer.service';
import { CreateOfferSchema, CreateOfferDto } from '../../dto/create-listing-offer.dto';
import { CounterOfferSchema, CounterOfferDto, DeclineOfferSchema, DeclineOfferDto } from '../../dto/update-listing-offer.dto';
import { QueryOffersSchema, QueryOffersDto } from '../../dto/query-listing-offer.dto';
import { OfferPermissions, canModerateOffer } from '../../policies/offers.policies';

// PC-56 STORE-3b · B8 (survey F-20): the cursor is the MICROSECOND instant the database printed + the id (shared/pagination/us-keyset.ts);
// anything malformed — including a pre-3b millisecond cursor — is "no cursor" (page one), never a millisecond guess.
const decodeCursor = (c?: string) => decodeKeyset(c, UUID_RE);
/** PC-56 STORE-3b · B5 (survey B17) — the 3a key: bound to THIS offer (sha256(offerId:key), 43 chars inside idempotency_keys.key varchar(120)). */
const offerKey = (id: string, key: string) => createHash('sha256').update(`${id}:${key}`).digest('base64url');

@Controller({ path: 'offers', version: '1' })
@UseGuards(AuthGuard, PermissionsGuard, FeatureFlagGuard)
@FeatureFlag('offers')
export class OffersController {
  constructor(private readonly offers: ListingOfferService, @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService) {}
  private actor(ctx: RequestContext) { return { userId: ctx.userId, canModerate: canModerateOffer(ctx) }; }

  @Post() @RequirePermissions(OfferPermissions.Create)
  make(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string, @ZodBody(CreateOfferSchema) dto: CreateOfferDto) {
    if (!key) throw new BadRequestError('Idempotency-Key header required');
    return this.offers.make(ctx.tenantId, ctx.userId, key, dto).then((data) => ({ data }));
  }

  @Get()
  list(@CurrentContext() ctx: RequestContext, @ZodQuery(QueryOffersSchema) q: QueryOffersDto) {
    return this.offers.list(ctx.tenantId, this.actor(ctx), { box: q.box, listingId: q.listingId, status: q.status, cursor: decodeCursor(q.cursor), limit: q.limit })
      .then((res) => ({ data: res.items, meta: { nextCursor: res.nextCursor } }));
  }

  /** PC-56 STORE-3b · B7 (survey B18): the caller's OUTGOING offers counted per status + all, each bounded ({count, capped}). STATIC: declared
   *  before ':id'. Never a tenant-wide count (Law 11). */
  @Get('counts')
  counts(@CurrentContext() ctx: RequestContext) { return this.offers.counts(ctx.tenantId, ctx.userId).then((data) => ({ data })); }

  @Get(':id')
  get(@CurrentContext() ctx: RequestContext, @Param('id') id: string) { return this.offers.getById(ctx.tenantId, this.actor(ctx), id).then((data) => ({ data })); }

  // PC-56 STORE-3b · B5 (survey B17): counter / accept / reject HONOUR Idempotency-Key — the 3a order-cancel pattern: a replay with the same key
  // returns the first answer and acts nothing (one round row, one effect); the key is bound to THIS offer and scoped by caller + act
  // (`offers.counter` / `offers.accept` / `offers.reject`). Without a key the act runs once as before (the state machine and the turn refuse a
  // second act by name).
  @Post(':id/counter')
  async counter(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @ZodBody(CounterOfferSchema) dto: CounterOfferDto) {
    const act = () => this.offers.counter(ctx.tenantId, this.actor(ctx), id, dto.priceMinor);
    return { data: key ? await this.idem.remember(offerKey(id, key), ctx.userId, 'offers.counter', act) : await act() };
  }

  /** The accept's answer carries `conversion: 'creating'` and `convertedOrderId: null` — the relay creates the order within seconds. */
  @Post(':id/accept')
  async accept(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string) {
    const act = () => this.offers.accept(ctx.tenantId, this.actor(ctx), id);
    return { data: key ? await this.idem.remember(offerKey(id, key), ctx.userId, 'offers.accept', act) : await act() };
  }

  /** PC-56 STORE-3b · B4 (founder D3): + an optional `reasonCode` from the `offer_decline_reason` vocabulary. */
  @Post(':id/reject')
  async reject(@CurrentContext() ctx: RequestContext, @Headers('idempotency-key') key: string | undefined, @Param('id') id: string, @ZodBody(DeclineOfferSchema) dto: DeclineOfferDto) {
    const act = () => this.offers.reject(ctx.tenantId, this.actor(ctx), id, dto.reasonCode ?? null);
    return { data: key ? await this.idem.remember(offerKey(id, key), ctx.userId, 'offers.reject', act) : await act() };
  }
}
