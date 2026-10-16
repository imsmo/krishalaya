'use server';
// apps/web-storefront/src/app/[tenantSlug]/messages/[id]/report/[messageId]/actions.ts · PC-56 STORE-4b · C3 — the REPORT act (W3109 → W3110 /
// W3111). AUTHENTICATED. A reason from the platform's `report_reason` vocabulary, the Idempotency-Key MINTED WHEN THE CONFIRM RENDERED
// (`report:<uuid>`) — a Retry from the failure page carries the SAME key, so a report that did land is answered, never doubled. Success → the
// thread with ?status=reported (the message now hidden); failure → the confirm again with the failure by name, the key and the reason kept.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../../../../lib/api-client';
import { requireSession } from '../../../../../../lib/session';
import { SLUG_RE, UUID_RE } from '../../../../../../features/store4b/messages';
import { actKeyOf, REASON_RE, REPORT_KEY_RE, reportFailureOf, reportHref, threadHref, type ReportFailure } from '../../../../../../features/store4b/thread';

export async function reportMessageAction(fd: FormData): Promise<void> {
  const slug = String(fd.get('slug') ?? '');
  const id = String(fd.get('conversationId') ?? '');
  const messageId = String(fd.get('messageId') ?? '');
  if (!SLUG_RE.test(slug)) redirect('/messages');
  if (!UUID_RE.test(id) || !UUID_RE.test(messageId)) redirect(`/${slug}/messages`);
  await requireSession(reportHref(slug, id, messageId));
  const key = actKeyOf(fd.get('key'), REPORT_KEY_RE);
  const reason = String(fd.get('reason') ?? '');
  if (!key) redirect(reportHref(slug, id, messageId, { failure: 'server' }));
  if (!REASON_RE.test(reason)) redirect(reportHref(slug, id, messageId, { failure: 'reason', key: key! }));
  let failure: ReportFailure | null = null;
  try { await serverClient(slug).conversations.flagMessage(messageId, { reason }, key!); }
  catch (e) { const err = e instanceof SdkError ? e : null; failure = reportFailureOf(err?.code, err?.status); }
  revalidatePath(`/${slug}/messages/${id}`);
  if (failure) redirect(reportHref(slug, id, messageId, { failure, key: key!, reason }));
  redirect(threadHref(slug, id, { status: 'reported' }));
}
