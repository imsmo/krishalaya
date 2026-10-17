// apps/web-storefront/src/components/offline/QueuedActionsScreen.tsx · PC-56 STORE-6a · C3 (canon W314, moved in from the sweep) — MONEY NEVER
// QUEUES, AND HERE IS THE WHOLE LIST. Under both chromes (`/queued`, `/<slug>/queued`). The list is features/store6/acts.ts — every money act
// (the 16 the founder named) and every countdown act (the sign-in and signup codes, the short-lived download links) with its reason in words,
// exactly as its button reads without signal ("Pay — needs signal: …"). Then the truth about everything else (it needs signal too — nothing is
// saved on the phone to send later; the person's own unsent words are STORE-6b's: "coming"), and the canon's queue drawer refused BY NAME —
// there is no queue, so no "queued / sending… / confirmed / failed — needs you", no "3 waiting to sync", no Undo / Fix, no auto-replay.
import { getTranslator } from '../../lib/i18n';
import { RefusalList } from '../RefusalList';
import type { AccountChrome } from '../../features/store4a/account';
import { actsOf, type ActEntry } from '../../features/store6/acts';
import { store6Href } from '../../features/store6/paths';

export function QueuedActionsScreen({ chrome }: { chrome: AccountChrome }) {
  const t = getTranslator();
  const needs = t.t('store6.signal.needsSignal');
  const row = (a: ActEntry) => (
    <li key={`${a.file}#${a.name}`} data-kv-act={a.id} data-kv-act-class={a.cls} data-kv-reason={a.reason}>
      <strong>{t.t(`store6.act.${a.id}`)}</strong> <span className="kv-signal__word">{`${needs}:`}</span> {t.t(`store6.reason.${a.reason}`)}
    </li>
  );
  return (
    <article className="kv-prose" data-kv-queued="" data-kv-chrome={chrome.kind}>
      <h1>{t.t('store6.queued.title')}</h1>
      <p className="kv-prose__lead">{t.t('store6.queued.lead')}</p>
      <section data-kv-queued-section="money" aria-labelledby="kv-q-money">
        <h2 id="kv-q-money">{t.t('store6.queued.money.title')}</h2>
        <ul>{actsOf('money').map(row)}</ul>
      </section>
      <section data-kv-queued-section="countdown" aria-labelledby="kv-q-count">
        <h2 id="kv-q-count">{t.t('store6.queued.countdown.title')}</h2>
        <ul>{actsOf('countdown').map(row)}</ul>
      </section>
      <section data-kv-queued-section="content" aria-labelledby="kv-q-content">
        <h2 id="kv-q-content">{t.t('store6.queued.content.title')}</h2>
        <p>{t.t('store6.queued.content.body')}</p>
        <p data-kv-coming="drafts"><em>{t.t('store6.queued.coming')}</em></p>
      </section>
      <p><a href={store6Href(chrome, 'offline')} className="kv-btn--link" data-kv-link="offline">{t.t('store6.queued.back')}</a></p>
      <RefusalList surface="queued" />
    </article>
  );
}
