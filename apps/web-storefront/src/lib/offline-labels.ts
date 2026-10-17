// apps/web-storefront/src/lib/offline-labels.ts · PC-56 STORE-6a — the catalogue words the offline pieces carry (both chromes read them here, so
// the platform and every organisation say the same thing in en / hi / gu). Server-side through lib/i18n (itself server-only); the client
// pieces get plain strings.
import { getTranslator } from './i18n';
import { REASON_KEYS } from '../features/store6/acts';
import type { SignalLabels } from '../components/OnlineGuard';
import type { BandLabels } from '../components/offline/CachedBand';
import type { UpdateLabels } from '../components/offline/UpdateNotice';

/** The port's banner labels, storefront words; "Why?" → the policy page of THIS chrome (`/offline` or `/<slug>/offline`). */
export function signalLabels(policyHref: string): SignalLabels {
  const t = getTranslator();
  return { banner: t.t('store6.signal.banner'), detail: t.t('store6.signal.detail'), needsSignal: t.t('store6.signal.needsSignal'), policy: t.t('store6.signal.policy'), policyHref };
}

/** Every reason, in words (features/store6/acts.ts `ReasonKey` → `store6.reason.<key>`). */
export function reasonWords(): Record<string, string> {
  const t = getTranslator();
  return Object.fromEntries(REASON_KEYS.map((k) => [k, t.t(`store6.reason.${k}`)]));
}

export function bandLabels(): BandLabels {
  const t = getTranslator();
  return {
    offline: t.t('store6.band.offline'), online: t.t('store6.band.online'), asOf: t.t('store6.band.asOf'), now: t.t('asOf.now'),
    minutes: t.t('asOf.minutes'), hours: t.t('asOf.hours'), days: t.t('asOf.days'), ago: t.t('asOf.ago'),
    pricesMoved: t.t('store6.band.pricesMoved'), moneyWord: t.t('store6.band.moneyWord'), reload: t.t('store6.band.reload'),
  };
}

export function updateLabels(): UpdateLabels {
  const t = getTranslator();
  return { ready: t.t('store6.update.ready'), refresh: t.t('store6.update.refresh'), later: t.t('store6.update.later') };
}
