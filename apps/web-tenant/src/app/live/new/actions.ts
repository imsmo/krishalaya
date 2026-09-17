'use server';
// apps/web-tenant/src/app/live/new/actions.ts · the live form chain's submit — W2673/W2674 · PC-56 TENANT-7c. Runs only
// from the REVIEW step, which has already asked the API every question this action could ask, so it validates nothing
// beyond presence (6d-4's contract). The same body goes to the writer, which runs the same review and refuses with the
// same codes if anything changed underneath (another class of the host's moved onto the hour, the class was cancelled).
// SUCCESS lands on the chain's success state WITH THE ID, for the audit deep-link; FAILURE keeps the values for the retry.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../features/forms/chain';
import { LIVE_FIELDS, LIVE_FORM_PATH, liveClassHref, liveHref } from '../../../features/live/classes';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function saveLiveClassAction(formData: FormData): Promise<void> {
  await requireSession(LIVE_FORM_PATH);
  const classId = opt(formData.get('class'));
  const values: Record<string, string | undefined> = {};
  for (const f of LIVE_FIELDS) values[f] = opt(formData.get(f));
  const carried = { ...values, class: classId };
  // The only checks: the things without which there is nothing to write. Everything else the review answered.
  if (!values.title || !values.date || !values.time || (!classId && !values.courseId)) redirect(`${LIVE_FORM_PATH}?${carryValues('review', carried).query}`);
  let savedId: string;
  try {
    const body = Object.fromEntries(LIVE_FIELDS.map((f) => [f, values[f]]));
    const c = tenantClient().liveClasses;
    savedId = classId ? (await c.update(classId, body, randomUUID())).id : (await c.create(body, randomUUID())).id;
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'save') : 'save';
    redirect(`${LIVE_FORM_PATH}?${carryValues('failure', carried).query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(liveHref()); revalidatePath(liveClassHref(savedId));
  redirect(`${LIVE_FORM_PATH}?step=success&created=${encodeURIComponent(savedId)}${classId ? `&class=${encodeURIComponent(classId)}` : ''}`);
}
