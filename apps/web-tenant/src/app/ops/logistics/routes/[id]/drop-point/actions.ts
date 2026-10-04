'use server';
// apps/web-tenant/src/app/ops/logistics/routes/[id]/drop-point/actions.ts · "Add drop point" — the one write (PC-56 TENANT-SW-e). The
// keeper must hold the ambassador role with an active profile, and the village must be on the route (the database refuses otherwise).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { isUuid, routeHref } from '../../../../../../features/swe/console';
import { dropPointRefusals, readDropPointDraft } from '../../../../../../features/swe/drop-point';

export async function addDropPointAction(formData: FormData): Promise<void> {
  const routeId = String(formData.get('routeId') ?? '');
  if (!isUuid(routeId)) redirect('/logistics/routes');
  const base = `${routeHref(routeId)}/drop-point`;
  await requireSession(base);
  const q: Record<string, string> = {}; formData.forEach((v, k) => { if (typeof v === 'string') q[k] = v; });
  const d = readDropPointDraft(q);
  const carry = new URLSearchParams(Object.entries(d).filter(([, v]) => v !== '') as Array<[string, string]>);
  if (dropPointRefusals(d, []).length) { carry.set('step', 'review'); redirect(`${base}?${carry.toString()}`); }
  let id = '';
  try {
    id = (await tenantClient().villageRun.addDropPoint(routeId, { sequence: Number(d.sequence), regionId: d.regionId, name: d.name, ambassadorUserId: d.ambassadorUserId,
      windowStart: d.windowStart || null, windowEnd: d.windowEnd || null }, String(q.idempotencyKey || ''))).id;
  } catch (e) { carry.set('step', 'failure'); carry.set('error', e instanceof SdkError ? (e.code || 'unknown') : 'unknown'); redirect(`${base}?${carry.toString()}`); }
  revalidatePath(routeHref(routeId));
  redirect(`${base}?step=success&dropPointId=${encodeURIComponent(id)}`);
}
