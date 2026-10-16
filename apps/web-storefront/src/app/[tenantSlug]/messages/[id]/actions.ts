'use server';
// apps/web-storefront/src/app/[tenantSlug]/messages/[id]/actions.ts · PC-56 STORE-4b · C2 — post a message in a thread with the organisation.
// AUTHENTICATED; membership is enforced SERVER-SIDE (a non-participant → 404, no IDOR). The Idempotency-Key is the one MINTED WHEN THE THREAD
// RENDERED (`send:<uuid>`, the hidden `key` input — the 3a/4c precedent; survey F-13: a key minted per submit double-posted on a retry), so a
// retry after a timeout posts ONCE. Outcome: ?status=sent, or ?status=senderr&code=<named> (a locked thread names its kind: lock_<kind>).
// (The platform /messages/[id]/actions.ts is deleted: the platform thread is a door.)
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { SLUG_RE, UUID_RE } from '../../../../features/store4b/messages';
import { actKeyOf, sendFailureOf, SEND_KEY_RE, threadHref } from '../../../../features/store4b/thread';

export async function postMessageAction(fd: FormData): Promise<void> {
  const slug = String(fd.get('slug') ?? '');
  const id = String(fd.get('conversationId') ?? '');
  if (!SLUG_RE.test(slug)) redirect('/messages');
  if (!UUID_RE.test(id)) redirect(`/${slug}/messages`);
  await requireSession(threadHref(slug, id));
  const key = actKeyOf(fd.get('key'), SEND_KEY_RE);
  const body = String(fd.get('body') ?? '').trim().slice(0, 4000);
  if (!body) redirect(threadHref(slug, id, { status: 'senderr', code: 'empty' }));
  if (!key) redirect(threadHref(slug, id, { status: 'senderr', code: 'server' }));
  let failure: string | null = null;
  try { await serverClient(slug).conversations.postMessage(id, { body }, key!); }
  catch (e) {
    const err = e instanceof SdkError ? e : null;
    const f = sendFailureOf(err?.code, err?.status);
    const kind = f === 'locked' ? String(err?.details?.lockKind ?? '') : '';
    failure = f === 'locked' && /^(owner|moderator|dispute)$/.test(kind) ? `lock_${kind}` : f;
  }
  revalidatePath(`/${slug}/messages/${id}`);
  redirect(threadHref(slug, id, failure ? { status: 'senderr', code: failure } : { status: 'sent' }));
}
