// apps/web-ops/src/app/insights/exports/[id]/download/route.ts · PC-56 OPS-5b · W3322's "Download" — MINT, THEN PIPE (survey E10; the shape of
// web-tenant `dairy/insights/exports/[id]/download/route.ts`, with the mint folded in).
//   1. `POST /v1/exports/:id/link` — the plane mints the 15-minute signed link and AUDITS the mint with its jti (`exports.link_minted`);
//   2. `GET /v1/exports/:id/download?token=` beside the session — the plane verifies the link and LOGS the fetch (served or refused);
//   3. the bytes stream through untouched, with the receipt's sha256 header (`x-export-sha256`).
// A POST (a form on the job page), never a GET: a link prefetch must never mint a link or log a fetch. A cross-site POST is refused. The token lives
// only inside this request — never in a page, a URL the browser keeps, or a log here. A refusal is never a file: back to the job page with a word.
import { NextResponse } from 'next/server';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { opsClient } from '../../../../../lib/api-client';
import { crossSite, downloadErrorOf, exportHref, jobParam, windowParam } from '../../../../../features/ops5/insights';

export const dynamic = 'force-dynamic';
const FORWARDED = ['content-type', 'content-length', 'content-disposition', 'x-export-sha256'] as const;

export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  const url = new URL(req.url);
  const id = jobParam(params.id);
  const form = await req.formData().catch(() => null);
  const w = windowParam(form ? String(form.get('window') ?? '') : '');
  if (!id) return NextResponse.redirect(new URL('/insights', url), 303);
  await requireSession(exportHref(id, w));
  const back = (code: string | null) => NextResponse.redirect(new URL(`${exportHref(id, w)}&downloadError=${downloadErrorOf(code)}`, url), 303);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  if (crossSite(req.headers.get('origin'), host)) return back('cross_site');

  const client = opsClient();
  let token = '';
  try { token = (await client.exportsPlane.mintLink(id)).token; }
  catch (e) { return back(e instanceof SdkError ? e.code ?? null : null); }
  let upstream: Response;
  try { upstream = await client.exportsPlane.openDownload(id, token); }
  catch (e) {
    const err = e instanceof SdkError ? e : null;
    return back(typeof err?.details?.outcome === 'string' ? (err.details.outcome as string) : (err?.code ?? null));
  }
  const headers = new Headers({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
  for (const h of FORWARDED) { const v = upstream.headers.get(h); if (v) headers.set(h, v); }
  return new Response(upstream.body, { status: 200, headers });
}
