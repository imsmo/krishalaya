'use server';
// apps/web-tenant/src/app/notifications/read-all/actions.ts · W204's *Mark all read* — the notifications MUTATE chain's
// act, W2691 / W2692 · PC-56 TENANT-8b. One API act under the confirm page's key (F-17): one statement server-side, one
// audit row carrying the count (W431's receipt, *"notifications_marked_read: 2 · actor"*).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { CENTER_HREF, INBOX_HREF, READ_ALL_HREF } from '../../../features/notifications/inbox';

export async function markAllReadAction(formData: FormData): Promise<void> {
  await requireSession(READ_ALL_HREF);
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  let failedCode: string | null = null; let marked = 0;
  try { marked = (await tenantClient().notifications.markAllRead(key)).marked; }
  catch (e) { failedCode = e instanceof SdkError ? (e.code || 'act') : 'act'; }
  if (failedCode) redirect(`${READ_ALL_HREF}?step=failure&error=${encodeURIComponent(failedCode)}`);
  revalidatePath(INBOX_HREF); revalidatePath(CENTER_HREF);
  redirect(`${READ_ALL_HREF}?step=success&marked=${marked}`);
}
