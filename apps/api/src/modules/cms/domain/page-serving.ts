// modules/cms/domain/page-serving.ts · PC-56 TENANT-8c · W175's serving column — which version of a slug `by-slug`
// answers for THIS tenant, stated as a function the list can print and the repository's ORDER BY obeys.
//
// F-14: `publishedBySlug` ranked the tenant's and the platform's published rows by `version DESC` alone, so a platform
// `about` at v5 shadowed the cooperative's own `about` at v1 — the canon's *"your own pages replace them as you publish"*
// inverted. The rule now: the tenant's OWN published version answers, whatever its number; the platform's answers only
// when the tenant has none published; otherwise nothing does (a 404 the reader would print).
//
// THERE IS NO READER. No storefront, mobile or partner code fetches `cms/*` (grep in the 8c report): this is what the
// API WOULD serve to a member who asked, and the console says so beside it, by name — never a preview of a surface that
// does not exist.
export type ServingSource = 'own' | 'platform' | 'none';
export interface Serving { source: ServingSource; version: number | null }

export function servingFor(ownPublishedVersion: number | null, platformPublishedVersion: number | null): Serving {
  if (ownPublishedVersion !== null) return { source: 'own', version: ownPublishedVersion };
  if (platformPublishedVersion !== null) return { source: 'platform', version: platformPublishedVersion };
  return { source: 'none', version: null };
}

/** The list's one-word state of a slug (a slug can be live AND have a draft open — `draftOpen` says so beside it). */
export type SlugState = 'published' | 'draft' | 'archived' | 'platform';
export const SLUG_STATES: readonly SlugState[] = ['published', 'draft', 'archived', 'platform'];
export function slugState(s: { ownRows: number; ownPublished: number | null; openDraft: number | null }): SlugState {
  if (s.ownRows === 0) return 'platform';
  if (s.ownPublished !== null) return 'published';
  if (s.openDraft !== null) return 'draft';
  return 'archived';
}

/** What a member WOULD read after an act on the live version: archiving your published version hands the slug to the
 *  platform's page (when there is one) or to nothing; publishing makes yours the answer. */
export function servingAfter(act: 'publish' | 'archive', s: { version: number; wasLive: boolean; platformPublished: number | null; ownPublished: number | null }): Serving {
  if (act === 'publish') return { source: 'own', version: s.version };
  if (!s.wasLive) return servingFor(s.ownPublished, s.platformPublished);
  return servingFor(null, s.platformPublished);
}
