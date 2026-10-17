// apps/web-storefront/src/lib/trace-download.ts · PC-56 STORE-5b · C3 — W3155's bytes: the trace record through THIS app (the 4a
// `personal-download.ts` pattern — the signed link AND the session; the API logs every fetch, refused ones included). A refusal is never a
// file: it is a redirect back to the export page with the API's outcome code. ONE copy, called by both chromes' route handlers.
import 'server-only';
import { NextResponse } from 'next/server';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from './session';
import { serverClient } from './api-client';
import type { AccountChrome } from '../features/store4a/account';
import { isTraceToken, traceHref } from '../features/store5b/trace';

const FORWARDED = ['content-type', 'content-length', 'content-disposition', 'x-export-sha256'] as const;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function traceDownload(req: Request, chrome: AccountChrome, qrToken: string, jobId: string): Promise<Response> {
  const url = new URL(req.url);
  const page = isTraceToken(qrToken) ? traceHref(chrome, qrToken, 'export') : '/trace';
  await requireSession(page);
  const back = (code: string) => NextResponse.redirect(new URL(isTraceToken(qrToken) ? traceHref(chrome, qrToken, 'export', { job: UUID.test(jobId) ? jobId : null, download: code }) : '/trace', url), 303);
  const token = url.searchParams.get('token') ?? '';
  if (!UUID.test(jobId)) return back('refused_wrong_job');
  if (!token) return back('refused_no_token');
  let upstream: Response;
  try { upstream = await serverClient(chrome.kind === 'tenant' ? chrome.slug : undefined).exportsPlane.openDownload(jobId, token); }
  catch (e) {
    const err = e instanceof SdkError ? e : null;
    return back(typeof err?.details?.outcome === 'string' ? (err.details.outcome as string) : (err?.code ?? 'generic'));
  }
  const headers = new Headers({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex' });
  for (const h of FORWARDED) { const v = upstream.headers.get(h); if (v) headers.set(h, v); }
  return new Response(upstream.body, { status: 200, headers });
}
