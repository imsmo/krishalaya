// apps/web-gov/src/app/verification/[id]/evidence/route.ts · GW-4 evidence opener (PC-55 B1).
// WHY A ROUTE AND NOT A LINK IN THE PAGE. Evidence must be visible (a blind decision is forbidden) but a KYC
// document image is about as sensitive as this platform gets. So:
//   • the presigned URL is minted HERE, server-side, at the moment the officer clicks — it is never embedded in
//     page HTML where it would survive in a screenshot, a browser cache, or a shared URL;
//   • the API re-checks the officer's permission on the case read AND on the download-url mint, so this route
//     cannot be used to fetch a media id the caller has no business seeing;
//   • the mediaId is taken from the CASE (kyc/review/:id), never from the query string — otherwise this endpoint
//     would become a general-purpose "presign any media id for me" oracle;
//   • the bytes go browser → S3 directly; they never pass through this console.
// 303 (not 302) so the browser issues a clean GET to the storage URL. no-store, and never cache the redirect.
import { NextResponse } from 'next/server';
import { govClient } from '../../../../lib/api-client';
import { resolveSessionToken } from '../../../../lib/session';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  // Not requireSession(): a route handler must not redirect an image request into an HTML login page.
  const token = await resolveSessionToken();
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const client = govClient();
  try {
    const kyc = await client.kyc.reviewCase(params.id);
    if (!kyc.mediaId) return NextResponse.json({ error: 'no_evidence' }, { status: 404 });
    const link = await client.media.downloadUrl(kyc.mediaId);
    return NextResponse.redirect(link.url, { status: 303, headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    // Mirror the API's own answer without elaborating: 403 stays 403 (no grant), everything else is a 404 so this
    // route never confirms that a case or an asset exists to someone who may not read it.
    const status = (e as { status?: number }).status === 403 ? 403 : 404;
    return NextResponse.json({ error: status === 403 ? 'forbidden' : 'not_found' }, { status });
  }
}
