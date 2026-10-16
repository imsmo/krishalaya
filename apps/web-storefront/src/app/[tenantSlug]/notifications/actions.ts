'use server';
// apps/web-storefront/src/app/[tenantSlug]/notifications/actions.ts · PC-56 STORE-4c · C2 — the inbox's two acts, under the organisation's chrome.
// AUTHENTICATED. The inbox is the caller's OWN (the API enforces ownership — a non-owner's id is 404, no IDOR).
//   markReadAction    — one item, with the row's own instant (`at`, one partition) and the key MINTED WHEN THE ROW RENDERED (`read:<uuid>`): a
//                       double submit is one read (the API remembers the key);
//   markAllReadAction — "Mark all read" (an EXTRA — the canon draws none), the key minted at render (`readall:<uuid>`), audited server-side.
// A failure is said on the inbox by name; the inbox is re-read either way (the log is the truth).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { inboxHref, readActKey, readAt, READ_ALL_KEY_RE, READ_KEY_RE } from '../../../features/store4c/inbox';

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const slugOf = (fd: FormData) => { const s = String(fd.get('slug') ?? ''); return SLUG.test(s) ? s : null; };

export async function markReadAction(fd: FormData): Promise<void> {
  const slug = slugOf(fd);
  if (!slug) redirect('/notifications');
  const unread = String(fd.get('unread') ?? '') === '1';
  await requireSession(inboxHref(slug, { unread }));
  const id = String(fd.get('id') ?? '');
  const key = readActKey(fd.get('key'), READ_KEY_RE);
  let failed = false;
  if (UUID.test(id) && key) {
    try { await serverClient(slug).notifications.markRead(id, { at: readAt(fd.get('at')), idempotencyKey: key }); } catch { failed = true; }
  } else failed = true;
  revalidatePath(`/${slug}/notifications`);
  redirect(inboxHref(slug, failed ? { unread, failure: 'read' } : { unread, ok: 'read' }));
}

export async function markAllReadAction(fd: FormData): Promise<void> {
  const slug = slugOf(fd);
  if (!slug) redirect('/notifications');
  await requireSession(inboxHref(slug));
  const key = readActKey(fd.get('key'), READ_ALL_KEY_RE);
  let failed = false;
  if (key) { try { await serverClient(slug).notifications.markAllRead(key); } catch { failed = true; } } else failed = true;
  revalidatePath(`/${slug}/notifications`);
  redirect(inboxHref(slug, failed ? { failure: 'all_read' } : { ok: 'all_read' }));
}
