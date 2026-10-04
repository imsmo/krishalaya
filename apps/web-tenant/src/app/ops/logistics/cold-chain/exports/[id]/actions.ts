'use server';
// apps/web-tenant/src/app/ops/logistics/cold-chain/exports/[id]/actions.ts · W2535 "Export ready" download — PC-56 TENANT-SW-e. The 6e-2
// mint-then-fetch rule (as `/dairy/insights/exports`): the API mints the 15-minute signed link (audited), the browser goes to the
// console's own download route with it, which presents it beside the session. The token is never rendered into the page.
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../../lib/api-client';
import { requireSession } from '../../../../../../lib/session';
import { BREACHES_HREF, coldExportDownloadHref, coldExportHref } from '../../../../../../features/swe/console';

export async function mintColdDownloadAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(BREACHES_HREF);
  await requireSession(coldExportHref(id));
  let token: string;
  try { token = (await tenantClient().exportsPlane.mintLink(id)).token; }
  catch (e) { redirect(`${coldExportHref(id)}?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'link') : 'link')}`); }
  redirect(coldExportDownloadHref(id, token));
}
