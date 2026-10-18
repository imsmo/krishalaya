// apps/web-partner/src/components/partner1/WebhooksView.tsx · PC-56 PARTNER-1b · founder D2 — WEBHOOKS (canon W268 at `account/webhooks`),
// presentational, READ-ONLY.
//   • the partner's OWN endpoints over `GET /v1/partner/webhooks`: the URL as stored (its own), the events, active, registered — never a secret;
//     the secret line says what is TRUE: held encrypted by the platform (the sender must reproduce the signature — not a hash); a new one is
//     arranged with the platform's partner operations;
//   • the events an endpoint can receive = 0090's allow-list (the API's `subscribableEvents`, pinned in features/partner1/webhook-contract.ts);
//   • the rail's CONTRACT from the constants (features/partner1/webhook-contract.ts, parity-pinned to the rail): the signature header and its
//     shape, the retry ladder and attempts, the send timeout and the response cap, the retention — no figure typed into a sentence; the
//     rail's secret-overlap is printed as what it is: an organisation's endpoints have it, a partner endpoint has no replacement pair yet;
//   • the delivery log (components/partner1/DeliveriesTable.tsx);
//   • Add endpoint (W3017–W3020) and Activate / Rotate secret / Send test ping / Replay (W3021–W3023) are DECOR: endpoints are registered and
//     changed by the platform's partner operations — write to the partners mailbox.
import Link from 'next/link';
import { formatDate } from '@krishalaya/i18n';
import type { PartnerDeliveriesPage, PartnerWebhookEndpoint } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import type { Mailbox } from './HelpView';
import { MailboxLine } from './MailboxLine';
import { RefusalList } from './RefusalList';
import { DeliveriesTable } from './DeliveriesTable';
import { WEBHOOK_CONTRACT as W } from '../../features/partner1/webhook-contract';
import { kib } from '../../features/partner1/webhooks';

export type HooksState = 'ok' | 'error' | 'off' | 'forbidden';
export interface WebhooksViewProps {
  t: Tr; lang: string; state: HooksState; endpoints: readonly PartnerWebhookEndpoint[]; events: readonly string[];
  deliveries: PartnerDeliveriesPage | null; filter: { state?: string; endpointId?: string; cursor?: string }; mailbox: Mailbox;
}

export function WebhooksView({ t, lang, state, endpoints, events, deliveries, filter, mailbox }: WebhooksViewProps) {
  if (state === 'off') return <section data-kv-hooks="off"><h1>{t.t('partner.off.title')}</h1><p className="kv-muted">{t.t('partner.off.body')}</p></section>;
  return (
    <section data-kv-hooks={state}>
      <h1>{t.t('partner1.hooks.title')}</h1>
      <p className="kv-muted">{t.t('partner1.hooks.lead')}</p>
      {state === 'forbidden' && <p role="alert">{t.t('partner1.hooks.forbidden')}</p>}
      {state === 'error' && <p role="alert">{t.t('partner1.hooks.error')} <Link className="kv-link" href="/account/webhooks">{t.t('partner1.hooks.retry')}</Link></p>}

      {state === 'ok' && (
        <>
          <div className="kv-card" data-kv-endpoints={endpoints.length ? 'ok' : 'empty'}>
            <h2 className="kv-card__title">{t.t('partner1.hooks.endpoints')}</h2>
            {endpoints.length === 0 ? <p>{t.t('partner1.hooks.endpointsNone')}</p> : (
              <table className="kv-table">
                <thead><tr>
                  <th scope="col">{t.t('partner1.hooks.colUrl')}</th><th scope="col">{t.t('partner1.hooks.colEvents')}</th>
                  <th scope="col">{t.t('partner1.hooks.colStatus')}</th><th scope="col">{t.t('partner1.hooks.colRegistered')}</th>
                </tr></thead>
                <tbody>{endpoints.map((e) => (
                  <tr key={e.id} data-kv-endpoint={e.id}>
                    <td>{e.url}</td>
                    <td>{e.eventTypes.map((x) => <code key={x} className="kv-code kv-scope">{x}</code>)}</td>
                    <td>{t.t(e.active ? 'partner1.hooks.active' : 'partner1.hooks.inactive')}</td>
                    <td>{e.createdAt ? formatDate(e.createdAt, lang, { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }) : ''}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
            <p>{t.t('partner1.hooks.secret')}</p>
            <p className="kv-actions" data-kv-decor="endpoint-acts">
              <Link className="kv-btn kv-btn--muted" href="/account/webhooks?form=review">{t.t('partner1.hooks.add')}</Link>{' '}
              <Link className="kv-btn kv-btn--muted" href="/account/webhooks?act=confirm">{t.t('partner1.hooks.activate')}</Link>{' '}
              <Link className="kv-btn kv-btn--muted" href="/account/webhooks?act=confirm">{t.t('partner1.hooks.newSecret')}</Link>{' '}
              <Link className="kv-btn kv-btn--muted" href="/account/webhooks?act=confirm">{t.t('partner1.hooks.ping')}</Link>
            </p>
            <p className="kv-field__hint">{t.t('partner1.hooks.writesRefused')}</p>
            <MailboxLine t={t} mailbox={mailbox} />
          </div>

          <div className="kv-card" data-kv-events>
            <h2 className="kv-card__title">{t.t('partner1.hooks.eventsTitle')}</h2>
            <p>{t.t('partner1.hooks.eventsLead')}</p>
            <ul className="kv-list">{events.map((x) => <li key={x}><code className="kv-code">{x}</code></li>)}</ul>
          </div>

          <DeliveriesTable t={t} lang={lang} page={deliveries} endpoints={endpoints} filter={filter} />
        </>
      )}

      <article className="kv-card kv-article" data-kv-contract>
        <h2 className="kv-card__title">{t.t('partner1.hooks.contractTitle')}</h2>
        <ul>
          <li>{t.t('partner1.hooks.contract.signature', { header: W.signatureHeader, legacy: W.legacySignatureHeader, format: W.headerFormat, algorithm: W.algorithm, signed: W.signedString })}</li>
          <li>{t.t('partner1.hooks.contract.ladder', { ladder: W.retryLadderLabels.join(' · '), attempts: W.maxAttempts })}</li>
          <li>{t.t('partner1.hooks.contract.timeout', { seconds: W.sendTimeoutSec, kib: kib(W.responseBodyCapBytes) })}</li>
          <li>{t.t('partner1.hooks.contract.delivered')}</li>
          <li>{t.t('partner1.hooks.contract.overlap', { hours: W.rotationOverlapHours })}</li>
          <li>{t.t('partner1.hooks.contract.retention', { days: W.retentionDays })}</li>
        </ul>
      </article>

      <RefusalList t={t} surface="webhooks" />
    </section>
  );
}
