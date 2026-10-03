// apps/web-tenant/src/app/settings/branding/logo/[id]/route.ts · the DRAFT logo for the console preview — PC-56 TENANT-13d.
// Same-origin (the console's CSP is img-src 'self'), session-bound (the API checks tenant.settings), and only once the antivirus scan
// cleared the file (the API answers 409 BRAND_LOGO_NOT_READY before that). The content type is the API's — png or svg, nothing else —
// and an SVG keeps its sandboxing CSP and nosniff on the way through.
import { NextResponse } from 'next/server';
import { tenantClient } from '../../../../../lib/api-client';
import { getAccessToken } from '../../../../../lib/auth';
import { isUuid } from '../../../../../features/branding/branding';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  // the cookie-held access token (a page load just refreshed it); no token → no logo
  if (!getAccessToken()) return new NextResponse(null, { status: 401 });
  if (!isUuid(params.id)) return new NextResponse(null, { status: 404 });
  try {
    const res = await tenantClient().branding.draftLogo(params.id);
    const type = res.headers.get('content-type') === 'image/svg+xml' ? 'image/svg+xml' : 'image/png';
    return new NextResponse(await res.arrayBuffer(), { status: 200, headers: {
      'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=60',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
    } });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
