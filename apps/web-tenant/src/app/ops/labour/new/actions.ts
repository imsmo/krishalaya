'use server';
// apps/web-tenant/src/app/ops/labour/new/actions.ts · W2659 / W2660 · post a job — PC-56 TENANT-11b.
// The review's rules are re-run here (a hand-crafted POST gets the same refusals, the floor re-read from the API) and then by
// the API inside its own transaction (it snapshots the statutory floor, numbers the job, records the employer's consent when
// the desk posts for them, and audits the create). THE KEY IS THE REVIEW PAGE'S (a double submit posts one job). The values
// ride back to the failure page so its retry is a review of what was typed.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import type { CreateBookingInput } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { FORM_KEYS, LABOUR_HREF, NEW_JOB_HREF, carried, createBody, failureCodesFrom, isUuid, isYmd, jobEntries, reviewJob } from '../../../../features/labour/console';

export async function postJobAction(formData: FormData): Promise<void> {
  await requireSession(NEW_JOB_HREF);
  const values = carried(FORM_KEYS, (k) => formData.get(k));
  const keep = new URLSearchParams(values);
  const e = jobEntries(values);
  let floor: string | null | undefined;
  if (isUuid(e.regionId) && e.skillLevel && isYmd(e.startDate)) {
    try { floor = (await tenantClient().labour.floor({ regionId: e.regionId!, skillLevel: e.skillLevel, wageKind: e.wageKind, onDate: e.startDate! })).minWageMinor; } catch { floor = undefined; }
  }
  const refusals = reviewJob(e, floor);
  if (refusals.length > 0) redirect(`${NEW_JOB_HREF}?step=failure&error=${encodeURIComponent([...new Set(refusals.map((r) => r.code))].join(','))}&${keep.toString()}`);
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  let id: string | null = null; let failed: string[] | null = null;
  try { id = (await tenantClient().labour.createBooking(createBody(e) as unknown as CreateBookingInput, key)).id; }
  catch (err) { failed = err instanceof SdkError ? failureCodesFrom(err.code, err.status) : ['unknown']; }
  if (failed) redirect(`${NEW_JOB_HREF}?step=failure&error=${encodeURIComponent(failed.join(','))}&${keep.toString()}`);
  revalidatePath(LABOUR_HREF);
  redirect(`${NEW_JOB_HREF}?step=success&id=${encodeURIComponent(id ?? '')}`);
}
