'use server';
// apps/web-tenant/src/app/ops/logistics/routes/[id]/plan/actions.ts · W2814–W2817 "Draft loading plan" — the one write (PC-56
// TENANT-SW-e): a DRAFT run. A second person confirms it (the database refuses the drafter: RUN_CHECKER_IS_DRAFTER).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { isUuid, planCarry, readPlanDraft, routeHref } from '../../../../../../features/swe/console';

export async function draftRunAction(formData: FormData): Promise<void> {
  const routeId = String(formData.get('routeId') ?? '');
  if (!isUuid(routeId)) redirect('/logistics/routes');
  const base = `${routeHref(routeId)}/plan`;
  await requireSession(base);
  const q: Record<string, string> = {}; formData.forEach((v, k) => { if (typeof v === 'string') q[k] = v; });
  const d = readPlanDraft(q);
  const carry = new URLSearchParams(planCarry(d));
  let id = '';
  try {
    id = (await tenantClient().villageRun.draft(routeId, { runDate: d.runDate, plan: d.assignments, partnerId: d.partnerId || null, reason: d.reason }, String(q.idempotencyKey || ''))).id;
  } catch (e) { carry.set('step', 'failure'); carry.set('error', e instanceof SdkError ? (e.code || 'unknown') : 'unknown'); redirect(`${base}?${carry.toString()}`); }
  revalidatePath(routeHref(routeId));
  redirect(`${base}?step=success&runId=${encodeURIComponent(id)}`);
}
