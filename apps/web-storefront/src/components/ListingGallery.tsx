// apps/web-storefront/src/components/ListingGallery.tsx · presentational photo gallery for a listing detail page.
// Images are SHORT-LIVED presigned GET urls from the API (`listings/:id/media`), clean assets only — this
// component renders only what it's given and shows nothing when there are no real images (never a placeholder).
// Copy arrives pre-localized from the server page, so this stays a string-free presentational component.
import type { GalleryItem } from '@krishalaya/sdk-js';
import { orderedGallery } from '../features/listing/gallery';

export function ListingGallery(
  // `title` was accepted and never read — removed rather than left as a prop callers believe does something.
  { items, heading, alt }:
  { items: GalleryItem[]; heading: string; alt: (index: number, total: number) => string },
) {
  const imgs = orderedGallery(items);
  if (imgs.length === 0) return null;   // no fabricated media — render nothing
  return (
    <section className="kv-detail__section kv-gallery" aria-label={heading}>
      <ul className="kv-gallery__grid" role="list">
        {imgs.map((it, i) => (
          <li key={it.mediaId} className="kv-gallery__item">
            {/* Plain <img>: signed S3 urls expire, so they are not statically optimizable. (Next's @next/next/*
                rules are not part of this repo's flat ESLint config — naming one in a disable is itself an error.) */}
            <img className="kv-gallery__img" src={it.url} alt={alt(i + 1, imgs.length)} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" />
          </li>
        ))}
      </ul>
    </section>
  );
}
