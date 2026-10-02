// apps/web-tenant/src/app/governance/resolutions/[id]/act/page.tsx · THE RESOLUTIONS MUTATE CHAIN — W2745 confirm → W2746
// success → W2747 failure · PC-56 TENANT-9b.
//
// The canon's only act on this chain is *Retry* (W198's couldn't-load) — a PAGE LOAD, refused by name (`retryIsMutation`).
// The real state changes the canon's lifecycle line names — *"Resolution lifecycle recorded"* — land HERE: **open · close ·
// withdraw**, each confirmed against the API's verdict on the resolution AS IT STANDS (`POST …/acts/:act/preview`): the
// permission (`governance.manage`), the state machine, a board election refused by name, a window already past, the
// reason from the declared vocabulary (close / withdraw), "the window has ended" only once it has, the SECOND PERSON on a
// special or dividend-class close, and a note of 3–300 characters, recorded word for word. What the act will FIX is shown
// before it happens: at open the rule the members vote under; at close the roll it records and the rule it closes under.
// The act re-takes the verdict under the row lock. THE KEY IS MINTED HERE.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { ResolutionActPreview } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { auditHref, failureKey, mutateStep, mutateStepKey, repeatedFailuresGapKey } from '../../../../../features/mutate/chain';
import {
  MAX_NOTE, MIN_NOTE, RESOLUTIONS_HREF, actKey, choiceKey, govState, isResolutionAct, majorityKey, outcomeKey, reasonKey, refusalKey, ruleVars, statusKey, typeKey,
} from '../../../../../features/governance/resolutions';
import { resolutionActAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('res.actTitle'), robots: { index: false, follow: false } };
}

export default async function ResolutionActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = `${RESOLUTIONS_HREF}/${encodeURIComponent(params.id)}/act`;
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const act = isResolutionAct(searchParams.act) ? searchParams.act : 'open';
  const step = mutateStep(searchParams.step);
  const reasonCode = (searchParams.reasonCode ?? '').trim().slice(0, 60);
  const note = (searchParams.note ?? '').trim().slice(0, MAX_NOTE + 50);
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const outcome = (searchParams.outcome ?? '').trim();
  const typed = note.length > 0 || reasonCode.length > 0;

  let pv: ResolutionActPreview | null = null; let state: string | null = null;
  if (step === 'confirm') {
    try { pv = await tenantClient().memberships.previewResolutionAct(params.id, act, { reasonCode: reasonCode || undefined, note: note || undefined }); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = govState(err?.code, err?.status); }
  }
  // Words not typed yet are not a refusal to show — they are the question the form is asking.
  const wordCodes = new Set(['REASON_REQUIRED', 'NOTE_REQUIRED']);
  const shown = (pv?.refusals ?? []).filter((r) => typed || !wordCodes.has(r));
  const rule = ruleVars(pv?.willRecord.rule ?? null);

  return (
    <section>
      <h1>{t.t(actKey(act))}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('res.act.module')}</p>
      <p className="kv-field__hint"><Link href={RESOLUTIONS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>

      {step === 'confirm' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`res.state.${state}.title`)}</strong><p>{t.t(`res.state.${state}.body`)}</p></div>}
          {pv && (
            <>
              <div className="kv-card">
                <p><strong>{pv.resolution.title}</strong></p>
                <p className="kv-field__hint">{t.t(typeKey(pv.resolution.resolutionType))} · {t.t(majorityKey(pv.resolution.majority))} · {t.t(statusKey(pv.resolution.status))}</p>
                <p className="kv-field__hint">{t.t(`res.act.rule.${act}`)}</p>
                {act === 'open' && rule && <p>{t.t('res.act.willFix', { quorum: `${Math.floor((pv.willRecord.rule?.quorumBp ?? 0) / 100)}%`, rule: t.t(rule.key, rule.vars) })}</p>}
                {act === 'open' && <p className="kv-field__hint">{t.t('res.act.ballotIs', { choices: (pv.willRecord.choices ?? []).map((c) => t.t(choiceKey(c))).join(' · ') || '—' })}</p>}
                {act === 'close' && <p>{t.t('res.act.willSnapshot', { cast: formatNumber(pv.willRecord.cast ?? 0, lang), eligible: formatNumber(pv.willRecord.eligibleNow ?? 0, lang) })}</p>}
                {act === 'close' && rule && <p className="kv-field__hint">{t.t(rule.key, rule.vars)} · {t.t(pv.willRecord.ruleFixedAt === 'open' ? 'res.rule.fixedAtOpen' : 'res.rule.fixedAtClose')}</p>}
                {act === 'close' && <p className="kv-field__hint">{t.t(pv.secondPerson ? 'res.act.secondPerson' : 'res.act.samePersonOk')}{pv.secondPerson && pv.resolution.openedByYou ? ` ${t.t('res.act.youOpenedIt')}` : ''}</p>}
                {act === 'withdraw' && <p className="kv-field__hint">{t.t('res.act.withdrawNote', { cast: formatNumber(pv.willRecord.cast ?? 0, lang) })}</p>}
                <p className="kv-field__hint">{t.t('res.act.recorded')}</p>
              </div>
              {shown.map((r) => <div className="kv-error" role="alert" key={r}><p>{t.t(refusalKey(r))}</p></div>)}
              <form action={base} method="get" className="kv-card kv-form">
                <input type="hidden" name="step" value="confirm" />
                <input type="hidden" name="act" value={act} />
                {act !== 'open' && (
                  <label className="kv-field" htmlFor="a-reason"><span>{t.t('res.act.reasonCode')}</span>
                    <select id="a-reason" name="reasonCode" className="kv-select" defaultValue={reasonCode} required>
                      <option value="" disabled>{t.t('res.act.reasonChoose')}</option>
                      {pv.reasons.map((r) => <option key={r} value={r}>{t.t(reasonKey(act, r))}</option>)}
                    </select></label>
                )}
                <label className="kv-field" htmlFor="a-note"><span>{t.t('res.act.note')}</span>
                  <textarea id="a-note" name="note" className="kv-textarea" rows={3} defaultValue={note} maxLength={MAX_NOTE} minLength={MIN_NOTE} required /></label>
                <p className="kv-field__hint">{t.t('res.act.noteHint', { min: String(MIN_NOTE), max: String(MAX_NOTE) })}</p>
                <button type="submit" className="kv-btn--link">{t.t('res.act.check')}</button>
              </form>
              {pv.allowed ? (
                <form action={resolutionActAction}>
                  <input type="hidden" name="id" value={params.id} />
                  <input type="hidden" name="act" value={act} />
                  <input type="hidden" name="reasonCode" value={reasonCode} />
                  <input type="hidden" name="note" value={note} />
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t('res.act.proceed')}</button>{' '}
                  <Link href={RESOLUTIONS_HREF} className="kv-btn--link">{t.t('res.act.cancel')}</Link>
                </form>
              ) : <p className="kv-field__hint">{t.t('res.act.notYet')}</p>}
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t(`res.act.done.${act}`)}</p>
          {act === 'close' && <p><strong>{t.t(outcomeKey(outcome))}</strong> <span className="kv-field__hint">{t.t('res.act.outcomeIsDb')}</span></p>}
          {(act === 'open' || act === 'close') && <p className="kv-field__hint">{t.t('res.act.membersTold')}</p>}
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          <p><Link href={auditHref('coop_resolution', params.id)} className="kv-btn--link">{t.t('form.viewAudit')}</Link>{' · '}<Link href={RESOLUTIONS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(refusalKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${base}?step=confirm&act=${act}${reasonCode ? `&reasonCode=${encodeURIComponent(reasonCode)}` : ''}`} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
          <p><Link href={RESOLUTIONS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
