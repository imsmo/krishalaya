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
import { SdkError } from '@krishalaya/sdk-js';

function back(path: string, qs: string): never { redirect(`${path}?${qs}`); }

// --- PC-26b: instructor self-profile + live-session hosting -----------------------------------------------

export async function upsertInstructorAction(formData: FormData): Promise<void> {
  await requireSession('/studio');
  const bio = String(formData.get('bio') ?? '').trim().slice(0, 2000);
  try { await tenantClient().liveStudio.upsertInstructor({ bio: bio || null }); }
  catch { back('/studio', 'error=instructor'); }
  revalidatePath('/studio');
  back('/studio', 'ok=instructor');
}

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

export async function scheduleLiveAction(formData: FormData): Promise<void> {
  await requireSession('/studio/live');
  const { buildLive } = await import('../../features/studio/quiz');
  const built = buildLive({
    channelId: String(formData.get('channelId') ?? ''),
    title: String(formData.get('title') ?? ''),
    scheduledAtLocal: String(formData.get('scheduledAt') ?? ''),
  });
  if (!built.ok) back('/studio/live', `error=live_${built.error}`);
  try { await tenantClient().liveStudio.schedule(built.value); }
  catch { back('/studio/live', 'error=live'); }
  revalidatePath('/studio/live');
  back('/studio/live', 'ok=live');
}

export async function liveLifecycleAction(formData: FormData): Promise<void> {
  await requireSession('/studio/live');
  const id = String(formData.get('id') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');
  if (!id) redirect('/studio/live');
  try {
    const ls = tenantClient().liveStudio;
    if (kind === 'start') await ls.start(id);
    else if (kind === 'end') await ls.end(id);
    else if (kind === 'cancel') await ls.cancel(id);
    else back('/studio/live', 'error=action');
  } catch (e) {
    back('/studio/live', `error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'action'}`);
  }
  revalidatePath('/studio/live');
  back('/studio/live', `ok=${kind}`);
}
