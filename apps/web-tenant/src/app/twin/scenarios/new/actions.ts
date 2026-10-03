'use server';
// apps/web-tenant/src/app/twin/scenarios/new/actions.ts · W2802 / W2803 · create a scenario from a template — PC-56 TENANT-12.
// Runs only from the REVIEW step; the API re-takes the review (TWIN_REFUSED, every code by name). The Idempotency-Key is the
// review page's. Success carries only the new id (the scenario and its audit row hold the rest).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { carryValues } from '../../../../features/forms/chain';
import { NEW_SCENARIO_HREF, SCENARIOS_HREF, TEMPLATE_CODES, failureCodesFrom, isUuid } from '../../../../features/twin/twin';

export async function createScenarioAction(formData: FormData): Promise<void> {
  await requireSession(NEW_SCENARIO_HREF);
  const s = (k: string) => String(formData.get(k) ?? '').trim();
  const key = /^[A-Za-z0-9-]{8,80}$/.test(s('idempotencyKey')) ? s('idempotencyKey') : randomUUID();
  const name = s('name').slice(0, 200);
  const templateCode = (TEMPLATE_CODES as readonly string[]).includes(s('templateCode')) ? s('templateCode') : '';
  const productId = isUuid(s('productId')) ? s('productId') : '';
  let id: string | null = null; let failed: string[] | null = null;
  try { id = (await tenantClient().twin.createScenario({ name, templateCode: templateCode || null, productId: productId || null }, key)).id; }
  catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.code, e.status, e.details) : ['unknown']; }
  if (failed || !id) redirect(`${NEW_SCENARIO_HREF}?${carryValues('failure', { name, templateCode, productId }).query}&error=${encodeURIComponent((failed ?? ['unknown']).join(','))}`);
  revalidatePath(SCENARIOS_HREF);
  redirect(`${NEW_SCENARIO_HREF}?step=success&saved=${encodeURIComponent(id!)}`);
}
