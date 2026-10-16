// apps/web-storefront/src/app/[tenantSlug]/account/data/[id]/download/route.ts · PC-56 STORE-4a · C4 — W3030's bytes under the organisation's chrome.
// The proxy is ONE copy (lib/personal-download.ts — the console's 6e-2 pattern: the signed link beside the session; every fetch logged by the API).
import { personalDownload } from '../../../../../../lib/personal-download';
import { tenantChrome } from '../../../../../../features/store4a/account';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { tenantSlug: string; id: string } }): Promise<Response> {
  return personalDownload(req, tenantChrome(params.tenantSlug), params.id);
}
