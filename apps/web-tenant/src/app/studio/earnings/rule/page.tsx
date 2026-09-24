// apps/web-tenant/src/app/studio/earnings/rule/page.tsx · the tenant's royalty split RULE — the desk's view and its
// confirm → success → failure chain · PC-56 TENANT-7d-money.
//
// W418: *"Tenant + platform (20%) — hosting, QA, payment rails."* The 20 is a RULE the tenant owns (0174
// `course_royalty_rules`): the platform default row (80 / 18 / 2) every tenant inherits, or the tenant's own — PROPOSED by
// one finance person (who chooses ONLY the instructor's share; the platform's is copied from the default, the tenant's is
// the remainder) and APPROVED or REJECTED by a DIFFERENT one (the API's verdict AND 0174's CHECK). The page prints the rule
// in force, the platform default and the history, as the API holds them; every percent is basis points rendered as text.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { RoyaltyRuleView } from '@krishalaya/sdk-js';
import { MAX_REASON, auditHref, canLinkAudit, carryValues, confirmHref, failureKey, mutateStep, mutateStepKey, readCarried, repeatedFailuresGapKey, retryToConfirm, valuesLostKey } from '../../../../features/mutate/chain';
import { RULE_FIELDS, RULE_PATH, earningsHref, earningsRefusedKey, percentToBps, ruleChainAct, shareText } from '../../../../features/studio/earnings';
import { ruleAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('earnings.rule.title'), robots: { index: false, follow: false } };
}

const when = (iso: string | null, lang: string) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : null);

export default async function RulePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const PATH = RULE_PATH;
  await requireSession(PATH);
  const t = getTranslator();
  const lang = getLang();
  const rawStep = typeof searchParams.step === 'string' ? searchParams.step : undefined;
  const step = rawStep ? mutateStep(rawStep) : null;   // no step = the desk's VIEW; a step = the chain
  const values = readCarried(searchParams, RULE_FIELDS);
  const carried = carryValues(step ?? 'confirm', values);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const failedRefusals = typeof searchParams.refusals === 'string' ? searchParams.refusals.split(',').filter(Boolean) : [];
  const act = ruleChainAct(values.act);

  let view: RoyaltyRuleView | null = null; let code: string | null = null;
  try { view = await tenantClient().instructorEarnings.rule(); }
  catch (e) { code = e instanceof SdkError ? (e.code || 'error') : 'error'; }
  const proposed = view?.history.find((r) => r.status === 'proposed') ?? null;
  const typedBps = values.shareBps ? percentToBps(values.shareBps) : null;
  const platformBps = view?.platformDefault?.platformShareBps ?? null;
  const tenantBps = typedBps !== null && platformBps !== null ? 10000 - typedBps - platformBps : null;
  const target = act && act !== 'propose' ? (proposed && proposed.id === values.rule ? proposed : null) : null;
  const note = values.note ?? '';
  const canAct = view && act ? (act === 'propose' ? view.canPropose && !proposed && typedBps !== null && tenantBps !== null && tenantBps >= 0 : !!target && view.canPropose && (act !== 'reject' || note.trim().length >= 3)) : false;

  return (
    <section>
      <h1>{t.t('earnings.rule.title')}</h1>
      <p className="kv-field__hint"><Link href={earningsHref()} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
      {code && <div className={code === 'EARNINGS_DISABLED' ? 'kv-card kv-card--notice' : 'kv-error'} role={code === 'EARNINGS_DISABLED' ? 'status' : 'alert'}><p>{t.t(code === 'EARNINGS_DISABLED' ? 'earnings.state.notEnabled' : code === 'EDUCATION_FORBIDDEN' || code === 'FORBIDDEN' ? 'earnings.rule.restricted' : 'earnings.state.error')}</p></div>}

      {view && !step && (
        <>
          <div className="kv-card">
            <h2>{t.t('earnings.rule.inForce')}</h2>
            {view.inForce ? <p>{t.t(view.inForce.source === 'tenant' ? 'earnings.rule.tenant' : 'earnings.rule.platform', { instructor: shareText(view.inForce.instructorShareBps), tenant: shareText(view.inForce.tenantShareBps), platform: shareText(view.inForce.platformShareBps) })} <span className="kv-field__hint">{when(view.inForce.effectiveFrom, lang)}</span></p> : <p className="kv-field__hint">{t.t('earnings.rule.none')}</p>}
            {view.platformDefault && <p className="kv-field__hint">{t.t('earnings.rule.platformDefault', { instructor: shareText(view.platformDefault.instructorShareBps), tenant: shareText(view.platformDefault.tenantShareBps), platform: shareText(view.platformDefault.platformShareBps) })}</p>}
            <p className="kv-field__hint">{t.t('earnings.rule.twoPeople')}</p>
            {!view.splitFlagOn && <p className="kv-field__hint">{t.t('earnings.splitOff')}</p>}
          </div>
          {proposed && (
            <div className="kv-card kv-card--notice" role="status">
              <p>{t.t('earnings.rule.proposedOpen', { instructor: shareText(proposed.instructorShareBps), tenant: shareText(proposed.tenantShareBps), platform: shareText(proposed.platformShareBps), when: when(proposed.proposedAt, lang) ?? '' })}</p>
              {proposed.decisionNote && <p className="kv-field__hint">{proposed.decisionNote}</p>}
              {view.canPropose && <p><Link href={confirmHref(PATH, { act: 'approve', rule: proposed.id })} className="kv-btn">{t.t('earnings.rule.act.approve')}</Link> <Link href={confirmHref(PATH, { act: 'reject', rule: proposed.id })} className="kv-btn--link">{t.t('earnings.rule.act.reject')}</Link></p>}
            </div>
          )}
          {view.canPropose && !proposed && <p><Link href={confirmHref(PATH, { act: 'propose' })} className="kv-btn">{t.t('earnings.rule.act.propose')}</Link></p>}
          {!view.canPropose && <p className="kv-field__hint">{t.t('earnings.rule.readOnly')}</p>}
          <div className="kv-card">
            <h2>{t.t('earnings.rule.history')}</h2>
            {view.history.length === 0 ? <p className="kv-field__hint">{t.t('earnings.rule.historyEmpty')}</p> : (
              <ul className="kv-list">
                {view.history.map((r) => <li key={r.id}>{shareText(r.instructorShareBps)} / {shareText(r.tenantShareBps)} / {shareText(r.platformShareBps)} · {t.t(`earnings.rule.status.${r.status}`)} · {when(r.proposedAt, lang)}{r.decidedAt && <> → {when(r.decidedAt, lang)}</>}{r.decisionNote && <span className="kv-field__hint"> · {r.decisionNote}</span>}</li>)}
              </ul>
            )}
          </div>
        </>
      )}

      {view && step === 'confirm' && (
        <>
          <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
          {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
          {!act && <div className="kv-error" role="alert"><p>{t.t('earnings.rule.noAct')}</p></div>}
          {act && (
            <div className="kv-card">
              <h2>{t.t(`earnings.rule.act.${act}`)}</h2>
              {act === 'propose' && (
                <>
                  <p className="kv-field__hint">{t.t('earnings.rule.proposeHint', { platform: platformBps === null ? t.t('common.dash') : shareText(platformBps) })}</p>
                  {typedBps !== null && tenantBps !== null && (tenantBps >= 0 ? <p>{t.t('earnings.rule.willWrite', { instructor: shareText(typedBps), tenant: shareText(tenantBps), platform: shareText(platformBps ?? 0) })}</p> : <div className="kv-error" role="alert"><p>{t.t('earnings.rule.refusal.SHARE_TOO_HIGH')}</p></div>)}
                  {proposed && <div className="kv-error" role="alert"><p>{t.t('earnings.rule.refusal.PROPOSAL_ALREADY_OPEN')}</p></div>}
                  <form action={PATH} method="get">
                    <input type="hidden" name="step" value="confirm" /><input type="hidden" name="act" value="propose" />
                    <label className="kv-field" htmlFor="rule-share"><span>{t.t('earnings.rule.shareLabel')}</span><input id="rule-share" name="shareBps" inputMode="decimal" defaultValue={values.shareBps ?? ''} /></label>
                    {values.shareBps && typedBps === null && <p className="kv-error" role="alert">{t.t('earnings.rule.refusal.SHARE_INVALID')}</p>}
                    <label className="kv-field" htmlFor="rule-note"><span>{t.t('earnings.rule.noteLabel')}</span><textarea id="rule-note" name="note" defaultValue={note} maxLength={MAX_REASON} rows={2} /></label>
                    <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
                  </form>
                </>
              )}
              {act !== 'propose' && (target ? (
                <>
                  <p>{t.t('earnings.rule.object', { instructor: shareText(target.instructorShareBps), tenant: shareText(target.tenantShareBps), platform: shareText(target.platformShareBps) })}</p>
                  <p className="kv-field__hint">{t.t('earnings.rule.twoPeople')}</p>
                  {act === 'reject' && (
                    <form action={PATH} method="get">
                      <input type="hidden" name="step" value="confirm" /><input type="hidden" name="act" value="reject" /><input type="hidden" name="rule" value={target.id} />
                      <label className="kv-field" htmlFor="rule-reject-note"><span>{t.t('earnings.rule.rejectNoteLabel')}</span><textarea id="rule-reject-note" name="note" defaultValue={note} maxLength={MAX_REASON} rows={2} /></label>
                      <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
                    </form>
                  )}
                </>
              ) : <div className="kv-error" role="alert"><p>{t.t('earnings.rule.refusal.NOT_FOUND')}</p></div>)}
              {!view.canPropose && <div className="kv-error" role="alert"><p>{t.t('earnings.rule.refusal.NOT_FINANCE')}</p></div>}
            </div>
          )}
          {canAct ? (
            <form action={ruleAction}>
              <input type="hidden" name="act" value={act as string} />
              {values.rule && <input type="hidden" name="rule" value={values.rule} />}
              {values.shareBps && <input type="hidden" name="shareBps" value={values.shareBps} />}
              {note && <input type="hidden" name="note" value={note} />}
              <button type="submit" className="kv-btn">{t.t('mutate.confirm')}</button>
            </form>
          ) : act && <p className="kv-field__hint">{t.t('mutate.cannotProceed')}</p>}
          <p><Link href={PATH} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{act ? t.t(`earnings.rule.done.${act}`) : t.t('mutate.step.success')}</p>
          <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          {canLinkAudit('course_royalty_rule', values.rule ?? null) && <p><Link href={auditHref('course_royalty_rule', values.rule as string)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>}
          <p><Link href={PATH} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')} {failed}</p>
          {failedRefusals.map((r) => <p key={r}>{t.t(`earnings.rule.refusal.${r}`) || r}</p>)}
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p className="kv-field__hint">{t.t(earningsRefusedKey('retry'))}</p>
          <p><Link href={retryToConfirm(PATH, values)} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
          <p><Link href={PATH} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
