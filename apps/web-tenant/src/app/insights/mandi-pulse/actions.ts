'use server';
// apps/web-tenant/src/app/insights/mandi-pulse/actions.ts · W193 "Export" → W2678 (queued) — PC-56 TENANT-SW-f. The 6e-2 plane: the API
// queues dataset `mandi_pulse_member_crops` (idempotent per click), the console goes to the shared receipt page.
import { redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { MANDI_HREF, insightExportHref } from '../../../features/swf/console';

export async function exportMandiAction(): Promise<void> {
  await requireSession(MANDI_HREF);
  let id: string;
  try { id = (await tenantClient().insights.exportMemberPulse(randomUUID())).id; }
  catch (e) { redirect(`${MANDI_HREF}?error=${encodeURIComponent(e instanceof SdkError ? (e.code || 'unknown') : 'unknown')}`); }
  redirect(insightExportHref(id, 'mandi'));
}
