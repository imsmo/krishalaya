// apps/web-storefront/src/components/sweep/QualityPromiseScreen.tsx · PC-56 STORE-SWEEP-a · C2 (canon W309; founder D1, money) — THE QUALITY PROMISE,
// UNDER BOTH CHROMES (`/quality-promise`, `/<slug>/quality-promise`). DERIVED from features/sweep/quality-rules.ts: each rule with its mechanism
// (`data-kv-rule` / `data-kv-mechanism`), and the canon's extra promises refused BY NAME (RefusalList `quality`). Not money: it PRINTS the money
// rules as the code has them; no money path is touched.
//   • under a store, the four dispute rules print only when its `disputes` flag is ON; OFF → "this organisation has not switched on disputes";
//     unreadable → said so (never guessed);
//   • on the platform, the dispute rules print under "each organisation decides whether its store takes disputes";
//   • the cancel rule links the person's orders (the rule is per order — no ladder page); the trace rule links the code entry `/trace`.
// Organisation-neutral words — no platform name (the brand guard).
import { getTranslator } from '../../lib/i18n';
import { RefusalList } from '../RefusalList';
import type { AccountChrome } from '../../features/store4a/account';
import { QUALITY_WINDOW_HOURS, rulesFor, type DisputesState, type QualityRule } from '../../features/sweep/quality-rules';
import { helpLinkHref } from './HelpScreen';

export function QualityPromiseScreen({ chrome, disputes }: { chrome: AccountChrome; disputes: DisputesState }) {
  const t = getTranslator();
  const hours = String(QUALITY_WINDOW_HOURS);
  const rules = rulesFor(chrome.kind, disputes);
  const general = rules.filter((r) => !r.disputes);
  const disputeRules = rules.filter((r) => r.disputes);
  const item = (r: QualityRule) => (
    <li key={r.id} data-kv-rule={r.id} data-kv-mechanism={r.id}>
      {t.t(r.key, { hours })}
      {r.link === 'orders' && <> <a href={helpLinkHref(chrome, 'orders')} className="kv-btn--link" data-kv-link="orders">{t.t('help.link.orders')}</a></>}
      {r.link === 'trace' && <> <a href={helpLinkHref(chrome, 'trace')} className="kv-btn--link" data-kv-link="trace">{t.t('help.link.trace')}</a></>}
    </li>
  );
  return (
    <article className="kv-prose" data-kv-quality="" data-kv-chrome={chrome.kind} data-kv-disputes={chrome.kind === 'tenant' ? disputes : 'per-store'}>
      <h1>{t.t('sweep.quality.title')}</h1>
      <p className="kv-prose__lead">{t.t('sweep.quality.lead')}</p>
      <section aria-labelledby="kv-quality-rules" data-kv-quality-section="rules">
        <h2 id="kv-quality-rules">{t.t('sweep.quality.rulesTitle')}</h2>
        <ul>{general.map(item)}</ul>
      </section>
      <section aria-labelledby="kv-quality-disputes" data-kv-quality-section="disputes">
        <h2 id="kv-quality-disputes">{t.t('sweep.quality.disputesTitle')}</h2>
        {chrome.kind === 'platform' && <p data-kv-state="disputes-per-store">{t.t('sweep.quality.disputesPerStore')}</p>}
        {chrome.kind === 'tenant' && disputes === 'off' && <p className="kv-state" role="status" data-kv-state="disputes-off">{t.t('sweep.quality.disputesOff')}</p>}
        {chrome.kind === 'tenant' && disputes === 'unknown' && <p className="kv-state" role="status" data-kv-state="disputes-unknown">{t.t('sweep.quality.disputesUnknown')}</p>}
        {disputeRules.length > 0 && <ul>{disputeRules.map(item)}</ul>}
      </section>
      <RefusalList surface="quality" />
    </article>
  );
}
