// apps/web-tenant/src/app/insights/exports/[id]/download/route.ts · the insights' file bytes — PC-56 TENANT-SW-f. The console is the proxy
// (6e-2): the API needs the signed link AND the session; the stream passes through with the receipt's sha256 header. A refusal is never a
// file — it is a redirect back to the receipt page with the API's outcome code (the API has already logged the attempt).
import { NextResponse } from 'next/server';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { insightExportHref, isInsightFrom } from '../../../../../features/swf/console';

export const dynamic = 'force-dynamic';
const FORWARDED = ['content-type', 'content-length', 'content-disposition', 'x-export-sha256'] as const;

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const id = params.id;
  const url = new URL(req.url);
  const fromRaw = url.searchParams.get('from') ?? ''; const from = isInsightFrom(fromRaw) ? fromRaw : 'reports';
  await requireSession(insightExportHref(id, from));
  const token = url.searchParams.get('token') ?? '';
  const back = (code: string) => NextResponse.redirect(new URL(`${insightExportHref(id, from)}&error=${encodeURIComponent(code)}`, url), 303);
  if (!token) return back('refused_no_token');
  let upstream: Response;
  try { upstream = await tenantClient().exportsPlane.openDownload(id, token); }
  catch (e) {
    const err = e instanceof SdkError ? e : null;
    return back(typeof err?.details?.outcome === 'string' ? (err.details.outcome as string) : (err?.code ?? 'generic'));
  }
  const headers = new Headers({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
  for (const h of FORWARDED) { const v = upstream.headers.get(h); if (v) headers.set(h, v); }
  return new Response(upstream.body, { status: 200, headers });
}
