// apps/web-storefront/src/app/[tenantSlug]/trace/[qrToken]/export/[jobId]/download/route.ts · PC-56 STORE-5b · C3 — W3155's bytes under the ORGANISATION's chrome.
// The proxy is ONE copy (lib/trace-download.ts — the signed link beside the session; every fetch logged by the API).
import { traceDownload } from '../../../../../../../lib/trace-download';
import { tenantChrome } from '../../../../../../../features/store4a/account';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  props: { params: Promise<{ tenantSlug: string; qrToken: string; jobId: string }> }
): Promise<Response> {
  const params = await props.params;
  return traceDownload(req, tenantChrome(params.tenantSlug), params.qrToken, params.jobId);
}
