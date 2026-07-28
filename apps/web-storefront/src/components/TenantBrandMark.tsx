// apps/web-storefront/src/components/TenantBrandMark.tsx · DEV-26/Q20: renders a tenant's storefront brand mark
// (the page's own <h1>) as EITHER the tenant's logo OR the LOGO-4 canon's name-block fallback — never a
// fabricated/platform-owned substitute. Thin presentational wrapper; all the fallback logic is the pure,
// unit-tested `resolveBrandMark` helper (see features/branding/brand-mark.ts for the canon citation).
// logo_url is tenant-supplied, arbitrary-origin media (see next.config.js CSP `img-src` note) — a plain <img>,
// not next/image, since next/image would require a fixed per-tenant domain allowlist that does not exist yet.
import { resolveBrandMark, type TenantBrandingLike } from '../features/branding/brand-mark';

export function TenantBrandMark(
  { branding, tenantSlug }: { branding: TenantBrandingLike | null; tenantSlug: string },
) {
  const mark = resolveBrandMark(branding, tenantSlug);
  if (mark.kind === 'logo') {
    return (
      <h1 className="kv-storefront__title kv-storefront__title--logo">
        {/* eslint-disable-next-line @next/next/no-img-element — arbitrary tenant-CDN origin, not statically optimizable */}
        <img className="kv-storefront__logo" src={mark.src} alt={mark.alt} loading="eager" decoding="async" />
      </h1>
    );
  }
  return <h1 className="kv-storefront__title">{mark.text}</h1>;
}
