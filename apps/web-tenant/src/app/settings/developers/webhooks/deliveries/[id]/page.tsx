// apps/web-tenant/src/app/settings/developers/webhooks/deliveries/[id]/page.tsx · W189 "Payload" — the MASKED payload viewer and every
// attempt of one delivery · PC-56 TENANT-13a. The payload is the catalogue's v1 projection (no member PII by construction); the API masks
// any *_phone / *Name / address / email key defensively and says so (`masked: true`). Each attempt row: number, outcome (delivered /
// failed / refused — the guard sent nothing), HTTP, duration, the error class, when it was signed and with how many signatures (two inside a
// rotation window). Replay (original payload, fresh signature) opens the mutate chain W2829–W2831.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { WebhookDeliveryDetail } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../../lib/i18n';
import { DELIVERIES_HREF, deliveryHref, isUuid, nextRetryCell, pageState, replayBase } from '../../../../../../features/webhooks/webhooks';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('wh.payload.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function DeliveryPage({ params }: { params: { id: string } }) {
  await requireSession(deliveryHref(params.id));
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'medium' }) : '—');
  let d: WebhookDeliveryDetail | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state) {
    try { d = await tenantClient().webhooks.delivery(params.id); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status, true); }
  }
  const nx = d ? nextRetryCell(d) : null;
  return (
    <section>
      <nav aria-label={t.t('wh.breadcrumb.label')} className="kv-field__hint"><Link href={DELIVERIES_HREF} className="kv-btn--link">{t.t('wh.log.crumb')}</Link> › {t.t('wh.payload.title')}</nav>
      <h1>{t.t('wh.payload.title')}</h1>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`wh.state.log.${state}.title`)}</strong><p>{t.t(`wh.state.log.${state}.body`)}</p>
          <p><Link href={DELIVERIES_HREF} className="kv-btn--link">{t.t('wh.payload.back')}</Link></p>
        </div>
      )}
      {d && nx && (
        <>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('wh.log.col.event')}</dt><dd><code>{d.eventType}</code> · {t.t('wh.payload.version', { v: d.payloadVersion ?? 1 })}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('wh.list.col.endpoint')}</dt><dd>{d.endpointHost}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('wh.payload.state')}</dt><dd>{t.t(`wh.delivery.state.${d.state}`)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('wh.log.col.next')}</dt><dd>{t.t(nx.key, { at: when(nx.at), step: nx.step ?? '' })}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('wh.log.col.when')}</dt><dd>{when(d.createdAt)}</dd></div>
          </dl>
          <p className="kv-field__hint">{t.t('wh.payload.masked')}</p>
          <pre className="kv-code">{JSON.stringify(d.payload, null, 2)}</pre>
          <h2>{t.t('wh.payload.attempts')}</h2>
          {d.attemptsList.length === 0 ? <p className="kv-field__hint">{t.t('wh.payload.noAttempts')}</p> : (
            <table className="kv-table">
              <thead><tr><th scope="col">#</th><th scope="col">{t.t('wh.payload.outcome')}</th><th scope="col">{t.t('wh.log.col.http')}</th><th scope="col">{t.t('wh.payload.duration')}</th><th scope="col">{t.t('wh.payload.error')}</th><th scope="col">{t.t('wh.payload.signed')}</th></tr></thead>
              <tbody>{d.attemptsList.map((a) => (
                <tr key={a.attemptNo}>
                  <td>{a.attemptNo}</td><td>{t.t(`wh.attempt.${a.outcome}`)}</td><td>{a.statusCode ?? '—'}</td>
                  <td>{t.t('wh.payload.ms', { ms: formatNumber(a.durationMs, lang) })}</td><td>{a.error ?? '—'}</td>
                  <td>{a.signedAt ? t.t('wh.payload.signedWith', { at: when(a.signedAt), n: a.signatures }) : t.t('wh.payload.notSigned')}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {['retrying', 'exhausted', 'delivered'].includes(d.state) && d.endpointStatus === 'active' && (
            <p><Link href={`${replayBase(d.id)}?step=confirm`} className="kv-btn kv-btn--primary">{t.t('wh.replay.button')}</Link></p>
          )}
          <p><Link href={DELIVERIES_HREF} className="kv-btn--link">{t.t('wh.payload.back')}</Link></p>
        </>
      )}
    </section>
  );
}
