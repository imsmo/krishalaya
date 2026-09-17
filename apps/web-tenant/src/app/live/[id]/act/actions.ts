'use server';
// apps/web-tenant/src/app/live/[id]/act/actions.ts · the live mutate chain's act — W2676/W2677 · PC-56 TENANT-7c. Posts
// the act WITH ITS REASON (and the attendance count or the recording's media id when the act asks for one) under a fresh
// Idempotency-Key; the server re-takes the verdict on the locked row. The reason is dropped from the success URL (6d-5's
// rule: it is in the audit row now).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { LIVE_ACTS, SdkError } from '@krishalaya/sdk-js';
import type { LiveAct } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/mutate/chain';
import { liveActPath, liveClassHref, liveHref } from '../../../../features/live/classes';

const opt = (v: FormDataEntryValue | null) => { const s = String(v ?? '').trim(); return s.length ? s : undefined; };

export async function liveActAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  const act = String(formData.get('act') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const count = opt(formData.get('count')); const mediaId = opt(formData.get('mediaId'));
  if (!id) redirect(liveHref());
  const path = liveActPath(id);
  await requireSession(path);
  const values = { act, reason, count, mediaId };
  if (!(LIVE_ACTS as readonly string[]).includes(act) || reason.length === 0) redirect(`${path}?${carryValues('confirm', values).query}`);
  let lessonId: string | null = null;
  try {
    const out = await tenantClient().liveClasses.act(id, act as LiveAct, { reason, count, mediaId }, randomUUID());
    lessonId = out.recordingLessonId ?? null;
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'act') : 'act';
    redirect(`${path}?${carryValues('failure', values).query}&error=${encodeURIComponent(code)}`);
  }
  revalidatePath(liveClassHref(id)); revalidatePath(liveHref());
  redirect(`${path}?step=success&act=${encodeURIComponent(act)}${act === 'to_lesson' && lessonId ? `&lesson=${encodeURIComponent(lessonId)}` : ''}`);
}
