// apps/web-storefront/src/components/offline/InstallScreen.tsx · PC-56 STORE-6a · C3 (canon W319) — THE APP IS THE ORGANISATION'S. Under both
// chromes (`/app`, `/<slug>/app`). What is TRUE, said plainly:
//   • it installs from the browser onto the home screen AS THIS STORE (the organisation's name; its logo or its monogram — never the
//     platform's mark); the browser's own install steps in words — no button here (the invitation, "Not now" and the second-visit rule are
//     STORE-6b's; `storefront_install_prompt` is not touched);
//   • it updates itself politely (founder D4: a new version waits; "tap to refresh now, or it applies next time you open"; never over a form
//     with content); it works in your language (the language at install; a switch applies at the next open);
//   • without signal: the public pages you opened, if this store keeps them (its `storefront_offline_reads`), with their age; the offline page.
//     NOT your orders or messages (founder Q3); your own unsent words are "coming" (6b). Paying, bidding, accepting offers… say "needs signal"
//     — the list is /queued;
//   • the storage line measured by the phone (`navigator.storage.estimate()`), photos never kept, a full phone loses nothing here.
// REFUSED (E10 and the canon's false lines): no size ("Under 3 MB", "small download"), no phone price, no "speaks", no "clears photos", no
// platform-app plug — no figure and no app name is printed.
// PC-56 STORE-6b · D3 / C2: + THE INVITATION section — the rule (from the second visit; "Not now" kept 30 days on this phone) when this
// organisation's `storefront_install_prompt` is ON, else the honest OFF line; the device's status line (components/install/InstallStatus.tsx:
// "Not now — until <date>" / "added" / W3137 "This browser can't install from here — Share → Add to Home Screen"); the sheet's outcomes as
// `?install=success|failure|error` (W3139 / W3140 / W3137). Still no install button on this page: the browser's own steps, in words. And the
// drafts line is TRUE now: "your unsent words stay on this phone" → On this phone.
import { getTranslator } from '../../lib/i18n';
import { RefusalList } from '../RefusalList';
import { StorageLine } from './StorageLine';
import type { AccountChrome } from '../../features/store4a/account';
import { store6Href } from '../../features/store6/paths';
import { PAGE_DAYS, PAGE_LIMIT } from '../../features/store6/sw-rules';
import { syncHref } from '../../features/store6b/paths';
import { NOT_NOW_DAYS, type InstallPageState } from '../../features/store6b/install';
import { InstallStatus } from '../install/InstallStatus';
import { statusLabels } from '../../lib/drafts-labels';
import { getLang } from '../../lib/i18n';
import { formatNumber } from '@krishalaya/i18n';

export interface InstallScreenProps {
  chrome: AccountChrome;
  /** the name the installed app carries: the organisation's (a store) or the platform store's (the platform's own page) */
  name: string;
  /** the organisation's `storefront_offline_reads`, or null on the platform page */
  offlineReads: boolean | null;
  /** STORE-6b: the organisation's `storefront_install_prompt` (the platform page: false — the tenant-scoped key reads absent there) */
  inviteOn?: boolean;
  /** STORE-6b: the sheet's outcome named in the query (`?install=success|failure|error`) */
  installState?: InstallPageState | null;
}

export function InstallScreen({ chrome, name, offlineReads, inviteOn = false, installState = null }: InstallScreenProps) {
  const t = getTranslator();
  const lang = getLang();
  const keep = chrome.kind === 'tenant'
    ? (offlineReads === true ? t.t('store6.offline.keep.on', { org: name, pages: PAGE_LIMIT, days: PAGE_DAYS }) : t.t('store6.offline.keep.off', { org: name }))
    : t.t('store6.offline.keep.platform', { pages: PAGE_LIMIT, days: PAGE_DAYS });
  return (
    <article className="kv-prose" data-kv-install="" data-kv-chrome={chrome.kind}>
      <h1>{t.t('store6.install.title', { name })}</h1>
      <p className="kv-prose__lead">{t.t('store6.install.lead', { name })}</p>

      <section data-kv-install-section="how" aria-labelledby="kv-i-how">
        <h2 id="kv-i-how">{t.t('store6.install.how.title')}</h2>
        <ul>
          <li data-kv-install-how="android">{t.t('store6.install.how.android')}</li>
          <li data-kv-install-how="iphone">{t.t('store6.install.how.iphone')}</li>
          <li data-kv-install-how="other">{t.t('store6.install.how.other', { name })}</li>
        </ul>
        <p className="kv-field__hint" data-kv-install-icon="">{t.t('store6.install.icon', { name })}</p>
      </section>

      <section data-kv-install-section="invite" aria-labelledby="kv-i-invite" data-kv-invite={inviteOn ? 'on' : 'off'}>
        <h2 id="kv-i-invite">{t.t('store6b.app.title')}</h2>
        {installState === 'success' && <p className="kv-form__notice" role="status" data-kv-install-state="success">{t.t('store6b.app.success', { name })}</p>}
        {installState === 'failure' && <p className="kv-state" role="status" data-kv-install-state="failure">{t.t('store6b.app.failure')}</p>}
        {installState === 'error' && <p className="kv-state" role="status" data-kv-install-state="error">{t.t('store6b.app.cannot')}</p>}
        <p data-kv-invite-rule="">{inviteOn ? t.t('store6b.app.rule', { name, days: formatNumber(NOT_NOW_DAYS, lang) }) : t.t('store6b.app.off', { name })}</p>
        <InstallStatus labels={statusLabels()} lang={lang} />
      </section>

      <section data-kv-install-section="polite" aria-labelledby="kv-i-polite">
        <h2 id="kv-i-polite">{t.t('store6.install.polite.title')}</h2>
        <p data-kv-install-true="update">{t.t('store6.install.update')}</p>
        <p data-kv-install-true="language">{t.t('store6.install.language')}</p>
      </section>

      <section data-kv-install-section="offline" aria-labelledby="kv-i-off">
        <h2 id="kv-i-off">{t.t('store6.install.offline.title')}</h2>
        <ul>
          <li data-kv-works="kept">{keep}</li>
          <li data-kv-works="this-page">{t.t('store6.offline.works.thisPage')}</li>
          <li data-kv-not-kept="orders">{t.t('store6.install.offline.notOrders')}</li>
          <li data-kv-drafts="kept">{t.t('store6.queued.coming')} <a href={syncHref(chrome)} className="kv-btn--link" data-kv-link="sync">{t.t('store6b.sync.title')}</a></li>
        </ul>
        <p>{t.t('store6.install.needsSignal')} <a href={store6Href(chrome, 'queued')} className="kv-btn--link" data-kv-link="queued">{t.t('store6.offline.link.queued')}</a></p>
      </section>

      <section data-kv-install-section="storage" aria-labelledby="kv-i-storage">
        <h2 id="kv-i-storage">{t.t('store6.install.storage.title')}</h2>
        <StorageLine labels={{ uses: t.t('store6.install.storage.uses', { name, mb: '{mb}' }), unknown: t.t('store6.install.storage.unknown') }} />
        <p data-kv-install-true="photos">{t.t('store6.install.storage.photos')}</p>
        <p data-kv-install-true="full">{t.t('store6.install.storage.full')}</p>
      </section>

      <p><a href={store6Href(chrome, 'offline')} className="kv-btn--link" data-kv-link="offline">{t.t('store6.queued.back')}</a></p>
      <RefusalList surface="install" />
    </article>
  );
}
