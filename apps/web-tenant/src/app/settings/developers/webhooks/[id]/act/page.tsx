// apps/web-tenant/src/app/settings/developers/webhooks/[id]/act/page.tsx · THE ENDPOINT MUTATE CHAIN — W2836 confirm → W2837 success →
// W2838 failure · PC-56 TENANT-13a.
//   • the confirm states, BEFORE anything is pressed, what the act will do — as the API computed it (`previewAct`): pause holds N queued
//     deliveries; resume replays N held + exhausted ones in creation order (a disabled endpoint resumes only when the guard passes NOW,
//     and the confirm prints that verdict); rotate keeps the old secret signing until <time>; delete cancels N open deliveries;
//     replay-failed re-queues N failed ones. A reason (3–300) is required for every act and written to the audit row;
//   • rotate is a client component (RotateSecretConfirm) so the new secret lives in memory only (F-5); the others post a server action
//     and come back with an outcome code — never a value;
//   • success reads the audit entry back (AuditEntryCard: actor · time · reason · before → after); failure lists every refusal by name;
//     Retry is a page load back to confirm. Back returns to W188.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { WebhookActVerdict, WebhookEndpointAct } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../../lib/i18n';
import { MAX_REASON, MIN_REASON, mutateStep, mutateStepKey } from '../../../../../../features/mutate/chain';
import { auditHref } from '../../../../../../features/forms/chain';
import { AuditEntryCard } from '../../../../../people/ambassadors/AuditEntryCard';
import {
  WEBHOOKS_HREF, actBase, formKeysWithRefusals, isAct, isUuid, pageState, parseCodes, refusalKey, secretMask, statusKey,
} from '../../../../../../features/webhooks/webhooks';
import { endpointActAction } from '../../actions';
import { RotateSecretConfirm } from './RotateSecretConfirm';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('wh.act.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

const AUDIT_ACTION: Record<WebhookEndpointAct, string> = {
  pause: 'webhook.paused', resume: 'webhook.resumed', rotate: 'webhook.secret_rotated', delete: 'webhook.deleted', 'replay-failed': 'webhook.replay_failed',
};

export default async function EndpointActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = actBase(params.id);
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const act: WebhookEndpointAct = isAct(searchParams.act) ? searchParams.act : 'pause';
  const step = mutateStep(searchParams.step);
  const failed = parseCodes(searchParams.error);
  const moved = Number.isFinite(Number(searchParams.moved)) ? Number(searchParams.moved) : 0;

  let v: WebhookActVerdict | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state && step === 'confirm') {
    try { v = await tenantClient().webhooks.previewAct(params.id, act); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status, true); }
  }
  const blocking = v ? v.refusals.filter((r) => !r.startsWith('REASON_')) : [];
  const labels = Object.fromEntries(formKeysWithRefusals().map((k) => [k, t.t(k)]));

  return (
    <section>
      <nav aria-label={t.t('wh.breadcrumb.label')} className="kv-field__hint">{t.t('wh.breadcrumb.settings')} › {t.t('wh.breadcrumb.developers')} › <Link href={WEBHOOKS_HREF} className="kv-btn--link">{t.t('wh.list.crumb')}</Link> › {t.t(`wh.act.${act}.title`)}</nav>
      <h1>{t.t(`wh.act.${act}.title`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('wh.act.module')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`wh.state.${state}.title`)}</strong><p>{t.t(`wh.state.${state}.body`)}</p>
          <p><Link href={WEBHOOKS_HREF} className="kv-btn--link">{t.t('wh.form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'confirm' && v && (
        <div className="kv-card">
          <p>{t.t('wh.act.confirm.lede')}</p>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('wh.list.col.endpoint')}</dt><dd><code>{v.endpoint.url}</code></dd></div>
            <div className="kv-facts__row"><dt>{t.t('wh.list.col.status')}</dt><dd>{t.t(statusKey(v.endpoint))}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('wh.list.col.secret')}</dt><dd>{secretMask(v.endpoint.secretHint) ?? t.t('wh.list.noHint')}</dd></div>
          </dl>
          <div className="kv-card kv-card--notice" role="note">
            <strong>{t.t('wh.act.effect.title')}</strong>
            <p>{t.t(`wh.act.${act}.effect`, {
              n: formatNumber(v.effect.holds ?? v.effect.replays ?? v.effect.cancels ?? 0, lang),
              until: when(v.effect.previousSignsUntil),
            })}</p>
            {v.effect.guard && <p>{t.t(v.effect.guard.verdict === 'public' ? 'wh.act.resume.guardPublic' : 'wh.act.resume.guardRefused', { reason: t.t(`wh.guard.${v.effect.guard.reason ?? 'unresolvable'}`) })}</p>}
          </div>
          {blocking.map((r) => <p key={r} className="kv-error" role="alert">{t.t(refusalKey(r))}</p>)}
          <p className="kv-field__hint">{t.t('wh.act.confirm.audit')}</p>
          {blocking.length === 0 && act === 'rotate' && (
            <RotateSecretConfirm id={params.id} labels={labels} idempotencyKey={randomUUID()} backHref={WEBHOOKS_HREF}
              auditHref={auditHref('webhook_endpoint', params.id)} minReason={MIN_REASON} maxReason={MAX_REASON} />
          )}
          {blocking.length === 0 && act !== 'rotate' && (
            <form action={endpointActAction} className="kv-form">
              <input type="hidden" name="id" value={params.id} /><input type="hidden" name="act" value={act} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <label className="kv-field" htmlFor="wh-reason"><span>{t.t('wh.act.reason')}</span>
                <textarea id="wh-reason" name="reason" className="kv-textarea" rows={2} minLength={MIN_REASON} maxLength={MAX_REASON} required /></label>
              <p className="kv-field__hint">{t.t('wh.act.reasonHint')}</p>
              <button type="submit" className="kv-btn kv-btn--primary">{t.t(`wh.act.${act}.proceed`)}</button>{' '}
              <Link href={WEBHOOKS_HREF} className="kv-btn--link">{t.t('wh.act.cancel')}</Link>
            </form>
          )}
          {blocking.length > 0 && <p><Link href={WEBHOOKS_HREF} className="kv-btn--link">{t.t('wh.form.backToScreen')}</Link></p>}
        </div>
      )}

      {step === 'success' && isUuid(params.id) && act !== 'rotate' && (
        <>
          <div className="kv-card kv-success" role="status">
            <strong>{t.t(`wh.act.${act}.done`, { n: formatNumber(moved, lang) })}</strong>
            <p><Link href={WEBHOOKS_HREF} className="kv-btn kv-btn--primary">{t.t('wh.form.backToScreen')}</Link></p>
          </div>
          <AuditEntryCard t={t} lang={lang} entityType="webhook_endpoint" entityId={params.id} action={AUDIT_ACTION[act]} />
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('wh.form.failure.title')}</strong>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((c) => <li key={c}>{t.t(refusalKey(c))}</li>)}</ul>
          <p>{t.t('wh.form.failure.untouched')}</p>
          <p className="kv-field__hint">{t.t('wh.form.failure.onCall')}</p>
          <p>
            <Link href={`${base}?step=confirm&act=${act}`} className="kv-btn--link">{t.t('wh.form.failure.retry')}</Link>{' · '}
            <Link href={WEBHOOKS_HREF} className="kv-btn--link">{t.t('wh.form.backToScreen')}</Link>
          </p>
        </div>
      )}
    </section>
  );
}
