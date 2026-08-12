// modules/listings/services/listing.service.ts
// Application service for the listings aggregate. This is where the platform's
// non-negotiables come together for EVERY write:
//   • one ACID transaction on the tenant's shard (UnitOfWork) with RLS set
//   • domain events drained from the aggregate → outbox IN THE SAME TX (Law 4)
//   • idempotency on create (Law 3) · plan-quota enforcement · optimistic locking
//   • ENFORCED ownership/authorization (seller owns the listing, or admin moderates)
//   • structured metrics/timing on every use-case (observability)
// It never touches money tables directly — that is wallet-service's job (Law 2).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { QUOTA_SERVICE, QuotaService } from '../../../core/quota/quota.service';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { CACHE_SERVICE, CacheService } from '../../../core/cache/cache.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ForbiddenError } from '../../../shared/errors/app-error';
import { memberSuspendedSql } from '../../../shared/sql/member-suspension.sql';
import { Listing, ListingDomainEvent } from '../domain/listing.entity';
import { ListingConcurrencyError, ListingNotFoundError, PhotoMediaInvalidError, TooManyPhotosError, UnknownRejectReasonError } from '../domain/listing.errors';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { PriceHistory } from '../domain/price-history.entity';
import { ListingAttribute, AttrValue } from '../domain/listing-attribute.entity';
import { ListingRepository } from '../repositories/listing.repository';
import { PriceHistoryRepository } from '../repositories/price-history.repository';
import { ListingAttributeRepository } from '../repositories/listing-attribute.repository';
import { ListingMediaRepository } from '../repositories/listing-media.repository';
import { CreateListingDto } from '../dto/create-listing.dto';

const QUOTA_METRIC = 'max_listings_month';
const MAX_LISTING_PHOTOS = 10; // mirrors CreateListingSchema's mediaIds max(10) — same cap, create-time or after
const cacheKey = (t: string, id: string) => `t:${t}:listing:${id}`;

/** The acting principal for a mutation: the seller, or an admin who may moderate. */
export interface ListingActor { userId: string; canModerate: boolean; }

@Injectable()
export class ListingService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(QUOTA_SERVICE) private readonly quota: QuotaService,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(CACHE_SERVICE) private readonly cache: CacheService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: ListingRepository,
    private readonly priceHistory: PriceHistoryRepository,
    private readonly attrs: ListingAttributeRepository,
    private readonly media: ListingMediaRepository,
    private readonly audit: AuditWriter,
  ) {}

  /** Drain aggregate events into the outbox within the same transaction. */
  private async flushEvents(tx: TxContext, tenantId: string, listingId: string, events: ListingDomainEvent[]) {
    for (const e of events) {
      await this.outbox.write(tx, {
        tenantId, aggregateType: 'listing', aggregateId: listingId,
        eventType: e.type, payload: { v: 1, ...e },
      });
    }
  }

  /** CREATE — idempotent, quota-enforced, atomic, event-emitting. */
  async create(tenantId: string, sellerUserId: string, idemKey: string, dto: CreateListingDto): Promise<{ id: string }> {
    return this.idem.remember(idemKey, sellerUserId, 'listings.create', () =>
      timed(this.metrics, 'listing.create', { tenant: tenantId }, async () => {
        await this.quota.assertWithinLimit(tenantId, QUOTA_METRIC);
        const id = uuidv7();
        const listing = Listing.create({
          id, tenantId, sellerUserId, productId: dto.productId, categoryId: dto.categoryId,
          title: dto.title, description: dto.description ?? null,
          quantityTotal: dto.quantityTotal, minOrderQty: dto.minOrderQty, unitCode: dto.unitCode,
          priceMinor: BigInt(dto.priceMinor), currencyCode: dto.currencyCode,
          organicClaim: dto.organicClaim, saleType: dto.saleType,
          pincode: dto.pincode ?? null, regionId: dto.regionId ?? null,
          lat: dto.lat ?? null, lng: dto.lng ?? null, visibility: dto.visibility,
          aiExtracted: false, publishAt: dto.publishAt ? new Date(dto.publishAt) : null,
          publishedAt: null, expiresAt: null,
        });
        const attrEntities = (dto.attributes ?? []).map((a) =>
          ListingAttribute.of({ id: uuidv7(), tenantId, listingId: id, attributeId: a.attributeId, value: toAttrValue(a) }));

        await this.uow.run(tenantId, async (tx) => {
          // **A SUSPENDED SELLER ADDS NO NEW SUPPLY (PC-56 TENANT-1b-2).** Inside the transaction, before the insert:
          // the same question the quota check asks — may this seller put produce on this tenant's market right now —
          // and refusing here means the idempotency record is never completed, so a retry re-asks rather than replaying
          // a success that never happened.
          await this.assertSellerNotSuspendedTx(tx, tenantId, sellerUserId);
          await this.repo.insert(tx, listing);
          if (attrEntities.length) await this.attrs.upsertMany(tx, attrEntities);
          if (dto.mediaIds?.length) await this.media.attach(tx, tenantId, id, dto.mediaIds);
          await this.quota.increment(tx, tenantId, QUOTA_METRIC, 1);
          await this.flushEvents(tx, tenantId, id, listing.pullEvents());
        }, { userId: sellerUserId });

        this.metrics.inc('listing.created', { tenant: tenantId });
        return { id };
      }));
  }

  /** ADD PHOTO — attach ONE already-uploaded, clean IMAGE to the caller's OWN, already-created listing
   *  (screen 112 "Listing health → Add more photos" cta; KV-MF-14). Distinct from `mediaIds` at create
   *  time (only ever consumed once, in create()) — before this method existed there was NO way to add a
   *  photo to a listing after it was created, so the cta had nowhere real to go. Ownership-enforced (owner
   *  or moderator, same rule as every other mutation here); the media gate (photoAttachable) mirrors the
   *  trust-document attach flow but requires kind='image'. Capped at MAX_LISTING_PHOTOS total, counting the
   *  gallery FRESH inside the same locked transaction as the listing row (getForUpdate), so two concurrent
   *  taps can't both slip past the cap. Idempotent: re-attaching an already-attached media id is a no-op
   *  (ListingMediaRepository.attachOne's WHERE NOT EXISTS guard) — the returned count is always the CURRENT
   *  live count, whether this call just added the photo or it was already there. */
  async addPhoto(tenantId: string, actor: ListingActor, id: string, mediaAssetId: string): Promise<{ photoCount: number }> {
    return timed(this.metrics, 'listing.add_photo', { tenant: tenantId }, async () => {
      let photoCount = 0;
      await this.uow.run(tenantId, async (tx) => {
        const listing = await this.repo.getForUpdate(tx, tenantId, id);
        this.assertCanMutate(listing, actor);
        const current = await this.media.countForListing(tx, id);
        if (current >= MAX_LISTING_PHOTOS) throw new TooManyPhotosError(MAX_LISTING_PHOTOS);
        if (!(await this.media.photoAttachable(tx, tenantId, mediaAssetId, actor.userId))) throw new PhotoMediaInvalidError();
        await this.media.attachOne(tx, id, mediaAssetId);
        photoCount = await this.media.countForListing(tx, id);
        await this.outbox.write(tx, { tenantId, aggregateType: 'listing', aggregateId: id, eventType: 'listing.photo_attached', payload: { v: 1, listingId: id, mediaAssetId } });
        await this.auditOverride(tx, tenantId, actor, listing, 'listing.photo_attached');
      }, { userId: actor.userId });
      await this.cache.del(cacheKey(tenantId, id));
      return { photoCount };
    });
  }

  /** PUBLISH — ownership-enforced, guarded transition; emits the searchable event. */
  async publish(tenantId: string, actor: ListingActor, id: string): Promise<void> {
    await timed(this.metrics, 'listing.publish', { tenant: tenantId }, async () => {
      await this.uow.run(tenantId, async (tx) => {
        const listing = await this.repo.getForUpdate(tx, tenantId, id);
        this.assertCanMutate(listing, actor);
        // Publishing is the act that puts a listing in front of buyers, so a suspended seller is refused here even for a
        // draft they wrote before the suspension. Checked INSIDE the transaction, against the LISTING's seller rather
        // than the actor: a moderator publishing on a suspended member's behalf must hit the same wall.
        await this.assertSellerNotSuspendedTx(tx, tenantId, listing.sellerUserId);
        listing.publish();
        await this.repo.update(tx, listing);
        await this.flushEvents(tx, tenantId, id, listing.pullEvents());
        await this.auditOverride(tx, tenantId, actor, listing, 'listing.published');
      }, { userId: actor.userId });
      await this.cache.del(cacheKey(tenantId, id));
    });
  }

  /** REPOST — bring the seller's own expired/sold-out/hidden/paused listing back to 'published' for a FRESH window
   *  (durationDays), keeping its photos/description/attributes. Optionally updates the price in the same tx (writes
   *  price history when it changes). Ownership-checked; the domain state machine validates the source status. */
  async repost(tenantId: string, actor: ListingActor, id: string, opts: { newPriceMinor?: bigint; durationDays: number }): Promise<void> {
    await timed(this.metrics, 'listing.repost', { tenant: tenantId }, async () => {
      await this.uow.run(tenantId, async (tx) => {
        const listing = await this.repo.getForUpdate(tx, tenantId, id);
        this.assertCanMutate(listing, actor); // ownership (moderator bypass); status validated by domain
        // A repost is a fresh publish of old produce; same rule, same reason.
        await this.assertSellerNotSuspendedTx(tx, tenantId, listing.sellerUserId);
        const old = listing.price.minor;
        listing.repost(opts.durationDays, new Date(), opts.newPriceMinor);
        await this.repo.update(tx, listing);
        if (opts.newPriceMinor !== undefined && opts.newPriceMinor !== old) {
          await this.priceHistory.append(tx, PriceHistory.record({ id: uuidv7(), tenantId, listingId: id, oldPriceMinor: old, newPriceMinor: opts.newPriceMinor, changedBy: actor.userId }));
        }
        await this.flushEvents(tx, tenantId, id, listing.pullEvents());
        await this.auditOverride(tx, tenantId, actor, listing, 'listing.reposted');
      }, { userId: actor.userId });
      await this.cache.del(cacheKey(tenantId, id));
    });
  }

  /** EXTEND — push an active listing's expiry out by `days` WITHOUT resetting stats/views (screen 112's EXTEND
   *  cta; KV-BL-031). Ownership-enforced; idempotency-keyed (Law 3) — a retried tap with the SAME Idempotency-Key
   *  returns the cached result rather than extending twice. */
  async extend(tenantId: string, actor: ListingActor, idemKey: string, id: string, days: number): Promise<{ id: string; expiresAt: string | null }> {
    return this.idem.remember(idemKey, actor.userId, 'listings.extend', () =>
      timed(this.metrics, 'listing.extend', { tenant: tenantId }, async () => {
        let expiresAt: Date | null = null;
        await this.uow.run(tenantId, async (tx) => {
          const listing = await this.repo.getForUpdate(tx, tenantId, id);
          this.assertCanMutate(listing, actor);
          listing.extend(days);
          await this.repo.update(tx, listing);
          await this.flushEvents(tx, tenantId, id, listing.pullEvents());
          await this.auditOverride(tx, tenantId, actor, listing, 'listing.extended');
          expiresAt = listing.toProps().expiresAt ?? null;
        }, { userId: actor.userId });
        await this.cache.del(cacheKey(tenantId, id));
        return { id, expiresAt: expiresAt ? (expiresAt as Date).toISOString() : null };
      }));
  }

  /** REMOVE (archive) — take the seller's OWN listing off the marketplace for good (screen 112's Remove cta,
   *  KV-MF-08). Terminal: the domain state machine has no transition OUT of 'archived' (listing.state.ts), so this
   *  cannot be undone — the screen must confirm before calling it. Ownership-enforced (moderator bypass);
   *  idempotency-keyed (Law 3) — a retried tap/double network call returns the same result, never a second
   *  attempt to transition an already-archived listing (which would throw IllegalListingTransitionError). The
   *  domain entity already exposed `archive()` (and the state machine already allowed → 'archived' from every
   *  non-terminal status) — this was the missing service+endpoint wiring (the entity method existed with no
   *  caller, mirroring the pattern already shipped for cms/education/services-marketplace `archive`). */
  async archive(tenantId: string, actor: ListingActor, idemKey: string, id: string): Promise<{ id: string; status: string }> {
    return this.idem.remember(idemKey, actor.userId, 'listings.archive', () =>
      timed(this.metrics, 'listing.archive', { tenant: tenantId }, async () => {
        let status = '';
        await this.uow.run(tenantId, async (tx) => {
          const listing = await this.repo.getForUpdate(tx, tenantId, id);
          this.assertCanMutate(listing, actor);
          listing.archive();
          await this.repo.update(tx, listing);
          await this.flushEvents(tx, tenantId, id, listing.pullEvents());
          await this.auditOverride(tx, tenantId, actor, listing, 'listing.archived');
          status = listing.status;
        }, { userId: actor.userId });
        await this.cache.del(cacheKey(tenantId, id));
        return { id, status };
      }));
  }

  /** CHANGE PRICE — ownership + optimistic-locked, writes price history, emits event. */
  async changePrice(tenantId: string, actor: ListingActor, id: string, newPriceMinor: bigint, expectedVersion: number): Promise<void> {
    await timed(this.metrics, 'listing.change_price', { tenant: tenantId }, async () => {
      await this.uow.run(tenantId, async (tx) => {
        const listing = await this.repo.getForUpdate(tx, tenantId, id);
        this.assertCanMutate(listing, actor);
        this.assertVersion(listing, expectedVersion);
        const old = listing.price.minor;
        if (old === newPriceMinor) return;            // no-op: don't bump version / write history
        listing.changePrice(newPriceMinor);
        await this.repo.update(tx, listing);
        await this.priceHistory.append(tx, PriceHistory.record({ id: uuidv7(), tenantId, listingId: id, oldPriceMinor: old, newPriceMinor, changedBy: actor.userId }));
        await this.flushEvents(tx, tenantId, id, listing.pullEvents());
        await this.auditOverride(tx, tenantId, actor, listing, 'listing.price_changed');
      }, { userId: actor.userId });
      await this.cache.del(cacheKey(tenantId, id));
    });
  }

  /** Reduce stock when an order/auction wins (system-initiated via event handlers). */
  async reduceStock(tenantId: string, id: string, qty: number): Promise<void> {
    await this.uow.run(tenantId, async (tx) => {
      const listing = await this.repo.getForUpdate(tx, tenantId, id);
      listing.reduceStock(qty);
      await this.repo.update(tx, listing);
      await this.flushEvents(tx, tenantId, id, listing.pullEvents());
    });
    await this.cache.del(cacheKey(tenantId, id));
  }

  async restock(tenantId: string, id: string, qty: number): Promise<void> {
    await this.uow.run(tenantId, async (tx) => {
      const listing = await this.repo.getForUpdate(tx, tenantId, id);
      listing.restock(qty);
      await this.repo.update(tx, listing);
      await this.flushEvents(tx, tenantId, id, listing.pullEvents());
    });
    await this.cache.del(cacheKey(tenantId, id));
  }

  /** READ — single listing, cache-aside off a replica. INTERNAL (no visibility gate). */
  async getById(tenantId: string, id: string) {
    return this.cache.wrap(cacheKey(tenantId, id), 300, async () => {
      const l = await this.repo.findById(tenantId, id);
      return l ? l.toProps() : null;
    });
  }

  /**
   * PUBLIC detail read. SECURITY: a non-owner may only see a PUBLISHED + publicly-visible
   * listing. Drafts/hidden/paused/rejected are 404 to non-owners (not 403) so a competitor
   * cannot scrape unpublished inventory/pricing by guessing ids (UUIDv7 is time-ordered).
   * The owner and moderators may view their own/any listing.
   */
  async getPublicById(tenantId: string, id: string, viewer: ListingActor) {
    const l = await this.getById(tenantId, id);
    if (!l) throw new ListingNotFoundError(id);
    const publiclyVisible = l.status === 'published' && (l.visibility === 'public' || l.visibility === 'cross_tenant');
    const isOwnerOrAdmin = viewer.canModerate || l.sellerUserId === viewer.userId;
    if (!publiclyVisible && !isOwnerOrAdmin) throw new ListingNotFoundError(id);
    return l;
  }

  /** Audit when a moderator (admin) acts on a listing they don't own — governance trail. */
  private async auditOverride(tx: TxContext, tenantId: string, actor: ListingActor, listing: Listing, action: string): Promise<void> {
    if (actor.canModerate && listing.sellerUserId !== actor.userId) {
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action, entityType: 'listing', entityId: listing.id, reason: 'moderator override', newValue: { seller: listing.sellerUserId } });
    }
  }

  /** Authorization: the seller owns it, OR the caller may moderate (admin). Else 403. */
  /**
   * **A SUSPENDED SELLER MAY NOT ADD OR RE-EXPOSE SUPPLY (PC-56 TENANT-1b-2).**
   *
   * W154 promises that suspension "pauses listings", and the read side (six public paths, one shared predicate) hides
   * what is already live. This is the other half: without it, a suspended member could keep publishing into a market
   * that hides each new listing, which would look to them like the platform silently swallowing their work.
   *
   * They can still EDIT and still SEE their own catalogue. The refusal is on exposure, not on their own records.
   */
  private async assertSellerNotSuspendedTx(tx: TxContext, tenantId: string, sellerUserId: string): Promise<void> {
    const r = await tx.query<{ suspended: boolean }>(
      `SELECT ${memberSuspendedSql('$2', '$1')} AS suspended`, [sellerUserId, tenantId]);
    if (r.rows[0]?.suspended === true) {
      this.metrics.inc('listing.refused_seller_suspended', { tenant: tenantId });
      throw new ForbiddenError('this member is suspended in this organisation and cannot list', { reason: 'seller_suspended' });
    }
  }

  // ---- PC-56 TENANT-2a · the QC verbs (W126/W127) — pending_approval gains its writers after 133 migrations.

  /** SUBMIT FOR QC — the seller (or a moderator) sends a draft to review; the waiting clock W126 measures
   *  starts HERE. Suspension is not checked at submit (nothing reaches buyers yet) — it is checked where it
   *  bites, at approve, against the SELLER (a reviewer approving a suspended member's lot hits the same wall
   *  as publish). */
  async submitForQc(tenantId: string, actor: ListingActor, id: string): Promise<void> {
    await timed(this.metrics, 'listing.qc_submit', { tenant: tenantId }, async () => {
      await this.uow.run(tenantId, async (tx) => {
        const listing = await this.repo.getForUpdate(tx, tenantId, id);
        this.assertCanMutate(listing, actor);
        listing.submitForQc();
        await this.repo.update(tx, listing);
        await this.flushEvents(tx, tenantId, id, listing.pullEvents());
        await this.auditOverride(tx, tenantId, actor, listing, 'listing.qc_submitted');
      }, { userId: actor.userId });
      await this.cache.del(cacheKey(tenantId, id));
    });
  }

  /** QC APPROVE — publishes immediately (W127: "publishes immediately; buyers with alerts are notified" rides
   *  the listing.published outbox event). Reviewer ≠ seller and ≠ staff creator, asserted in the DOMAIN with its
   *  own codes and backstopped by 0138's CHECK. The controller requires `listing.approve` — the permission that
   *  had been granted since 0004 with nothing checking it. */
  async qcApprove(tenantId: string, reviewer: { userId: string }, id: string): Promise<void> {
    await timed(this.metrics, 'listing.qc_approve', { tenant: tenantId }, async () => {
      await this.uow.run(tenantId, async (tx) => {
        const listing = await this.repo.getForUpdate(tx, tenantId, id);
        await this.assertSellerNotSuspendedTx(tx, tenantId, listing.sellerUserId);
        listing.approveQc(reviewer.userId);
        await this.repo.update(tx, listing);
        await this.flushEvents(tx, tenantId, id, listing.pullEvents());
        await this.audit.write(tx, { tenantId, actorUserId: reviewer.userId, action: 'listing.qc_approved', entityType: 'listing', entityId: id, oldValue: { status: 'pending_approval' }, newValue: { status: 'published' } });
      }, { userId: reviewer.userId });
      await this.cache.del(cacheKey(tenantId, id));
    });
  }

  /** QC REJECT — the reason is mandatory AND from the closed lookup vocabulary (Law 6: reasons are rows, not
   *  code). Validated inside the same tx; an unknown code names the vocabulary and decides NOTHING. The member
   *  is notified via the listing.qc_rejected outbox event, reason included — a rejection always teaches. */
  async qcReject(tenantId: string, reviewer: { userId: string }, id: string, reasonCode: string): Promise<void> {
    await timed(this.metrics, 'listing.qc_reject', { tenant: tenantId }, async () => {
      await this.uow.run(tenantId, async (tx) => {
        const known = await tx.query<{ code: string }>(
          `SELECT code FROM lookup_values WHERE type_code = 'listing_reject_reason' AND is_active
            AND (tenant_id IS NULL OR tenant_id = $1) ORDER BY sort_order, code`, [tenantId]);
        const codes = known.rows.map((x) => x.code);
        if (!codes.includes(reasonCode)) throw new UnknownRejectReasonError(reasonCode, codes);
        const listing = await this.repo.getForUpdate(tx, tenantId, id);
        listing.rejectQc(reviewer.userId, reasonCode);
        await this.repo.update(tx, listing);
        await this.flushEvents(tx, tenantId, id, listing.pullEvents());
        await this.audit.write(tx, { tenantId, actorUserId: reviewer.userId, action: 'listing.qc_rejected', entityType: 'listing', entityId: id, oldValue: { status: 'pending_approval' }, newValue: { status: 'rejected', reason: reasonCode } });
      }, { userId: reviewer.userId });
      await this.cache.del(cacheKey(tenantId, id));
    });
  }

  /** PAUSE — the seller's own hand on their own sale (distinct from the platform's `held`, by design — see
   *  listing.state.ts). W123/W124's Pause finally gets its route; the state machine validates published→paused. */
  async pause(tenantId: string, actor: ListingActor, id: string): Promise<void> {
    await timed(this.metrics, 'listing.pause', { tenant: tenantId }, async () => {
      await this.uow.run(tenantId, async (tx) => {
        const listing = await this.repo.getForUpdate(tx, tenantId, id);
        this.assertCanMutate(listing, actor);
        listing.pause();
        await this.repo.update(tx, listing);
        await this.flushEvents(tx, tenantId, id, listing.pullEvents());
        await this.auditOverride(tx, tenantId, actor, listing, 'listing.paused');
      }, { userId: actor.userId });
      await this.cache.del(cacheKey(tenantId, id));
    });
  }

  private assertCanMutate(listing: Listing, actor: ListingActor): void {
    if (actor.canModerate) return;
    if (listing.sellerUserId !== actor.userId) {
      throw new ForbiddenError('You can only modify your own listings',
        { listingId: listing.id });
    }
  }
  private assertVersion(listing: Listing, expected: number): void {
    if (listing.version !== expected) throw new ListingConcurrencyError(listing.id);
  }
}

function toAttrValue(a: any): AttrValue {
  switch (a.kind) {
    case 'text': return { kind: 'text', text: a.text };
    case 'number': return { kind: 'number', number: a.number };
    case 'bool': return { kind: 'bool', bool: a.bool };
    case 'date': return { kind: 'date', date: a.date };
    case 'option': return { kind: 'option', optionId: a.optionId };
    default: throw new Error('UNKNOWN_ATTR_KIND');
  }
}
