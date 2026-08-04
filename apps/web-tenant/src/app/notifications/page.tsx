// apps/web-tenant/src/app/notifications/page.tsx · the staff member's in-app notification inbox. requireSession-
// gated + dynamic. Reads the caller's OWN inbox (keyset; server-scoped — no IDOR), unread-only filter via
// searchParams. The human-readable title/body/deep-link are server-rendered into each notification's `payload`
// (localized upstream), so we display those, falling back to a localized event-code label. Deep links are honoured
// only when same-origin (open-redirect guard). Per-item mark-read is a Server Action (no client JS). Degrades to
// empty/error, never 500 (Law 12); noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate } from '@krishalaya/i18n';
import type { NotificationItem } from '@krishalaya/sdk-js';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator, getLang } from '../../lib/i18n';
import { markNotificationReadAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('notif.title'), robots: { index: false, follow: false } };
}

function str(v: unknown): string | null { return typeof v === 'string' && v.trim() ? v : null; }
function sameOriginPath(v: unknown): string | null {
  const s = str(v);
  return s && s.startsWith('/') && !s.startsWith('//') ? s : null; // same-origin only
}

export default async function NotificationsPage({ searchParams }: { searchParams: { cursor?: string; unread?: string } }) {
  await requireSession('/notifications');
  const t = getTranslator();
  const lang = getLang();
  const unreadOnly = searchParams.unread === '1';

  let items: NotificationItem[] = []; let nextCursor: string | null = null; let failed = false;
  try { const p = await tenantClient().notifications.inbox({ unreadOnly, cursor: searchParams.cursor, limit: 30 }); items = p.items; nextCursor = p.nextCursor; }
  catch { failed = true; }

  const eventLabel = (code: string) => { const k = `notif.event.${code.toLowerCase()}`; const l = t.t(k); return l === k ? code : l; };
  const isUnread = (n: NotificationItem) => n.status?.toLowerCase() !== 'read' && !n.readAt;
  const qs = (extra: Record<string, string>) => `/notifications?${new URLSearchParams({ ...(unreadOnly ? { unread: '1' } : {}), ...extra }).toString()}`;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('notif.title')}</h1>
        <Link href="/notifications/preferences" className="kv-link">{t.t('notif.managePrefs')}</Link>
      </div>

      <nav className="kv-notif-filters" aria-label={t.t('notif.filters')}>
        <Link href="/notifications" className={`kv-btn--link${!unreadOnly ? ' is-active' : ''}`} aria-current={!unreadOnly ? 'page' : undefined}>{t.t('notif.all')}</Link>
        <Link href="/notifications?unread=1" className={`kv-btn--link${unreadOnly ? ' is-active' : ''}`} aria-current={unreadOnly ? 'page' : undefined}>{t.t('notif.unread')}</Link>
      </nav>

      {failed ? (
        <p className="kv-error" role="alert">{t.t('notif.loadError')}</p>
      ) : items.length === 0 ? (
        <p className="kv-empty-state">{t.t('notif.empty')}</p>
      ) : (
        <ul className="kv-notif-list">
          {items.map((n) => {
            const title = str(n.payload.title) ?? eventLabel(n.eventCode);
            const body = str(n.payload.body);
            const deep = sameOriginPath(n.payload.deepLink);
            const unread = isUnread(n);
            return (
              <li key={n.id} className={`kv-notif-item${unread ? ' kv-notif-item--unread' : ''}`}>
                <div className="kv-notif-main">
                  <span className="kv-notif-title">{title}</span>
                  {body && <span className="kv-notif-body">{body}</span>}
                  <span className="kv-notif-meta">
                    {n.createdAt && <span className="kv-muted">{formatDate(n.createdAt, lang, { dateStyle: 'medium', timeStyle: 'short' })}</span>}
                    {deep && <Link href={deep} className="kv-link">{t.t('notif.open')}</Link>}
                  </span>
                </div>
                {unread && (
                  <form action={markNotificationReadAction}>
                    <input type="hidden" name="id" value={n.id} />
                    <button type="submit" className="kv-btn--link">{t.t('notif.markRead')}</button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {nextCursor && <p className="kv-pager"><Link href={qs({ cursor: nextCursor })} className="kv-btn--link" rel="next">{t.t('common.nextPage')}</Link></p>}
    </section>
  );
}
