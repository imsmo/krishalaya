'use server';
// apps/web-tenant/src/app/studio/profile/edit/actions.ts · the instructor form chain's submit — W2638/W2639 · PC-56 TENANT-7d.
// Runs only from the REVIEW step, which has already asked the API every question this action could ask, so it validates
// nothing beyond presence (6d-4's contract). The same body goes to the writer, which runs the same review and refuses with
// the same codes if anything changed underneath. SUCCESS lands on the chain's success state WITH THE INSTRUCTOR'S ID, for
// the audit deep-link; FAILURE keeps the values for the retry. The bio is never put in a success URL.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/forms/chain';
import { CREDENTIAL_FIELDS, MAX_CARRIED_LENGTH_PROFILE, PROFILE_FIELDS, PROFILE_FORM_PATH, instructorForm, profileHref, studioHref } from '../../../../features/studio/instructor';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function saveInstructorFormAction(formData: FormData): Promise<void> {
  await requireSession(PROFILE_FORM_PATH);
  const form = instructorForm(opt(formData.get('form')));
  const credentialId = form === 'credential' ? opt(formData.get('credential')) : undefined;
  const FIELDS: readonly string[] = form === 'profile' ? PROFILE_FIELDS : CREDENTIAL_FIELDS;
  const values: Record<string, string | undefined> = {};
  for (const f of FIELDS) values[f] = opt(formData.get(f));
  const carried = { ...values, form, credential: credentialId };
  const back = (step: string, extra = '') => redirect(`${PROFILE_FORM_PATH}?${carryValues(step, carried, MAX_CARRIED_LENGTH_PROFILE).query}${extra}`);
  // The only checks: the things without which there is nothing to write. Everything else the review answered.
  if (form === 'profile' ? !values.bio : (!values.title || !values.documentMediaId)) back('review');
  let savedId: string;
  try {
    const c = tenantClient().instructors;
    if (form === 'profile') savedId = (await c.saveProfile(values, randomUUID())).id;
    else {
      const cred = credentialId ? await c.refileCredential(credentialId, values, randomUUID()) : await c.fileCredential(values, randomUUID());
      savedId = cred.instructorId;
    }
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'save') : 'save';
    back('failure', `&error=${encodeURIComponent(code)}`);
    return;
  }
  revalidatePath(profileHref()); revalidatePath(studioHref());
  redirect(`${PROFILE_FORM_PATH}?step=success&form=${form}${credentialId ? `&credential=${encodeURIComponent(credentialId)}` : ''}&saved=${encodeURIComponent(savedId)}`);
}
