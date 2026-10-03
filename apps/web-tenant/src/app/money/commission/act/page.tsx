// apps/web-tenant/src/app/money/commission/act/page.tsx · W2431 confirm → W2432 success → W2433 failure — the commission MUTATE chain
// (PC-56 TENANT-SW-a). Acts: confirm a proposal (offered only when the API says the viewer did not propose it — the database re-judges),
// refuse / withdraw one (reason ≥ 20), propose a rule's deactivation (an IST date ≥ 7 days out + reason). "Retry" is a page load. The
// success screen shows the audit entry the act wrote, read back from the trail.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { CommissionPolicy, CommissionRuleProposal } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { mutateStep, mutateStepKey, failureKey } from '../../../../features/mutate/chain';
import { COMMISSION_HREF, bpsPercent, codeKey, isCommissionAct, isUuid, isYmd, pageState } from '../../../../features/swa/console';
import { AuditEntryCard } from '../../../people/ambassadors/AuditEntryCard';
import { commissionActAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swa.com.actTitle'), robots: { index: false, follow: false } }; }
const AUDIT: Record<string, string> = { confirm: 'payments.commission_rule_confirmed', refuse: 'payments.commission_rule_refused', deactivate: 'payments.commission_rule_deactivation_proposed' };

export default async function CommissionActPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const base = `${COMMISSION_HREF}/act`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const day = (ymd: string) => formatDate(`${ymd}T00:00:00+05:30`, lang, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const act = isCommissionAct(searchParams.act) ? searchParams.act : 'confirm';
  const id = isUuid(searchParams.id) ? searchParams.id : null;
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim().slice(0, 500);
  const effectiveFrom = isYmd(searchParams.effectiveFrom) ? searchParams.effectiveFrom : '';
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z0-9_]{2,60}$/.test(x));
  let p: CommissionRuleProposal | null = null; let policy: CommissionPolicy | null = null; let state: string | null = id ? null : 'notFound';
  if (id && step === 'confirm') {
    try {
      policy = await tenantClient().tenantConfig.commissionPolicy();
      if (act !== 'deactivate') p = await tenantClient().tenantConfig.commissionProposal(id);
    } catch (e) { state = pageState(e instanceof SdkError ? e.status : undefined, false); }
  }
  const needsReason = act !== 'confirm';
  const reasonOk = !needsReason || reason.length >= 20;
  const dateOk = act !== 'deactivate' || (!!effectiveFrom && !!policy && effectiveFrom >= policy.earliestEffectiveFrom);
  const offered = act === 'deactivate' ? true : act === 'confirm' ? !!p?.canConfirm : !!p?.canRefuse;
  const carry = { act, ...(id ? { id } : {}) };

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swa.com.title')}><Link href={COMMISSION_HREF}>{t.t('swa.com.title')}</Link> / <span aria-current="page">{t.t(`swa.com.act.${act}`)}</span></nav>
      <h1>{t.t(`swa.com.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      {step === 'confirm' && (state ? (
        <div className="kv-error" role="alert"><strong>{t.t(`swa.com.state.${state}.title`)}</strong><p>{t.t(`swa.com.state.${state}.body`)}</p></div>
      ) : (
        <>
          <div className="kv-card">
            {p && <p><strong>{t.t(`swa.com.kind.${p.kind}`)}</strong> · {p.rule ? `${bpsPercent(p.rule.rateBps ?? 0)} · ${t.t(`swa.com.charged.${p.rule.chargedTo ?? 'seller'}`)}` : t.t('swa.com.endsRule', { id: (p.targetRuleId ?? '').slice(0, 8) })} · {t.t('swa.com.from', { date: day(p.effectiveFrom) })}</p>}
            {p && <p className="kv-detail__muted">{p.reason}</p>}
            <p>{t.t(`swa.com.act.rule.${act}`, { earliest: policy ? day(policy.earliestEffectiveFrom) : '—' })}</p>
            <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          </div>
          {!offered && <div className="kv-error" role="alert"><p>{t.t(`swa.com.act.notOffered.${act}`)}</p></div>}
          {needsReason && (
            <form method="get" action={base} className="kv-card kv-form">
              <input type="hidden" name="step" value="confirm" />
              {Object.entries(carry).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              {act === 'deactivate' && (
                <label className="kv-field" htmlFor="c-ef"><span>{t.t('swa.com.form.stopsFrom')}</span>
                  <input id="c-ef" name="effectiveFrom" type="date" className="kv-input" min={policy?.earliestEffectiveFrom} defaultValue={effectiveFrom || policy?.earliestEffectiveFrom} /></label>
              )}
              <label className="kv-field" htmlFor="c-why"><span>{t.t('swa.com.form.reason')}</span>
                <textarea id="c-why" name="reason" className="kv-textarea" rows={2} maxLength={500} defaultValue={reason} /></label>
              {reason !== '' && !reasonOk && <p className="kv-field__hint">{t.t('swa.com.form.err.reason')}</p>}
              <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
            </form>
          )}
          {offered && reasonOk && dateOk ? (
            <form action={commissionActAction} className="kv-actions">
              {Object.entries(carry).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              {reason && <input type="hidden" name="reason" value={reason} />}
              {effectiveFrom && <input type="hidden" name="effectiveFrom" value={effectiveFrom} />}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
              <Link href={COMMISSION_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
            </form>
          ) : <p><Link href={COMMISSION_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
        </>
      ))}
      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t(`swa.com.act.done.${act}`)}</p></div>
          {isUuid(searchParams.auditId) && <AuditEntryCard t={t} lang={lang} entityType="commission_rule_proposal" entityId={searchParams.auditId} action={AUDIT[act]} />}
          <p><Link href={COMMISSION_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}
      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')}</p>
          <ul>{failed.map((c) => <li key={c}>{t.t(codeKey(c))} <code>{c}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p><Link href={`${base}?${new URLSearchParams({ step: 'confirm', ...carry, ...(reason ? { reason } : {}), ...(effectiveFrom ? { effectiveFrom } : {}) }).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={COMMISSION_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
