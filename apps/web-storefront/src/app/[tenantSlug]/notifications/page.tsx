// apps/web-storefront/src/app/[tenantSlug]/notifications/page.tsx · PC-56 STORE-4c · C2 — canon W299 "Notifications", under the ORGANISATION's
// chrome (founder Q13: notices carry the organisation; the platform /notifications is a door — lib/store-door.ts). PROTECTED + dynamic.
//   • All / Unread (the strict boolean — HOTFIX-6: the All tab lists read rows too);
//   • each item: the tier chip (critical / important / informational / promotional), the words it was SENT with (features/store4c/inbox.ts
//     `itemWords` — the row's own template version rendered by the API, else the payload's own words, else the event's name), the module, the
//     time, the LADDER of its other channels ("also by SMS · delivered / not sent — quiet hours / failed", the reason by name), "Open" only when
//     the payload carries a same-origin link, and "Mark read" (keyed — a key minted at render per row);
//   • "Mark all read" — an EXTRA (the canon draws none), keyed and audited server-side;
//   • keyset Next only; empty: "All caught up — payment notices always reach you here" (TRUE since 0215: `payment.success` is critical, locked,
//     in-app); a load error is NOT empty — it says so with a Retry that reloads (W3118–W3120 are DECOR);
//   • NO "Flagged off" state: a person's notices have no kill-switch (founder Q12); the refused canon claims printed by name.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'crypto';
import { formatDate } from '@krishalaya/i18n';
import type { NotificationItem } from '@krishalaya/sdk-js';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import { reloadHref } from '../../../features/home/load-result';
import { accountHref, tenantChrome } from '../../../features/store4a/account';
import {
  deepLink, eventKey, inboxHref, isUnread, itemWords, ladderRows, readInboxQuery, readOneOf, tierKey, tierTone, INBOX_FAILURES, INBOX_OK,
} from '../../../features/store4c/inbox';
import { markReadAction, markAllReadAction } from './actions';
import { RefusalList } from '../../../components/RefusalList';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('notif.title'), robots: { index: false, follow: false } };
}

export default async function TenantNotificationsPage({ params, searchParams }: { params: { tenantSlug: string }; searchParams: SP }) {
  const slug = params.tenantSlug;
  const { unreadOnly, cursor } = readInboxQuery(searchParams);
  await requireSession(inboxHref(slug, { unread: unreadOnly }));
  const t = getTranslator();
  const lang = getLang();
  const api = serverClient(slug);
  const ok = readOneOf(searchParams.ok, INBOX_OK);
  const failure = readOneOf(searchParams.failure, INBOX_FAILURES);

  let items: NotificationItem[] = [];
  let nextCursor: string | null = null;
  let failed = false;
  try {
    const page = await api.notifications.inbox({ unreadOnly, cursor, limit: 30 });
    items = page.items; nextCursor = page.nextCursor;
  } catch { failed = true; }

  const label = (key: string, fallback: string) => { const v = t.t(key); return v === key ? fallback : v; };
  const prefsHref = accountHref(tenantChrome(slug), 'preferences');
  const head = (
    <>
      <div className="kv-notif__head">
        <h1>{t.t('notif.title')}</h1>
        <Link href={prefsHref} className="kv-link" data-kv-link="preferences">{t.t('notif.managePrefs')}</Link>
      </div>
      <nav className="kv-notif__filters" aria-label={t.t('notif.filters')} data-kv-tabs="inbox">
        <Link href={inboxHref(slug)} className={`kv-btn--link${!unreadOnly ? ' is-active' : ''}`} aria-current={!unreadOnly ? 'page' : undefined} data-kv-tab="all">{t.t('notif.all')}</Link>
        <Link href={inboxHref(slug, { unread: true })} className={`kv-btn--link${unreadOnly ? ' is-active' : ''}`} aria-current={unreadOnly ? 'page' : undefined} data-kv-tab="unread">{t.t('notif.unread')}</Link>
      </nav>
      {ok && <p className="kv-form__notice" role="status" data-kv-ok={ok}>{t.t(`store4c.inbox.ok.${ok}`)}</p>}
      {failure && <p className="kv-form__error" role="alert" data-kv-failure={failure}>{t.t(`store4c.inbox.failure.${failure}`)}</p>}
    </>
  );

  if (failed) {
    return (
      <section className="kv-notif" data-kv-screen="inbox" data-kv-store={slug}>
        {head}
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('store4c.inbox.loadError')}</p>
          <a href={reloadHref(`/${encodeURIComponent(slug)}/notifications`, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
        <RefusalList surface="inbox" />
      </section>
    );
  }

  const unreadCount = items.filter(isUnread).length;
  return (
    <section className="kv-notif" data-kv-screen="inbox" data-kv-store={slug}>
      {head}
      {items.length === 0 ? (
        <div className="kv-state" data-kv-state="empty">
          <p className="kv-empty">{t.t(unreadOnly ? 'store4c.inbox.emptyUnread' : 'store4c.inbox.empty')}</p>
        </div>
      ) : (
        <>
          {unreadCount > 0 && (
            <form action={markAllReadAction} className="kv-inline-form" data-kv-form="read-all">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="key" value={`readall:${randomUUID()}`} />
              <button type="submit" className="kv-btn--link" data-kv-act="read-all">{t.t('store4c.inbox.markAll')}</button>
            </form>
          )}
          <ul className="kv-notif__list">
            {items.map((n) => {
              const words = itemWords(n);
              const title = words.title ?? label(eventKey(n.eventCode), n.eventCode);
              const deep = deepLink(n.payload);
              const unread = isUnread(n);
              const ladder = ladderRows(n.alsoOn);
              const tier = n.tier ?? null;
              return (
                <li key={n.id} className={`kv-notif__item${unread ? ' kv-notif__item--unread' : ''}`} data-kv-item={n.eventCode} data-kv-unread={String(unread)}>
                  <div className="kv-notif__main">
                    <span className={`kv-chip kv-chip--${tierTone(tier)}`} data-kv-tier={tier ?? 'unknown'}>{t.t(tierKey(tier))}</span>
                    <span className="kv-notif__ntitle" lang={n.languageCode ?? undefined}>{title}</span>
                    {words.body && <span className="kv-notif__body" lang={n.languageCode ?? undefined} data-kv-body={words.source}>{words.body}</span>}
                    <span className="kv-notif__meta">
                      {n.module && <span className="kv-detail__muted" data-kv-module={n.module}>{label(`store4c.module.${n.module}`, n.module)}</span>}
                      {n.createdAt && <span className="kv-detail__muted"> · {formatDate(n.createdAt, lang, { dateStyle: 'medium', timeStyle: 'short' })}</span>}
                      {deep && <> · <Link href={deep} className="kv-link" data-kv-open>{t.t('notif.open')}</Link></>}
                    </span>
                    {ladder.length > 0 && (
                      <ul className="kv-notif__ladder" data-kv-ladder={ladder.length}>
                        {ladder.map((l) => (
                          <li key={l.channel} data-kv-also={l.channel} data-kv-outcome={l.outcomeKey.split('.').pop()}>
                            {t.t('store4c.inbox.alsoBy', { channel: t.t(l.channelKey) })} · {t.t(l.outcomeKey)}
                            {l.reasonKey && <> — <span data-kv-reason={l.reasonKey.split('.').pop()}>{t.t(l.reasonKey)}</span></>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {unread && (
                    <form action={markReadAction} className="kv-inline-form">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="id" value={n.id} />
                      {n.at && <input type="hidden" name="at" value={n.at} />}
                      <input type="hidden" name="key" value={`read:${randomUUID()}`} />
                      {unreadOnly && <input type="hidden" name="unread" value="1" />}
                      <button type="submit" className="kv-btn--link" data-kv-act="read">{t.t('notif.markRead')}</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {nextCursor && (
        <p className="kv-loadmore"><Link href={inboxHref(slug, { unread: unreadOnly, cursor: nextCursor })} className="kv-btn kv-btn--ghost" rel="next" data-kv-next>{t.t('discover.nextPage')}</Link></p>
      )}
      <RefusalList surface="inbox" />
    </section>
  );
}
