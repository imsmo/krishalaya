// apps/mobile/src/features/notifications/notifications.api.ts · the notification-center data layer. Inbox reads
// go through the SWR cache (usable offline); mark-read + preference/quiet-hours writes hit the SDK and invalidate
// the cached inbox. Degrade-never-die everywhere. Keyset paginated. The server enforces ownership (no IDOR).
import type { NotificationItem, NotificationPreference, QuietHours } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { cache } from '../../core/offline/sqlite.db';
import { currentScope } from '../../core/offline/scope';
import { POLICY } from '../../core/offline/cache-policies';

type InboxPage = { items: NotificationItem[]; nextCursor: string | null };

/** Inbox (optionally unread-only), cached + keyset. Degrades to an empty page on a hard failure. */
export async function inbox(opts: { unreadOnly?: boolean; cursor?: string } = {}): Promise<InboxPage> {
  try {
    const { value } = await cache.read<InboxPage>({
      scope: currentScope(), ns: 'notifications.inbox', parts: [opts.unreadOnly ? 'unread' : 'all', opts.cursor ?? 'first'], policy: POLICY.shortList,
      fetcher: async () => {
        const page = await apiClient().notifications.inbox({ unreadOnly: opts.unreadOnly, cursor: opts.cursor, limit: 50 });
        return { items: page.items, nextCursor: page.nextCursor };
      },
    });
    return value;
  } catch {
    return { items: [], nextCursor: null };
  }
}

/** Find one notification by id from the (cached) inbox. Returns null if not present. (No GET /:id endpoint —
 * the detail view reuses the already-loaded inbox; cheap + offline-friendly.) */
export async function getById(id: string): Promise<NotificationItem | null> {
  const page = await inbox({});
  return page.items.find((n) => n.id === id) ?? null;
}

/** Mark one notification read (idempotent server-side) and refresh the cached inbox. */
export async function markRead(id: string): Promise<void> {
  try { await apiClient().notifications.markRead(id); } catch { /* idempotent; ignore transient */ }
  await cache.invalidate(currentScope(), 'notifications.inbox');
}

/** Mark several notifications read ("Mark all read", screen 28). Each server call is idempotent; failures are
 * swallowed per-item (degrade-never-die). Refreshes the cached inbox once at the end. */
export async function markAllRead(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => apiClient().notifications.markRead(id).catch(() => {})));
  await cache.invalidate(currentScope(), 'notifications.inbox');
}

export async function getPreferences(): Promise<NotificationPreference[]> {
  try { return await apiClient().notifications.getPreferences(); } catch { return []; }
}
export async function setPreferences(preferences: NotificationPreference[]): Promise<NotificationPreference[]> {
  return apiClient().notifications.setPreferences(preferences);
}
export async function getQuietHours(): Promise<QuietHours | null> {
  try { return await apiClient().notifications.getQuietHours(); } catch { return null; }
}
export async function setQuietHours(input: QuietHours): Promise<QuietHours> {
  return apiClient().notifications.setQuietHours(input);
}
