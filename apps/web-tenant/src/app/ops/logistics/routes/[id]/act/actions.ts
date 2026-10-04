'use server';
// apps/web-tenant/src/app/ops/logistics/routes/[id]/act/actions.ts · W2818–W2820 — a run's acts (confirm by a second person · start
// loading · depart · complete · cancel with a reason) and a drop point's deactivation (reason) · PC-56 TENANT-SW-e. The database is the
// wall for every one (the drafter cannot confirm; a frozen plan cannot change).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import type { RunAct } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { isRouteAct, isUuid, routeHref } from '../../../../../../features/swe/console';

export async function routeActAction(formData: FormData): Promise<void> {
  const routeId = String(formData.get('routeId') ?? '');
  const act = String(formData.get('act') ?? ''); const id = String(formData.get('id') ?? '');
  const reason = String(formData.get('reason') ?? '').trim(); const key = String(formData.get('idempotencyKey') ?? '');
  if (!isUuid(routeId) || !isRouteAct(act) || !isUuid(id)) redirect('/logistics/routes');
  const base = `${routeHref(routeId)}/act`;
  await requireSession(base);
  const carry = new URLSearchParams({ act, id, ...(reason ? { reason } : {}) });
  try {
    if (act === 'deactivate_drop_point') await tenantClient().villageRun.deactivateDropPoint(id, reason, key);
    else await tenantClient().villageRun.act(id, act as RunAct, reason || null, key);
  } catch (e) { carry.set('step', 'failure'); carry.set('error', e instanceof SdkError ? (e.code || 'unknown') : 'unknown'); redirect(`${base}?${carry.toString()}`); }
  revalidatePath(routeHref(routeId));
  carry.set('step', 'success');
  redirect(`${base}?${carry.toString()}`);
}
