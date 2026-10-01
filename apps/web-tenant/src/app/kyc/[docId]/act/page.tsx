// apps/web-tenant/src/app/kyc/[docId]/act/page.tsx · THE KYC MUTATE CHAIN — W2323 confirm → W2324 success → W2325 failure
// · PC-56 TENANT-9a.
//
// The canon's acts on the `kyc` mutate chain are *Reveal full document (recorded)* and *Retry*. The reveal is real here,
// and so are the DESK's decisions the canon's W121/W122 imply but draw no chain for: *Verify*, *Reject* (a coded reason),
// *Ask for more* (a coded reason — the canon's "rejected → fixable"). *Retry* (couldn't-load) is a PAGE LOAD and is refused
// by name. The confirm step is the API's verdict (`POST …/acts/:act/preview`) on the document AS IT STANDS — maker ≠
// checker, never your own, never your organisation as its admin, evidence opened before deciding, a clean scan, not lapsed
// — with the reason and note judged once typed. The act re-takes the verdict under the row lock. THE KEY IS MINTED HERE.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { KycActPreview, KycDeskCatalogue } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator } from '../../../../lib/i18n';
import { auditHref, failureKey, mutateStep, mutateStepKey, repeatedFailuresGapKey } from '../../../../features/mutate/chain';
import { MAX_NOTE, MIN_REVEAL_REASON, actKey, deskState, docHref, failureCodeKey, isDeskAct, reasonKey, refusalKey, statusKey } from '../../../../features/kyc/desk';
import { kycActAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('kyc.act.title'), robots: { index: false, follow: false } };
}

export default async function KycActPage({ params, searchParams }: { params: { docId: string }; searchParams: Record<string, string | undefined> }) {
  const base = `${docHref(params.docId)}/act`;
  await requireSession(base);
  const t = getTranslator();
  const act = isDeskAct(searchParams.act) ? searchParams.act : 'reveal';
  const step = mutateStep(searchParams.step);
  const reasonCode = (searchParams.reasonCode ?? '').trim();
  const note = (searchParams.note ?? '').trim();
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const link = typeof searchParams.link === 'string' && /^https:\/\//.test(searchParams.link) ? searchParams.link : null;
  const typed = note.length > 0 || reasonCode.length > 0;

  let pv: KycActPreview | null = null; let state: string | null = null; let cat: KycDeskCatalogue | null = null;
  if (step === 'confirm') {
    try { pv = await tenantClient().kyc.deskActPreview(params.docId, act, { reasonCode: reasonCode || undefined, note: note || undefined }); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = deskState(err?.code, err?.status); }
    if (act === 'reject' || act === 'request_more') { try { cat = await tenantClient().kyc.deskCatalogue(); } catch { cat = null; } }
  }
  // Words not typed yet are not a refusal to show — they are the question the form is asking.
  const wordCodes = new Set(['REASON_REQUIRED', 'REVEAL_REASON_TOO_SHORT', 'NOTE_REQUIRED']);
  const shown = (pv?.refusals ?? []).filter((r) => typed || !wordCodes.has(r));
  const reasons = (cat?.reasons ?? []).filter((r) => r.acts.includes(act));

  return (
    <section>
      <h1>{t.t(actKey(act))}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('kyc.act.module')}</p>
      <p className="kv-field__hint"><Link href={docHref(params.docId)} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>

      {step === 'confirm' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><p>{t.t(state === 'notFound' ? 'kyc.doc.state.notFound.body' : `kyc.desk.state.${state}.body`)}</p></div>}
          {pv && (
            <>
              <div className="kv-card">
                <p>{t.t('kyc.act.object', { status: t.t(statusKey(pv.document.status)) })}</p>
                <p className="kv-field__hint">{t.t(act === 'reveal' ? 'kyc.act.revealRule' : act === 'verify' ? 'kyc.act.verifyRule' : 'kyc.act.refuseRule')}</p>
                <p className="kv-field__hint">{t.t('kyc.act.recorded')}</p>
              </div>
              {shown.map((r) => <div className="kv-error" role="alert" key={r}><p>{t.t(refusalKey(r))}</p></div>)}
              <form action={base} method="get" className="kv-card kv-form">
                <input type="hidden" name="step" value="confirm" />
                <input type="hidden" name="act" value={act} />
                {(act === 'reject' || act === 'request_more') && (
                  <label className="kv-field" htmlFor="a-reason"><span>{t.t('kyc.act.reasonCode')}</span>
                    <select id="a-reason" name="reasonCode" className="kv-select" defaultValue={reasonCode} required>
                      <option value="" disabled>{t.t('kyc.act.reasonChoose')}</option>
                      {reasons.map((r) => <option key={r.code} value={r.code}>{t.t(reasonKey(r.code))}{r.needsNote ? ` · ${t.t('kyc.act.needsNote')}` : ''}</option>)}
                    </select></label>
                )}
                <label className="kv-field" htmlFor="a-note"><span>{t.t(act === 'reveal' ? 'kyc.act.revealReason' : 'kyc.act.note')}</span>
                  <textarea id="a-note" name="note" className="kv-textarea" rows={3} defaultValue={note} maxLength={MAX_NOTE} required={act === 'reveal'} minLength={act === 'reveal' ? MIN_REVEAL_REASON : undefined} /></label>
                <p className="kv-field__hint">{t.t(act === 'reveal' ? 'kyc.act.revealReasonHint' : act === 'verify' ? 'kyc.act.noteHintVerify' : 'kyc.act.noteHint')}</p>
                <button type="submit" className="kv-btn--link">{t.t('kyc.act.check')}</button>
              </form>
              {pv.allowed && (typed || act === 'verify') ? (
                <form action={kycActAction}>
                  <input type="hidden" name="id" value={params.docId} />
                  <input type="hidden" name="act" value={act} />
                  <input type="hidden" name="reasonCode" value={reasonCode} />
                  <input type="hidden" name="note" value={note} />
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t('kyc.act.proceed')}</button>{' '}
                  <Link href={docHref(params.docId)} className="kv-btn--link">{t.t('kyc.act.cancel')}</Link>
                </form>
              ) : <p className="kv-field__hint">{t.t('kyc.act.notYet')}</p>}
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t(`kyc.act.done.${act}`)}</p>
          {act === 'reveal' && link && <p><a href={link} className="kv-btn" rel="noopener noreferrer">{t.t('kyc.act.openEvidence')}</a> <span className="kv-field__hint">{t.t('kyc.act.linkExpires')}</span></p>}
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          <p><Link href={auditHref('kyc_document', params.docId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link>{' · '}<Link href={docHref(params.docId)} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(failureCodeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${base}?step=confirm&act=${act}${reasonCode ? `&reasonCode=${encodeURIComponent(reasonCode)}` : ''}`} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
        </div>
      )}
    </section>
  );
}
