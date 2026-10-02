'use server';
// apps/web-tenant/src/app/people/ambassadors/[id]/edit/actions.ts · the edit chain's act — PATCH /ambassadors/:id, audited
// before → after (PC-56 TENANT-10a · F-12). An edit is idempotent by nature (it sets values; repeating it changes nothing,
// and a repeat with no change is refused by name as NOTHING_CHANGED).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { AMBASSADORS_HREF, detailHref, failureCodesFrom, formEntries, isUuid, recordFromForm } from '../../../../../features/ambassadors/console';

export async function editAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const base = `${detailHref(id)}/edit`;
  await requireSession(base);
  const values = recordFromForm((k) => formData.get(k));
  const keep = new URLSearchParams(values);
  if (!isUuid(id)) redirect(`${AMBASSADORS_HREF}`);
  const { entries, stipendInvalid } = formEntries(values, false);
  if (stipendInvalid) redirect(`${base}?step=failure&error=STIPEND_INVALID&${keep.toString()}`);
  let failed: string[] | null = null;
  try {
    await tenantClient().ambassadors.update(id, {
      tierId: entries.tierId ? entries.tierId : null, clusterRegionIds: entries.clusterRegionIds ?? [], mentorAmbassadorId: entries.mentorAmbassadorId ? entries.mentorAmbassadorId : null,
      kioskEnabled: entries.kioskEnabled, aepsEnabled: entries.aepsEnabled, monthlyStipendMinor: entries.monthlyStipendMinor,
      ...(entries.trainingCompleted ? { trainingCompleted: true } : {}), ...(values.reason ? { reason: values.reason } : {}),
    });
  } catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.details, e.code) : ['unknown']; }
  if (failed) redirect(`${base}?step=failure&error=${encodeURIComponent(failed.join(','))}&${keep.toString()}`);
  revalidatePath(detailHref(id));
  redirect(`${base}?step=success`);
}
