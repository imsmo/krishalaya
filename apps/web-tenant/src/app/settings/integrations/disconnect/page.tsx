// apps/web-tenant/src/app/settings/integrations/disconnect/page.tsx · Disconnect a provider — the mutate chain W2647 confirm → (proposal) →
// W2649 failure · PC-56 TENANT-13c.
//   • the confirm names the connection (masked ref, status) and says what is true about money: nothing settles through a tenant connection
//     (payments run on the platform account), so a disconnect never waits on in-flight settlements — and the sentence says why;
//   • a reason (20–500) is required; the act is a PROPOSAL a second administrator confirms (owner + checker); success goes to its card;
//   • failure lists every refusal by name (one in flight per provider, a second administrator needed, …).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { IntegrationList, TenantIntegration } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../lib/i18n';
import { mutateStep, mutateStepKey } from '../../../../features/mutate/chain';
import { INTEGRATIONS_HREF, consumersKey, isProviderCode, pageState, parseCodes, refusalKey, statusKey } from '../../../../features/integrations/integrations';
import { proposeDisconnectAction } from '../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('int.disconnect.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function DisconnectPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(INTEGRATIONS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const provider = isProviderCode(searchParams.provider) ? searchParams.provider : null;
  const step = mutateStep(searchParams.step);
  const failed = parseCodes(searchParams.error);

  let c: TenantIntegration | null = null; let state: string | null = provider ? null : 'notFound';
  if (!state && step === 'confirm') {
    try {
      const data: IntegrationList = await tenantClient().integrations.list();
      c = data.items.find((i) => i.providerCode === provider && i.status !== 'disconnected') ?? null;
      if (!c) state = 'notFound';
    } catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status, true); }
  }

  return (
    <section>
      <nav aria-label={t.t('int.breadcrumb.label')} className="kv-field__hint">{t.t('int.breadcrumb.settings')} › <Link href={INTEGRATIONS_HREF} className="kv-btn--link">{t.t('int.list.crumb')}</Link> › {t.t('int.disconnect.title')}</nav>
      <h1>{t.t('int.disconnect.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('int.disconnect.module')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`int.state.${state}.title`)}</strong><p>{t.t(`int.state.${state}.body`)}</p>
          <p><Link href={INTEGRATIONS_HREF} className="kv-btn--link">{t.t('int.form.backToScreen')}</Link></p>
        </div>
      )}
      {step === 'confirm' && c && (
        <div className="kv-card">
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('int.list.col.provider')}</dt><dd>{c.providerName ?? c.providerCode}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('int.list.col.config')}</dt><dd>{c.maskedRef ? <code>{t.t('int.list.ref', { ref: c.maskedRef })}</code> : '—'}{c.credentialHint ? ` · ${c.credentialHint}` : ''}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('int.list.col.status')}</dt><dd>{t.t(statusKey(c.status))} · {when(c.verifiedAt)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('int.disconnect.consumers')}</dt><dd>{t.t(consumersKey(c.consumers))}</dd></div>
          </dl>
          <div className="kv-card kv-card--notice" role="note"><p>{t.t('int.note.disconnect')}</p></div>
          <form action={proposeDisconnectAction} className="kv-form">
            <input type="hidden" name="provider" value={c.providerCode} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <label className="kv-field" htmlFor="int-dc-reason"><span>{t.t('int.form.reason')}</span>
              <textarea id="int-dc-reason" name="reason" className="kv-textarea" rows={2} minLength={20} maxLength={500} required /></label>
            <p className="kv-field__hint">{t.t('int.disconnect.checker')}</p>
            <button type="submit" className="kv-btn kv-btn--danger">{t.t('int.disconnect.proceed')}</button>{' '}
            <Link href={INTEGRATIONS_HREF} className="kv-btn--link">{t.t('int.disconnect.cancel')}</Link>
          </form>
        </div>
      )}
      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('int.form.failure.title')}</strong>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((x) => <li key={x}>{t.t(refusalKey(x))}</li>)}</ul>
          <p>{t.t('int.form.failure.untouched')}</p>
          <p>
            {provider && <><Link href={`${INTEGRATIONS_HREF}/disconnect?provider=${encodeURIComponent(provider)}&step=confirm`} className="kv-btn--link">{t.t('int.form.failure.retry')}</Link>{' · '}</>}
            <Link href={INTEGRATIONS_HREF} className="kv-btn--link">{t.t('int.form.backToScreen')}</Link>
          </p>
        </div>
      )}
    </section>
  );
}
