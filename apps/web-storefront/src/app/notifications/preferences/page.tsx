// apps/web-storefront/src/app/notifications/preferences/page.tsx · manage notification preferences + quiet hours.
// PROTECTED + dynamic. Reads the caller's own preference matrix (event × channel) and quiet-hours window via the
// authed SDK and renders two no-JS Server-Action forms. Preferences submit the COMPLETE matrix (hidden pair +
// opt-in checkbox) so the server replaces it atomically. Quiet hours uses native time inputs + an IANA timezone.
// Degrades to an error state; never 500 (Law 12).
import type { Metadata } from 'next';
import Link from 'next/link';
import type { NotificationPreference, QuietHours } from '@krishalaya/sdk-js';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { savePreferencesAction, saveQuietHoursAction } from './actions';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('notif.prefsTitle'), robots: { index: false, follow: false } };
}

const DEFAULT_TZ = 'Asia/Kolkata'; // platform default tz when the buyer hasn't set quiet hours yet

export default async function PreferencesPage({ searchParams }: { searchParams: { status?: string } }) {
  await requireSession('/notifications/preferences');
  const t = getTranslator();

  let prefs: NotificationPreference[] = [];
  let quiet: QuietHours | null = null;
  let failed = false;
  try {
    [prefs, quiet] = await Promise.all([
      serverClient().notifications.getPreferences(),
      serverClient().notifications.getQuietHours(),
    ]);
  } catch { failed = true; }

  if (failed) {
    return <section className="kv-prefs"><h1>{t.t('notif.prefsTitle')}</h1>
      <p className="kv-form__error" role="alert">{t.t('notif.loadError')}</p></section>;
  }

  const eventLabel = (c: string) => { const k = `notif.event.${c.toLowerCase()}`; const l = t.t(k); return l === k ? c : l; };
  const channelLabel = (c: string) => { const k = `notif.channel.${c.toLowerCase()}`; const l = t.t(k); return l === k ? c : l; };
  const notice =
    searchParams.status === 'prefsaved' ? { kind: 'ok', msg: t.t('notif.prefsSaved') } :
    searchParams.status === 'preferr' ? { kind: 'err', msg: t.t('notif.prefsError') } :
    searchParams.status === 'qhsaved' ? { kind: 'ok', msg: t.t('notif.qhSaved') } :
    searchParams.status === 'qherr' ? { kind: 'err', msg: t.t('notif.qhError') } : null;

  return (
    <section className="kv-prefs">
      <h1>{t.t('notif.prefsTitle')}</h1>
      <p><Link href="/notifications" className="kv-btn--link">{t.t('notif.backToInbox')}</Link></p>
      {notice && <p className={notice.kind === 'ok' ? 'kv-form__notice' : 'kv-form__error'} role="status">{notice.msg}</p>}

      <form action={savePreferencesAction} className="kv-prefs__form">
        <h2>{t.t('notif.channelsTitle')}</h2>
        {prefs.length === 0 ? (
          <p className="kv-detail__muted">{t.t('notif.noPrefs')}</p>
        ) : (
          <ul className="kv-prefs__list">
            {prefs.map((p) => {
              const key = `${p.eventCode}::${p.channel}`;
              return (
                <li key={key} className="kv-prefs__row">
                  <input type="hidden" name="pref" value={key} />
                  <label className="kv-prefs__label">
                    <input type="checkbox" name="enabled" value={key} defaultChecked={p.isEnabled} />
                    <span>{eventLabel(p.eventCode)} · <span className="kv-detail__muted">{channelLabel(p.channel)}</span></span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {prefs.length > 0 && <button type="submit" className="kv-btn">{t.t('notif.savePrefs')}</button>}
      </form>

      <form action={saveQuietHoursAction} className="kv-prefs__form kv-prefs__qh">
        <h2>{t.t('notif.quietTitle')}</h2>
        <p className="kv-field__hint">{t.t('notif.quietHint')}</p>
        <div className="kv-prefs__qhrow">
          <div className="kv-field">
            <label htmlFor="qh-start" className="kv-field__label">{t.t('notif.quietStart')}</label>
            <input id="qh-start" name="starts" type="time" defaultValue={quiet?.starts ?? '22:00'} className="kv-field__input" required />
          </div>
          <div className="kv-field">
            <label htmlFor="qh-end" className="kv-field__label">{t.t('notif.quietEnd')}</label>
            <input id="qh-end" name="ends" type="time" defaultValue={quiet?.ends ?? '07:00'} className="kv-field__input" required />
          </div>
          <div className="kv-field">
            <label htmlFor="qh-tz" className="kv-field__label">{t.t('notif.quietTz')}</label>
            <input id="qh-tz" name="timezone" type="text" defaultValue={quiet?.timezone ?? DEFAULT_TZ} className="kv-field__input" required />
          </div>
        </div>
        <button type="submit" className="kv-btn">{t.t('notif.saveQuiet')}</button>
      </form>
    </section>
  );
}
