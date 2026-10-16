// modules/listings/services/listing-inquiry.service.ts · KV-BL-031 (screen 112 inquiries tab).
// GET /v1/listings/:id/inquiries — owner-only, paginated buyer inquiries for ONE listing. Reuses communication's
// ConversationService (Law 11: cross-module via its exported service, never its repository/table) filtered to
// contextType='listing' + contextId=<this listing>. The seller is a PARTICIPANT of EVERY listing-context thread
// linked to their own listing (the buyer always adds the seller as a participant when opening it — see
// ConversationService.open()), so "the owner's own conversations for this context" IS the inquiry inbox — no new
// storage needed (03_API_CONTRACT_DELTA.md's own recommendation for this endpoint).
import { Injectable } from '@nestjs/common';
import { ListingRepository } from '../repositories/listing.repository';
import { ListingNotFoundError } from '../domain/listing.errors';
import { ListingActor } from './listing.service';
import { ConversationService } from '../../communication/services/conversation.service';

export interface ListingInquiry {
  conversationId: string;
  buyerUserId: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
}

@Injectable()
export class ListingInquiryService {
  constructor(
    private readonly listings: ListingRepository,
    private readonly conversations: ConversationService,
  ) {}

  async list(
    tenantId: string,
    actor: ListingActor,
    listingId: string,
    q: { cursor?: { c: string; id: string }; limit: number },
  ): Promise<{ items: ListingInquiry[]; nextCursor: string | null }> {
    const listing = await this.listings.findById(tenantId, listingId);
    if (!listing) throw new ListingNotFoundError(listingId);
    const p = listing.toProps();
    // Owner-only, anti-IDOR: a non-owner/non-moderator gets 404 (not 403) — same convention as GET :id/analytics,
    // never confirming a listing's existence to someone who isn't allowed to see its inquiries.
    if (!actor.canModerate && p.sellerUserId !== actor.userId) throw new ListingNotFoundError(listingId);

    // Query AS the listing's real seller — this also covers the moderator-override read path (a moderator reads
    // through the owner's own inbox; read-only, no action is taken as the impersonated user).
    // PC-56 HOTFIX-6 · B2: the seller's own inbox read in the STAFF shape (owner-verified above) — the buyer shape carries no user id.
    const { items, nextCursor } = await this.conversations.listSummaries(
      tenantId,
      { userId: p.sellerUserId, isModerator: false },
      { archived: false, contextType: 'listing', contextId: listingId, cursor: q.cursor, limit: q.limit },
      { asStaff: true },
    );
    return {
      items: items.map((s) => ({
        conversationId: s.id,
        buyerUserId: 'counterpartyUserId' in s ? s.counterpartyUserId : null,
        lastMessagePreview: s.lastMessageBody,
        unreadCount: s.unreadCount,
      })),
      nextCursor,
    };
  }
}
