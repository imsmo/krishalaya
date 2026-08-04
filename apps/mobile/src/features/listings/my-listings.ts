// apps/mobile/src/features/listings/my-listings.ts · PURE logic for screen 12 (My Listings): the filter
// vocabulary, status→badge mapping, status counts for the chips + stat cards, an auction countdown formatter,
// and a crop→emoji map. No I/O — unit-tested. The screen fetches the owner listing box + wallet earnings and
// renders; all branching/counting lives here.
//
// FLAGGED GAP (never faked): the design shows per-card engagement (👁 views · N inq · bids) and a sold final
// price. Those live in the per-listing ListingAnalytics read (one call PER listing → N+1, forbidden on a list,
// §5). So the list cards omit them and they appear on the listing DETAIL instead; surface them here only when
// the owner list read-model starts returning lightweight view/offer counts inline. Never invented.

import type { ListingCard } from '@krishalaya/sdk-js';

export type ListingFilter = 'all' | 'active' | 'sold' | 'draft';
export const LISTING_FILTERS: readonly ListingFilter[] = Object.freeze(['all', 'active', 'sold', 'draft']);

export type BadgeKind = 'live' | 'auction' | 'sold' | 'draft' | 'paused' | 'expired';

/** Map a listing to its design badge. Auctions win over plain status; otherwise status drives it. */
export function badgeFor(l: Pick<ListingCard, 'status' | 'auctionId' | 'auctionStatus'>): BadgeKind {
  if (l.auctionId && (l.auctionStatus === 'live' || l.auctionStatus === 'active' || l.auctionStatus === 'open')) return 'auction';
  switch (l.status) {
    case 'draft': return 'draft';
    case 'sold': return 'sold';
    case 'paused': return 'paused';
    case 'expired': return 'expired';
    default: return 'live'; // active/published
  }
}

export interface StatusCounts { all: number; active: number; sold: number; draft: number }

/** Count listings by the chip buckets. "active" counts anything that isn't sold/draft/expired (live + auction). */
export function countByStatus(items: ReadonlyArray<Pick<ListingCard, 'status' | 'auctionId' | 'auctionStatus'>>): StatusCounts {
  const c: StatusCounts = { all: items.length, active: 0, sold: 0, draft: 0 };
  for (const it of items) {
    const b = badgeFor(it);
    if (b === 'sold') c.sold++;
    else if (b === 'draft') c.draft++;
    else if (b === 'live' || b === 'auction') c.active++;
  }
  return c;
}

/** Client-side filter over the owner box (the box returns the farmer's own listings; filtering is presentational). */
export function filterListings<T extends Pick<ListingCard, 'status' | 'auctionId' | 'auctionStatus'>>(items: T[], filter: ListingFilter): T[] {
  if (filter === 'all') return items;
  return items.filter((it) => {
    const b = badgeFor(it);
    if (filter === 'sold') return b === 'sold';
    if (filter === 'draft') return b === 'draft';
    return b === 'live' || b === 'auction'; // active
  });
}

/** Compact auction countdown "2h" / "45m" / "30s" from an ISO end time. Null when ended/absent. Pure (now injected). */
export function auctionCountdown(endsAtIso: string | null | undefined, nowMs = Date.now()): string | null {
  if (!endsAtIso) return null;
  const end = Date.parse(endsAtIso);
  if (!Number.isFinite(end)) return null;
  const ms = end - nowMs;
  if (ms <= 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins >= 1440) return `${Math.floor(mins / 1440)}d`;
  if (mins >= 60) return `${Math.floor(mins / 60)}h`;
  if (mins >= 1) return `${mins}m`;
  return `${Math.floor(ms / 1000)}s`;
}

const CROP_EMOJI: Record<string, string> = {
  wheat: '🌾', paddy: '🌾', rice: '🌾', bajra: '🌾', maize: '🌽', corn: '🌽', chilli: '🌶️', chili: '🌶️',
  onion: '🧅', potato: '🥔', tomato: '🍅', cotton: '🧶', soybean: '🫘', groundnut: '🥜',
};
/** Crop → emoji (presentational iconography; the name itself is real). Default 🌾. */
export function cropEmoji(name: string | null | undefined): string {
  const key = (name ?? '').trim().toLowerCase();
  for (const k of Object.keys(CROP_EMOJI)) if (key.includes(k)) return CROP_EMOJI[k];
  return '🌾';
}
