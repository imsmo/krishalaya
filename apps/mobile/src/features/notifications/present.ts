// apps/mobile/src/features/notifications/present.ts · PURE presentation helpers for a notification row. The
// rendered title/body live in the server payload (localized); these read them defensively (any shape) and decide
// unread state. No I/O → unit-tested.
import type { NotificationItem } from '@krishalaya/sdk-js';

export interface PresentedNotification { id: string; title: string; body: string; ref: string; deepLink: string | null; unread: boolean; createdAt?: string }

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function presentNotification(n: NotificationItem): PresentedNotification {
  const p = n.payload ?? {};
  const title = str(p.title) || str(p.subject) || n.eventCode;
  const body = str(p.body) || str(p.message) || str(p.text);
  const ref = str(p.ref) || str(p.reference) || str(p.subtitle);
  return { id: n.id, title, body, ref, deepLink: internalDeepLink(p.deepLink ?? p.link ?? p.url), unread: n.status !== 'read', createdAt: n.createdAt };
}

/** Only accept an IN-APP deep link (a relative expo-router path) from the server payload — never an external URL
 * (a hostile/mis-templated `http(s)://…` must not auto-open; §4 deep-link guard). null when absent/external. Pure. */
export function internalDeepLink(v: unknown): string | null {
  const s = str(v).trim();
  return s.startsWith('/') && !s.startsWith('//') ? s : null;
}

export function unreadCount(items: NotificationItem[]): number {
  return items.reduce((c, n) => c + (n.status !== 'read' ? 1 : 0), 0);
}

export type NotifDayGroup = 'today' | 'yesterday' | 'earlier';
/** Bucket notifications (newest-first) into Today / Yesterday / Earlier by their created date (UTC calendar day),
 * preserving order within each bucket. Items without a date fall into 'earlier'. Pure. */
export function groupByDay(items: NotificationItem[], nowMs: number = Date.now()): Array<{ key: NotifDayGroup; items: NotificationItem[] }> {
  const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const today = dayOf(nowMs);
  const yesterday = dayOf(nowMs - 86400000);
  const buckets: Record<NotifDayGroup, NotificationItem[]> = { today: [], yesterday: [], earlier: [] };
  for (const n of items) {
    const t = n.createdAt ? Date.parse(n.createdAt) : NaN;
    const d = Number.isNaN(t) ? '' : dayOf(t);
    buckets[d === today ? 'today' : d === yesterday ? 'yesterday' : 'earlier'].push(n);
  }
  return (['today', 'yesterday', 'earlier'] as NotifDayGroup[]).filter((k) => buckets[k].length > 0).map((k) => ({ key: k, items: buckets[k] }));
}
