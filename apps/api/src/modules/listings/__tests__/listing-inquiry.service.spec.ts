// modules/listings/__tests__/listing-inquiry.service.spec.ts · KV-BL-031 (screen 112 inquiries tab).
// Unit tests with fakes: owner-only 404 (anti-IDOR), the contextType/contextId filter forwarded to
// ConversationService, cursor pass-through, and the response shape mapping.
import { ListingInquiryService } from '../services/listing-inquiry.service';
import { ListingNotFoundError } from '../domain/listing.errors';

function build(opts: { sellerUserId?: string | null } = {}) {
  const listings = {
    findById: jest.fn().mockResolvedValue(
      opts.sellerUserId === null ? null : { toProps: () => ({ sellerUserId: opts.sellerUserId ?? 'owner-A' }) },
    ),
  };
  const conversations = {
    listSummaries: jest.fn().mockResolvedValue({
      items: [
        { id: 'C1', counterpartyUserId: 'buyer-1', lastMessageBody: 'is this still available?', unreadCount: 2 },
        { id: 'C2', counterpartyUserId: 'buyer-2', lastMessageBody: null, unreadCount: 0 },
      ],
      nextCursor: 'opaque-cursor-2',
    }),
  };
  const svc = new ListingInquiryService(listings as any, conversations as any);
  return { svc, listings, conversations };
}

describe('ListingInquiryService.list', () => {
  it('404s for a listing that does not exist', async () => {
    const { svc } = build({ sellerUserId: null });
    await expect(svc.list('t1', { userId: 'owner-A', canModerate: false }, 'L1', { limit: 20 })).rejects.toBeInstanceOf(ListingNotFoundError);
  });

  it('404s (anti-IDOR) for a non-owner, non-moderator — never a 403 (no existence leak)', async () => {
    const { svc } = build({ sellerUserId: 'owner-A' });
    await expect(svc.list('t1', { userId: 'stranger', canModerate: false }, 'L1', { limit: 20 })).rejects.toBeInstanceOf(ListingNotFoundError);
  });

  it('a moderator may read inquiries for a listing they do not own', async () => {
    const { svc, conversations } = build({ sellerUserId: 'owner-A' });
    await svc.list('t1', { userId: 'admin-Z', canModerate: true }, 'L1', { limit: 20 });
    expect(conversations.listSummaries).toHaveBeenCalled();
  });

  it('queries conversations filtered to contextType="listing" AND contextId=<the listing>, AS the real seller', async () => {
    const { svc, conversations } = build({ sellerUserId: 'owner-A' });
    await svc.list('t1', { userId: 'owner-A', canModerate: false }, 'L1', { cursor: { c: '2026-01-01', id: 'C0' }, limit: 20 });
    expect(conversations.listSummaries).toHaveBeenCalledWith(
      't1',
      { userId: 'owner-A', isModerator: false },
      { archived: false, contextType: 'listing', contextId: 'L1', cursor: { c: '2026-01-01', id: 'C0' }, limit: 20 },
      // PC-56 HOTFIX-6 · B2: the owner's inquiries are read in the STAFF shape (the buyer shape carries no user id)
      { asStaff: true },
    );
  });

  it('maps conversation summaries to {conversationId, buyerUserId, lastMessagePreview, unreadCount} and forwards nextCursor', async () => {
    const { svc } = build({ sellerUserId: 'owner-A' });
    const res = await svc.list('t1', { userId: 'owner-A', canModerate: false }, 'L1', { limit: 20 });
    expect(res.items).toEqual([
      { conversationId: 'C1', buyerUserId: 'buyer-1', lastMessagePreview: 'is this still available?', unreadCount: 2 },
      { conversationId: 'C2', buyerUserId: 'buyer-2', lastMessagePreview: null, unreadCount: 0 },
    ]);
    expect(res.nextCursor).toBe('opaque-cursor-2');
  });
});
