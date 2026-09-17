'use server';
// apps/web-tenant/src/app/courses/[id]/lessons/[lessonId]/act/actions.ts · the lesson mutate chain's act — W2669/W2670 ·
// PC-56 TENANT-7b. Posts the act WITH ITS REASON under a fresh Idempotency-Key; the server re-takes the verdict on the
// locked row. The reason is dropped from the success URL (6d-5's rule: it is in the audit row now).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../../../lib/api-client';
import { requireSession } from '../../../../../../lib/session';
import { LESSON_ACTS, SdkError } from '@krishalaya/sdk-js';
import type { LessonAct } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../../../features/mutate/chain';
import { lessonActPath, lessonHref, outlineHref } from '../../../../../../features/courses/lessons';
import { courseHref, publishHref } from '../../../../../../features/courses/desk';

export async function lessonActAction(formData: FormData): Promise<void> {
  const courseId = String(formData.get('courseId') ?? '').trim();
  const lessonId = String(formData.get('lessonId') ?? '').trim();
  const act = String(formData.get('act') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (!courseId || !lessonId) redirect('/courses');
  const path = lessonActPath(courseId, lessonId);
  await requireSession(path);
  const values = { act, reason };
  if (!(LESSON_ACTS as readonly string[]).includes(act) || reason.length === 0) redirect(`${path}?${carryValues('confirm', values).query}`);
  try {
    await tenantClient().courses.lessonAct(courseId, lessonId, act as LessonAct, reason, randomUUID());
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'act') : 'act';
    redirect(`${path}?${carryValues('failure', values).query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(outlineHref(courseId)); revalidatePath(lessonHref(courseId, lessonId)); revalidatePath(courseHref(courseId)); revalidatePath(publishHref(courseId));
  redirect(`${path}?step=success&act=${encodeURIComponent(act)}`);
}
