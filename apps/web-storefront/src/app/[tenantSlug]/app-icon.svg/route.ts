// apps/web-storefront/src/app/[tenantSlug]/app-icon.svg/route.ts · PC-56 STORE-6a · D6 (founder Q6) — the organisation's GENERATED MONOGRAM: its
// initial(s) on its own primary colour (features/store6/manifest.ts `monogramSvg`), 512 × 512, the icon of its installed app until it publishes
// a logo — never the platform's. Read from the PUBLIC brand (no session); an unknown organisation → 404. Cached briefly, like the manifest.
// (The segment is `app-icon.svg`, not `icon.svg`: Next 14 treats a segment named `icon.<ext>` as its metadata-image convention.)
import type { TenantBranding } from '@krishalaya/sdk-js';
import { publicClient } from '../../../lib/api-client';
import { brandColours } from '../../../features/branding/brand-theme';
import { monogramSvg } from '../../../features/store6/manifest';

export const revalidate = 60;

export async function GET(_req: Request, { params }: { params: { tenantSlug: string } }): Promise<Response> {
  const slug = params.tenantSlug;
  if (!/^[a-z0-9][a-z0-9-]{0,49}$/i.test(slug)) return new Response(null, { status: 404 });
  let b: TenantBranding | null = null;
  try { b = await publicClient(slug).lookups.tenantBranding(); } catch { b = null; }
  if (!b) return new Response(null, { status: 404 });
  const name = (b.brand?.displayName || b.displayName || slug).trim();
  return new Response(monogramSvg(name, brandColours(b.brand)?.primary ?? null), {
    status: 200,
    headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff' },
  });
}
