'use server';
// apps/web-storefront/src/app/[tenantSlug]/messages/actions.ts · PC-56 STORE-4b · C4 — "Message the organisation" (founder D1): from an order
// (`contextType: 'order'`), an offer's listing or a listing (`contextType: 'listing'`). AUTHENTICATED. The key MINTED WHEN THE BUTTON RENDERED
// (`openorg:<uuid>`), so a double tap opens one thread; the server validates the context in THIS store and resolves who answers. Success → the
// thread; a failure → the messages list with the failure by name (context not found · nobody to answer · switched off · server).
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { messagesHref, OPEN_CONTEXTS, OPEN_KEY_RE, openFailureOf, SLUG_RE, UUID_RE, type OpenContext } from '../../../features/store4b/messages';
import { actKeyOf, threadHref } from '../../../features/store4b/thread';

export async function openOrganisationThreadAction(fd: FormData): Promise<void> {
  const slug = String(fd.get('slug') ?? '');
  if (!SLUG_RE.test(slug)) redirect('/messages');
  const contextType = String(fd.get('contextType') ?? '');
  const contextId = String(fd.get('contextId') ?? '');
  await requireSession(messagesHref(slug));
  const key = actKeyOf(fd.get('key'), OPEN_KEY_RE);
  if (!(OPEN_CONTEXTS as readonly string[]).includes(contextType) || !UUID_RE.test(contextId) || !key) redirect(messagesHref(slug, { failure: 'open', code: 'context' }));
  let id: string | null = null;
  let code: string | null = null;
  try { id = (await serverClient(slug).conversations.openWithOrganisation({ contextType: contextType as OpenContext, contextId }, key!)).id; }
  catch (e) { const err = e instanceof SdkError ? e : null; code = openFailureOf(err?.code, err?.status); }
  if (!id) redirect(messagesHref(slug, { failure: 'open', code: code ?? 'server' }));
  redirect(threadHref(slug, id!));
}
