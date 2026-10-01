// apps/web-tenant/src/app/notifications/page.tsx · W204 — notifications: your inbox (the bell's items) + the cooperative's
// delivery health · PC-56 TENANT-8b · THE INBOX.
//
// W204: *"Statuses are the real machine: queued → sent → delivered / failed → read (or suppressed by quiet
// hours/preferences)"*. WHAT THIS PAGE PRINTS, AND FROM WHERE:
//   • YOUR INBOX — your IN-APP items only (F-9: the bell listed every channel row, so one notice on in-app + push + SMS was
//     three lines). Each says what the rest of its delivery instance did ("also by SMS · sent"), from the log; the
//     canon's *"critical items also SMS you"* is printed per item, only where that item's SMS row exists.
//   • MEMBER DELIVERY HEALTH (24h) — the tenant-wide read `notification.manage` was described as granting and no route
//     served. Every tile a live count: left the platform · delivered (a receipt said so) · awaiting a receipt · failed
//     (by reason, a vocabulary code) · suppressed (by reason — quiet-hours rows are HELD and released, F-4). The canon's
//     *"SMS cost ₹412"* is refused by name (`cost_minor` has no currency column; the count of costed sends is printed)
//     and *"auto-retry · 38 recovered"* is refused by name (no retry poller exists).
//   • The DIGEST ENGINE is refused by name (`batched_into` is written by nothing; no job).
//   • YOUR PREFERENCES, summarised from the matrix (W433); *"money and disputes cannot be turned off while you hold approval
//     roles"* is refused by name — the lock is per EVENT (`user_can_opt_out`), not per role, and the count is printed.
// Six states: inbox zero · couldn't load (Retry is a page load — 6a's ruling, the canon's W2690 "Retry") · delivery health
// restricted · loading (loading.tsx) · flagged off (the module guard's 404, its own sentence) · no unread.
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { DeliveryHealth, InboxPage, NotificationMatrix } from '@krishalaya/sdk-js';
import { tenantClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator, getLang } from '../../lib/i18n';
import {
  CENTER_HREF, INBOX_HREF, PREFS_HREF, READ_ALL_HREF, alsoOnLine, alsoReachedBySms, channelKey, failureKey, inappStatusKey, inboxTransportState, isUnread, itemBody,
  itemTitle, ladderHref, outcomeKey, pageStateKey, refusedKey, sameOriginPath, suppressedKey, tierKey, type InboxPageState,
} from '../../features/notifications/inbox';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('notif.title'), robots: { index: false, follow: false } };
}

const SUMMARY_LIMIT = 10;

export default async function NotificationsPage() {
  await requireSession(INBOX_HREF);
  const t = getTranslator();
  const lang = getLang();
  const c = tenantClient().notifications;

  let page: InboxPage | null = null; let state: InboxPageState | null = null;
  try { page = await c.inboxPage({ limit: SUMMARY_LIMIT }); }
  catch (e) { state = e instanceof SdkError ? inboxTransportState(e.code, e.status) : 'error'; }

  let health: DeliveryHealth | null = null; let healthState: InboxPageState | null = null;
  let matrix: NotificationMatrix | null = null;
  if (state === null) {
    const [h, m] = await Promise.allSettled([c.deliveryHealth(), c.matrix()]);
    if (h.status === 'fulfilled') health = h.value;
    else healthState = h.reason instanceof SdkError ? inboxTransportState(h.reason.code, h.reason.status) : 'error';
    if (m.status === 'fulfilled') matrix = m.value;
  }
  const zone = page?.zone ?? undefined;
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }) : t.t('common.dash'));
  const n = (v: number) => formatNumber(v, lang);
  const eventLabel = (code: string) => { const k = `notif.event.${code.toLowerCase()}`; const l = t.t(k); return l === k ? code : l; };
  const unreadShown = page ? page.items.filter(isUnread).length : 0;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('notif.title')}</h1>
        <nav className="kv-notif-filters" aria-label={t.t('notif.nav')}>
          <Link href={CENTER_HREF} className="kv-btn--link">{t.t('notif.center.title')}</Link>
          <Link href={PREFS_HREF} className="kv-btn--link">{t.t('notif.managePrefs')}</Link>
          {page && unreadShown > 0 && <Link href={`${READ_ALL_HREF}?step=confirm`} className="kv-btn">{t.t('notif.act.readAll')}</Link>}
        </nav>
      </div>
      <p className="kv-field__hint">{t.t('notif.lead')}</p>

      {state !== null && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(pageStateKey(state))}</p>
          {state === 'error' && <p><Link href={INBOX_HREF} className="kv-btn--link">{t.t('common.retry')}</Link> · <span className="kv-field__hint">{t.t('notif.errorStillSms')}</span></p>}
        </div>
      )}

      {page && (
        <section aria-labelledby="inbox-h">
          <h2 id="inbox-h">{t.t('notif.yourInbox')}</h2>
          {page.items.length === 0 ? (
            <div className="kv-card kv-card--notice" role="status"><p>{t.t('notif.inboxZero')}</p><p><Link href="/dashboard" className="kv-btn--link">{t.t('notif.viewDashboard')}</Link></p></div>
          ) : (
            <ul className="kv-notif-list">
              {page.items.map((it) => {
                const deep = sameOriginPath(it.payload.deepLink);
                const ladder = ladderHref(it);
                const also = alsoOnLine(it.alsoOn ?? []);
                return (
                  <li key={it.id} className={`kv-notif-item${isUnread(it) ? ' kv-notif-item--unread' : ''}`}>
                    <div className="kv-notif-main">
                      <span className="kv-notif-title">{itemTitle(it) ?? eventLabel(it.eventCode)}</span>
                      {itemBody(it) && <span className="kv-notif-body">{itemBody(it)}</span>}
                      <span className="kv-notif-meta">
                        <span className="kv-badge">{t.t(tierKey(it.tier))}</span>
                        <span className="kv-muted">{when(it.createdAt)}</span>
                        <span>{t.t(inappStatusKey(it))}</span>
                      </span>
                      {also.length > 0 && (
                        <span className="kv-field__hint">{t.t('notif.alsoOn')} {also.map((a) => `${t.t(channelKey(a.channel))} · ${t.t(outcomeKey(a.outcome))}`).join(' — ')}</span>
                      )}
                      {alsoReachedBySms(it.alsoOn ?? []) && <span className="kv-field__hint">{t.t('notif.alsoSms')}</span>}
                    </div>
                    <span className="kv-notif-meta">
                      {deep && <Link href={deep} className="kv-link">{t.t('notif.open')}</Link>}
                      {ladder && <Link href={ladder} className="kv-link">{t.t('notif.deliveryDetail')}</Link>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="kv-field__hint">{t.t('notif.shownOf', { n: n(page.items.length) })} <Link href={CENTER_HREF} className="kv-btn--link">{t.t('notif.seeAll')}</Link></p>
        </section>
      )}

      {page && (
        <section aria-labelledby="health-h" className="kv-card">
          <h2 id="health-h">{t.t('notif.health.title')}</h2>
          {healthState === 'restricted' && <p role="status">{t.t('notif.health.restricted')}</p>}
          {healthState !== null && healthState !== 'restricted' && <p className="kv-error" role="alert">{t.t(pageStateKey(healthState))}</p>}
          {health && (
            <>
              <div className="kv-kpis">
                <div className="kv-kpi"><span className="kv-kpi__label">{t.t('notif.health.leftPlatform')}</span><strong>{n(health.leftPlatform)}</strong></div>
                <div className="kv-kpi"><span className="kv-kpi__label">{t.t('notif.health.delivered')}</span><strong>{n(health.delivered)}</strong><span className="kv-field__hint">{t.t('notif.health.deliveredNote', { n: n(health.awaitingReceipt) })}</span></div>
                <div className="kv-kpi"><span className="kv-kpi__label">{t.t('notif.health.failed')}</span><strong>{n(health.failed)}</strong></div>
                <div className="kv-kpi"><span className="kv-kpi__label">{t.t('notif.health.suppressed')}</span><strong>{n(health.suppressed)}</strong><span className="kv-field__hint">{t.t('notif.health.suppressedNote')}</span></div>
                <div className="kv-kpi"><span className="kv-kpi__label">{t.t('notif.health.inapp')}</span><strong>{n(health.inapp)}</strong></div>
              </div>
              {Object.keys(health.failedByReason).length > 0 && (
                <p className="kv-field__hint">{t.t('notif.health.failedBy')} {Object.entries(health.failedByReason).map(([r, v]) => `${t.t(failureKey(r))} ${n(v)}`).join(' · ')}</p>
              )}
              {Object.keys(health.suppressedByReason).length > 0 && (
                <p className="kv-field__hint">{t.t('notif.health.suppressedBy')} {Object.entries(health.suppressedByReason).map(([r, v]) => `${t.t(suppressedKey(r))} ${n(v)}`).join(' · ')}</p>
              )}
              <p className="kv-field__hint">{t.t(refusedKey('smsCostRupees'))} {t.t('notif.health.costed', { n: n(health.costedSends) })}</p>
              <p className="kv-field__hint">{t.t(refusedKey('autoRetry'))}</p>
            </>
          )}
        </section>
      )}

      {page && (
        <section aria-labelledby="digest-h" className="kv-card">
          <h2 id="digest-h">{t.t('notif.digest.title')}</h2>
          <p className="kv-field__hint">{t.t(refusedKey('digest'))}</p>
        </section>
      )}

      {page && matrix && (
        <section aria-labelledby="prefs-h" className="kv-card">
          <h2 id="prefs-h">{t.t('notif.prefsSummary.title')}</h2>
          <p>{t.t('notif.prefsSummary.line', { explicit: n(matrix.counts.explicit), events: n(matrix.counts.events), locked: n(matrix.counts.locked) })}</p>
          {matrix.quietHours.effective && (
            <p className="kv-field__hint">{t.t('notif.prefsSummary.window', { starts: matrix.quietHours.effective.starts.slice(0, 5), ends: matrix.quietHours.effective.ends.slice(0, 5), zone: matrix.quietHours.effective.timezone })}</p>
          )}
          <p className="kv-field__hint">{t.t(refusedKey('approvalRoleLock'))}</p>
          <p><Link href={PREFS_HREF} className="kv-btn--link">{t.t('notif.managePrefs')}</Link></p>
        </section>
      )}
    </section>
  );
}
