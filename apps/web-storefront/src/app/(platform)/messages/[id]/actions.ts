'use server';
// apps/web-storefront/src/app/(platform)/messages/[id]/actions.ts · post a chat message + initiate a masked (privacy-proxy)
// call. AUTHENTICATED. Conversation membership is enforced SERVER-SIDE (a non-participant gets 404 — no IDOR).
// Both POSTs carry an Idempotency-Key (Law 3). The masked call bridges the two real numbers on the server — NO
// phone number is ever sent to or shown in the client; we only pass the counterpart's USER id. revalidate the
// thread so the new message/state shows on return.
import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { serverClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';

function threadPath(id: string): string { return `/messages/${encodeURIComponent(id)}`; }

export async function postMessageAction(formData: FormData): Promise<void> {
  const conversationId = String(formData.get('conversationId') ?? '');
  if (!conversationId) redirect('/messages');
  await requireSession(threadPath(conversationId));
  const body = String(formData.get('body') ?? '').trim().slice(0, 4000);
  if (body) {
    try { await serverClient().conversations.postMessage(conversationId, { body }, randomUUID()); }
    catch { redirect(`${threadPath(conversationId)}?status=senderr`); }
  }
  revalidatePath(threadPath(conversationId));
  redirect(threadPath(conversationId));
}

export async function initiateCallAction(formData: FormData): Promise<void> {
  const conversationId = String(formData.get('conversationId') ?? '');
  const calleeUserId = String(formData.get('calleeUserId') ?? '');
  const contextType = String(formData.get('contextType') ?? '') || undefined;
  const contextId = String(formData.get('contextId') ?? '') || undefined;
  if (!conversationId || !calleeUserId) redirect('/messages');
  await requireSession(threadPath(conversationId));
  try { await serverClient().maskedCalls.initiate({ calleeUserId, contextType, contextId }, randomUUID()); }
  catch { redirect(`${threadPath(conversationId)}?status=callerr`); }
  redirect(`${threadPath(conversationId)}?status=calling`);
}
