'use server';
// apps/web-storefront/src/app/(platform)/trace/actions.ts · PC-56 STORE-5b · C3 — the trace record's two acts (W3154 / W3155), ONE action module for
// BOTH chromes (the 4a pattern: every form carries a hidden `chrome` — `platform` or the organisation's slug — re-validated by `chromeOf`):
//   • requestTraceExportAction — "Prepare the file": `POST /v1/traceability/scan/:qrToken/export` under the key MINTED WHEN THE PAGE RENDERED
//     (a Retry re-sends the SAME key — one job however often it is pressed) → the export page `?job=<id>` (queued, W3154); a refusal comes
//     back BY NAME with the key kept (`?failure=…&k=…`);
//   • mintTraceDownloadAction — "Download (link valid N minutes)": the plane mints the signed link (audited with its jti); the browser goes to
//     this app's own download route, which presents it BESIDE the session — the token is never rendered.
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { chromeOf, type AccountChrome } from '../../../features/store4a/account';
import { carriedExportKey, exportFailureOf, isTraceToken, traceDownloadHref, traceHref } from '../../../features/store5b/trace';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const api = (c: AccountChrome) => serverClient(c.kind === 'tenant' ? c.slug : undefined);

export async function requestTraceExportAction(formData: FormData): Promise<void> {
  const c = chromeOf(formData.get('chrome'));
  const token = String(formData.get('qrToken') ?? '');
  if (!isTraceToken(token)) redirect('/trace');
  await requireSession(traceHref(c, token, 'export'));
  const key = carriedExportKey(formData.get('key'));
  if (!key) redirect(traceHref(c, token, 'export', { failure: 'server' }));
  let jobId: string;
  try { jobId = (await api(c).traceability.requestExport(token, key)).jobId; }
  catch (e) {
    const err = e instanceof SdkError ? e : null;
    redirect(traceHref(c, token, 'export', { failure: exportFailureOf(err?.code ?? null, err?.status ?? null), k: key }));
  }
  redirect(traceHref(c, token, 'export', { job: jobId }));
}

export async function mintTraceDownloadAction(formData: FormData): Promise<void> {
  const c = chromeOf(formData.get('chrome'));
  const token = String(formData.get('qrToken') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!isTraceToken(token)) redirect('/trace');
  await requireSession(traceHref(c, token, 'export'));
  if (!UUID.test(id)) redirect(traceHref(c, token, 'export'));
  let link: string;
  try { link = (await api(c).exportsPlane.mintLink(id)).token; }
  catch (e) { redirect(traceHref(c, token, 'export', { job: id, download: e instanceof SdkError ? (e.code || 'link') : 'link' })); }
  redirect(traceDownloadHref(c, token, id, link));
}
