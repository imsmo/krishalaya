// apps/web-tenant/src/app/settings/developers/webhooks/deliveries/[id]/replay/page.tsx · REPLAY ONE DELIVERY — W2829 confirm → W2830
// success → W2831 failure · PC-56 TENANT-13a. The confirm states the API's verdict (only retrying / exhausted / delivered, only to an
// active endpoint) and what replaying does: the ORIGINAL payload is re-queued now and signed afresh at send time; your handler should be
// idempotent. Reason required (audited); the Idempotency-Key is this page's. Success reads the audit entry back; Retry is a page load.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../../../../lib/session';
import { tenantClient } from '../../../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../../../lib/i18n';
import { MAX_REASON, MIN_REASON, mutateStep, mutateStepKey } from '../../../../../../../features/mutate/chain';
import { AuditEntryCard } from '../../../../../../people/ambassadors/AuditEntryCard';
import { DELIVERIES_HREF, deliveryHref, isUuid, pageState, parseCodes, refusalKey, replayBase } from '../../../../../../../features/webhooks/webhooks';
import { replayDeliveryAction } from '../../../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('wh.replay.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function ReplayPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = replayBase(params.id);
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const step = mutateStep(searchParams.step);
  const failed = parseCodes(searchParams.error);
  let v: Awaited<ReturnType<ReturnType<typeof tenantClient>['webhooks']['previewReplay']>> | null = null;
  let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state && step === 'confirm') {
    try { v = await tenantClient().webhooks.previewReplay(params.id); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status, true); }
  }
  const blocking = v ? v.refusals.filter((r) => !r.startsWith('REASON_')) : [];
  return (
    <section>
      <nav aria-label={t.t('wh.breadcrumb.label')} className="kv-field__hint"><Link href={DELIVERIES_HREF} className="kv-btn--link">{t.t('wh.log.crumb')}</Link> › {t.t('wh.replay.title')}</nav>
      <h1>{t.t('wh.replay.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('wh.replay.module')}</p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`wh.state.log.${state}.title`)}</strong><p>{t.t(`wh.state.log.${state}.body`)}</p></div>}
      {step === 'confirm' && v && (
        <div className="kv-card">
          <p>{t.t('wh.act.confirm.lede')}</p>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('wh.log.col.event')}</dt><dd><code>{v.delivery.eventType}</code> {v.delivery.eventRef ?? ''}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('wh.list.col.endpoint')}</dt><dd>{v.delivery.endpointHost}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('wh.payload.state')}</dt><dd>{t.t(`wh.delivery.state.${v.delivery.state}`)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('wh.log.col.when')}</dt><dd>{formatDate(v.delivery.createdAt, lang, { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>
          </dl>
          <div className="kv-card kv-card--notice" role="note"><p>{t.t('wh.replay.effect')}</p></div>
          {blocking.map((r) => <p key={r} className="kv-error" role="alert">{t.t(refusalKey(r))}</p>)}
          <p className="kv-field__hint">{t.t('wh.act.confirm.audit')}</p>
          {blocking.length === 0 && (
            <form action={replayDeliveryAction} className="kv-form">
              <input type="hidden" name="id" value={params.id} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <label className="kv-field" htmlFor="wh-rp-reason"><span>{t.t('wh.act.reason')}</span>
                <textarea id="wh-rp-reason" name="reason" className="kv-textarea" rows={2} minLength={MIN_REASON} maxLength={MAX_REASON} required /></label>
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('wh.replay.proceed')}</button>{' '}
              <Link href={deliveryHref(params.id)} className="kv-btn--link">{t.t('wh.act.cancel')}</Link>
            </form>
          )}
        </div>
      )}
      {step === 'success' && isUuid(params.id) && (
        <>
          <div className="kv-card kv-success" role="status"><strong>{t.t('wh.replay.done')}</strong><p><Link href={DELIVERIES_HREF} className="kv-btn kv-btn--primary">{t.t('wh.payload.back')}</Link></p></div>
          <AuditEntryCard t={t} lang={lang} entityType="webhook_delivery" entityId={params.id} action="webhook.delivery_replayed" />
        </>
      )}
      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('wh.form.failure.title')}</strong>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((c) => <li key={c}>{t.t(refusalKey(c))}</li>)}</ul>
          <p>{t.t('wh.form.failure.untouched')}</p>
          <p className="kv-field__hint">{t.t('wh.form.failure.onCall')}</p>
          <p><Link href={`${base}?step=confirm`} className="kv-btn--link">{t.t('wh.form.failure.retry')}</Link>{' · '}<Link href={DELIVERIES_HREF} className="kv-btn--link">{t.t('wh.payload.back')}</Link></p>
        </div>
      )}
    </section>
  );
}
