'use server';
// apps/web-tenant/src/app/studio/actions.ts · education-studio mutations (PC-26). Server-gated by
// education.author / education.publish + the `education` flag — this console only reflects legality
// (features/studio/manage mirrors the lesson rules); the API re-checks everything. PC-56 TENANT-7a: course create and
// every lifecycle act moved to `/courses/new` and `/courses/[id]/act` — one write path each, with a reason and an audit row.
// PC-56 TENANT-7b: the add-lesson form moved to the lesson chain at `/courses/[id]/lessons/new` (API-reviewed, keyed, audited).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';

function back(path: string, qs: string): never { redirect(`${path}?${qs}`); }

// PC-56 TENANT-7d: `upsertInstructorAction` (a bio, no key, no audit row) is GONE — the profile is the instructor form chain at
// /studio/profile/edit (API-reviewed, keyed, audited; features/studio/instructor.ts).

export async function registerChannelAction(formData: FormData): Promise<void> {
  await requireSession('/studio/live');
  const provider = String(formData.get('provider') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const externalUrl = String(formData.get('externalUrl') ?? '').trim();
  if (!title || title.length > 200) back('/studio/live', 'error=chtitle');
  if (!/^https?:\/\/.+/.test(externalUrl) || externalUrl.length > 500) back('/studio/live', 'error=churl');
  try { await tenantClient().liveStudio.registerChannel({ provider, title, externalUrl }); }
  catch { back('/studio/live', 'error=channel'); }
  revalidatePath('/studio/live');
  back('/studio/live', 'ok=channel');
}
// PC-56 TENANT-7c: `scheduleLiveAction` and `liveLifecycleAction` are GONE — the live class is scheduled and acted on through
// the API-reviewed chains at /live/new and /live/[id]/act (features/live/classes.ts).
