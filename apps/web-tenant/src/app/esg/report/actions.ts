'use server';
// apps/web-tenant/src/app/esg/report/actions.ts · W424 "Generate report" → the export's own page (queued → ready) · PC-56 TENANT-9d.
// THE KEY IS THE REPORT PAGE'S (the guard is the review). A refusal goes back to W424 with the API's code
// (`ESG_REFUSED` NO_PERMISSION, `EXPORT_PLANE_DISABLED`, `EXPORT_TOO_MANY_OPEN`, …) — nothing was queued.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { refusalCodesFrom } from '../../../features/governance/resolutions';
import { REPORT_HREF, exportHref } from '../../../features/esg/esg';

export async function enqueueEsgReportAction(formData: FormData): Promise<void> {
  await requireSession(REPORT_HREF);
  const key = String(formData.get('idempotencyKey') ?? '') || randomUUID();
  const langRaw = String(formData.get('lang') ?? '').trim();
  const lang = /^[a-z]{2,3}$/.test(langRaw) ? langRaw : undefined;
  let id: string | null = null; let failed: string[] = ['unknown'];
  try { id = (await tenantClient().esg.enqueueReport(lang ? { lang } : {}, key)).id; }
  catch (e) { failed = e instanceof SdkError ? refusalCodesFrom(e.details, e.code || 'unknown') : ['unknown']; }
  if (!id) redirect(`${REPORT_HREF}?error=${encodeURIComponent(failed.join(','))}`);
  redirect(exportHref(id!));
}
