'use server';
// apps/web-tenant/src/app/studio/from-template/actions.ts · the studio form chain's submit — W2777/W2778 · PC-56 TENANT-7d.
// Runs only from the REVIEW step; validates presence alone (6d-4's contract). One transaction on the API writes the draft
// course and every scaffolded lesson, or nothing. SUCCESS carries the new course's id for the audit deep-link and the
// builder; FAILURE keeps the values for the retry.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../features/forms/chain';
import { TEMPLATE_FIELDS, TEMPLATE_FORM_PATH, studioHref } from '../../../features/studio/instructor';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function startFromTemplateAction(formData: FormData): Promise<void> {
  await requireSession(TEMPLATE_FORM_PATH);
  const values: Record<string, string | undefined> = {};
  for (const f of TEMPLATE_FIELDS) values[f] = opt(formData.get(f));
  if (!values.templateCode) redirect(`${TEMPLATE_FORM_PATH}?${carryValues('review', values).query}`);
  let created: { id: string; lessons: number };
  try { created = await tenantClient().courses.createFromTemplate(values, randomUUID()); }
  catch (e) {
    const code = e instanceof SdkError ? (e.code || 'save') : 'save';
    redirect(`${TEMPLATE_FORM_PATH}?${carryValues('failure', values).query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(studioHref()); revalidatePath('/courses');
  redirect(`${TEMPLATE_FORM_PATH}?step=success&created=${encodeURIComponent(created.id)}&lessons=${created.lessons}`);
}
