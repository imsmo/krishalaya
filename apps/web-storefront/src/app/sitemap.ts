// apps/web-storefront/src/app/sitemap.ts · sitemap.xml (App Router metadata route). Lists the PUBLIC, indexable
// surfaces only — the home page, the marketing/static pages, and the auctions browse when that surface is enabled.
// Tenant storefronts, listing details, and trace pages are unbounded/data-driven and are discovered via crawl +
// internal links rather than enumerated here (they'd need a full catalogue walk, which the SDK read-models don't
// expose to the storefront). URLs are absolute when the site origin is configured, else path-relative.
import type { MetadataRoute } from 'next';
import { env } from '../lib/env';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = env.siteUrl; // '' when unset → relative paths
  const paths = ['/', '/about', '/blog', '/help', '/pricing', '/press', '/for-organisations', ...(env.featureAuctions ? ['/auctions'] : [])];
  const now = new Date();
  return paths.map((p) => ({
    url: `${base}${p}`,
    lastModified: now,
    changeFrequency: p === '/' || p === '/auctions' ? 'daily' : 'monthly',
    priority: p === '/' ? 1 : 0.7,
  }));
}
