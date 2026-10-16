// apps/web-storefront/src/lib/personal-download.ts · PC-56 STORE-4a · C4 — W3030's bytes: "Download my data" through THIS app (the console's 6e-2
// proxy pattern — apps/web-tenant `insights/exports/[id]/download/route.ts`). The API needs the signed link AND the session: the link authorises
// the file, the session says who; the stream passes through with the receipt's sha256 header. A refusal is never a file — it is a redirect back
// to the data page with the API's outcome code (the API has already LOGGED the attempt). ONE copy, called by both chromes' route handlers.
import 'server-only';
import { NextResponse } from 'next/server';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from './session';
import { serverClient } from './api-client';
import { accountHref, type AccountChrome } from '../features/store4a/account';

const FORWARDED = ['content-type', 'content-length', 'content-disposition', 'x-export-sha256'] as const;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function personalDownload(req: Request, chrome: AccountChrome, id: string): Promise<Response> {
  const url = new URL(req.url);
  await requireSession(accountHref(chrome, 'data'));
  const back = (code: string) => NextResponse.redirect(new URL(accountHref(chrome, 'data', { download: code }), url), 303);
  const token = url.searchParams.get('token') ?? '';
  if (!UUID.test(id)) return back('refused_wrong_job');
  if (!token) return back('refused_no_token');
  let upstream: Response;
  try { upstream = await serverClient(chrome.kind === 'tenant' ? chrome.slug : undefined).exportsPlane.openDownload(id, token); }
  catch (e) {
    const err = e instanceof SdkError ? e : null;
    return back(typeof err?.details?.outcome === 'string' ? (err.details.outcome as string) : (err?.code ?? 'generic'));
  }
  const headers = new Headers({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
  for (const h of FORWARDED) { const v = upstream.headers.get(h); if (v) headers.set(h, v); }
  return new Response(upstream.body, { status: 200, headers });
}
