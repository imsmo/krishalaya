'use server';
// apps/web-tenant/src/app/ops/logistics/carriers/new/actions.ts · W2378–W2381 "New carrier" — the form chain's one write (PC-56 TENANT-SW-e).
// A rider carrier names a user who holds the delivery-partner role (the database refuses anyone else: RIDER_NOT_DELIVERY_PARTNER); a
// vehicle line is registered in the carrier's own transaction. Keyed by the review page's idempotency key.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { CARRIERS_HREF, carrierInput, carrierRefusals, readCarrierDraft } from '../../../../../features/swe/console';

export async function createCarrierAction(formData: FormData): Promise<void> {
  const base = `${CARRIERS_HREF}/new`;
  await requireSession(base);
  const q: Record<string, string> = {}; formData.forEach((v, k) => { if (typeof v === 'string') q[k] = v; });
  const d = readCarrierDraft(q);
  const carry = new URLSearchParams(Object.entries(d).filter(([k, v]) => v !== '' && k !== 'contactPhone') as Array<[string, string]>);
  if (carrierRefusals(d).length) { carry.set('step', 'review'); redirect(`${base}?${carry.toString()}`); }
  let id = '';
  try { id = (await tenantClient().carriers.create(carrierInput(d), String(q.idempotencyKey || ''))).id; }
  catch (e) { carry.set('step', 'failure'); carry.set('error', e instanceof SdkError ? (e.code || 'unknown') : 'unknown'); redirect(`${base}?${carry.toString()}`); }
  revalidatePath(CARRIERS_HREF);
  redirect(`${base}?step=success&carrierId=${encodeURIComponent(id)}`);
}
