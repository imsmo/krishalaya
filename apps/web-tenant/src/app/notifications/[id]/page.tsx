// apps/web-tenant/src/app/notifications/[id]/page.tsx · W434 — one notification's per-channel delivery ladder · PC-56
// TENANT-8b · THE INBOX.
//
// W434: *"notifications IS the per-channel delivery log … One genuine gap, flagged: no explicit foreign key groups the 5
// channel-rows of ONE logical send"*. 0176 closed that gap (`fanout_key`), so this page is a LOOKUP of the delivery
// instance, never a guess by time proximity. Each channel is a ladder from its own row's columns:
//   queued → sent → delivered (the provider's receipt, `delivered_at`) | failed (a vocabulary reason, `failed_at`) |
//   suppressed (opted out · routine rule) | held for quiet hours → released → sent / failed.
// *"not sent — channel off in your preferences at send time"* is TRUE now: the suppressed row exists (F-4).
// A step whose time was not recorded (a row delivered before 0176 kept `delivered_at`) says so — never a guessed time.
// REFUSED BY NAME: the retry ladder (*"queued → failed → queued (auto-retry, alternate route) → delivered"* — no retry
// poller, and a retry would reuse the SAME deterministic row, so attempts have nowhere to live); *"DLT relay confirmed
// submission"* (the notifier's `accepted` is all this platform knows — printed as "accepted by the notifier"); another
// member's detail (ops scope — no staff read exists; your own is always yours: anyone else's id is "not found").
// States: no retries needed (the canon's own) · not found (retention / not yours) · couldn't load (Retry = page load) ·
// restricted · channel off at send time · release switched off · flagged off · loading.
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { NotificationLadder } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import {
  CENTER_HREF, INBOX_HREF, channelKey, failureKey, inboxTransportState, itemBody, itemTitle, outcomeKey, pageStateKey, refusedKey, stepKey, suppressedKey, tierKey, type InboxPageState,
} from '../../../features/notifications/inbox';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('notif.ladder.title'), robots: { index: false, follow: false } };
}

export default async function LadderPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const at = typeof searchParams.at === 'string' ? searchParams.at : '';
  await requireSession(`${INBOX_HREF}/${encodeURIComponent(params.id)}`);
  const t = getTranslator();
  const lang = getLang();
  let l: NotificationLadder | null = null; let state: InboxPageState | null = null;
  if (!at) state = 'notFound';
  else {
    try { l = await tenantClient().notifications.ladder(params.id, at); }
    catch (e) { state = e instanceof SdkError ? inboxTransportState(e.code, e.status) : 'error'; }
  }
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'medium' }) : null);
  const eventLabel = (code: string) => { const k = `notif.event.${code.toLowerCase()}`; const v = t.t(k); return v === k ? code : v; };
  const anyFailed = l ? l.channels.some((c) => c.outcome === 'failed') : false;
  const anyOff = l ? l.channels.some((c) => c.suppressedReason === 'opted_out') : false;
  const anyHeld = l ? l.channels.some((c) => c.outcome === 'held') : false;

  return (
    <section>
      <h1>{t.t('notif.ladder.title')}</h1>
      <p className="kv-field__hint"><Link href={CENTER_HREF} className="kv-btn--link">{t.t('notif.ladder.back')}</Link></p>

      {state !== null && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(state === 'notFound' ? 'notif.ladder.notFound' : pageStateKey(state))}</p>
          {state === 'notFound' && <p className="kv-field__hint">{t.t('notif.ladder.restricted')}</p>}
          {state === 'error' && <p><Link href={`${INBOX_HREF}/${encodeURIComponent(params.id)}?${new URLSearchParams({ at }).toString()}`} className="kv-btn--link">{t.t('common.retry')}</Link> · <span className="kv-field__hint">{t.t('notif.ladder.sendHappened')}</span></p>}
        </div>
      )}

      {l && (
        <>
          <div className="kv-card">
            <h2><code>{l.eventCode}</code> — {itemTitle(l) ?? eventLabel(l.eventCode)} <span className="kv-badge">{t.t(tierKey(l.tier))}</span></h2>
            {itemBody(l) && <p>{itemBody(l)}</p>}
            <p className="kv-field__hint">{t.t('notif.ladder.eventTime', { at: when(l.createdAt) ?? t.t('common.dash') })}</p>
            {!l.grouped && <p className="kv-field__hint">{t.t('notif.ladder.ungrouped')}</p>}
          </div>

          <ol className="kv-ladder" aria-label={t.t('notif.ladder.channels')}>
            {l.channels.map((ch) => (
              <li key={ch.channel} className="kv-ladder__channel">
                <h3>{t.t(channelKey(ch.channel))} — <span>{t.t(outcomeKey(ch.outcome))}</span></h3>
                <ol className="kv-ladder__steps">
                  {ch.steps.map((s, i) => (
                    <li key={`${s.kind}-${i}`}>
                      <strong>{t.t(stepKey(s))}</strong>{' '}
                      <span className="kv-muted">{when(s.at) ?? t.t('notif.ladder.timeNotRecorded')}</span>
                      {s.kind === 'held' && <> · {t.t('notif.ladder.heldUntil', { at: when(s.until) ?? t.t('common.dash') })}</>}
                      {s.kind === 'failed' && <> · {t.t(failureKey(s.reason))}</>}
                      {s.kind === 'suppressed' && <> · {t.t(suppressedKey(s.reason))}</>}
                      {s.kind === 'sent' && ch.channel !== 'inapp' && <> · <span className="kv-field__hint">{t.t('notif.ladder.acceptedByNotifier')}</span></>}
                    </li>
                  ))}
                </ol>
                {ch.channel === 'inapp' && <p className="kv-field__hint">{t.t('notif.ladder.inappNote')}</p>}
              </li>
            ))}
          </ol>

          {!anyFailed && <p className="kv-field__hint">{t.t('notif.ladder.noRetries')}</p>}
          {anyOff && <p className="kv-field__hint" role="status">{t.t('notif.ladder.channelOff')}</p>}
          {anyHeld && <p className="kv-field__hint" role="status">{t.t(l.releaseStopped ? 'notif.ladder.releaseStopped' : 'notif.ladder.heldNote')}</p>}
          <p className="kv-field__hint">{t.t(refusedKey('autoRetry'))}</p>
          <p className="kv-field__hint">{t.t('notif.ladder.grounding')}</p>
        </>
      )}
    </section>
  );
}
