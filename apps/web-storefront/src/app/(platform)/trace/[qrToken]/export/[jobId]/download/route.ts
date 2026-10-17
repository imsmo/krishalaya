// apps/web-storefront/src/app/(platform)/trace/[qrToken]/export/[jobId]/download/route.ts · PC-56 STORE-5b · C3 — W3155's bytes under the PLATFORM chrome.
// The proxy is ONE copy (lib/trace-download.ts — the signed link beside the session; every fetch logged by the API).
import { traceDownload } from '../../../../../../../lib/trace-download';
import { PLATFORM_CHROME } from '../../../../../../../features/store4a/account';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { qrToken: string; jobId: string } }): Promise<Response> {
  return traceDownload(req, PLATFORM_CHROME, params.qrToken, params.jobId);
}
