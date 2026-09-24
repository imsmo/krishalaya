// apps/web-tenant/src/app/studio/earnings/exports/[id]/download/route.ts · the bytes (PC-56 TENANT-7d-money, 6e-2's page ported to W418's export).
//
// THE CONSOLE IS THE PROXY, AND THAT IS THE DESIGN. The API's download requires the signed link AND the caller's session;
// the session lives in an HttpOnly cookie the browser cannot put on a cross-origin request, so the console fetches the
// file on the operator's behalf and streams it through. Nothing is buffered: the API's `ReadableStream` IS the response
// body, headers included (content type, length, disposition, and the receipt's sha256 as `x-export-sha256`, so a person
// with a checksum tool can verify what they saved against what the receipt says).
//
// A REFUSAL IS NEVER A FILE. TENANT-5d's rule: a CSV body holding an English error message is a downloaded file that
// looks like data. Every `SdkError` here becomes a redirect back to the receipt page carrying the API's own outcome code
// (`refused_expired`, `refused_wrong_job`, …), which the page renders as a sentence — and which the API has already logged.
import { NextResponse } from 'next/server';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';
import { exportHref } from '../../../../../../features/studio/earnings';

export const dynamic = 'force-dynamic';

const FORWARDED = ['content-type', 'content-length', 'content-disposition', 'x-export-sha256'] as const;

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const id = params.id;
  await requireSession(exportHref(id));
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  const back = (code: string) => NextResponse.redirect(new URL(`${exportHref(id)}?error=${encodeURIComponent(code)}`, url), 303);
  if (!token) return back('refused_no_token');

  let upstream: Response;
  try {
    upstream = await tenantClient().exportsPlane.openDownload(id, token);
  } catch (e) {
    const err = e instanceof SdkError ? e : null;
    const outcome = typeof err?.details?.outcome === 'string' ? (err.details.outcome as string) : (err?.code ?? 'generic');
    return back(outcome);
  }
  const headers = new Headers({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
  for (const h of FORWARDED) { const v = upstream.headers.get(h); if (v) headers.set(h, v); }
  return new Response(upstream.body, { status: 200, headers });
}
