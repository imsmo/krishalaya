// apps/mobile/src/features/auctions/auctions.api.ts · data layer for the auctions vertical (P-11). Keeps screens
// thin (guide §3). Reads degrade-never-die (empty/null). Placing a bid + creating an auction are online, idempotent
// (Law 3) mutations that throw so the screen shows the precise outcome — they're NOT offline-queued (a bid moves
// money via the EMD hold and needs live auction state; blind replay of a stale bid is wrong). The EMD hold + the
// loser-refund + winner→settlement are entirely SERVER-SIDE (the app never moves money — Law 11). Money is bigint
// minor-unit strings (Law 2).
import type { Auction, BidHistoryItem, MyBid, PlaceBidResult } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';

export interface AuctionsPage { items: Auction[]; nextCursor: string | null }
export interface BidsPage { items: BidHistoryItem[]; nextCursor: string | null }
export interface MyBidsPage { items: MyBid[]; nextCursor: string | null }

/** The caller's OWN bids across ALL auctions (screen 18), each with its EMD hold + winning flag. Keyset;
 * degrades to an empty page on failure (read screens never crash). */
export async function listMyBids(cursor?: string): Promise<MyBidsPage> {
  try { return await apiClient().auctions.myBids({ cursor }); } catch { return { items: [], nextCursor: null }; }
}

export async function listAuctions(params: { status?: string; cursor?: string } = {}): Promise<AuctionsPage> {
  try { return await apiClient().auctions.list(params); } catch { return { items: [], nextCursor: null }; }
}
export async function getAuction(id: string): Promise<Auction | null> {
  try { return await apiClient().auctions.get(id); } catch { return null; }
}
export async function bidHistory(auctionId: string, cursor?: string): Promise<BidsPage> {
  try { return await apiClient().auctions.listBids(auctionId, { cursor }); } catch { return { items: [], nextCursor: null }; }
}
/** Place a bid (amount in minor units). Holds the EMD server-side. Idempotent; throws on a real error. */
export function placeBid(auctionId: string, amountMinor: string): Promise<PlaceBidResult> {
  return apiClient().auctions.placeBid(auctionId, amountMinor, newId());
}
/** Create an auction on a listing the caller owns. Idempotent; throws on a real error. */
export function createAuction(input: { listingId: string; kind?: 'english_open' | 'sealed'; startPriceMinor: string; reservePriceMinor?: string; minIncrementMinor?: string; startsAt: string; endsAt: string }): Promise<Auction> {
  return apiClient().auctions.create(input, newId());
}
export function cancelAuction(id: string): Promise<{ ok: boolean }> { return apiClient().auctions.cancel(id); }

// --- watch / follow (P1-7) — any authed member may watch an auction in their tenant; watchers are notified when it
// closes (server-side, via the notification spine). Reads degrade-never-die; the toggle mutations throw so the
// screen can show the precise outcome. No money moves on any of these. ---
export async function isWatchingAuction(id: string): Promise<boolean> {
  try { return await apiClient().auctions.isWatching(id); } catch { return false; }
}
export function watchAuction(id: string): Promise<{ ok: boolean; auctionId: string; watching: boolean }> {
  return apiClient().auctions.watch(id);
}
export function unwatchAuction(id: string): Promise<{ ok: boolean; auctionId: string; watching: boolean }> {
  return apiClient().auctions.unwatch(id);
}
/** The caller's watched auctions (keyset). Degrades to an empty page on failure. */
export async function listWatchedAuctions(cursor?: string): Promise<{ items: import('@krishalaya/sdk-js').WatchedAuction[]; nextCursor: string | null }> {
  try { return await apiClient().auctions.watching({ cursor }); } catch { return { items: [], nextCursor: null }; }
}
