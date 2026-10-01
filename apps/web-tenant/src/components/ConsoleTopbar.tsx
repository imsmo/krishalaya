// apps/web-tenant/src/components/ConsoleTopbar.tsx · DEV-18 REAL consuming-app smoke test (packages/ui
// port batch 4). Wraps `@krishalaya/ui`'s `Topbar` for the console shell. `me` is passed down from
// `layout.tsx` (fetched once there, shared with `Sidebar`'s `tenant` slot — see that file's own header
// comment for why).
//
// [PC-56 TENANT-8b · W432 — THE BELL] DEV-18 left the bell out ON PURPOSE: *"no notification-unread-count data source
// today … inventing a '0 unread' badge with no backing data would be worse than showing no bell at all"*. The data source
// exists now (`GET /notifications/bell` — your unread IN-APP items, capped at 100; the latest eight; what quiet hours are
// holding for you), so the bell is drawn — from that, and only that:
//   • zero unread = NO badge (not a "0"); the badge caps at 99+ (W432);
//   • the popover is a native `<details>` disclosure: no client JS (the console's law). W432's ↑/↓ row keys and
//     focus-on-open are PARITY-DECOR — they need script, as the canon's own annotation says; Esc/Enter/Tab work natively;
//   • the popover is a GLANCE: the latest eight grouped by the cooperative's day, never filtered, paged or bulk-acted —
//     "See all" hands off to W431 (the canon's honesty line); *Mark all read* opens the mutate chain's confirm;
//   • *"All items already suppressed/queued … appear the moment the window opens"* is printed as what the log says: how
//     many of your push/SMS legs are HELD and when the earliest is released (or that the release is switched off);
//   • couldn't load → the bell stays, with no badge and a retry row (never a stale count); the module flagged off → the
//     API's 404 → no bell (W432's "Center disabled — bell hidden", the honest reading of a switched-off module).
import Link from 'next/link';
import type { NotificationBell, UserProfile } from '@krishalaya/sdk-js';
import { Topbar } from '@krishalaya/ui';
import { formatDate } from '@krishalaya/i18n';
import { getTranslator, getLang } from '../lib/i18n';
import { CENTER_HREF, INBOX_HREF, actHref, bellBadge, dayLabel, groupByDay, isUnread, itemTitle, ladderHref, sameOriginPath, tierKey } from '../features/notifications/inbox';

export type BellState = { kind: 'ok'; bell: NotificationBell } | { kind: 'error' } | { kind: 'hidden' };

export function ConsoleTopbar({ me, bell }: { me: UserProfile | null; bell?: BellState }) {
  const t = getTranslator();
  const lang = getLang();
  const b = bell?.kind === 'ok' ? bell.bell : null;
  const badge = b ? bellBadge(b.unread) : null;
  const eventLabel = (code: string) => { const k = `notif.event.${code.toLowerCase()}`; const v = t.t(k); return v === k ? code : v; };
  const dayText = (d: string | null) => {
    const l = dayLabel(d, b?.today);
    if (l.kind === 'today') return t.t('notif.day.today');
    if (l.kind === 'yesterday') return t.t('notif.day.yesterday');
    if (l.kind === 'date') return formatDate(`${l.date}T12:00:00Z`, lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    return t.t('common.dash');
  };
  const bellEl = bell && bell.kind !== 'hidden' ? (
    <details className="kv-bell">
      <summary className="kvw-topbar-iconbtn" aria-label={badge ? t.t('notif.bell.labelUnread', { n: badge }) : t.t('notif.bell.label')} aria-haspopup="true">
        <span aria-hidden="true">{'\u{1F514}'}</span>
        {badge && <span className="kv-bell__badge" aria-hidden="true">{badge}</span>}
      </summary>
      <div className="kv-bell__popover" role="group" aria-label={t.t('notif.bell.label')}>
        <p className="kv-bell__head"><strong>{t.t('notif.title')}</strong>{b && b.unread > 0 && <> · <Link href={actHref('readAll')} className="kv-btn--link">{t.t('notif.act.readAll')}</Link></>}</p>
        {bell.kind === 'error' && <p className="kv-error" role="alert">{t.t('notif.bell.error')} <Link href={INBOX_HREF} className="kv-btn--link">{t.t('common.retry')}</Link></p>}
        {b && b.latest.length === 0 && <p className="kv-field__hint">{t.t('notif.bell.none')}</p>}
        {b && groupByDay(b.latest).map((g) => (
          <div key={g.day ?? 'none'}>
            <p className="kv-field__hint">{dayText(g.day)}</p>
            <ul className="kv-bell__list">
              {g.items.map((it) => {
                const href = sameOriginPath(it.payload.deepLink) ?? ladderHref(it) ?? CENTER_HREF;
                return (
                  <li key={it.id} className={isUnread(it) ? 'kv-bell__item kv-bell__item--unread' : 'kv-bell__item'}>
                    <Link href={href}>{itemTitle(it) ?? eventLabel(it.eventCode)}</Link>
                    <span className="kv-field__hint"> {t.t(tierKey(it.tier))} · {it.localTime ?? ''}{isUnread(it) ? '' : ` · ${t.t('notif.inapp.read')}`}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {b && b.held > 0 && (
          <p className="kv-field__hint">{b.releaseStopped ? t.t('notif.bell.heldStopped', { n: String(b.held) }) : t.t('notif.bell.held', { n: String(b.held), at: b.nextRelease ? formatDate(b.nextRelease, lang, { timeStyle: 'short', timeZone: b.zone ?? undefined }) : t.t('common.dash') })}</p>
        )}
        <p><Link href={CENTER_HREF} className="kv-btn--link">{t.t('notif.bell.seeAll')}</Link></p>
      </div>
    </details>
  ) : null;
  return (
    <Topbar
      userMenu={<>{bellEl}<span className="kv-muted">{me?.displayName ?? me?.id ?? '—'}</span></>}
    />
  );
}
