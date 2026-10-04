'use server';
// apps/web-tenant/src/app/insights/governance/agm/exports/[id]/actions.ts · W2474 "Export ready" download — PC-56 TENANT-SW-d. The 6e-2
// mint-then-fetch rule (as `/dairy/insights/exports`): the API mints the 15-minute signed link (audited), the browser goes to the
// console's own download route with it, which presents it beside the session. The token is never rendered into the page.
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../../lib/api-client';
import { requireSession } from '../../../../../../lib/session';
import { AGM_HREF, agmExportDownloadHref, agmExportHref } from '../../../../../../features/swd/console';

export async function mintAgmDownloadAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(AGM_HREF);
  await requireSession(agmExportHref(id));
  let token: string;
  try { token = (await tenantClient().exportsPlane.mintLink(id)).token; }
  catch (e) { redirect(`${agmExportHref(id)}?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'link') : 'link')}`); }
  redirect(agmExportDownloadHref(id, token));
}
