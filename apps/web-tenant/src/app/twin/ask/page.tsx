// apps/web-tenant/src/app/twin/ask/page.tsx · THE LOCKED PAGE'S ONE ACT — W2804 confirm → W2805 success → W2806 failure · PC-56 TENANT-12.
// "Ask your account desk" asks once. The confirm says exactly what happens: one recorded request for the Twin licence for this
// cooperative; asking again (by anyone) changes nothing; no countdown, no reminders, nothing billed. Success reads the audit entry
// back (AuditEntryCard). Back / Retry return to W420 (the originating screen). Retry is a page load back to confirm.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { TwinAccess } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getLang, getTranslator } from '../../../lib/i18n';
import { failureKey, mutateStep, mutateStepKey, repeatedFailuresGapKey } from '../../../features/mutate/chain';
import { AuditEntryCard } from '../../people/ambassadors/AuditEntryCard';
import { ASK_HREF, PLAN_HREF, TWIN_HREF, isUuid, refusalKey, twinState } from '../../../features/twin/twin';
import { askDeskAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('twin.ask.title'), robots: { index: false, follow: false } };
}

export default async function TwinAskPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(ASK_HREF);
  const t = getTranslator();
  const lang = getLang();
  const step = mutateStep(searchParams.step);
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  let access: TwinAccess | null = null; let state: string | null = null;
  if (step === 'confirm') {
    try { access = await tenantClient().twin.access(); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = twinState(err?.code, err?.status); }
  }
  const rid = isUuid(searchParams.rid) ? searchParams.rid : null;

  return (
    <section>
      <nav aria-label={t.t('twin.breadcrumb.label')} className="kv-field__hint">{t.t('twin.breadcrumb.area')} › {t.t('twin.overview.crumb')} › {t.t('twin.ask.title')}</nav>
      <h1>{t.t('twin.ask.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('twin.chain.module')}</p>
      <p className="kv-field__hint"><Link href={TWIN_HREF} className="kv-btn--link">{t.t('twin.chain.back')}</Link></p>

      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`twin.state.${state}.title`)}</strong><p>{t.t(`twin.state.${state}.body`)}</p></div>}

      {step === 'confirm' && access && (
        <div className="kv-card">
          {access.enabled && <p role="status">{t.t('twin.ask.alreadyLicensed')}</p>}
          {!access.enabled && access.request && <p role="status">{t.t('twin.locked.asked', { when: formatDate(access.request.requestedAt, lang, { dateStyle: 'medium' }), who: access.request.requestedBy ?? t.t('twin.someone') })}</p>}
          {!access.enabled && !access.request && (
            <form action={askDeskAction}>
              <p>{t.t('twin.ask.confirmBody')}</p>
              <p className="kv-field__hint">{t.t('twin.ask.once')}</p>
              <input type="hidden" name="idem" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('twin.ask.proceed')}</button>{' '}
              <Link href={TWIN_HREF} className="kv-btn--link">{t.t('twin.chain.cancel')}</Link>
            </form>
          )}
          <p><Link href={PLAN_HREF} className="kv-btn--link">{t.t('twin.locked.planSheet')}</Link></p>
        </div>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-success" role="status">
            <strong>{t.t(searchParams.enabled === '1' ? 'twin.ask.alreadyLicensed' : searchParams.written === '1' ? 'twin.ask.recorded' : 'twin.ask.alreadyAsked')}</strong>
            <p>{t.t('twin.locked.noNag')}</p>
            <p><Link href={TWIN_HREF} className="kv-btn kv-btn--primary">{t.t('twin.chain.back')}</Link></p>
          </div>
          {rid && <AuditEntryCard t={t} lang={lang} entityType="twin_access_request" entityId={rid} action="twin.access_requested" />}
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('twin.chain.failedTitle')}</strong>
          <p>{t.t(failureKey())}</p>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((c) => <li key={c}>{t.t(refusalKey(c))}</li>)}</ul>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${ASK_HREF}?step=confirm`} className="kv-btn--link">{t.t('twin.chain.retry')}</Link> · <Link href={TWIN_HREF} className="kv-btn--link">{t.t('twin.chain.back')}</Link></p>
        </div>
      )}
    </section>
  );
}
