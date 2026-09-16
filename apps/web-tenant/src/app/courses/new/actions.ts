'use server';
// apps/web-tenant/src/app/courses/new/actions.ts · the course form chain's submit — W2548/W2549 · PC-56 TENANT-7a.
//
// Runs only from the REVIEW step, and the review has already asked the API every question this action could ask — so
// it validates nothing beyond presence (6d-4's contract). The same body the review saw goes to the writer, which runs
// the same review function and refuses with the same codes if anything changed underneath (a topic retired, a cover
// deleted) between the review and the click.
//
// SUCCESS lands on the chain's success state WITH THE ID, so the screen deep-links to that record's audit trail.
// FAILURE lands on the failure state with the values intact, so the retry is a review of what was typed.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../features/forms/chain';
import { COURSES_HREF, COURSE_FORM_FIELDS, NEW_COURSE_HREF, courseHref } from '../../../features/courses/desk';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function saveCourseFromChainAction(formData: FormData): Promise<void> {
  await requireSession(NEW_COURSE_HREF);
  const id = opt(formData.get('id'));
  const values: Record<string, string | undefined> = {};
  for (const f of COURSE_FORM_FIELDS) values[f] = opt(formData.get(f));
  const carried = { ...values, id };
  // The only check: the one field without which there is nothing to create. Everything else the review answered.
  if (!values.defaultTitle) redirect(`${NEW_COURSE_HREF}?${carryValues('review', carried).query}`);

  const body = { defaultTitle: values.defaultTitle, topicCode: values.topicCode, level: values.level, priceMajor: values.priceMajor, certEnabled: values.certEnabled, coverMediaId: values.coverMediaId };
  let savedId: string;
  try {
    const c = tenantClient().courses;
    savedId = id ? (await c.update(id, body, randomUUID())).id : (await c.create(body, randomUUID())).id;
  } catch (e) {
    // A refused form (`COURSE_FORM_REFUSED`) carries its codes; a transport failure carries its own. Both are honest
    // failures — W2549's *"state is untouched (all-or-nothing)"* is true of each.
    const code = e instanceof SdkError ? (e.code || 'save') : 'save';
    redirect(`${NEW_COURSE_HREF}?${carryValues('failure', carried).query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(COURSES_HREF); revalidatePath(courseHref(savedId));
  redirect(`${NEW_COURSE_HREF}?step=success&created=${encodeURIComponent(savedId)}${id ? `&id=${encodeURIComponent(id)}` : ''}`);
}
