'use server';
// apps/web-tenant/src/app/auditor/exports/new/actions.ts · W2500 → W2498 / W2502 · the auditor's export enqueue (PC-56 TENANT-9c).
// THE KEY IS THE CONFIRM PAGE'S. Success lands on the job's own page (queued → ready); a refusal goes back to the chain's
// failure step with the API's code (`EXPORT_PARAMS_INVALID`, `EXPORT_TOO_MANY_OPEN`, `AUDITOR_REALM_OFF`, …).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import type { AuditorDatasetCode, AuditorPackSection } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { EXPORTS_HREF, NEW_EXPORT_HREF, dayOrUndefined, exportHref, isDataset, isSection } from '../../../../features/auditor/realm';

export async function enqueueAuditorExportAction(formData: FormData): Promise<void> {
  await requireSession(NEW_EXPORT_HREF);
  const dataset = String(formData.get('dataset') ?? '');
  const sectionRaw = String(formData.get('section') ?? '');
  const from = dayOrUndefined(String(formData.get('from') ?? ''));
  const to = dayOrUndefined(String(formData.get('to') ?? ''));
  const key = String(formData.get('idempotencyKey') ?? '') || randomUUID();
  const keep = new URLSearchParams({ step: 'failure', dataset, from: from ?? '', to: to ?? '' });
  if (isSection(sectionRaw)) keep.set('section', sectionRaw);
  if (!isDataset(dataset) || !from || !to) { keep.set('error', 'EXPORT_PARAMS_INVALID'); redirect(`${NEW_EXPORT_HREF}?${keep.toString()}`); }
  let id: string | null = null; let code = 'export';
  try {
    const params: { from: string; to: string; section?: AuditorPackSection } = { from: from!, to: to! };
    if (isSection(sectionRaw)) params.section = sectionRaw;
    id = (await tenantClient().auditor.enqueueExport({ datasetCode: dataset as AuditorDatasetCode, params }, key)).id;
  } catch (e) { code = e instanceof SdkError ? (e.code || 'export') : 'export'; }
  if (!id) { keep.set('error', code); redirect(`${NEW_EXPORT_HREF}?${keep.toString()}`); }
  revalidatePath(EXPORTS_HREF);
  redirect(exportHref(id!));
}
