'use server';
// apps/web-tenant/src/app/studio/actions.ts · education-studio mutations (PC-26). Server-gated by
// education.author / education.publish + the `education` flag — this console only reflects legality
// (features/studio/manage mirrors the state machine); the API re-checks everything. 409 → illegal message.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildCourse, buildLesson } from '../../features/studio/manage';
import { SdkError } from '@krishalaya/sdk-js';

function back(path: string, qs: string): never { redirect(`${path}?${qs}`); }

export async function createCourseAction(formData: FormData): Promise<void> {
  await requireSession('/studio');
  const built = buildCourse({
    title: String(formData.get('title') ?? ''),
    level: String(formData.get('level') ?? ''),
    priceMajor: String(formData.get('priceMajor') ?? ''),
    certEnabled: formData.get('certEnabled') === '1',
    coverMediaId: String(formData.get('coverMediaId') ?? '') || undefined,
  });
  if (!built.ok) back('/studio', `error=${built.error}`);
  let id = '';
  try { id = (await tenantClient().courses.create(built.value)).id; }
  catch { back('/studio', 'error=create'); }
  revalidatePath('/studio');
  redirect(`/studio/${encodeURIComponent(id)}?ok=created`);
}

export async function courseLifecycleAction(formData: FormData): Promise<void> {
  await requireSession('/studio');
  const id = String(formData.get('id') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');
  if (!id) redirect('/studio');
  const path = `/studio/${encodeURIComponent(id)}`;
  try {
    const c = tenantClient().courses;
    if (kind === 'submit') await c.submit(id);
    else if (kind === 'publish' || kind === 'resume') await c.publish(id);
    else if (kind === 'pause') await c.pause(id);
    else if (kind === 'archive') await c.archive(id);
    else back(path, 'error=action');
  } catch (e) {
    back(path, `error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'action'}`);
  }
  revalidatePath(path); revalidatePath('/studio');
  back(path, `ok=${kind}`);
}

export async function addLessonAction(formData: FormData): Promise<void> {
  await requireSession('/studio');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/studio');
  const path = `/studio/${encodeURIComponent(id)}`;
  const built = buildLesson({
    moduleNo: String(formData.get('moduleNo') ?? ''),
    lessonNo: String(formData.get('lessonNo') ?? ''),
    title: String(formData.get('title') ?? ''),
    contentKind: String(formData.get('contentKind') ?? ''),
    mediaId: String(formData.get('lessonMediaId') ?? ''),
    body: String(formData.get('body') ?? ''),
  });
  if (!built.ok) back(path, `error=${built.error}`);
  try { await tenantClient().courses.addLesson(id, built.value); }
  catch (e) { back(path, `error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'lesson'}`); }
  revalidatePath(path);
  back(path, 'ok=lesson');
}
