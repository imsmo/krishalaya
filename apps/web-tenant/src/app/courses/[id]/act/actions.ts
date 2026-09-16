'use server';
// apps/web-tenant/src/app/courses/[id]/act/actions.ts · the course mutate chain's act — W2551/W2552 · PC-56 TENANT-7a.
//
// The confirm step asked the API for the verdict and showed the reason box; this posts the act WITH ITS REASON under a
// fresh Idempotency-Key. The server re-takes the verdict on the locked row — a confirm screen is not a token.
// The REASON is dropped from the success URL: it is in the audit row now, and a URL that carries somebody's stated
// reason around after the act leaks it into browser history and proxy logs (6d-5's rule).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { COURSE_ACTS, SdkError } from '@krishalaya/sdk-js';
import type { CourseAct } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/mutate/chain';
import { COURSES_HREF, courseHref, publishHref } from '../../../../features/courses/desk';

export async function courseActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  const act = String(formData.get('act') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const path = `/courses/${encodeURIComponent(id)}/act`;
  await requireSession(path);
  if (!id) redirect(COURSES_HREF);
  const values = { act, reason };
  // The only check: the things without which there is no act. The verdict is the server's.
  if (!(COURSE_ACTS as readonly string[]).includes(act) || reason.length === 0) {
    redirect(`${path}?${carryValues('confirm', values).query}`);
  }
  try {
    await tenantClient().courses.act(id, act as CourseAct, reason, randomUUID());
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'act') : 'act';
    redirect(`${path}?${carryValues('failure', values).query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(COURSES_HREF); revalidatePath(courseHref(id)); revalidatePath(publishHref(id));
  redirect(`${path}?step=success&act=${encodeURIComponent(act)}`);
}
