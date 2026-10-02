// modules/auctions/policies/auctions.policies.ts · permission keys (DB-backed RBAC, Law 6).
//
// PC-56 TENANT-11a (F-10): `canModerateAuction` (listing.moderate || dispute.resolve — held by support_agent and ai_ops)
// no longer reaches ANY auction write. Staff act only through the auction desk's own verbs (0186):
//   • auction.schedule_on_behalf — tenant_admin, fpo_coordinator: schedule FOR a seller, and record a seller's decision
//     (approve / decline) — each WITH a consent row for that act; never staff alone;
//   • auction.cancel_live — tenant_admin: stop a live auction, reason mandatory, every bidder notified;
//   • auction.pause_entry — tenant_admin: stop / resume NEW bidders;
//   • auction.read — broad: the (masked) bid stream. Bidders read it with auction.bid.
// Moderators keep READ (the list and the detail are open to every member of the tenant).
import { RequestContext } from '../../../core/tenancy-context/request-context';
import type { AuctionActor, AuctionViewer } from '../services/auction.service';

export const AuctionPermissions = {
  Create: 'auction.create', Bid: 'auction.bid', Read: 'auction.read',
  ScheduleOnBehalf: 'auction.schedule_on_behalf', CancelLive: 'auction.cancel_live', PauseEntry: 'auction.pause_entry',
} as const;

const has = (ctx: RequestContext, p: string) => ctx.permissions.has(p) || ctx.permissions.has('*');

export function auctionActor(ctx: RequestContext): AuctionActor {
  return { userId: ctx.userId, onBehalf: has(ctx, AuctionPermissions.ScheduleOnBehalf), cancelLive: has(ctx, AuctionPermissions.CancelLive), pauseEntry: has(ctx, AuctionPermissions.PauseEntry) };
}
export function auctionViewer(ctx: RequestContext): AuctionViewer {
  const a = auctionActor(ctx);
  return { ...a, isStaff: Boolean(a.onBehalf || a.cancelLive || a.pauseEntry) };
}
export const canSchedule = (ctx: RequestContext) => has(ctx, AuctionPermissions.Create) || has(ctx, AuctionPermissions.ScheduleOnBehalf);
export const canReadBids = (ctx: RequestContext) => has(ctx, AuctionPermissions.Bid) || has(ctx, AuctionPermissions.Read);
