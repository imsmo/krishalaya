// @krishalaya/sdk-js · notifications resource (communication module). The caller's OWN inbox + preferences +
// quiet hours (server enforces ownership — a non-owner read is 404, no IDOR). Inbox is keyset-paginated. mark-read
// is idempotent server-side. Gated server-side by the `communication` flag.
import { HttpClient } from '../http';
import { NotificationItem, NotificationPreference, QuietHours, Page } from '../types';

export class NotificationsResource {
  constructor(private readonly http: HttpClient) {}

  /** The caller's notification inbox (keyset). `unreadOnly` / `status` filter server-side. */
  async inbox(opts: { status?: string; unreadOnly?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<NotificationItem>> {
    const r = await this.http.request<NotificationItem[]>('GET', 'notifications', {
      query: { status: opts.status, unreadOnly: opts.unreadOnly, cursor: opts.cursor, limit: opts.limit ?? 50 }, signal,
    });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** Mark one notification read (idempotent). */
  async markRead(id: string): Promise<NotificationItem> {
    return (await this.http.request<NotificationItem>('POST', `notifications/${encodeURIComponent(id)}/read`)).data;
  }

  async getPreferences(signal?: AbortSignal): Promise<NotificationPreference[]> {
    return (await this.http.request<NotificationPreference[]>('GET', 'notifications/preferences', { signal })).data;
  }
  /** Bulk set per event×channel opt-in/out (a mandatory event can't be disabled — server throws). */
  async setPreferences(preferences: NotificationPreference[]): Promise<NotificationPreference[]> {
    return (await this.http.request<NotificationPreference[]>('PUT', 'notifications/preferences', { body: { preferences } })).data;
  }

  async getQuietHours(signal?: AbortSignal): Promise<QuietHours | null> {
    return (await this.http.request<QuietHours | null>('GET', 'notifications/quiet-hours', { signal })).data;
  }
  async setQuietHours(input: QuietHours): Promise<QuietHours> {
    return (await this.http.request<QuietHours>('PUT', 'notifications/quiet-hours', { body: input })).data;
  }

  /** Register this device's push token so the server can target it (call after login). Idempotent: the
   *  token is unique server-side, so re-registering the same token is a no-op re-stamp. Never log the token. */
  async registerDevice(platform: 'ios' | 'android' | 'web', token: string): Promise<{ ok: boolean; platform: string }> {
    return (await this.http.request<{ ok: boolean; platform: string }>('POST', 'notifications/devices', { body: { platform, token } })).data;
  }
  /** Revoke this device's push token (call on logout). Idempotent — ok whether or not a row existed. */
  async revokeDevice(token: string): Promise<{ ok: boolean; revoked: boolean }> {
    return (await this.http.request<{ ok: boolean; revoked: boolean }>('DELETE', 'notifications/devices', { body: { token } })).data;
  }
}
