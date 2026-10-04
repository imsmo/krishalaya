'use server';
// apps/web-tenant/src/app/insights/exports/[id]/actions.ts · W2679 / W2570 / W2825 / the report file "Download" — PC-56 TENANT-SW-f. The 6e-2
// mint-then-fetch rule: the API mints the 15-minute signed link (audited with its jti), the browser goes to the console's own download route
// with it, which presents it beside the session. The token is never rendered into a page.
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { INSIGHTS_HREF, insightExportDownloadHref, insightExportHref, isInsightFrom } from '../../../../features/swf/console';

export async function mintInsightDownloadAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  const fromRaw = String(formData.get('from') ?? ''); const from = isInsightFrom(fromRaw) ? fromRaw : 'reports';
  if (!id) redirect(INSIGHTS_HREF);
  await requireSession(insightExportHref(id, from));
  let token: string;
  try { token = (await tenantClient().exportsPlane.mintLink(id)).token; }
  catch (e) { redirect(`${insightExportHref(id, from)}&error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'link') : 'link')}`); }
  redirect(insightExportDownloadHref(id, token, from));
}
