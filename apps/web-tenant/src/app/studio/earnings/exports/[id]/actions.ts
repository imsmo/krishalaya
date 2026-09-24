'use server';
// apps/web-tenant/src/app/studio/earnings/exports/[id]/actions.ts · W2554's *"Download (link valid 15 min)"* (PC-56 TENANT-7d-money, 6e-2's page ported to W418's export).
//
// MINT, THEN FETCH. The button is a form POST: the API mints the 15-minute signed link (and audits the mint with its jti),
// and the browser is redirected to the console's own download route with the token — which presents it BESIDE the
// session to the API, streams the bytes back, and lets the API log the fetch. The token therefore lives in exactly one
// navigation, is never rendered into the page's HTML, and is dead fifteen minutes later whatever happened to it.
//
// A refusal (not ready, file past retention) goes back to the receipt page with its code, where the sentence for it is.
import { redirect } from 'next/navigation';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { exportDownloadHref, exportHref } from '../../../../../features/studio/earnings';

export async function mintDownloadLinkAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/studio/earnings');
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
