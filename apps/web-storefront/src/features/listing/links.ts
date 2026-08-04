// apps/web-storefront/src/features/listing/links.ts · PURE helpers (no React/IO) → unit-tested.
// Shape the NON-PII public links the detail read exposes (qrToken → farm-to-fork page; auctionId → live auction)
// into safe hrefs + a CTA state. No fabrication: a missing token/id yields null so the component renders nothing.
import type { ListingCard } from '@krishalaya/sdk-js';

/** A live consumer can still bid; ended/settled/cancelled is view-only. Drives the storefront auction CTA label. */
const LIVE_AUCTION_STATUSES = new Set(['scheduled', 'live', 'extended', 'awaiting_approval']);

/** The public farm-to-fork provenance href for a listing's QR token, or null when there is no trace lot. */
export function traceHref(qrToken: string | null | undefined): string | null {
  if (typeof qrToken !== 'string') return null;
  const tok = qrToken.trim();
  if (tok.length === 0) return null;
  return `/trace/${encodeURIComponent(tok)}`;
}

export interface AuctionCta {
  href: string;
  /** true → buyers can still bid (label "bid"); false → ended/settled, view-only (label "view results"). */
  live: boolean;
}

/** The auction CTA (href + live flag) for a listing, or null when the listing isn't auctioned. */
export function auctionCta(
  auctionId: string | null | undefined,
  auctionStatus: string | null | undefined,
): AuctionCta | null {
  if (typeof auctionId !== 'string' || auctionId.trim().length === 0) return null;
  return {
    href: `/auctions/${encodeURIComponent(auctionId)}`,
    live: typeof auctionStatus === 'string' && LIVE_AUCTION_STATUSES.has(auctionStatus),
  };
}

/** Convenience: derive both links straight off a detail-read ListingCard. */
export function listingLinks(l: Pick<ListingCard, 'qrToken' | 'auctionId' | 'auctionStatus'>): {
  trace: string | null; auction: AuctionCta | null;
} {
  return { trace: traceHref(l.qrToken), auction: auctionCta(l.auctionId, l.auctionStatus) };
}
