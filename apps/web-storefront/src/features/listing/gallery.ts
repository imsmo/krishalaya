// apps/web-storefront/src/features/listing/gallery.ts · PURE gallery helpers (no React/IO) → unit-tested.
// The gallery itself is fetched from the API's signed `listings/:id/media` endpoint (short-lived presigned GET
// urls, clean assets only) — these helpers only shape what the presentational component renders. No fabrication:
// if the API returns no items the component shows nothing (never a placeholder image).
import type { GalleryItem } from '@krishalaya/sdk-js';

/** True when there is at least one real, presigned image to show. */
export function hasGallery(items: GalleryItem[] | null | undefined): boolean {
  return Array.isArray(items) && items.length > 0;
}

/** Stable, deduped, sort-ordered view of the gallery (defends against a provider returning unordered/dupe rows). */
export function orderedGallery(items: GalleryItem[] | null | undefined): GalleryItem[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  return items
    .filter((it) => it && typeof it.url === 'string' && it.url.length > 0 && !seen.has(it.mediaId) && (seen.add(it.mediaId), true))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}
