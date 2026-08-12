// modules/listings/services/on-behalf-console.service.ts · W125, staff listing on a member's behalf
// (PC-56 TENANT-2b).
//
// THE CONSENT GATE IS THE SAME ONE THE AMBASSADOR PATH ALREADY HONOURS — purpose `on_behalf_listing`, the
// member's own recorded yes (voice or app tap, captured by the consent plane), checked BEFORE anything is
// created. W125's restricted state in the canon's own words: "staff-created listings need the member's recorded
// confirmation". Two doors, one law: an ambassador in the field and a staff hand at the console meet the same
// wall. The staff identity lands in created_by, which is what makes QC's no-self-review (QC_OWN_DRAFT) real for
// console drafts — the hand that typed it cannot be the hand that clears it.
import { Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { ConsentService } from '../../identity/services/consent.service';
import { ListingService } from './listing.service';

/** The same purpose code the ambassador path checks (its export lives in a file that imports ListingService —
 *  importing it here would close a module cycle, so the string is duplicated and PINNED EQUAL by spec: the day
 *  the codes drift, the two doors stop being one law and the test says so). */
export const ON_BEHALF_LISTING_PURPOSE = 'on_behalf_listing';
import { OnBehalfConsentMissingError } from '../domain/listing.errors';
import { CreateListingDto } from '../dto/create-listing.dto';

@Injectable()
export class OnBehalfConsoleService {
  constructor(
    private readonly consents: ConsentService,
    private readonly listings: ListingService,
    private readonly audit: AuditWriter,
  ) {}

  async create(tenantId: string, actor: { userId: string }, idemKey: string, sellerUserId: string, dto: CreateListingDto): Promise<{ id: string }> {
    const ok = await this.consents.isGranted(tenantId, sellerUserId, ON_BEHALF_LISTING_PURPOSE, actor.userId);
    if (!ok) throw new OnBehalfConsentMissingError(sellerUserId);
    const res = await this.listings.create(tenantId, sellerUserId, idemKey, dto, actor.userId);
    await this.audit.log({
      tenantId, actorUserId: actor.userId, action: 'listing.created_on_behalf', entityType: 'listing', entityId: res.id,
      oldValue: null, newValue: { sellerUserId, consentPurpose: ON_BEHALF_LISTING_PURPOSE },
      reason: 'console on-behalf create — member consent verified before creation',
    });
    return res;
  }
}
