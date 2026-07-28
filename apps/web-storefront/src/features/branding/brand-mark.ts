// apps/web-storefront/src/features/branding/brand-mark.ts · PURE decision helper (no React/IO) → unit-tested.
// DEV-26/Q20 + LOGO-4 canon (BRAND-034-cobrand-fallback.html §3, "the two-tier rule", DECIDED 2026-07-19):
// "NAME-BLOCK wherever available width >= 160px (documents/headers/emails); INITIAL-TILE ONLY in fixed-square
// micro contexts (nav 32-40px, avatars); never mixed on one surface; initial-tile NEVER uses KV green (fixed
// neutral ink-400 instead)." The storefront's tenant heading is a wide slot (a page <h1>, not a fixed-square
// micro context), so ONLY the name-block tier applies here — this module never produces an initial-tile result;
// a dedicated micro-context (e.g. a future compact header/avatar) would need its own resolver.
//
// Law 12 (render only verified truth): a tenant with no configured logo is a normal, expected state, not an
// error — the name-block fallback (the tenant's OWN name, never the platform's KV mark/green) is not a "broken
// image" placeholder, it is the ratified default appearance for an unbranded tenant.
export interface TenantBrandingLike { displayName: string; logoUrl: string | null }

export type BrandMark =
  | { kind: 'logo'; src: string; alt: string }
  | { kind: 'name'; text: string };

/** Resolve what to render for a tenant's storefront brand mark, given branding data (or null when unresolved)
 *  and the tenantSlug as the last-resort text fallback (e.g. branding fetch failed / no tenant context). */
export function resolveBrandMark(branding: TenantBrandingLike | null, tenantSlug: string): BrandMark {
  const name = branding?.displayName?.trim();
  const text = name && name.length > 0 ? name : tenantSlug;
  const logoUrl = branding?.logoUrl?.trim();
  if (logoUrl && logoUrl.length > 0) return { kind: 'logo', src: logoUrl, alt: text };
  return { kind: 'name', text };
}
