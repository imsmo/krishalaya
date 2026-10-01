// apps/web-tenant/src/app/channels/whatsapp/settings/edit/page.tsx · THE OPT-IN POLICY FORM CHAIN — W2841 form-error →
// W2842 review → W2843 success → W2844 failure (the `whatsapp` module's form pattern, here over W430's one honest
// record) · PC-56 TENANT-8e. The sources are CHECKBOXES over the `whatsapp_optin_source` vocabulary (Law 6 — never free
// text), the statement a textarea; the API computes the review (vocabulary, repeats, the statement's bounds and plain text,
// the diff against the policy as it stands) and says, every time, that consent is NOT collected. The key is minted on the
// review page and carried in the form (F-17); the save is audited.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { WhatsAppOptinReview, WhatsAppOptinView } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';
import { getTranslator } from '../../../../../lib/i18n';
import { chainHref, chainStep, chainStepKey, failureKey, isFormError, nothingStoredKey, readCarried, repeatedFailuresGapKey, storedText } from '../../../../../features/forms/chain';
import { WA_POLICY_FORM_HREF, WA_SETTINGS_HREF, transportState } from '../../../../../features/comms/broadcasts';
import { saveOptinPolicyAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('wa.optin.form.title'), robots: { index: false, follow: false } }; }

const all = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).map((s) => s.trim()).filter(Boolean);

export default async function OptinPolicyFormPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(WA_POLICY_FORM_HREF);
  const t = getTranslator();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const c = tenantClient().notifications;
  let view: WhatsAppOptinView | null = null; let state = 'data';
  try { view = await c.whatsappOptinPolicy(); } catch (e) { const err = e instanceof SdkError ? e : null; state = transportState(err?.code, err?.status); }
  const carried = readCarried(searchParams, ['consentStatement']);
  const typed = all(searchParams.sources);
  const fresh = step === 'edit' && typed.length === 0 && !carried.consentStatement;
  const sources = fresh ? (view?.policy?.sources ?? []) : typed;
  const statement = fresh ? (view?.policy?.consentStatement ?? '') : (carried.consentStatement ?? '');
  const backQs = () => { const q = new URLSearchParams(); for (const s of sources) q.append('sources', s); if (statement) q.set('consentStatement', statement); return q; };
  let review: WhatsAppOptinReview | null = null; let reviewError: string | null = null;
  if (step === 'review') { try { review = await c.previewWhatsAppOptinPolicy({ sources, consentStatement: statement }); } catch (e) { reviewError = e instanceof SdkError ? (e.code || 'review') : 'review'; } }
  const refusal = (code: string) => t.t(`wa.optin.refusal.${code}`);

  return (
    <section>
      <h1>{t.t('wa.optin.form.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review)))} · {t.t('wa.optin.form.module')}</p>
      <p className="kv-field__hint"><Link href={WA_SETTINGS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
      <div className="kv-card kv-card--notice" role="note"><p>{t.t('wa.optin.notCollected')}</p><p className="kv-field__hint">{t.t('wa.optin.why')}</p></div>
      {!view && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="status"><p>{t.t(`wa.state.${state}`)}</p></div>}

      {view && step === 'edit' && (
        <form action={WA_POLICY_FORM_HREF} method="get" className="kv-card kv-form">
          <input type="hidden" name="step" value="review" />
          <fieldset className="kv-fieldset">
            <legend>{t.t('wa.optin.sources')}</legend>
            {view.sources.map((s) => (
              <label key={s.code} className="kv-check" htmlFor={`src-${s.code}`}>
                <input type="checkbox" id={`src-${s.code}`} name="sources" value={s.code} defaultChecked={sources.includes(s.code)} /> {s.name} <code>{s.code}</code>
              </label>
            ))}
          </fieldset>
          <label className="kv-field" htmlFor="st"><span>{t.t('wa.optin.statement')}</span><textarea id="st" name="consentStatement" className="kv-textarea" rows={4} maxLength={600} defaultValue={statement} required /></label>
          <p className="kv-field__hint">{t.t('wa.optin.statementHint')}</p>
          <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
        </form>
      )}

      {step === 'review' && (
        <>
          {reviewError && <div className="kv-error" role="alert"><p>{t.t('form.reviewFailed')} <code>{reviewError}</code></p></div>}
          {review && (
            <>
              {review.refusals.filter((r) => r.field === null).map((r) => <div className="kv-error" role="alert" key={r.code}><p>{refusal(r.code)}</p></div>)}
              <table className="kv-table">
                <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.entered')}</th><th scope="col">{t.t('form.col.stored')}</th></tr></thead>
                <tbody>{review.fields.map((f) => (
                  <tr key={f.name}><th scope="row">{t.t(`wa.optin.field.${f.name}`)}</th><td>{f.entered ?? t.t('common.dash')}</td>
                    <td>{storedText(f).isNothing ? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span> : <strong>{storedText(f).text}</strong>}
                      {review!.refusals.filter((r) => r.field === f.name).map((r) => <div className="kv-error" key={r.code}>{refusal(r.code)}</div>)}</td></tr>
                ))}</tbody>
              </table>
              <p className="kv-field__hint">{t.t('wa.optin.collectionState')} <strong>{t.t('wa.optin.notCollected')}</strong></p>
              <p className="kv-field__hint">{t.t(review.diff === null ? 'form.diff.notApplicable' : 'form.diff.heading')}</p>
              {review.diff && review.diff.length > 0 && (
                <table className="kv-table"><tbody>{review.diff.map((d) => <tr key={d.field}><th scope="row">{t.t(`wa.optin.field.${d.field}`)}</th><td>{d.before ?? t.t('common.dash')}</td><td><strong>{d.after ?? t.t('common.dash')}</strong></td></tr>)}</tbody></table>
              )}
              {review.ready ? (
                <form action={saveOptinPolicyAction}>
                  {review.stored.sources.map((s) => <input type="hidden" name="sources" value={s} key={s} />)}
                  <input type="hidden" name="consentStatement" value={review.stored.consentStatement ?? ''} />
                  {view?.policy && <input type="hidden" name="expectVersion" value={String(view.policy.version)} />}
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn">{t.t('wa.optin.form.submit')}</button>
                </form>
              ) : <p className="kv-field__hint">{t.t('form.fixFirst')}</p>}
              <p><Link href={`${WA_POLICY_FORM_HREF}?${backQs().toString()}`} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
            </>
          )}
        </>
      )}
      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('wa.optin.form.done')}</p><p className="kv-field__hint">{t.t('form.auditNote')}</p>
          <p><Link href={WA_SETTINGS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')} <code>{typeof searchParams.error === 'string' ? searchParams.error : ''}</code></p>
          <p className="kv-field__hint">{t.t(failureKey())}</p><p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${chainHref(WA_POLICY_FORM_HREF, 'review', { consentStatement: statement })}${sources.map((s) => `&sources=${encodeURIComponent(s)}`).join('')}`} className="kv-btn--link">{t.t('form.retry')}</Link></p>
        </div>
      )}
    </section>
  );
}
