// apps/web-tenant/src/app/people/ambassadors/new/page.tsx · THE RECRUIT FORM CHAIN — W2481 form-error · W2482 review ·
// W2483 success · W2484 failure · PC-56 TENANT-10a.
//
// edit → review → success | failure, ONE page, the values in the URL (features/forms/chain.ts). The member is found by
// PHONE — an existing member of this cooperative — and the review names them (short name + masked phone) before anything is
// written. The review is the API's own (`POST /ambassadors/review`), the same rule function the act re-runs inside its
// transaction, so a "ready" review cannot be followed by a refusal the review could have named. With refusals the review
// IS W2481 (every field's reason, the entries kept, nothing written). THE IDEMPOTENCY KEY IS MINTED ON THE REVIEW PAGE, so
// a double click on Submit writes one ambassador.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { AmbassadorReview } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { auditHref, chainStep, chainStepKey, failureKey, repeatedFailuresGapKey, retryHref, isFormError } from '../../../../features/forms/chain';
import { AMBASSADORS_HREF, NEW_AMBASSADOR_HREF, carriedFrom, codeKey, consoleState, detailHref, formEntries, isUuid } from '../../../../features/ambassadors/console';
import { ProfileFormFields, ReviewTable } from '../ProfileForm';
import { loadFormOptions } from '../formOptions';
import { recruitAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('amb.recruit.title'), robots: { index: false, follow: false } };
}

export default async function RecruitPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(NEW_AMBASSADOR_HREF);
  const t = getTranslator();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = carriedFrom(searchParams);
  const { entries, stipendInvalid } = formEntries(searchParams, true);
  const failed = (typeof searchParams.error === 'string' ? searchParams.error : '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const createdId = typeof searchParams.id === 'string' && isUuid(searchParams.id) ? searchParams.id : null;

  if (!env.featureAmbassadors) {
    return <section><h1>{t.t('amb.recruit.title')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('amb.state.flaggedOff.title')}</strong><p>{t.t('amb.state.flaggedOff.body')}</p></div></section>;
  }

  const opts = step === 'edit' || step === 'review' ? await loadFormOptions(typeof searchParams.under === 'string' ? searchParams.under : undefined, entries.clusterRegionIds ?? []) : null;
  let review: AmbassadorReview | null = null; let state: string | null = null;
  if (step === 'review') {
    try { review = await tenantClient().ambassadors.reviewRecruit({ ...entries, monthlyStipendMinor: stipendInvalid ? 'invalid' : entries.monthlyStipendMinor }); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status); }
  }
  const formError = isFormError(step, review);

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('amb.breadcrumb')}><Link href={AMBASSADORS_HREF}>{t.t('amb.title')}</Link> / <span aria-current="page">{t.t('amb.recruit.title')}</span></nav>
      <h1>{t.t('amb.recruit.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, formError))} · {t.t('amb.chain.module')}</p>

      {step === 'edit' && opts && (
        <>
          <p className="kv-field__hint">{t.t('amb.recruit.lede')}</p>
          <ProfileFormFields t={t} form="recruit" action={NEW_AMBASSADOR_HREF} values={values} tiers={opts.tiers} regions={opts.regions} parents={opts.parents} mentors={opts.mentors} under={opts.under} />
        </>
      )}

      {step === 'review' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`amb.state.${state}.title`)}</strong><p>{t.t(`amb.state.${state}.body`)}</p></div>}
          {review && opts && <ReviewTable t={t} form="recruit" review={review} names={opts.names} />}
          {review && review.ready ? (
            <form action={recruitAction} className="kv-actions">
              {Object.entries(values).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.submit')}</button>{' '}
              <Link href={`${NEW_AMBASSADOR_HREF}?${new URLSearchParams({ ...values, step: 'edit' }).toString()}`} className="kv-btn--link">{t.t('form.backToEdit')}</Link>
            </form>
          ) : (
            <p><span className="kv-field__hint">{t.t('form.fixFirst')}</span>{' '}
              <Link href={`${NEW_AMBASSADOR_HREF}?${new URLSearchParams({ ...values, step: 'edit' }).toString()}`} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('amb.recruit.done')}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          <p>{createdId && <><Link href={auditHref('ambassador_profile', createdId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link>{' · '}<Link href={detailHref(createdId)} className="kv-btn--link">{t.t('amb.recruit.open')}</Link>{' · '}</>}
            <Link href={AMBASSADORS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(NEW_AMBASSADOR_HREF, values)} className="kv-btn--link">{t.t('form.retry')}</Link>{' · '}<Link href={AMBASSADORS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
