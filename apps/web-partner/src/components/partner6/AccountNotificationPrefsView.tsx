// apps/web-partner/src/components/partner6/AccountNotificationPrefsView.tsx · PC-56 PARTNER-6c · W271 (canon `account/notifications/preferences`)
// — AN HONEST PAGE WITH NO CHECKBOX (founder 6c-2, door Q5-A) AND THE ONE REAL ACT OF PARTNER-6 (founder 6c-3, door Q7-A), presentational.
//
// The sign-in code and the team invitation cannot be switched off, and no other message is sent, so there is nothing else to set — the canon's
// 8-row matrix and its 24 checkboxes, its tiers, its quiet window, its daily summary and its "Save preferences" are refused BY NAME, and NO
// checkbox is rendered. The one thing a partner person sets here is the CONSOLE'S LANGUAGE for this browser: ONE radio group of exactly the
// languages it is GIVEN (the page passes `@krishalaya/i18n`'s live list — features/partner6/language.ts; never a literal list here), each named
// in its own script and marked `lang`, the current one checked, and ONE submit that opens the form chain's review state (`?form=review&lang=`,
// a GET — nothing is set until the review state's own button posts to the Server Action). It says plainly that older console text is still
// English-only and falls back to English (never "every template exists"). No read → no error state; OFF prints OFF. Laid out with logical
// CSS only (`.kv-lang-choice*` in styles/globals.css) — no physical direction, no arrow.
import Link from 'next/link';
import type { LanguageDef } from '@krishalaya/i18n';
import type { Tr } from '../NotYet';
import { Refusals6 } from './LenderChain6';
import { AccountSwitchedOff } from './AccountNotificationsView';
import { NOTIFICATIONS_PAGE, NOTIFICATION_PREFS_PAGE, WEBHOOKS_PAGE, type AccountState } from '../../features/partner6/figures';

export function AccountNotificationPrefsView({ t, state, current, choices }: { t: Tr; state: AccountState; current: LanguageDef; choices: readonly LanguageDef[] }) {
  if (state === 'off') return <AccountSwitchedOff t={t} page="notification-prefs" />;
  return (
    <section data-kv-account="notification-prefs" data-kv-state={state}>
      <h1>{t.t('partner6.notificationPrefs.title')}</h1>
      <p className="kv-muted">{t.t('partner6.notificationPrefs.lead')}</p>

      <div className="kv-card" data-kv-statement="notification-prefs">
        <h2 className="kv-card__title">{t.t('partner6.notificationPrefs.statementTitle')}</h2>
        <p className="kv-statement" data-kv-statement="partner6.notificationPrefs.statement">{t.t('partner6.notificationPrefs.statement')}</p>
        <p className="kv-pager" data-kv-acts="webhooks">
          <Link className="kv-btn kv-btn--muted" href={WEBHOOKS_PAGE} data-kv-real="webhooks">{t.t('partner6.notifications.webhooksLink')}</Link>
        </p>
      </div>

      <div className="kv-card" data-kv-language="choice">
        <h2 className="kv-card__title" id="kv-lang-title">{t.t('partner6.language.title')}</h2>
        <form method="get" action={NOTIFICATION_PREFS_PAGE} className="kv-lang-choice" aria-labelledby="kv-lang-title" data-kv-lang-form="true">
          <fieldset className="kv-lang-choice__set">
            <legend className="kv-lang-choice__legend">{t.t('partner6.language.legend')}</legend>
            {choices.map((l) => (
              <label key={l.code} className="kv-lang-choice__option" lang={l.code} data-kv-lang-option={l.code}>
                <input type="radio" name="lang" value={l.code} defaultChecked={l.code === current.code} />
                <span>{l.nameNative}</span>
              </label>
            ))}
          </fieldset>
          <button type="submit" name="form" value="review" className="kv-btn">{t.t('partner6.language.submit')}</button>
        </form>
        <p className="kv-muted" data-kv-language-note="browser">{t.t('partner6.language.browserOnly')}</p>
        <p className="kv-muted" data-kv-language-note="fallback">{t.t('partner6.language.fallbackNote')}</p>
      </div>

      <p className="kv-pager" data-kv-acts="notification-prefs">
        <Link className="kv-btn kv-btn--muted" href={NOTIFICATIONS_PAGE} data-kv-real="notifications">{t.t('partner6.notificationPrefs.backLink')}</Link>
      </p>
      <Refusals6 t={t} surface="notification_prefs" />
    </section>
  );
}
