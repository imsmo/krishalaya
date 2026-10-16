'use server';
// apps/web-storefront/src/app/(platform)/messages/[id]/actions.ts · post a chat message. AUTHENTICATED. Conversation membership is
// enforced SERVER-SIDE (a non-participant gets 404 — no IDOR). The POST carries an Idempotency-Key (Law 3). revalidate the thread so the new
// message shows on return.
// PC-56 HOTFIX-6 · C2 (founder D2): the masked-call action is GONE — "Call" is refused by name on the page, and no person id is ever posted
// from this storefront (the API now takes a conversation id only and resolves the callee itself).
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

