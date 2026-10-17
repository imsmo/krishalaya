// apps/web-storefront/src/components/offline/OfflineScreen.tsx · PC-56 STORE-6a · C3 (canon W313 + the DECOR chain W3127–W3130) — THE OFFLINE
// PAGE IS A KIND PAGE: ONE screen, two jobs.
//   1. THE FALLBACK. The worker answers a failed navigation with the host-root `/offline` (features/store6/sw-rules.ts `swFallback`) when it
//      kept no copy of that page: "No connection right now" and "Try again" — `/` (or the store's home) in the HTML, and a one-line script points
//      it at the requested URL when this page stands in for another (HOTFIX-8's script; it now recognises `/<slug>/offline` too).
//   2. THE RULES (W313): the two honest states (no "slow" tier exists — the as-of line instead), the "as of" law and its tiers (stale-tiers.ts),
//      the three don'ts (TRUE — nothing is shown stale without the band, a kept copy is never blanked, nothing refreshes under the thumb), the
//      in-context example ("Add to cart — needs signal; nothing is saved on the phone"), where it applies and the pages NEVER kept (payment,
//      a live auction, an offer's accept / counter — not marked cacheable), and what this store keeps (its `storefront_offline_reads` answer).
//   + the offline FORM chain (W3127–W3130 — DECOR, the act is refused): `?form=error|review|success|failure` prints the refusal and the live act.
// SESSION-FREE: used by `(shell)/offline` (the platform host — no session read, no API call: the platform sentence is printed) and by
// `[tenantSlug]/offline` (the organisation named from the public brand read; its `storefront_offline_reads` from the public flags read).
// No price, no figure, no app plug: the platform's mobile-app sentence (`offline.hint`) is retired (founder D7).
import { getTranslator } from '../../lib/i18n';
import { RefusalList } from '../RefusalList';
import type { AccountChrome } from '../../features/store4a/account';
import { homeHref, offlineFormState, store6Href } from '../../features/store6/paths';
import { PAGE_DAYS, PAGE_LIMIT } from '../../features/store6/sw-rules';
import { FULL_MS, PROMINENT_MS, QUIET_MS } from '../../features/store6/stale-tiers';

const QUIET_MIN = QUIET_MS / 60_000; const PROMINENT_H = PROMINENT_MS / 3_600_000; const FULL_H = FULL_MS / 3_600_000;

type SP = Record<string, string | string[] | undefined>;

/** Point "Try again" at the URL the person asked for when this page stands in for it (any path that is not itself an offline page). */
export const RETRY_SCRIPT = "(function(){var a=document.querySelector('[data-kv-retry]');if(a&&!/\\/offline$/.test(location.pathname)){a.setAttribute('href',location.href)}})()";

export interface OfflineScreenProps {
  chrome: AccountChrome;
  /** the organisation's published name (a store), or null (the platform's own page) */
  orgName: string | null;
  /** the organisation's `storefront_offline_reads` (true / false), or null on the platform page (no read is made there) */
  offlineReads: boolean | null;
  searchParams?: SP;
}

export function OfflineScreen({ chrome, orgName, offlineReads, searchParams = {} }: OfflineScreenProps) {
  const t = getTranslator();
  const form = offlineFormState(searchParams.form);
  const org = orgName ?? '';
  const keep = chrome.kind === 'tenant'
    ? (offlineReads === true ? t.t('store6.offline.keep.on', { org, pages: PAGE_LIMIT, days: PAGE_DAYS }) : t.t('store6.offline.keep.off', { org }))
    : t.t('store6.offline.keep.platform', { pages: PAGE_LIMIT, days: PAGE_DAYS });
  return (
    <article className="kv-offline-policy" data-kv-offline="policy" data-kv-chrome={chrome.kind} data-kv-keep={offlineReads === true ? 'on' : chrome.kind === 'tenant' ? 'off' : 'platform'}>
      <section className="kv-offline" data-kv-offline="shell" style={{ textAlign: 'center', padding: '32px 16px' }}>
        <h1>{t.t('offline.heading')}</h1>
        <p>{t.t('offline.body')}</p>
        <a href={homeHref(chrome)} className="kv-btn" data-kv-retry="">{t.t('offline.retry')}</a>
        <script dangerouslySetInnerHTML={{ __html: RETRY_SCRIPT }} />
      </section>

      {form && <OfflineFormChain chrome={chrome} state={form} />}

      <section className="kv-prose" data-kv-offline-section="states" aria-labelledby="kv-off-states">
        <h2 id="kv-off-states">{t.t('store6.offline.states.title')}</h2>
        <p className="kv-prose__lead">{t.t('store6.offline.lead')}</p>
        <ul>
          <li data-kv-state-row="online"><strong>{t.t('store6.offline.states.onlineName')}</strong> — {t.t('store6.offline.states.online')}</li>
          <li data-kv-state-row="offline"><strong>{t.t('store6.offline.states.offlineName')}</strong> — {t.t('store6.offline.states.offline')}
            <ul>
              <li data-kv-works="kept">{keep}</li>
              <li data-kv-works="this-page">{t.t('store6.offline.works.thisPage')}</li>
              <li data-kv-works="needs-signal">{t.t('store6.offline.works.needsSignal')}</li>
            </ul>
          </li>
          <li data-kv-state-row="slow"><strong>{t.t('store6.offline.states.slowName')}</strong> — {t.t('store6.offline.states.slow')}</li>
        </ul>
      </section>

      <section className="kv-prose" data-kv-offline-section="time" aria-labelledby="kv-off-time">
        <h2 id="kv-off-time">{t.t('store6.offline.time.title')}</h2>
        <p>{t.t('store6.offline.time.rule')}</p>
        <ul>
          <li data-kv-tier="fresh">{t.t('store6.offline.tier.fresh', { minutes: QUIET_MIN })}</li>
          <li data-kv-tier="aging">{t.t('store6.offline.tier.aging', { minutes: QUIET_MIN, hours: PROMINENT_H })}</li>
          <li data-kv-tier="prominent">{t.t('store6.offline.tier.prominent', { hours: PROMINENT_H })}</li>
          <li data-kv-tier="full">{t.t('store6.offline.tier.full', { hours: FULL_H })}</li>
        </ul>
        <p data-kv-tier="money">{t.t('store6.offline.time.money', { hours: PROMINENT_H })}</p>
        <h3>{t.t('store6.offline.dont.title')}</h3>
        <ul>
          <li data-kv-dont="stale-without-band">{t.t('store6.offline.dont.staleWithoutBand')}</li>
          <li data-kv-dont="blank">{t.t('store6.offline.dont.blank')}</li>
          <li data-kv-dont="auto-refresh">{t.t('store6.offline.dont.autoRefresh')}</li>
        </ul>
      </section>

      <section className="kv-prose" data-kv-offline-section="example" aria-labelledby="kv-off-example">
        <h2 id="kv-off-example">{t.t('store6.offline.example.title')}</h2>
        <div className="kv-state kv-cached-band kv-cached-band--prominent" data-kv-cached-band-example="" role="note">
          <strong>{t.t('store6.band.offline')}</strong> {t.t('store6.offline.example.band')}
        </div>
        <p>
          <button type="button" className="kv-btn" disabled aria-disabled="true" data-kv-example="add-to-cart">{t.t('store6.offline.example.addToCart')}</button>{' '}
          <span className="kv-field__hint">{t.t('store6.offline.example.nothingSaved')}</span>
        </p>
        <p><a href={store6Href(chrome, 'offline', 'review')} className="kv-btn--link" data-kv-chain="offline-form">{t.t('store6.offline.example.chainLink')}</a></p>
      </section>

      <section className="kv-prose" data-kv-offline-section="where" aria-labelledby="kv-off-where">
        <h2 id="kv-off-where">{t.t('store6.offline.where.title')}</h2>
        <p>{t.t('store6.offline.where.applies')}</p>
        <p>{t.t('store6.offline.where.exceptionsLead')}</p>
        <ul>
          <li data-kv-never-kept="payment">{t.t('store6.offline.where.payment')}</li>
          <li data-kv-never-kept="auction">{t.t('store6.offline.where.auction')}</li>
          <li data-kv-never-kept="offer">{t.t('store6.offline.where.offer')}</li>
        </ul>
        <p>
          <a href={store6Href(chrome, 'queued')} className="kv-btn--link" data-kv-link="queued">{t.t('store6.offline.link.queued')}</a>
          {' · '}<a href={store6Href(chrome, 'app')} className="kv-btn--link" data-kv-link="app">{t.t('store6.offline.link.app')}</a>
        </p>
      </section>

      <RefusalList surface="offline" />
    </article>
  );
}

/** W3127–W3130 — the offline form chain is DECOR: there is no act to complete, so each state prints the refusal and the live act. */
function OfflineFormChain({ chrome, state }: { chrome: AccountChrome; state: 'error' | 'review' | 'success' | 'failure' }) {
  const t = getTranslator();
  const live = chrome.kind === 'tenant' ? `/${chrome.slug}/search` : '/search';
  return (
    <section className="kv-state" data-kv-offline-form={state} aria-labelledby="kv-off-form">
      <h2 id="kv-off-form">{t.t(`store6.form.${state}.title`)}</h2>
      <p><strong>{t.t('store6.form.refused')}</strong></p>
      <p>{t.t(`store6.form.${state}.body`)}</p>
      <p>
        <a href={live} className="kv-btn" data-kv-live-act="add-to-cart">{t.t('store6.form.liveAct')}</a>{' '}
        <a href={store6Href(chrome, 'offline')} className="kv-btn--link" data-kv-back="offline">{t.t('store6.form.back')}</a>
      </p>
      <RefusalList surface="offline_form" />
    </section>
  );
}
