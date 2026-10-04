'use server';
// apps/web-tenant/src/app/insights/wastage/actions.ts · W195 "Export" → W2824 (queued) — PC-56 TENANT-SW-f. Dataset `wastage_events`.
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { WASTAGE_HREF, insightExportHref } from '../../../features/swf/console';

export async function exportWastageAction(): Promise<void> {
  await requireSession(WASTAGE_HREF);
  let id: string;
  try { id = (await tenantClient().insights.exportWastage(randomUUID())).id; }
  catch (e) { redirect(`${WASTAGE_HREF}?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'unknown') : 'unknown')}`); }
  redirect(insightExportHref(id, 'wastage'));
}
