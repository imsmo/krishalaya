'use server';
// apps/web-tenant/src/app/courses/[id]/lessons/[lessonId]/quiz/actions.ts · the quiz form chain's submit — W2729/W2730 ·
// PC-56 TENANT-7b. From the REVIEW step only; the API's review already answered every question, so this posts the same
// body under a fresh Idempotency-Key and lands on success (with the question number) or failure (with the values).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../../../lib/api-client';
import { requireSession } from '../../../../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../../../features/forms/chain';
import { MAX_CARRIED_LENGTH_LESSON, QUESTION_FORM_FIELDS, lessonHref, outlineHref, quizFormPath } from '../../../../../../features/courses/lessons';
import { courseHref, publishHref } from '../../../../../../features/courses/desk';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function saveQuestionFromChainAction(formData: FormData): Promise<void> {
  const courseId = String(formData.get('courseId') ?? '').trim();
  const lessonId = String(formData.get('lessonId') ?? '').trim();
  if (!courseId || !lessonId) redirect('/courses');
  const PATH = quizFormPath(courseId, lessonId);
  await requireSession(PATH);
  const nRaw = opt(formData.get('n'));
  const n = /^\d{1,3}$/.test(nRaw ?? '') ? Number(nRaw) : 1;
  const values: Record<string, string | undefined> = {};
  for (const f of QUESTION_FORM_FIELDS) values[f] = opt(formData.get(f));
  const carried = { ...values, n: String(n) };
  if (!values.q) redirect(`${PATH}?${carryValues('review', carried, MAX_CARRIED_LENGTH_LESSON).query}`);
  try {
    await tenantClient().courses.saveQuestion(courseId, lessonId, n, values, randomUUID());
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'save') : 'save';
    redirect(`${PATH}?${carryValues('failure', carried, MAX_CARRIED_LENGTH_LESSON).query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(lessonHref(courseId, lessonId)); revalidatePath(outlineHref(courseId)); revalidatePath(courseHref(courseId)); revalidatePath(publishHref(courseId));
  redirect(`${PATH}?step=success&n=${n}`);
}
