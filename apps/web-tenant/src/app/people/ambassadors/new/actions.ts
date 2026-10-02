'use server';
// apps/web-tenant/src/app/people/ambassadors/new/actions.ts · W2483 / W2484 · recruit — PC-56 TENANT-10a.
// The API re-runs the review's rules inside its own transaction; a refusal comes back as AMBASSADOR_REFUSED with every code.
// THE KEY IS THE REVIEW PAGE'S (a double submit writes one ambassador). The values ride back to the failure page so its
// retry is a review of what was typed.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { AMBASSADORS_HREF, NEW_AMBASSADOR_HREF, failureCodesFrom, formEntries, recordFromForm } from '../../../../features/ambassadors/console';

export async function recruitAction(formData: FormData): Promise<void> {
  await requireSession(NEW_AMBASSADOR_HREF);
  const values = recordFromForm((k) => formData.get(k));
  const { entries, stipendInvalid } = formEntries(values, true);
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  const keep = new URLSearchParams(values);
  if (stipendInvalid || !entries.phone) redirect(`${NEW_AMBASSADOR_HREF}?step=failure&error=${stipendInvalid ? 'STIPEND_INVALID' : 'PHONE_REQUIRED'}&${keep.toString()}`);
  let id: string | null = null; let failed: string[] | null = null;
  try {
    id = (await tenantClient().ambassadors.enroll({
      phone: entries.phone, tierId: entries.tierId || null, clusterRegionIds: entries.clusterRegionIds ?? [], mentorAmbassadorId: entries.mentorAmbassadorId || null,
      kioskEnabled: !!entries.kioskEnabled, aepsEnabled: !!entries.aepsEnabled, monthlyStipendMinor: entries.monthlyStipendMinor ?? '0',
    }, key)).id;
  } catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.details, e.code) : ['unknown']; }
  if (failed) redirect(`${NEW_AMBASSADOR_HREF}?step=failure&error=${encodeURIComponent(failed.join(','))}&${keep.toString()}`);
  revalidatePath(AMBASSADORS_HREF);
  redirect(`${NEW_AMBASSADOR_HREF}?step=success&id=${encodeURIComponent(id ?? '')}`);
}
