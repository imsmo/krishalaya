'use server';
// apps/web-tenant/src/app/auditor/exports/[id]/actions.ts · W2499's *"delivery via 15-min signed URL"* (PC-56 TENANT-9c, 6e-2's
// action). MINT, THEN FETCH: the API mints the 15-minute HMAC LINK (audited with its jti — a signed LINK, not a signed FILE,
// and the page says which) and the browser is redirected to the console's download route, which presents it beside the
// session. The mint is the AuditorReadOnlyGuard's `export.link` carve-out: without it the export's file cannot be fetched.
import { redirect } from 'next/navigation';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { EXPORTS_HREF, exportDownloadHref, exportHref } from '../../../../features/auditor/realm';

export async function mintAuditorDownloadLinkAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect(EXPORTS_HREF);
  await requireSession(exportHref(id));
  let token: string;
  try {
    token = (await tenantClient().exportsPlane.mintLink(id)).token;
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'link') : 'link';
    redirect(`${exportHref(id)}?error=${encodeURIComponent(code)}`);
  }
  redirect(exportDownloadHref(id, token));
}
