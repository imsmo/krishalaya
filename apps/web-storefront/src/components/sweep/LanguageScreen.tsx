// apps/web-storefront/src/components/sweep/LanguageScreen.tsx · PC-56 STORE-SWEEP-b · C2 (founder D3 — canon W323) — CHOOSE YOUR LANGUAGE, under both
// chromes (`/language`, `/<slug>/language`; `/language` on a store's own host). Server component; works with no client JS:
//   • the LIVE languages (features/sweep/languages.ts `liveLanguages` — the code registry, pinned to the seed's active rows by languages-drift.spec)
//     as BUTTONS, each written in itself (`nameNative`, its own `lang`/`dir`), in ONE <form> that POSTs to the existing `/api/lang` route with the
//     hidden `from` = the page the person came from (`languageFrom`: the link's `?from=`, else a same-host Referer, else the chrome's home) — the route
//     sets `kv_lang`, sets the account language too when signed in (4c), and 303s back to `from` with `?lang=`;
//   • the language in use is marked (`aria-pressed`, "in use"); "until you choose, this site follows your browser's own setting" (TRUE — lib/i18n);
//   • the rest as ONE "not available yet" line (DELTA `coming_soon_languages` — never a button, never selectable);
//   • "change it later on your preferences page" (TRUE — STORE-4c) with the link; "Back without changing" → `from`;
//   • refused by name (RefusalList `language`): an IP guess, a speaker, a downloaded font, a first-visit interstitial.
// One language per page: every sentence in the person's language (the language names are each in their own script — that is the point).
import { getTranslator } from '../../lib/i18n';
import { RefusalList } from '../RefusalList';
import { accountHref, type AccountChrome } from '../../features/store4a/account';
import { comingSoonLanguages, liveLanguages } from '../../features/sweep/languages';

export function LanguageScreen({ chrome, from, active }: { chrome: AccountChrome; from: string; active: string }) {
  const t = getTranslator();
  const live = liveLanguages();
  const soon = comingSoonLanguages();
  return (
    <section className="kv-prose kv-lang" aria-labelledby="kv-lang-h" data-kv-language={chrome.kind === 'tenant' ? chrome.slug : 'platform'}>
      <h1 id="kv-lang-h">{t.t('sweep.language.title')}</h1>
      <p>{t.t('sweep.language.lead')}</p>
      <form action="/api/lang" method="post" className="kv-lang__form" data-kv-lang-form="choose">
        <input type="hidden" name="from" value={from} />
        <div className="kv-lang__grid">
          {live.map((l) => (
            <button key={l.code} type="submit" name="lang" value={l.code} lang={l.code} dir={l.dir} aria-pressed={l.code === active}
              className={`kv-btn kv-lang__choice${l.code === active ? ' is-active' : ''}`} data-kv-lang-choice={l.code}>
              {l.nameNative}
              {l.code === active && <small className="kv-lang__inuse"> · {t.t('sweep.language.inUse')}</small>}
            </button>
          ))}
        </div>
      </form>
      <p className="kv-detail__muted" data-kv-lang-note="browser">{t.t('sweep.language.browserNote')}</p>
      {soon.length > 0 && (
        <p className="kv-detail__muted" data-kv-coming-soon={soon.length}>
          {t.t('sweep.language.comingSoon', { count: String(soon.length) })}{' '}
          {soon.map((l, i) => <span key={l.code}>{i > 0 && ' · '}<span lang={l.code} dir={l.dir} data-kv-soon-lang={l.code}>{l.nameNative}</span></span>)}
        </p>
      )}
      <p data-kv-lang-later="preferences">
        {t.t('sweep.language.later')}{' '}
        <a href={accountHref(chrome, 'preferences')} className="kv-btn--link" data-kv-link="preferences">{t.t('sweep.language.preferences')}</a>
      </p>
      <p><a href={from} className="kv-btn--link" data-kv-link="back">{t.t('sweep.language.back')}</a></p>
      <RefusalList surface="language" />
    </section>
  );
}
