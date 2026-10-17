// apps/web-storefront/src/components/sync/SyncScreen.tsx · PC-56 STORE-6b · B8 / C2 (canon W315, REBUILT; the discard chain W3151–W3153) — "ON THIS
// PHONE". Under both chromes (`/sync`, `/<slug>/sync`). A SERVER page whose list is a client island reading THIS phone (components/sync/
// SyncList.tsx): the server never reads a session here (no cookie, no API call) — the page is the phone's, and a signed-out visitor sees it too
// (with nothing on it: sign-out wiped the drafts). Never marked cacheable (features/store6/sw-rules.ts `cacheableScope('/…/sync') === null`).
//   • the chain from the query (features/store6b/paths.ts): `?discard=<id>` (W3151 "Discard this draft? Nothing on the server changes"),
//     `?done=discarded` (W3152 "Discarded from this phone"), `?done=failed&discard=<id>` (W3153 "the draft is kept" + Retry);
//   • "this page loaded at <time>" (the drift-pinned `AsOf`, untouched) — the honest line instead of "Last full sync … on Wi-Fi";
//   • the rules rewritten to the truth (server wins — TRUE; you decide — your words are only on this phone and leave when YOU press Send;
//     re-confirm — STORE-2b's price-drift rule, unchanged), what is kept, when it goes;
//   • the sync engine refused BY NAME (features/store6b/refusals.ts, surface `sync`).
import { getTranslator, getLang } from '../../lib/i18n';
import { RefusalList } from '../RefusalList';
import { AsOf } from '../AsOf';
import { SyncList, type SyncLabels } from './SyncList';
import type { AccountChrome } from '../../features/store4a/account';
import { store6Href } from '../../features/store6/paths';
import { ASK_DAYS, EXPIRE_DAYS } from '../../features/store6b/drafts';
import { syncHref, type SyncState } from '../../features/store6b/paths';
import { formatNumber } from '@krishalaya/i18n';

export function syncLabels(): SyncLabels {
  const t = getTranslator();
  const lang = getLang();
  const days = formatNumber(ASK_DAYS, lang); const expire = formatNumber(EXPIRE_DAYS, lang);
  return {
    noscript: t.t('store6b.sync.noscript'), empty: t.t('store6b.sync.empty'), off: t.t('store6b.sync.off'), unavailable: t.t('store6b.sync.unavailable'),
    message: t.t('store6b.sync.kind.message'), review: t.t('store6b.sync.kind.review'), reviewEdit: t.t('store6b.sync.kind.reviewEdit'),
    noWords: t.t('store6b.sync.noWords'), sendNow: t.t('store6b.sync.sendNow'), sendNowHint: t.t('store6b.sync.sendNowHint'),
    discard: t.t('store6b.sync.discard'), askTitle: t.t('store6b.sync.ask.title'), askBody: t.t('store6b.sync.ask.body', { days, expire }),
    keep: t.t('store6b.sync.ask.keep'), expired: t.t('store6b.sync.expired', { days: expire }), proceed: t.t('store6b.sync.confirm.proceed'),
    gone: t.t('store6b.sync.confirm.gone'), listTitle: t.t('store6b.sync.listTitle'),
    now: t.t('store6b.age.now'), minutes: t.t('store6b.age.minutes', { n: '{n}' }), hours: t.t('store6b.age.hours', { n: '{n}' }), days: t.t('store6b.age.days', { n: '{n}' }),
  };
}

export function SyncScreen({ chrome, state, renderedAt }: { chrome: AccountChrome; state: SyncState; renderedAt: string }) {
  const t = getTranslator();
  const lang = getLang();
  const days = formatNumber(ASK_DAYS, lang); const expire = formatNumber(EXPIRE_DAYS, lang);
  const asOf = {
    asOf: t.t('store6b.sync.loadedAt'), now: t.t('asOf.now'), minutes: t.t('asOf.minutes'), hours: t.t('asOf.hours'), days: t.t('asOf.days'),
    ago: t.t('asOf.ago'), stale: t.t('asOf.stale'), staleCell: t.t('asOf.stale'), refresh: t.t('asOf.refresh'),
  };
  const list = syncHref(chrome);
  return (
    <article className="kv-prose" data-kv-sync-screen="" data-kv-chrome={chrome.kind} data-kv-sync-state={state.kind}>
      <h1>{t.t('store6b.sync.title')}</h1>
      <p className="kv-prose__lead">{t.t(chrome.kind === 'tenant' ? 'store6b.sync.lead' : 'store6b.sync.leadPlatform')}</p>
      <AsOf at={renderedAt} labels={asOf} />

      {state.kind === 'confirm' && (
        <section className="kv-state" data-kv-chain="confirm" aria-labelledby="kv-s-confirm">
          <h2 id="kv-s-confirm">{t.t('store6b.sync.confirm.title')}</h2>
          <p>{t.t('store6b.sync.confirm.body')}</p>
          <p><a href={list} className="kv-btn--link" data-kv-cancel="discard">{t.t('store6b.sync.confirm.cancel')}</a></p>
        </section>
      )}
      {state.kind === 'discarded' && (
        <section className="kv-form__notice" role="status" data-kv-chain="success" aria-labelledby="kv-s-done">
          <h2 id="kv-s-done">{t.t('store6b.sync.done.title')}</h2>
          <p>{t.t('store6b.sync.done.body')}</p>
        </section>
      )}
      {state.kind === 'failed' && (
        <section className="kv-state kv-state--error" role="alert" data-kv-chain="failure" aria-labelledby="kv-s-failed">
          <h2 id="kv-s-failed">{t.t('store6b.sync.failed.title')}</h2>
          <p>{t.t('store6b.sync.failed.body')}</p>
          <p>
            <a href={syncHref(chrome, { kind: 'confirm', id: state.id })} className="kv-btn" data-kv-retry="discard">{t.t('store6b.sync.retry')}</a>{' '}
            <a href={list} className="kv-btn--link" data-kv-back="list">{t.t('store6b.sync.back')}</a>
          </p>
        </section>
      )}

      <section data-kv-sync-section="drafts" aria-labelledby="kv-s-list">
        <h2 id="kv-s-list">{t.t('store6b.sync.listTitle')}</h2>
        <SyncList chrome={chrome} state={state} labels={syncLabels()} />
        {state.kind !== 'list' && <p><a href={list} className="kv-btn--link" data-kv-back="list">{t.t('store6b.sync.back')}</a></p>}
      </section>

      <section data-kv-sync-section="rules" aria-labelledby="kv-s-rules">
        <h2 id="kv-s-rules">{t.t('store6b.sync.rules.title')}</h2>
        <ul>
          <li data-kv-rule="kept">{t.t('store6b.sync.rules.kept')}</li>
          <li data-kv-rule="send">{t.t('store6b.sync.rules.send')}</li>
          <li data-kv-rule="age">{t.t('store6b.sync.rules.age', { days, expire })}</li>
          <li data-kv-rule="wiped">{t.t('store6b.sync.rules.wiped')}</li>
          <li data-kv-rule="server-wins">{t.t('store6b.sync.rules.serverWins')}</li>
          <li data-kv-rule="you-decide">{t.t('store6b.sync.rules.youDecide')}</li>
          <li data-kv-rule="reconfirm">{t.t('store6b.sync.rules.reconfirm')}</li>
        </ul>
      </section>

      <p>
        <a href={store6Href(chrome, 'offline')} className="kv-btn--link" data-kv-link="offline">{t.t('store6b.sync.link.offline')}</a>{' · '}
        <a href={store6Href(chrome, 'queued')} className="kv-btn--link" data-kv-link="queued">{t.t('store6.offline.link.queued')}</a>
      </p>
      <RefusalList surface="sync" />
    </article>
  );
}
