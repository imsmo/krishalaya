'use server';
// apps/web-tenant/src/app/insights/demand-map/actions.ts · W194 "Export" → W2569 (queued) — PC-56 TENANT-SW-f. Dataset `demand_map` on
// the 6e-2 plane, with the reach filter the screen shows.
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { DEMAND_HREF, insightExportHref } from '../../../features/swf/console';

export async function exportDemandAction(formData: FormData): Promise<void> {
  await requireSession(DEMAND_HREF);
  const reach = formData.get('reach') === 'districts' ? 'districts' : 'all';
  let id: string;
  try { id = (await tenantClient().insights.exportDemandMap(reach, randomUUID())).id; }
  catch (e) { redirect(`${DEMAND_HREF}?reach=${reach}&error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'unknown') : 'unknown')}`); }
  redirect(insightExportHref(id, 'demand'));
}
