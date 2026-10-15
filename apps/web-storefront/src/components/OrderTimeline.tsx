// apps/web-storefront/src/components/OrderTimeline.tsx · presentational order progress. Server component: maps the
// pure orderTimeline model to localized step labels. Off-path orders (cancelled / disputed) show a single status
// banner instead of a progress bar. The raw server status is always shown too (localized when known) so the UI
// never misrepresents the authoritative state.
//
// PC-56 STORE-3a · C2 (canon W289 "Where it stands"): + the HOPS, when the buyer's events read is given (`GET orders/:id/events` — the buyer
// receives `{ fromStatus, toStatus, actorRole, at }` only, HOTFIX-5): each hop's status, WHO moved it as a ROLE ("by you", "by the
// organisation", "by the system", "by the platform's moderators") and WHEN — never a person's name or id. `refunded` / `partially_refunded`
// are their own terminal banners (features/orders/timeline.ts).
import type { OrderTimelineEvent } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { getTranslator, getLang } from '../lib/i18n';
import { orderTimeline } from '../features/orders/timeline';
import { orderStatusKey } from '../features/store3a/order-status';

const ROLES = ['buyer', 'seller', 'system', 'moderator'] as const;
export const when = (v: string, lang: string) => formatDate(v, lang, { dateStyle: 'medium', timeStyle: 'short' });

export function OrderTimeline({ status, events = null }: { status: string; events?: ReadonlyArray<Pick<OrderTimelineEvent, 'toStatus' | 'actorRole' | 'at'>> | null }) {
  const t = getTranslator();
  const lang = getLang();
  const model = orderTimeline(status);

  const hops = events && events.length > 0 ? (
    <ol className="kv-timeline__hops" aria-label={t.t('store3a.timeline.hops')} data-kv-hops={events.length}>
      {[...events].sort((a, b) => Date.parse(String(a.at)) - Date.parse(String(b.at))).map((e, i) => {
        const role = (ROLES as readonly string[]).includes(String(e.actorRole)) ? String(e.actorRole) : null;
        return (
          <li key={`${e.toStatus}-${i}`} className="kv-timeline__hop" data-kv-hop={e.toStatus} data-kv-actor={role ?? 'unknown'}>
            <span className="kv-timeline__label">{t.t(orderStatusKey(e.toStatus))}</span>
            {role && <span className="kv-detail__muted"> · {t.t(`store3a.actor.${role}`)}</span>}
            {e.at && <span className="kv-detail__muted"> · <time dateTime={String(e.at)}>{when(String(e.at), lang)}</time></span>}
          </li>
        );
      })}
    </ol>
  ) : null;

  if (model.terminal) {
    return (
      <div className="kv-timeline__wrap">
        <p className={`kv-timeline__terminal kv-timeline__terminal--${model.terminal}`} role="status">
          {t.t(`order.terminal.${model.terminal}`)}
        </p>
        {hops}
      </div>
    );
  }

  return (
    <div className="kv-timeline__wrap">
      <ol className="kv-timeline" aria-label={t.t('order.timelineLabel')}>
        {model.stepKeys.map((key, i) => {
          const state = i < model.currentIndex ? 'done' : i === model.currentIndex ? 'current' : 'todo';
          return (
            <li key={key} className={`kv-timeline__step kv-timeline__step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="kv-timeline__dot" aria-hidden="true" />
              <span className="kv-timeline__label">{t.t(`order.step.${key}`)}</span>
            </li>
          );
        })}
      </ol>
      {hops}
    </div>
  );
}
