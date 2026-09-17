'use server';
// apps/web-tenant/src/app/courses/[id]/lessons/new/actions.ts · the lesson form chain's submit — W2666/W2667 · PC-56
// TENANT-7b. Runs only from the REVIEW step, which has already asked the API every question this action could ask, so
// it validates nothing beyond presence (6d-4's contract). The same body goes to the writer, which runs the same review
// and refuses with the same codes if anything changed underneath (a twin paired elsewhere, a lesson marked ready).
// SUCCESS lands on the chain's success state WITH THE ID, for the audit deep-link; FAILURE keeps the values for the retry.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../../features/forms/chain';
import { MAX_CARRIED_LENGTH_LESSON, formMode, formOf, lessonFormPath, lessonHref, outlineHref } from '../../../../../features/courses/lessons';
import { courseHref } from '../../../../../features/courses/desk';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function saveLessonFromChainAction(formData: FormData): Promise<void> {
  const courseId = String(formData.get('courseId') ?? '').trim();
  if (!courseId) redirect('/courses');
  const PATH = lessonFormPath(courseId);
  await requireSession(PATH);
  const lesson = opt(formData.get('lesson'));
  const mode = formMode(opt(formData.get('mode')));
  const { fields } = formOf(mode);
  const values: Record<string, string | undefined> = {};
  for (const f of fields) values[f] = opt(formData.get(f));
  const carried = { ...values, lesson, mode: mode === 'subtitle' ? 'subtitle' : undefined };
  // The only checks: the things without which there is nothing to write. Everything else the review answered.
  if (mode === 'subtitle' ? !(lesson && values.languageCode && values.body) : !values.defaultTitle) redirect(`${PATH}?${carryValues('review', carried, MAX_CARRIED_LENGTH_LESSON).query}`);

  let savedId: string;
  try {
    const c = tenantClient().courses;
    if (mode === 'subtitle') {
      await c.saveSubtitle(courseId, lesson as string, { languageCode: values.languageCode, body: values.body, reviewed: values.reviewed }, randomUUID());
      savedId = lesson as string;
    } else {
      const body = Object.fromEntries(fields.map((f) => [f, values[f]]));
      savedId = lesson ? (await c.updateLesson(courseId, lesson, body, randomUUID())).id : (await c.createLesson(courseId, body, randomUUID())).id;
    }
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'save') : 'save';
    redirect(`${PATH}?${carryValues('failure', carried, MAX_CARRIED_LENGTH_LESSON).query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(outlineHref(courseId)); revalidatePath(courseHref(courseId)); revalidatePath(lessonHref(courseId, savedId));
  redirect(`${PATH}?step=success&created=${encodeURIComponent(savedId)}${lesson ? `&lesson=${encodeURIComponent(lesson)}` : ''}${mode === 'subtitle' ? '&mode=subtitle' : ''}`);
}
