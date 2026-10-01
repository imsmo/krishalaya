// apps/web-tenant/src/app/notifications/preferences/page.tsx · W433 — notification preferences: the matrix, quiet hours,
// language · PC-56 TENANT-8b · THE INBOX.
//
// W433: *"Per event, per channel — saved for you alone"* · *"Critical (9) — opt_out=false, LOCKED"* · *"One channel is
// enough … Disabled — pending founder decision"* · *"Quiet hours … Asia/Kolkata (user_quiet_hours schema defaults)"* ·
// *"Digest frequency daily | alternate_day | weekly | monthly"* · *"Channel master switches"*. WHAT IS BUILT:
//   • F-13 · THE MATRIX IS YOURS. It was built from your EXPLICIT overrides only (a new member saw "no preferences") and the
//     catalogue read that would fill it needed `notification.manage`. It is now every catalogued event (the live count, not
//     the canon's 40 — 22 of the canon's codes are not catalogued) grouped by tier, every channel the event is SENT on, your
//     choice merged over the catalogue's "on", and the events you may not turn off LOCKED with the reason — by the
//     catalogue's own `user_can_opt_out` (the live locked count, not the canon's "exactly 9").
//   • F-18 · "One channel is enough" is printed as DECIDED (G0-4, 2026-07-22) with the flag's live state — never "pending".
//   • QUIET HOURS: the window that applies to you tonight — yours, or the cooperative's default in its zone (F-5) — what it
//     holds (push · SMS · WhatsApp · IVR) and what never waits (in-app · email); critical notices ignore it. *Change
//     window* is the form chain (W2683–W2686) with the API's review (zone registry, window maths).
//   • LANGUAGE: yours, from the platform's active registry; *Change language* is the same chain.
//   • *Save preferences* posts the matrix to a server action that computes the CHANGES and opens the chain's review.
// REFUSED BY NAME: channel master switches (no per-member or per-tenant switch exists), digest frequency (no column), the
// one-night quiet-hours suspension, team admins viewing members' critical reachability (no staff read).
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { NotificationMatrix } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import {
  INBOX_HREF, PREFS_HREF, cellName, cellState, cellStateKey, channelKey, inboxTransportState, pageStateKey, prefsEditHref, refusedKey, routineRuleKey, tierKey, windowSourceKey,
  type InboxPageState,
} from '../../../features/notifications/inbox';
import { prepareMatrixAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('notif.prefsTitle'), robots: { index: false, follow: false } };
}

export default async function PreferencesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(PREFS_HREF);
  const t = getTranslator();
  const lang = getLang();
  let m: NotificationMatrix | null = null; let state: InboxPageState | null = null;
  try { m = await tenantClient().notifications.matrix(); }
  catch (e) { state = e instanceof SdkError ? inboxTransportState(e.code, e.status) : 'error'; }
  const n = (v: number) => formatNumber(v, lang);
  const note = typeof searchParams.note === 'string' ? searchParams.note : null;
  const langName = (code: string | null) => m?.language.active.find((l) => l.code === code);

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('notif.prefsTitle')}</h1>
        <Link href={INBOX_HREF} className="kv-btn--link">{t.t('notif.backToInbox')}</Link>
      </div>
      <p className="kv-field__hint">{t.t('notif.prefs.lead')}</p>
      {note === 'nochange' && <p className="kv-card kv-card--notice" role="status">{t.t('notif.prefs.noChange')}</p>}
      {note === 'toomany' && <p className="kv-error" role="alert">{t.t('notif.prefs.tooMany')}</p>}

      {state !== null && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(pageStateKey(state))}</p>
          {state === 'error' && <p><Link href={PREFS_HREF} className="kv-btn--link">{t.t('common.retry')}</Link> · <span className="kv-field__hint">{t.t('notif.prefs.stillApply')}</span></p>}
        </div>
      )}

      {m && (
        <>
          <p className="kv-field__hint">{t.t(m.counts.explicit === 0 ? 'notif.prefs.defaultsActive' : 'notif.prefs.yours', { n: n(m.counts.explicit) })}</p>
          <p className="kv-field__hint">{t.t('notif.prefs.counts', { events: n(m.counts.events), locked: n(m.counts.locked), critical: n(m.counts.critical) })}</p>

          <form action={prepareMatrixAction} className="kv-card">
            <table className="kv-table kv-matrix">
              <caption className="kv-field__hint">{t.t('notif.prefs.caption')}</caption>
              <thead>
                <tr><th scope="col">{t.t('notif.col.event')}</th><th scope="col">{t.t('notif.col.tier')}</th>{m.channels.map((ch) => <th scope="col" key={ch}>{t.t(channelKey(ch))}</th>)}<th scope="col">{t.t('notif.col.note')}</th></tr>
              </thead>
              {m.tiers.filter((g) => g.events.length > 0).map((g) => (
                <tbody key={g.tier}>
                  <tr><th scope="rowgroup" colSpan={m!.channels.length + 3}>{t.t(tierKey(g.tier))} ({n(g.events.length)})</th></tr>
                  {g.events.map((e) => (
                    <tr key={e.code}>
                      <th scope="row"><code>{e.code}</code><div className="kv-field__hint">{e.defaultName}</div></th>
                      <td>{t.t(tierKey(e.priority))}</td>
                      {e.cells.map((c) => {
                        const s = cellState(c, e.locked);
                        const name = cellName(e.code, c.channel);
                        return (
                          <td key={c.channel}>
                            {s === 'on' || s === 'off' ? (
                              <>
                                <input type="hidden" name="cell" value={name} />
                                <input type="checkbox" name="on" value={name} defaultChecked={s === 'on'} aria-label={t.t('notif.prefs.cellLabel', { event: e.code, channel: t.t(channelKey(c.channel)) })} />
                              </>
                            ) : <span aria-label={t.t(cellStateKey(s))} title={t.t(cellStateKey(s))}>{s === 'locked' ? '🔒' : t.t('common.dash')}</span>}
                          </td>
                        );
                      })}
                      <td className="kv-field__hint">{e.locked ? t.t('notif.prefs.lockedReason') : null}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
            <button type="submit" className="kv-btn">{t.t('notif.savePrefs')}</button>
            <p className="kv-field__hint">{t.t('notif.prefs.saveHint')}</p>
          </form>

          <section className="kv-card" aria-labelledby="routine-h">
            <h2 id="routine-h">{t.t('notif.routine.title')}</h2>
            <p>{t.t(routineRuleKey(m.routineRule.on))}</p>
          </section>

          <section className="kv-card" aria-labelledby="quiet-h">
            <h2 id="quiet-h">{t.t('notif.quietTitle')}</h2>
            {m.quietHours.effective ? (
              <>
                <p>{t.t('notif.window.applies', { starts: m.quietHours.effective.starts.slice(0, 5), ends: m.quietHours.effective.ends.slice(0, 5), zone: m.quietHours.effective.timezone })}</p>
                <p className="kv-field__hint">{t.t(windowSourceKey(m.quietHours.effective.source))}</p>
                {m.quietHours.effective.sanitised && <p className="kv-error" role="alert">{t.t('notif.window.sanitised', { zone: m.quietHours.effective.requestedZone ?? '', used: m.quietHours.effective.timezone })}</p>}
              </>
            ) : <p>{t.t('notif.window.none')}</p>}
            <p className="kv-field__hint">{t.t('notif.window.holds', { held: m.quietHours.held.map((c) => t.t(channelKey(c))).join(' · '), never: m.quietHours.neverHeld.map((c) => t.t(channelKey(c))).join(' · ') })}</p>
            <p className="kv-field__hint">{t.t('notif.window.critical')}</p>
            <p><Link href={prefsEditHref('window', m.quietHours.effective ? { starts: m.quietHours.effective.starts.slice(0, 5), ends: m.quietHours.effective.ends.slice(0, 5), timezone: m.quietHours.own ? m.quietHours.effective.timezone : undefined } : {})} className="kv-btn--link">{t.t('notif.window.change')}</Link></p>
            <p className="kv-field__hint">{t.t(refusedKey('suspendTonight'))}</p>
          </section>

          <section className="kv-card" aria-labelledby="lang-h">
            <h2 id="lang-h">{t.t('notif.language.title')}</h2>
            <p>{t.t('notif.language.current', { lang: langName(m.language.current)?.nameNative ?? m.language.current ?? t.t('common.dash') })}</p>
            <p className="kv-field__hint">{t.t('notif.language.fallback')}</p>
            <p><Link href={prefsEditHref('language', { languageCode: m.language.current ?? undefined })} className="kv-btn--link">{t.t('notif.language.change')}</Link></p>
          </section>

          <section className="kv-card" aria-labelledby="refused-h">
            <h2 id="refused-h">{t.t('notif.prefs.notBuilt')}</h2>
            <p className="kv-field__hint">{t.t(refusedKey('masterSwitch'))}</p>
            <p className="kv-field__hint">{t.t(refusedKey('digestFrequency'))}</p>
            <p className="kv-field__hint">{t.t(refusedKey('teamReachability'))}</p>
          </section>
        </>
      )}
    </section>
  );
}
