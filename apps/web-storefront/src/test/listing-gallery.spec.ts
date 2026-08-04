// Unit tests for the PURE listing-gallery helpers (no React/IO). Proves the storefront never fabricates media
// and always renders a stable, deduped, sort-ordered view of whatever the signed media endpoint returns.
import type { GalleryItem } from '@krishalaya/sdk-js';
import { hasGallery, orderedGallery } from '../features/listing/gallery';

const item = (mediaId: string, url: string, sortOrder?: number): GalleryItem =>
  ({ mediaId, url, sortOrder } as GalleryItem);

describe('hasGallery', () => {
  it('is false for empty / nullish input', () => {
    expect(hasGallery(null)).toBe(false);
    expect(hasGallery(undefined)).toBe(false);
    expect(hasGallery([])).toBe(false);
  });
  it('is true when at least one item exists', () => {
    expect(hasGallery([item('m1', 'https://s3/x?sig=1')])).toBe(true);
  });
});

describe('orderedGallery', () => {
  it('returns [] for nullish / non-array input', () => {
    expect(orderedGallery(null)).toEqual([]);
    expect(orderedGallery(undefined)).toEqual([]);
    expect(orderedGallery({} as unknown as GalleryItem[])).toEqual([]);
  });

  it('sorts by sortOrder ascending (stable order, no fabrication)', () => {
    const out = orderedGallery([
      item('m3', 'https://s3/c?sig=3', 2),
      item('m1', 'https://s3/a?sig=1', 0),
      item('m2', 'https://s3/b?sig=2', 1),
    ]);
    expect(out.map((i) => i.mediaId)).toEqual(['m1', 'm2', 'm3']);
  });

  it('dedupes repeated mediaIds (keeps first occurrence)', () => {
    const out = orderedGallery([
      item('m1', 'https://s3/a?sig=1', 0),
      item('m1', 'https://s3/a-dupe?sig=9', 0),
      item('m2', 'https://s3/b?sig=2', 1),
    ]);
    expect(out.map((i) => i.mediaId)).toEqual(['m1', 'm2']);
  });

  it('drops items with no usable url (never renders a broken/placeholder image)', () => {
    const out = orderedGallery([
      item('m1', '', 0),
      item('m2', 'https://s3/b?sig=2', 1),
      { mediaId: 'm3', url: undefined as unknown as string, sortOrder: 2 } as GalleryItem,
    ]);
    expect(out.map((i) => i.mediaId)).toEqual(['m2']);
  });

  it('treats a missing sortOrder as 0', () => {
    const out = orderedGallery([
      item('m2', 'https://s3/b?sig=2', 1),
      item('m1', 'https://s3/a?sig=1'),
    ]);
    expect(out.map((i) => i.mediaId)).toEqual(['m1', 'm2']);
  });
});
