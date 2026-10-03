'use server';
// apps/web-tenant/src/app/twin/scenarios/[id]/assumptions/actions.ts · W2802 / W2803 · save a scenario's assumptions — PC-56 TENANT-12.
// Runs only from the REVIEW step; the API re-takes the review on the locked scenario (a value without its citation + as-of is refused
// by name and nothing is written). The Idempotency-Key is the review page's. Every change lands in the history by the database's trigger.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { carryValues } from '../../../../../features/forms/chain';
import {
  KEY_CODES, MAX_CARRIED_ASSUMPTIONS, SCENARIOS_HREF, assumptionCarry, assumptionInput, assumptionValues, assumptionsBase, failureCodesFrom, isUuid, scenarioHref,
} from '../../../../../features/twin/twin';

export async function saveAssumptionsAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  if (!isUuid(id)) redirect(SCENARIOS_HREF);
  const base = assumptionsBase(id);
  await requireSession(base);
  const key = /^[A-Za-z0-9-]{8,80}$/.test(String(formData.get('idempotencyKey') ?? '')) ? String(formData.get('idempotencyKey')) : randomUUID();
  const keys = String(formData.get('keys') ?? '').split(',').filter((k) => (KEY_CODES as readonly string[]).includes(k));
  const sp: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === 'string') sp[k] = v;
  const values = assumptionValues(sp, keys);
  let status: string | null = null; let failed: string[] | null = null;
  try { status = (await tenantClient().twin.saveAssumptions(id, assumptionInput(values), key)).status; }
  catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.code, e.status, e.details) : ['unknown']; }
  if (failed || !status) redirect(`${base}?${carryValues('failure', assumptionCarry(values), MAX_CARRIED_ASSUMPTIONS).query}&error=${encodeURIComponent((failed ?? ['unknown']).join(','))}`);
  revalidatePath(SCENARIOS_HREF); revalidatePath(scenarioHref(id));
  redirect(`${base}?step=success&status=${encodeURIComponent(status!)}`);
}
