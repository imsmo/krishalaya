// apps/web-partner/src/components/partner1/DeliveriesTable.tsx · PC-56 PARTNER-1b · founder D2 — THE DELIVERY LOG of the partner's own endpoints
// (canon W268 "Recent deliveries"), presentational: newest first, the rail's retention window; the state filter in the rail's own words;
// keyset pages ("older"); each row → its attempts (`?delivery=<id>`). NO payload body (the partner's server received it) and never the
// originating organisation. "Replay" is an ACT (the FLOWMAP classes it `filter` — DELTA) and leads to the DECOR act chain (W3021–W3023): a
// replay is run by the platform's partner operations on request. `DeliveryDetail` prints one delivery and every attempt.
import Link from 'next/link';
import { formatDate } from '@krishalaya/i18n';
import type { PartnerDeliveriesPage, PartnerDeliveryDetail, PartnerWebhookEndpoint } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { WEBHOOK_CONTRACT } from '../../features/partner1/webhook-contract';
import { deliveriesHref, deliveryStateKey } from '../../features/partner1/webhooks';

const when = (v: string | null, lang: string) => (v ? formatDate(v, lang, { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Kolkata' }) : '');
const urlOf = (endpoints: readonly PartnerWebhookEndpoint[], id: string) => endpoints.find((e) => e.id === id)?.url ?? null;

export function DeliveriesTable({ t, lang, page, endpoints, filter }: {
  t: Tr; lang: string; page: PartnerDeliveriesPage | null; endpoints: readonly PartnerWebhookEndpoint[]; filter: { state?: string; endpointId?: string; cursor?: string };
}) {
  return (
    <div className="kv-card" id="deliveries" data-kv-deliveries={page ? (page.items.length ? 'ok' : 'empty') : 'error'}>
      <h2 className="kv-card__title">{t.t('partner1.hooks.deliveries')}</h2>
      <p className="kv-field__hint">{t.t('partner1.hooks.deliveriesLead', { days: WEBHOOK_CONTRACT.retentionDays })}</p>
      <ul className="kv-filters" aria-label={t.t('partner1.hooks.filterLabel')}>
        <li><Link className={`kv-filter${!filter.state ? ' kv-filter--on' : ''}`} href={deliveriesHref(filter, { state: null })}>{t.t('partner1.hooks.filterAll')}</Link></li>
        {WEBHOOK_CONTRACT.deliveryStates.map((s) => (
          <li key={s}><Link className={`kv-filter${filter.state === s ? ' kv-filter--on' : ''}`} href={deliveriesHref(filter, { state: s })} data-kv-filter-state={s}>{t.t(deliveryStateKey(s))}</Link></li>
        ))}
      </ul>
      {!page && <p role="alert">{t.t('partner1.hooks.deliveriesError')}</p>}
      {page && page.items.length === 0 && <p>{t.t('partner1.hooks.deliveriesNone')}</p>}
      {page && page.items.length > 0 && (
        <table className="kv-table">
          <thead><tr>
            <th scope="col">{t.t('partner1.hooks.colTime')}</th><th scope="col">{t.t('partner1.hooks.colEvent')}</th><th scope="col">{t.t('partner1.hooks.colEndpoint')}</th>
            <th scope="col">{t.t('partner1.hooks.colAttempts')}</th><th scope="col">{t.t('partner1.hooks.colHttp')}</th><th scope="col">{t.t('partner1.hooks.colState')}</th>
            <th scope="col">{t.t('partner1.hooks.colActions')}</th>
          </tr></thead>
          <tbody>{page.items.map((d) => (
            <tr key={d.id} data-kv-delivery={d.id} data-kv-delivery-state={d.state}>
              <td>{when(d.createdAt, lang)}</td>
              <td><code className="kv-code">{d.eventType}</code></td>
              <td>{urlOf(endpoints, d.endpointId) ?? t.t('partner1.hooks.endpointUnknown')}</td>
              <td>{d.attempts}</td>
              <td>{d.lastStatusCode ?? t.t('partner1.hooks.noAnswer')}</td>
              <td>{t.t(deliveryStateKey(d.state))}</td>
              <td>
                <Link className="kv-btn--link" href={`/account/webhooks?delivery=${encodeURIComponent(d.id)}`}>{t.t('partner1.hooks.details')}</Link>{' '}
                <Link className="kv-btn--link" href="/account/webhooks?act=confirm" data-kv-decor="replay">{t.t('partner1.hooks.replay')}</Link>
              </td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="kv-pager">
        {filter.cursor && <Link className="kv-btn kv-btn--muted" href={deliveriesHref(filter, { cursor: null })}>{t.t('partner1.hooks.newest')}</Link>}{' '}
        {page?.nextCursor && <Link className="kv-btn kv-btn--muted" href={deliveriesHref(filter, { cursor: page.nextCursor })} data-kv-next>{t.t('partner1.hooks.older')}</Link>}
      </p>
    </div>
  );
}

export function DeliveryDetail({ t, lang, d, endpoints }: { t: Tr; lang: string; d: PartnerDeliveryDetail | null; endpoints: readonly PartnerWebhookEndpoint[] }) {
  if (!d) {
    return (
      <section className="kv-card" data-kv-delivery-detail="missing">
        <h1>{t.t('partner1.hooks.detail.title')}</h1>
        <p role="alert">{t.t('partner1.hooks.detail.missing', { days: WEBHOOK_CONTRACT.retentionDays })}</p>
        <p><Link className="kv-btn" href="/account/webhooks#deliveries">{t.t('partner1.hooks.backToList')}</Link></p>
      </section>
    );
  }
  return (
    <section className="kv-card" data-kv-delivery-detail={d.id}>
      <h1>{t.t('partner1.hooks.detail.title')}</h1>
      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('partner1.hooks.colEvent')}</dt><dd><code className="kv-code">{d.eventType}</code></dd></div>
        <div className="kv-facts__row"><dt>{t.t('partner1.hooks.colEndpoint')}</dt><dd>{urlOf(endpoints, d.endpointId) ?? t.t('partner1.hooks.endpointUnknown')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('partner1.hooks.colState')}</dt><dd>{t.t(deliveryStateKey(d.state))}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('partner1.hooks.colTime')}</dt><dd>{when(d.createdAt, lang)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('partner1.hooks.deliveredAt')}</dt><dd>{d.deliveredAt ? when(d.deliveredAt, lang) : t.t('partner1.hooks.notDelivered')}</dd></div>
      </dl>
      <p className="kv-field__hint">{t.t('partner1.hooks.detail.noBody')}</p>
      <h2 className="kv-card__title">{t.t('partner1.hooks.detail.attempts')}</h2>
      {d.attemptsList.length === 0 ? <p>{t.t('partner1.hooks.detail.noAttempts')}</p> : (
        <table className="kv-table">
          <thead><tr>
            <th scope="col">{t.t('partner1.hooks.colAttemptNo')}</th><th scope="col">{t.t('partner1.hooks.colOutcome')}</th><th scope="col">{t.t('partner1.hooks.colHttp')}</th>
            <th scope="col">{t.t('partner1.hooks.colDuration')}</th><th scope="col">{t.t('partner1.hooks.colError')}</th><th scope="col">{t.t('partner1.hooks.colSignedAt')}</th>
          </tr></thead>
          <tbody>{d.attemptsList.map((a) => (
            <tr key={a.attemptNo} data-kv-attempt={a.attemptNo}>
              <td>{a.attemptNo}</td><td>{t.t(`partner1.hooks.outcome.${a.outcome === 'delivered' || a.outcome === 'failed' || a.outcome === 'refused' ? a.outcome : 'failed'}`)}</td>
              <td>{a.statusCode ?? t.t('partner1.hooks.noAnswer')}</td><td>{t.t('partner1.hooks.ms', { ms: a.durationMs })}</td>
              <td>{a.error ?? ''}</td><td>{a.signedAt ? when(a.signedAt, lang) : t.t('partner1.hooks.notSigned')}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <p className="kv-pager">
        <Link className="kv-btn kv-btn--muted" href="/account/webhooks?act=confirm" data-kv-decor="replay">{t.t('partner1.hooks.replay')}</Link>{' '}
        <Link className="kv-btn" href="/account/webhooks#deliveries">{t.t('partner1.hooks.backToList')}</Link>
      </p>
    </section>
  );
}
