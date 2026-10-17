// apps/web-storefront/src/components/sweep/HelpScreen.tsx · PC-56 STORE-SWEEP-a · C2 (canon W311; founder D8 — the first thing built) — HELP, UNDER
// BOTH CHROMES (`/help`, `/<slug>/help`), TELLING THE TRUTH. Derived from features/sweep/help.ts:
//   • the money answer by the STORE's `online_payments` (both cases on the platform, and on a store whose flags could not be read — said);
//   • no "held until", no "track delivery", no "support team": "how do I buy" names the order page and its status; "still need help?" is the
//     Contact page (platform) or "Message the organisation" (the store's own contact page);
//   • the canon's search, voice, short code, licence upload, versioned answers, phone line, ticket and paging refused BY NAME (RefusalList `help`).
// Under a store, organisation-neutral words only — no platform name (the brand guard pins every `help.*` key a store renders).
import type { StorefrontFlags } from '@krishalaya/sdk-js';
import { getTranslator } from '../../lib/i18n';
import { RefusalList } from '../RefusalList';
import { accountHref, type AccountChrome } from '../../features/store4a/account';
import { HELP_SECTIONS, MONEY_CASE_KEY, helpEntries, moneyCases, type HelpEntry, type HelpLink } from '../../features/sweep/help';
import { sweepHref } from '../../features/sweep/paths';
import { QUALITY_WINDOW_HOURS } from '../../features/sweep/quality-rules';

const LINK_LABEL: Record<HelpLink, string> = {
  orders: 'help.link.orders', trace: 'help.link.trace', quality: 'help.link.quality', preferences: 'help.link.preferences', signup: 'help.link.signup',
};

export function helpLinkHref(c: AccountChrome, link: HelpLink): string {
  switch (link) {
    case 'orders': return c.kind === 'tenant' ? `/${encodeURIComponent(c.slug)}/orders` : '/orders';
    case 'trace': return '/trace';
    case 'quality': return sweepHref(c, 'quality-promise');
    case 'preferences': return accountHref(c, 'preferences');
    default: return '/for-organisations';
  }
}

/** `flags` = the STORE's public flags (null when unreadable); ignored on the platform. */
export function HelpScreen({ chrome, flags }: { chrome: AccountChrome; flags: StorefrontFlags | null }) {
  const t = getTranslator();
  const hours = String(QUALITY_WINDOW_HOURS);
  const money = moneyCases(chrome.kind, flags);
  const entries = helpEntries(chrome.kind);
  const answer = (e: HelpEntry) => {
    if (e.a !== 'money') return <p>{t.t(e.a)}</p>;
    return (
      <div data-kv-money={money.cases.join(' ')}>
        {money.unknown && <p className="kv-state" role="status" data-kv-state="flags-unknown">{t.t('help.a2unknown')}</p>}
        {money.cases.map((c) => (
          <p key={c} data-kv-money-case={c}>
            {money.cases.length > 1 && <><strong>{t.t(`help.a2when.${c}`)}</strong>{' '}</>}
            {t.t(MONEY_CASE_KEY[c], { hours })}
          </p>
        ))}
      </div>
    );
  };
  return (
    <article className="kv-prose" data-kv-help="" data-kv-chrome={chrome.kind}>
      <h1>{t.t('help.title')}</h1>
      <p className="kv-prose__lead">{t.t('help.lead')}</p>
      {HELP_SECTIONS.map((s) => {
        const rows = entries.filter((e) => e.section === s);
        if (rows.length === 0) return null;
        return (
          <section key={s} data-kv-help-section={s} aria-labelledby={`kv-help-${s}`}>
            <h2 id={`kv-help-${s}`}>{t.t(`help.section.${s}`)}</h2>
            <dl className="kv-faq">
              {rows.map((e) => (
                <div key={e.id} className="kv-faq__item" id={`help-${e.id}`} data-kv-help-entry={e.id}>
                  <dt className="kv-faq__q">{t.t(e.q)}</dt>
                  <dd className="kv-faq__a">
                    {answer(e)}
                    {e.link && <a href={helpLinkHref(chrome, e.link)} className="kv-btn--link" data-kv-link={e.link}>{t.t(LINK_LABEL[e.link])}</a>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
      <section data-kv-help-section="contact" aria-labelledby="kv-help-contact">
        <h2 id="kv-help-contact">{t.t('help.contactTitle')}</h2>
        {chrome.kind === 'tenant'
          ? <p>{t.t('help.contactStore')} <a href={sweepHref(chrome, 'contact')} className="kv-btn--link" data-kv-link="contact">{t.t('help.link.contactStore')}</a></p>
          : <p>{t.t('help.contact')} <a href={sweepHref(chrome, 'contact')} className="kv-btn--link" data-kv-link="contact">{t.t('help.link.contact')}</a></p>}
      </section>
      <RefusalList surface="help" />
    </article>
  );
}
