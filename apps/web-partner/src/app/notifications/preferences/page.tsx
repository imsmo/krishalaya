// apps/web-partner/src/app/notifications/preferences/page.tsx · preference matrix + quiet hours (PC-2C).
// Renders the caller's OWN event×channel matrix; submitting posts the COMPLETE matrix (full replace — the API
// contract; hidden `pref` inputs enumerate every cell so unticked = disabled, never dropped).
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePartner } from '../../../lib/partner-auth';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { savePreferencesAction, saveQuietHoursAction } from '../actions';
import type { NotificationPreference, QuietHours } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('notif.prefsTitle'), robots: { index: false, follow: false } };
}

export default async function PreferencesPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requirePartner();
  const t = getTranslator();

  let prefs: NotificationPreference[] = []; let quiet: QuietHours | null = null; let failed = false;
  try {
    [prefs, quiet] = await Promise.all([
      partnerClient().notifications.getPreferences(),
      partnerClient().notifications.getQuietHours(),
    ]);
  } catch { failed = true; }

  const events = [...new Set(prefs.map((p) => p.eventCode))];
  const channels = [...new Set(prefs.map((p) => p.channel))];
  const enabled = (e: string, c: string) => prefs.find((p) => p.eventCode === e && p.channel === c)?.isEnabled ?? false;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('notif.prefsTitle')}</h1>
        <Link href="/notifications" className="kv-btn--link">← {t.t('notif.title')}</Link>
      </div>
      {searchParams.ok && <p className="kv-success" role="status">{t.t(`notif.ok.${searchParams.ok === 'quiet' ? 'quiet' : 'prefs'}`)}</p>}
      {searchParams.error && <p className="kv-error" role="alert">{t.t(`notif.error.${searchParams.error === 'quiet' ? 'quiet' : 'prefs'}`)}</p>}

      {failed ? <p className="kv-error" role="alert">{t.t('notif.loadError')}</p> : prefs.length === 0 ? (
        <p className="kv-muted">{t.t('notif.prefsEmpty')}</p>
      ) : (
        <form action={savePreferencesAction} className="kv-card kv-form">
          <table className="kv-table">
            <thead><tr><th>{t.t('notif.colEvent')}</th>{channels.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e}>
                  <td className="kv-mono">{e}</td>
                  {channels.map((c) => (
                    <td key={c}>
                      <input type="hidden" name="pref" value={`${e}|${c}`} />
                      <input type="checkbox" name={`on:${e}|${c}`} value="1" defaultChecked={enabled(e, c)} aria-label={`${e} ${c}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <button type="submit" className="kv-btn">{t.t('notif.savePrefs')}</button>
        </form>
      )}

      <form action={saveQuietHoursAction} className="kv-card kv-form">
        <h2 className="kv-card__title">{t.t('notif.quiet')}</h2>
        <p className="kv-field__hint">{t.t('notif.quietHint')}</p>
        <label htmlFor="qh-s" className="kv-field__label">{t.t('notif.quietStart')}</label>
        <input id="qh-s" name="starts" type="time" className="kv-input" defaultValue={quiet?.starts ?? '21:00'} required />
        <label htmlFor="qh-e" className="kv-field__label">{t.t('notif.quietEnd')}</label>
        <input id="qh-e" name="ends" type="time" className="kv-input" defaultValue={quiet?.ends ?? '07:00'} required />
        <button type="submit" className="kv-btn">{t.t('notif.saveQuiet')}</button>
      </form>
    </section>
  );
}
