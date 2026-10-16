// apps/web-storefront/src/app/(platform)/account/data/[id]/download/route.ts · PC-56 STORE-4a · C4 — W3030's bytes under the platform chrome.
// The proxy is ONE copy (lib/personal-download.ts — the console's 6e-2 pattern: the signed link beside the session; every fetch logged by the API).
import { personalDownload } from '../../../../../../lib/personal-download';
import { PLATFORM_CHROME } from '../../../../../../features/store4a/account';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  return personalDownload(req, PLATFORM_CHROME, params.id);
}
