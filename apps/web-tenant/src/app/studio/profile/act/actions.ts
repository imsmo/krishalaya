'use server';
// apps/web-tenant/src/app/studio/profile/act/actions.ts · the instructor mutate chain's act — W2641/W2642 · PC-56 TENANT-7d.
// Posts the act WITH ITS REASON (and the credential it is about, when it is about one) under a fresh Idempotency-Key; the
// server re-takes the verdict on the locked row. The reason is dropped from the success URL (6d-5's rule: it is in the
// audit row now — and for a rejection it IS the note the instructor reads).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { INSTRUCTOR_ACTS, SdkError } from '@krishalaya/sdk-js';
import type { InstructorAct } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/mutate/chain';
import { PROFILE_ACT_PATH, profileHref, studioHref } from '../../../../features/studio/instructor';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function instructorActAction(formData: FormData): Promise<void> {
  const instructor = opt(formData.get('instructor'));
  const act = String(formData.get('act') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const credentialId = opt(formData.get('credentialId'));
  if (!instructor) redirect(profileHref());
  await requireSession(PROFILE_ACT_PATH);
  const values = { act, reason, credentialId, instructor };
  if (!(INSTRUCTOR_ACTS as readonly string[]).includes(act) || reason.length === 0) redirect(`${PROFILE_ACT_PATH}?${carryValues('confirm', values).query}`);
  try { await tenantClient().instructors.act(instructor as string, act as InstructorAct, { reason, credentialId }, randomUUID()); }
  catch (e) {
    const code = e instanceof SdkError ? (e.code || 'act') : 'act';
    redirect(`${PROFILE_ACT_PATH}?${carryValues('failure', values).query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(profileHref()); revalidatePath(profileHref(instructor)); revalidatePath(studioHref());
  redirect(`${PROFILE_ACT_PATH}?step=success&act=${encodeURIComponent(act)}&instructor=${encodeURIComponent(instructor as string)}${credentialId ? `&credentialId=${encodeURIComponent(credentialId)}` : ''}`);
}
