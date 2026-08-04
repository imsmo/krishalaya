// apps/web-storefront/src/app/notifications/page.tsx · the buyer's in-app notification inbox. PROTECTED + dynamic
// (requireSession → anon to /login?next=/notifications). Reads the caller's own inbox (keyset; RLS-scoped — no
// IDOR), with an unread-only filter via searchParams. The human-readable title/body/deep-link are SERVER-rendered
// into each notification's `payload` (localized upstream), so we display those — falling back to a localized
// event-code label. Deep links are honoured only when same-origin (open-redirect guard). Per-item mark-read is a
// Server Action (no client JS). Degrades to empty/error, never 500 (Law 12).
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate } from '@krishalaya/i18n';
import type { NotificationItem } from '@krishalaya/sdk-js';
import { serverClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator, getLang } from '../../lib/i18n';
import { markNotificationReadAction } from './actions';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('notif.title'), robots: { index: false, follow: false } };
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

  let items: NotificationItem[] = [];
  let nextCursor: string | null = null;
  let failed = false;
  try {
    const page = await serverClient().notifications.inbox({ unreadOnly, cursor: searchParams.cursor, limit: 30 });
    items = page.items; nextCursor = page.nextCursor;
  } catch { failed = true; }

  const eventLabel = (code: string) => { const k = `notif.event.${code.toLowerCase()}`; const l = t.t(k); return l === k ? code : l; };
  const isUnread = (n: NotificationItem) => n.status?.toLowerCase() !== 'read' && !n.readAt;

  const qs = (extra: Record<string, string>) => `/notifications?${new URLSearchParams({ ...(unreadOnly ? { unread: '1' } : {}), ...extra }).toString()}`;

  return (
    <section className="kv-notif">
      <div className="kv-notif__head">
        <h1>{t.t('notif.title')}</h1>
        <Link href="/notifications/preferences" className="kv-link">{t.t('notif.managePrefs')}</Link>
      </div>

      <nav className="kv-notif__filters" aria-label={t.t('notif.filters')}>
        <Link href="/notifications" className={`kv-btn--link${!unreadOnly ? ' is-active' : ''}`} aria-current={!unreadOnly ? 'page' : undefined}>{t.t('notif.all')}</Link>
        <Link href="/notifications?unread=1" className={`kv-btn--link${unreadOnly ? ' is-active' : ''}`} aria-current={unreadOnly ? 'page' : undefined}>{t.t('notif.unread')}</Link>
      </nav>

      {failed ? (
        <p className="kv-form__error" role="alert">{t.t('notif.loadError')}</p>
      ) : items.length === 0 ? (
        <p className="kv-empty">{t.t('notif.empty')}</p>
      ) : (
        <ul className="kv-notif__list">
          {items.map((n) => {
            const title = str(n.payload.title) ?? eventLabel(n.eventCode);
            const body = str(n.payload.body);
            const deep = sameOriginPath(n.payload.deepLink);
            const unread = isUnread(n);
            return (
              <li key={n.id} className={`kv-notif__item${unread ? ' kv-notif__item--unread' : ''}`}>
                <div className="kv-notif__main">
                  <span className="kv-notif__ntitle">{title}</span>
                  {body && <span className="kv-notif__body">{body}</span>}
                  <span className="kv-notif__meta">
                    {n.createdAt && <span className="kv-detail__muted">{formatDate(n.createdAt, lang, { dateStyle: 'medium', timeStyle: 'short' })}</span>}
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

      {nextCursor && (
        <p className="kv-loadmore"><Link href={qs({ cursor: nextCursor })} className="kv-btn kv-btn--ghost" rel="next">{t.t('discover.nextPage')}</Link></p>
      )}
    </section>
  );
}
