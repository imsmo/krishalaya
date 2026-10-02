// apps/web-tenant/src/app/people/ambassadors/[id]/edit/page.tsx · THE EDIT FORM CHAIN (the W159 row act "Edit") — the shared
// form pattern (edit → review → success | failure) over PATCH /ambassadors/:id · PC-56 TENANT-10a.
//
// The review is the API's (`POST /ambassadors/:id/review`): the DIFF against the profile as it stands (W2482's "diff against
// current values where applicable"), every refusal against its field, and "nothing changed" refused by name. The act is
// audited `ambassador.updated` with the before and after of exactly the fields that changed, and the reason when given
// (F-12: the stipend, tier and cluster edits used to write no audit row at all).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { AmbassadorReview, AmbassadorRosterRow } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { auditHref, chainStep, chainStepKey, failureKey, repeatedFailuresGapKey, retryHref, isFormError } from '../../../../../features/forms/chain';
import { AMBASSADORS_HREF, CLUSTER_SLOTS, carriedFrom, codeKey, consoleState, detailHref, formEntries, isUuid, minorToRupees, personKey } from '../../../../../features/ambassadors/console';
import { ProfileFormFields, ReviewTable } from '../../ProfileForm';
import { loadFormOptions } from '../../formOptions';
import { editAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('amb.editTitle'), robots: { index: false, follow: false } };
}

/** The profile as it stands → the form's values (stipend in rupees, clusters into the three slots). */
function valuesFromProfile(p: AmbassadorRosterRow): Record<string, string> {
  const v: Record<string, string> = { kiosk: p.kioskEnabled ? '1' : '0', aeps: p.aepsEnabled ? '1' : '0', stipend: minorToRupees(p.monthlyStipendMinor) };
  if (p.tierId) v.tierId = p.tierId;
  if (p.mentorAmbassadorId) v.mentorAmbassadorId = p.mentorAmbassadorId;
  p.clusterRegionIds.slice(0, 3).forEach((id, i) => { v[CLUSTER_SLOTS[i]] = id; });
  return v;
}

export default async function EditAmbassadorPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const base = `${detailHref(params.id)}/edit`;
  await requireSession(base);
  const t = getTranslator();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  if (!env.featureAmbassadors) {
    return <section><h1>{t.t('amb.editTitle')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('amb.state.flaggedOff.title')}</strong><p>{t.t('amb.state.flaggedOff.body')}</p></div></section>;
  }
  let profile: AmbassadorRosterRow | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state && step !== 'success') {
    try { profile = await tenantClient().ambassadors.get(params.id); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status); }
  }
  const carried = carriedFrom(searchParams);
  const values = step === 'edit' && Object.keys(carried).length === 0 && profile ? valuesFromProfile(profile) : carried;
  const { entries, stipendInvalid } = formEntries(values, false);
  const failed = (typeof searchParams.error === 'string' ? searchParams.error : '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const opts = profile && (step === 'edit' || step === 'review') ? await loadFormOptions(typeof searchParams.under === 'string' ? searchParams.under : undefined, entries.clusterRegionIds ?? []) : null;
  let review: AmbassadorReview | null = null;
  if (profile && step === 'review') {
    try { review = await tenantClient().ambassadors.reviewEdit(params.id, { ...entries, monthlyStipendMinor: stipendInvalid ? 'invalid' : entries.monthlyStipendMinor }); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status); }
  }
  const who = profile ? personKey(profile.displayName) : null;

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('amb.breadcrumb')}><Link href={AMBASSADORS_HREF}>{t.t('amb.title')}</Link> / <Link href={detailHref(params.id)}>{who ? t.t(who.key, who.vars) : t.t('amb.detail.title')}</Link> / <span aria-current="page">{t.t('amb.editTitle')}</span></nav>
      <h1>{t.t('amb.editTitle')}{profile && <span className="kv-field__hint"> · {profile.phoneMasked}</span>}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review)))} · {t.t('amb.chain.module')}</p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`amb.state.${state}.title`)}</strong><p>{t.t(`amb.state.${state}.body`)}</p></div>}

      {step === 'edit' && opts && profile && (
        <ProfileFormFields t={t} form="edit" action={base} values={values} tiers={opts.tiers} regions={opts.regions} parents={opts.parents} mentors={opts.mentors} under={opts.under} selfId={profile.id} />
      )}

      {step === 'review' && review && opts && (
        <>
          <ReviewTable t={t} form="edit" review={review} names={opts.names} />
          {review.ready ? (
            <form action={editAction} className="kv-actions">
              <input type="hidden" name="id" value={params.id} />
              {Object.entries(values).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.submit')}</button>{' '}
              <Link href={`${base}?${new URLSearchParams({ ...values, step: 'edit' }).toString()}`} className="kv-btn--link">{t.t('form.backToEdit')}</Link>
            </form>
          ) : (
            <p><span className="kv-field__hint">{t.t('form.fixFirst')}</span>{' '}<Link href={`${base}?${new URLSearchParams({ ...values, step: 'edit' }).toString()}`} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('amb.edit.done')}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          <p><Link href={auditHref('ambassador_profile', params.id)} className="kv-btn--link">{t.t('form.viewAudit')}</Link>{' · '}<Link href={detailHref(params.id)} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(base, carried)} className="kv-btn--link">{t.t('form.retry')}</Link>{' · '}<Link href={detailHref(params.id)} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
