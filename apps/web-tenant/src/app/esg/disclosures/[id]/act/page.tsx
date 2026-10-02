// apps/web-tenant/src/app/esg/disclosures/[id]/act/page.tsx · THE ESG MUTATE CHAIN — W2602 confirm → W2603 success → W2604
// failure · PC-56 TENANT-9d.
//
// The canon's only act on this chain is *Retry* (W424's "Couldn't compile") — a PAGE LOAD, refused by name
// (`retryIsMutation() === false`). The state changes ESG actually has land HERE: **publish** a draft disclosure (its words
// fixed as reviewed — 0183's guard refuses a change in the same act; one published disclosure per metric) and **withdraw**
// one (a draft discarded, or a published one taken back) with a reason from the declared vocabulary. Both confirmed against
// the API's verdict on the disclosure AS IT STANDS (`POST …/acts/:act/preview`): `esg.disclose`, the state machine, another
// published disclosure on the metric, the reason, a note of 3–300 characters recorded word for word as the audit reason.
// The act re-takes the verdict under the row lock. THE KEY IS MINTED HERE.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { EsgActPreview } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { auditHref, failureKey, mutateStep, mutateStepKey, repeatedFailuresGapKey } from '../../../../../features/mutate/chain';
import { ESG_HREF, MAX_NOTE, MIN_NOTE, actKey, esgState, isDisclosureAct, reasonKey, refusalKey, statusKey } from '../../../../../features/esg/esg';
import { disclosureActAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('esg.act.title'), robots: { index: false, follow: false } };
}

export default async function EsgDisclosureActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  if (!env.featureEsg) notFound();
  const base = `${ESG_HREF}/disclosures/${encodeURIComponent(params.id)}/act`;
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const act = isDisclosureAct(searchParams.act) ? searchParams.act : 'publish';
  const step = mutateStep(searchParams.step);
  const reasonCode = (searchParams.reasonCode ?? '').trim().slice(0, 40);
  const note = (searchParams.note ?? '').trim().slice(0, MAX_NOTE + 50);
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const typed = note.length > 0 || reasonCode.length > 0;

  let pv: EsgActPreview | null = null; let state: string | null = null;
  if (step === 'confirm') {
    try { pv = await tenantClient().esg.previewDisclosureAct(params.id, act, { reasonCode: reasonCode || undefined, note: note || undefined }); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = esgState(err?.code, err?.status); }
  }
  // Words not typed yet are the question the form is asking, not a refusal to show.
  const wordCodes = new Set(['REASON_REQUIRED', 'NOTE_REQUIRED']);
  const shown = (pv?.refusals ?? []).filter((r) => typed || !wordCodes.has(r));
  const words = pv ? (pv.disclosure.texts[lang] ?? pv.disclosure.texts.en ?? Object.values(pv.disclosure.texts)[0] ?? '') : '';

  return (
    <section>
      <h1>{t.t(actKey(act))}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('esg.act.module')}</p>
      <p className="kv-field__hint"><Link href={ESG_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>

      {step === 'confirm' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`esg.state.${state}.title`)}</strong><p>{t.t(`esg.state.${state}.body`)}</p></div>}
          {pv && (
            <>
              <div className="kv-card">
                <p className="kv-field__hint">{pv.disclosure.metricCode} · {t.t(statusKey(pv.disclosure.status))}</p>
                <p>{words}</p>
                <p className="kv-field__hint">{t.t(`esg.act.rule.${act}`)}</p>
                <p className="kv-field__hint">{t.t('esg.act.recorded')}</p>
              </div>
              {shown.map((r) => <div className="kv-error" role="alert" key={r}><p>{t.t(refusalKey(r))}</p></div>)}
              <form action={base} method="get" className="kv-card kv-form">
                <input type="hidden" name="step" value="confirm" />
                <input type="hidden" name="act" value={act} />
                {act === 'withdraw' && (
                  <label className="kv-field" htmlFor="a-reason"><span>{t.t('esg.act.reasonCode')}</span>
                    <select id="a-reason" name="reasonCode" className="kv-select" defaultValue={reasonCode} required>
                      <option value="" disabled>{t.t('esg.act.reasonChoose')}</option>
                      {pv.reasons.map((r) => <option key={r} value={r}>{t.t(reasonKey(r))}</option>)}
                    </select></label>
                )}
                <label className="kv-field" htmlFor="a-note"><span>{t.t('esg.act.note')}</span>
                  <textarea id="a-note" name="note" className="kv-textarea" rows={3} defaultValue={note} maxLength={MAX_NOTE} minLength={MIN_NOTE} required /></label>
                <p className="kv-field__hint">{t.t('esg.act.noteHint', { min: String(MIN_NOTE), max: String(MAX_NOTE) })}</p>
                <button type="submit" className="kv-btn--link">{t.t('esg.act.check')}</button>
              </form>
              {pv.allowed ? (
                <form action={disclosureActAction}>
                  <input type="hidden" name="id" value={params.id} />
                  <input type="hidden" name="act" value={act} />
                  <input type="hidden" name="reasonCode" value={reasonCode} />
                  <input type="hidden" name="note" value={note} />
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t('esg.act.proceed')}</button>{' '}
                  <Link href={ESG_HREF} className="kv-btn--link">{t.t('esg.act.cancel')}</Link>
                </form>
              ) : <p className="kv-field__hint">{t.t('esg.act.notYet')}</p>}
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t(`esg.act.done.${act}`)}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          <p><Link href={auditHref('esg_disclosure', params.id)} className="kv-btn--link">{t.t('form.viewAudit')}</Link>{' · '}<Link href={ESG_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(refusalKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${base}?step=confirm&act=${act}${reasonCode ? `&reasonCode=${encodeURIComponent(reasonCode)}` : ''}`} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
          <p><Link href={ESG_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
