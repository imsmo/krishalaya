'use server';
// apps/web-tenant/src/app/inbox/[id]/actions.ts · reply in a conversation (PC-28b). Party membership asserted
// server-side; Idempotency-Key so a double-submit can't post twice; a locked conversation degrades to a message.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';

export async function replyAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/inbox');
  await requireSession(`/inbox/${id}`);
  const body = String(formData.get('body') ?? '').trim();
  if (!body || body.length > 4000) redirect(`/inbox/${encodeURIComponent(id)}?error=empty`);
  try {
    await tenantClient().conversations.postMessage(id, { body }, randomUUID());
  } catch (e) {
    const locked = e instanceof SdkError && e.status === 409;
    redirect(`/inbox/${encodeURIComponent(id)}?error=${locked ? 'locked' : 'reply'}`);
  }
  revalidatePath(`/inbox/${id}`);
  redirect(`/inbox/${encodeURIComponent(id)}?ok=sent`);
}
