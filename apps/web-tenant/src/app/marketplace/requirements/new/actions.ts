'use server';
// apps/web-tenant/src/app/marketplace/requirements/new/actions.ts · W2373 / W2374 · post a requirement — PC-56 TENANT-11d.
// The review's rules are re-run here (a hand-crafted POST gets the same refusals) and then by the API inside its own
// transaction (the desk permission, the buyer's membership and recorded consent; REQ number by trigger; audited with ip).
// THE KEY IS THE REVIEW PAGE'S (a double submit posts once). The values ride back to the failure page so its retry is a review.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import type { CreateRequirementInput } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { FORM_KEYS, NEW_REQ_HREF, REQUIREMENTS_HREF, carried, createBody, failureCodesFrom, indiaToday, reqEntries, reviewRequirement } from '../../../../features/requirements/console';

export async function postRequirementAction(formData: FormData): Promise<void> {
  await requireSession(NEW_REQ_HREF);
  const values = carried(FORM_KEYS, (k) => formData.get(k));
  const keep = new URLSearchParams(values);
  const entries = reqEntries(values);
  const refusals = reviewRequirement(entries, indiaToday());
  if (refusals.length > 0) redirect(`${NEW_REQ_HREF}?step=failure&error=${encodeURIComponent([...new Set(refusals.map((r) => r.code))].join(','))}&${keep.toString()}`);
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  let id: string | null = null; let failed: string[] | null = null;
  try { id = (await tenantClient().requirements.create(createBody(entries) as unknown as CreateRequirementInput, key)).id; }
  catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.code, e.status) : ['unknown']; }
  if (failed) redirect(`${NEW_REQ_HREF}?step=failure&error=${encodeURIComponent(failed.join(','))}&${keep.toString()}`);
  revalidatePath(REQUIREMENTS_HREF);
  redirect(`${NEW_REQ_HREF}?step=success&id=${encodeURIComponent(id ?? '')}`);
}
