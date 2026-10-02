// modules/ambassadors/services/on-behalf-listing.service.ts · an ACTIVE ambassador creates a listing ON BEHALF
// of an onboarded farmer (P1-16). This is the consent/authz surface for "acting as": the ambassador acts, but
// the listing's SELLER is the farmer, and the action is allowed ONLY when the farmer has granted the
// 'on_behalf_listing' DPDP consent to THIS ambassador (re-checked from the token, not trusted from the client —
// no IDOR / no acting for arbitrary users). The op is audited with BOTH parties (actor=ambassador, subject=farmer)
// and idempotent on the caller's key (Law 3). The listing itself is created through the canonical
// ListingService.create (one source of truth for listing rules) with sellerUserId = the farmer.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { ListingService } from '../../listings/services/listing.service';
import { ConsentService } from '../../identity/services/consent.service';
import { AmbassadorProfileRepository } from '../repositories/ambassador-profile.repository';
import { DOC_EXTRACTION, DocExtractionProvider, SuggestedListingDraft } from '../gateway/doc-extraction.port';
import { AmbassadorActor } from './ambassador-profile.service';
import { NotAnAmbassadorError, OnBehalfConsentRequiredError } from '../domain/ambassadors.errors';
import { OnBehalfListingDto } from '../dto/on-behalf-listing.dto';
import { SuggestFromDocsDto } from '../dto/suggest-from-docs.dto';

export const ON_BEHALF_LISTING_PURPOSE = 'on_behalf_listing';

@Injectable()
export class OnBehalfListingService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(DOC_EXTRACTION) private readonly docExtraction: DocExtractionProvider,
    private readonly audit: AuditWriter,
    private readonly listings: ListingService,
    private readonly consents: ConsentService,
    private readonly profiles: AmbassadorProfileRepository,
  ) {}

  /** P1-16-AI · AI-suggest listing fields from a farmer's document (OCR'd upstream). ADVISORY — never creates a
   *  listing; the ambassador reviews/edits then calls createListing to confirm. Same gates as the create
   *  (active ambassador + the farmer's on-behalf consent to this ambassador), so AI prefill can't widen authority.
   *  The model tier logs the inference (ai_inferences); we never persist the raw doc text. Degrades to an empty
   *  draft + needsReview when the model tier is unavailable (Law 12). */
  async suggestFromDocs(tenantId: string, actor: AmbassadorActor, dto: SuggestFromDocsDto): Promise<SuggestedListingDraft> {
    const me = await this.profiles.findByUser(tenantId, actor.userId);
    if (!me || !me.toProps().isActive) throw new NotAnAmbassadorError();
    const ok = await this.consents.isGranted(tenantId, dto.farmerUserId, ON_BEHALF_LISTING_PURPOSE, actor.userId);
    if (!ok) throw new OnBehalfConsentRequiredError();
    return this.docExtraction.suggest({ tenantId, docText: dto.docText, locale: dto.locale, docType: 'listing', mediaIds: dto.mediaIds ?? [] });
  }

  /** Create a listing for `farmerUserId` as `actor` (the ambassador). Consent-gated + audited. Idempotent via key. */
  async createListing(tenantId: string, actor: AmbassadorActor, idemKey: string, dto: OnBehalfListingDto, ip: string | null) {
    // 1) the actor must be an ACTIVE ambassador (resolved from the token, not the client).
    const me = await this.profiles.findByUser(tenantId, actor.userId);
    if (!me || !me.toProps().isActive) throw new NotAnAmbassadorError();
    // 2) the farmer must have granted on-behalf-listing consent TO THIS ambassador (DPDP authority; anti-IDOR).
    const ok = await this.consents.isGranted(tenantId, dto.farmerUserId, ON_BEHALF_LISTING_PURPOSE, actor.userId);
    if (!ok) throw new OnBehalfConsentRequiredError();
    // 3) create the listing through the canonical path — SELLER is the farmer (idempotent on the caller's key).
    const created = await this.listings.create(tenantId, dto.farmerUserId, idemKey, dto.listing);
    // 4) audit BOTH parties (append-only) — who acted, for whom.
    await this.uow.run(tenantId, async (tx) => {
      await this.profiles.touchActivity(tx, tenantId, me.toProps().id);   // PC-56 TENANT-10a · F-15
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'ambassadors.on_behalf_listing_created',
        entityType: 'listing', entityId: created.id, newValue: { farmerUserId: dto.farmerUserId, ambassadorUserId: actor.userId }, ip });
    }, { userId: actor.userId });
    return created;
  }
}
