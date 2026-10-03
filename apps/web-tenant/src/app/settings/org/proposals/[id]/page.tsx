// apps/web-tenant/src/app/settings/org/proposals/[id]/page.tsx · THE SETTINGS MUTATE CHAIN — W2758 confirm · W2759 success · W2760 failure
// · PC-56 TENANT-13b.
//   • confirm: the proposal (old → new, who proposed it and why, the floor, "from the next midnight IST after you confirm", the member
//     notice) BEFORE anything is pressed. Confirm is offered only to a DIFFERENT administrator — and the database refuses the proposer
//     anyway (CHECKER_IS_MAKER is named on the failure step). Refuse needs a reason (20–500); the proposer's refusal is a withdrawal;
//   • success reads the audit entry back (AuditEntryCard); failure lists every refusal by name; Retry is a page load back to confirm.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { SettingProposalDetail } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../lib/i18n';
import { mutateStep, mutateStepKey } from '../../../../../features/mutate/chain';
import { ORG_HREF, isUuid, pageState, parseCodes, proposalHref, refusalKey, showValue } from '../../../../../features/org-settings/org-settings';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { proposalActAction } from '../../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('os.act.title'), robots: { index: false, follow: false } };
}

export default async function ProposalActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  await requireSession(ORG_HREF);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '');
  const act: 'confirm' | 'refuse' = searchParams.act === 'refuse' ? 'refuse' : 'confirm';
  const step = mutateStep(searchParams.step);
  const failed = parseCodes(searchParams.error);
  let p: SettingProposalDetail | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state) {
    try { p = await tenantClient().orgSettings.proposal(params.id); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status, true); }
  }
  const withdraw = act === 'refuse' && p?.youProposed;

  return (
    <section>
      <nav aria-label={t.t('os.breadcrumb.label')} className="kv-field__hint">{t.t('os.breadcrumb.settings')} › <Link href={ORG_HREF} className="kv-btn--link">{t.t('os.title')}</Link> › {t.t(`os.act.${act}.title`)}</nav>
      <h1>{t.t(withdraw ? 'os.act.withdraw.title' : `os.act.${act}.title`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('os.form.module')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`os.state.${state}.title`)}</strong><p>{t.t(`os.state.${state}.body`)}</p>
          <p><Link href={ORG_HREF} className="kv-btn--link">{t.t('os.form.backToScreen')}</Link></p>
        </div>
      )}

      {p && (
        <dl className="kv-facts">
          <div className="kv-facts__row"><dt>{t.t('os.col.key')}</dt><dd><code>{p.key}</code></dd></div>
          <div className="kv-facts__row"><dt>{t.t('os.form.before')} → {t.t('os.form.after')}</dt><dd><code>{showValue(p.oldValue)}</code> → <code>{showValue(p.newValue)}</code></dd></div>
          <div className="kv-facts__row"><dt>{t.t('os.act.proposedBy')}</dt><dd>{t.t('os.proposals.by', { name: p.proposedByName ?? t.t('os.proposals.someone'), at: when(p.proposedAt) })}</dd></div>
          <div className="kv-facts__row"><dt>{t.t('os.act.why')}</dt><dd>{p.reason}</dd></div>
          {p.floor && (p.floor.min !== null || p.floor.max !== null) && <div className="kv-facts__row"><dt>{t.t('os.form.floor')}</dt><dd>{t.t('os.row.floor', { min: showValue(p.floor.min), max: showValue(p.floor.max) })}</dd></div>}
          <div className="kv-facts__row"><dt>{t.t('os.act.status')}</dt><dd>{t.t(`os.status.${p.status}`)}{p.effectiveAt ? ` · ${t.t('os.act.effective', { at: when(p.effectiveAt) })}` : ''}</dd></div>
        </dl>
      )}

      {step === 'confirm' && p && p.status === 'proposed' && (
        <div className="kv-card">
          {act === 'confirm' ? (
            <>
              <p>{t.t('os.act.confirm.lede', { at: when(p.wouldTakeEffectAt) })}</p>
              {p.memberNotice && <p>{t.t('os.form.memberNotice')}</p>}
              {p.youProposed ? <p className="kv-error" role="alert">{t.t('os.refusal.CHECKER_IS_MAKER')}</p> : (
                <form action={proposalActAction} className="kv-form">
                  <input type="hidden" name="id" value={p.id} /><input type="hidden" name="act" value="confirm" /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <p className="kv-field__hint">{t.t('os.act.confirm.audit', { n: formatNumber(p.admins, lang) })}</p>
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t('os.act.confirm.proceed')}</button>{' '}
                  <Link href={ORG_HREF} className="kv-btn--link">{t.t('os.act.cancel')}</Link>
                </form>
              )}
            </>
          ) : (
            <form action={proposalActAction} className="kv-form">
              <input type="hidden" name="id" value={p.id} /><input type="hidden" name="act" value="refuse" /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <label className="kv-field" htmlFor="os-refuse"><span>{t.t('os.act.refuse.reason')}</span>
                <textarea id="os-refuse" name="reason" className="kv-textarea" rows={2} minLength={20} maxLength={500} required /></label>
              <button type="submit" className="kv-btn kv-btn--primary">{t.t(withdraw ? 'os.act.withdraw.proceed' : 'os.act.refuse.proceed')}</button>{' '}
              <Link href={ORG_HREF} className="kv-btn--link">{t.t('os.act.cancel')}</Link>
            </form>
          )}
        </div>
      )}
      {step === 'confirm' && p && p.status !== 'proposed' && <p className="kv-card kv-card--notice">{t.t('os.refusal.SETTING_PROPOSAL_CLOSED')}</p>}

      {step === 'success' && p && (
        <>
          <div className="kv-card kv-success" role="status">
            <strong>{t.t(act === 'confirm' ? 'os.act.confirm.done' : 'os.act.refuse.done', { at: when(p.effectiveAt) })}</strong>
            <p><Link href={ORG_HREF} className="kv-btn kv-btn--primary">{t.t('os.form.backToScreen')}</Link></p>
          </div>
          <AuditEntryCard t={t} lang={lang} entityType="tenant_setting_proposal" entityId={p.id} action={act === 'confirm' ? 'tenancy.setting_confirmed' : 'tenancy.setting_refused'} />
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('os.form.failure.title')}</strong>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((c) => <li key={c}>{t.t(refusalKey(c))}</li>)}</ul>
          <p>{t.t('os.form.failure.untouched')}</p>
          <p><Link href={proposalHref(params.id, act)} className="kv-btn--link">{t.t('os.act.retry')}</Link>{' · '}<Link href={ORG_HREF} className="kv-btn--link">{t.t('os.form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
