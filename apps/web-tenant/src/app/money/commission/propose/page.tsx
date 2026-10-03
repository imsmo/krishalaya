// apps/web-tenant/src/app/money/commission/propose/page.tsx · W149 "Propose rule change (checker)" — the shared FORM chain (edit → review /
// form-error → success → failure) · PC-56 TENANT-SW-a.
//
// Values travel in the query string (no client JS). The review step lists every refusal against its field (the form-error screen IS the
// review with refusals), shows the API's own earliest date (next IST midnight + 7 days) and the platform share the PLAN sets — there is
// no share field to fill (F-3) — and asks the API which rule an order with these facts is charged under today. Success shows the proposal
// and, from the API, what the resolution will be once it applies; a second administrator confirms it on the commission screen.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import type { CommissionPolicy, CommissionResolution, CommissionRuleProposal } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { tenantHasPerm } from '../../../../lib/auth';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { chainStep, chainStepKey } from '../../../../features/forms/chain';
import { COMMISSION_HREF, COMMISSION_SOURCES, bpsPercent, codeKey, isUuid, proposalRefusals, readProposalDraft } from '../../../../features/swa/console';
import { AuditEntryCard } from '../../../people/ambassadors/AuditEntryCard';
import { proposeCommissionAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swa.com.propose'), robots: { index: false, follow: false } }; }

export default async function ProposeCommissionPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const base = `${COMMISSION_HREF}/propose`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const day = (ymd: string) => formatDate(`${ymd}T00:00:00+05:30`, lang, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const step = chainStep(searchParams.step);
  const d = readProposalDraft(searchParams);
  let policy: CommissionPolicy | null = null;
  try { policy = await tenantClient().tenantConfig.commissionPolicy(); } catch { policy = null; }
  const refusals = policy ? proposalRefusals(d, policy.earliestEffectiveFrom) : [{ field: 'form' as const, code: 'policy' }];
  const err = (f: string) => refusals.filter((r) => r.field === f).map((r) => t.t(`swa.com.form.err.${r.code}`, { earliest: policy ? day(policy.earliestEffectiveFrom) : '—' })).join(' ');
  let today: CommissionResolution | null = null;
  if (step === 'review' && refusals.length === 0) { try { today = await tenantClient().tenantConfig.commissionResolution({ source: d.source || undefined, categoryId: d.categoryId || undefined }); } catch { today = null; } }
  const proposalId = isUuid(searchParams.proposalId) ? searchParams.proposalId : null;
  let made: CommissionRuleProposal | null = null; let after: CommissionResolution | null = null;
  if (step === 'success' && proposalId) {
    try { made = await tenantClient().tenantConfig.commissionProposal(proposalId); after = await tenantClient().tenantConfig.commissionResolution({ source: made.rule?.source ?? undefined, proposalId }); } catch { made = null; }
  }
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z0-9_]{2,60}$/.test(x));
  const carried = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== ''));
  if (!tenantHasPerm('commission.manage')) {
    return <section><h1>{t.t('swa.com.propose')}</h1><div className="kv-card kv-card--notice" role="alert"><strong>{t.t('swa.com.state.restricted.title')}</strong><p>{t.t('swa.com.state.locked')}</p></div></section>;
  }

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swa.com.title')}><Link href={COMMISSION_HREF}>{t.t('swa.com.title')}</Link> / <span aria-current="page">{t.t('swa.com.propose')}</span></nav>
      <h1>{t.t('swa.com.propose')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, refusals.length > 0))}</p>

      {(step === 'edit' || step === 'review') && (
        <form method="get" action={base} className="kv-card kv-form">
          <input type="hidden" name="step" value="review" />
          {policy && <p className="kv-card kv-card--notice">{t.t('swa.com.form.shareNote', { n: String(policy.platformShareBps), pct: bpsPercent(policy.platformShareBps) })}</p>}
          <label className="kv-field" htmlFor="p-src"><span>{t.t('swa.com.col.source')}</span>
            <select id="p-src" name="source" className="kv-select" defaultValue={d.source}><option value="">{t.t('swa.com.source.all')}</option>
              {COMMISSION_SOURCES.map((s) => <option key={s} value={s}>{t.t(`swa.com.source.${s}`)}</option>)}</select>{step === 'review' && err('source') && <span className="kv-error">{err('source')}</span>}</label>
          <label className="kv-field" htmlFor="p-cat"><span>{t.t('swa.com.form.category')}</span>
            <input id="p-cat" name="categoryId" className="kv-input" maxLength={36} defaultValue={d.categoryId} /><span className="kv-field__hint">{t.t('swa.com.form.categoryHint')}</span>{step === 'review' && err('categoryId') && <span className="kv-error">{err('categoryId')}</span>}</label>
          <label className="kv-field" htmlFor="p-rate"><span>{t.t('swa.com.form.rate')}</span>
            <input id="p-rate" name="rateBps" className="kv-input" inputMode="numeric" maxLength={5} defaultValue={d.rateBps} required />{step === 'review' && err('rateBps') && <span className="kv-error">{err('rateBps')}</span>}</label>
          <label className="kv-field" htmlFor="p-fixed"><span>{t.t('swa.com.form.fixed')}</span>
            <input id="p-fixed" name="fixedMinor" className="kv-input" inputMode="numeric" maxLength={15} defaultValue={d.fixedMinor} />{step === 'review' && err('fixedMinor') && <span className="kv-error">{err('fixedMinor')}</span>}</label>
          <label className="kv-field" htmlFor="p-cap"><span>{t.t('swa.com.form.cap')}</span>
            <input id="p-cap" name="capMinor" className="kv-input" inputMode="numeric" maxLength={15} defaultValue={d.capMinor} />{step === 'review' && err('capMinor') && <span className="kv-error">{err('capMinor')}</span>}</label>
          <label className="kv-field" htmlFor="p-ct"><span>{t.t('swa.com.col.chargedTo')}</span>
            <select id="p-ct" name="chargedTo" className="kv-select" defaultValue={d.chargedTo}><option value="seller">{t.t('swa.com.charged.seller')}</option><option value="buyer">{t.t('swa.com.charged.buyer')}</option></select>
            <span className="kv-field__hint">{t.t('swa.com.form.chargedHint')}</span></label>
          <label className="kv-field" htmlFor="p-pr"><span>{t.t('swa.com.col.priority')}</span>
            <input id="p-pr" name="priority" className="kv-input" inputMode="numeric" maxLength={4} defaultValue={d.priority} /><span className="kv-field__hint">{t.t('swa.com.form.priorityHint')}</span>{step === 'review' && err('priority') && <span className="kv-error">{err('priority')}</span>}</label>
          <label className="kv-field" htmlFor="p-ef"><span>{t.t('swa.com.form.effectiveFrom')}</span>
            <input id="p-ef" name="effectiveFrom" type="date" className="kv-input" min={policy?.earliestEffectiveFrom} defaultValue={d.effectiveFrom || policy?.earliestEffectiveFrom} required />
            <span className="kv-field__hint">{t.t('swa.com.form.effectiveHint', { earliest: policy ? day(policy.earliestEffectiveFrom) : '—' })}</span>{step === 'review' && err('effectiveFrom') && <span className="kv-error">{err('effectiveFrom')}</span>}</label>
          <label className="kv-field" htmlFor="p-et"><span>{t.t('swa.com.form.effectiveTo')}</span>
            <input id="p-et" name="effectiveTo" type="date" className="kv-input" defaultValue={d.effectiveTo} />{step === 'review' && err('effectiveTo') && <span className="kv-error">{err('effectiveTo')}</span>}</label>
          <label className="kv-field" htmlFor="p-why"><span>{t.t('swa.com.form.reason')}</span>
            <textarea id="p-why" name="reason" className="kv-textarea" rows={3} maxLength={500} defaultValue={d.reason} required />{step === 'review' && err('reason') && <span className="kv-error">{err('reason')}</span>}</label>
          <button type="submit" className="kv-btn">{t.t('swa.com.form.review')}</button>
        </form>
      )}

      {step === 'review' && refusals.length === 0 && (
        <div className="kv-card">
          <h2>{t.t('swa.com.form.reviewTitle')}</h2>
          <dl className="kv-detail">
            <dt>{t.t('swa.com.col.rate')}</dt><dd>{t.t('swa.com.bps', { n: d.rateBps })} ({bpsPercent(Number(d.rateBps))}){d.fixedMinor && d.fixedMinor !== '0' ? ` + ${formatMoneyMinor(d.fixedMinor, 'INR', lang)}` : ''}</dd>
            <dt>{t.t('swa.com.col.cap')}</dt><dd>{d.capMinor ? formatMoneyMinor(d.capMinor, 'INR', lang) : t.t('common.dash')}</dd>
            <dt>{t.t('swa.com.col.chargedTo')}</dt><dd>{t.t(`swa.com.charged.${d.chargedTo}`)}</dd>
            <dt>{t.t('swa.com.col.effective')}</dt><dd>{day(d.effectiveFrom)}{d.effectiveTo ? ` → ${day(d.effectiveTo)}` : ''}</dd>
            <dt>{t.t('swa.com.col.share')}</dt><dd>{policy ? t.t('swa.com.shareByPlan', { n: String(policy.platformShareBps) }) : '—'}</dd>
          </dl>
          <p>{today?.winner ? t.t('swa.com.form.todayWinner', { scope: t.t(`swa.com.scope.${today.winner.scope}`), rate: bpsPercent(today.winner.rateBps), priority: String(today.winner.priority) }) : t.t('swa.com.example.none')}</p>
          <p className="kv-field__hint">{t.t('swa.com.form.checker')}</p>
          <form action={proposeCommissionAction} className="kv-actions">
            {Object.entries(carried).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <button type="submit" className="kv-btn kv-btn--primary">{t.t('swa.com.form.submit')}</button>{' '}
            <Link href={COMMISSION_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
          </form>
        </div>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status">
            <p>{t.t('swa.com.form.done', { date: made ? day(made.effectiveFrom) : '—' })}</p>
            {after?.after && <p>{t.t(after.after.proposed ? 'swa.com.form.afterWins' : 'swa.com.form.afterLoses', { date: day(after.after.onDate) })}</p>}
          </div>
          {proposalId && <AuditEntryCard t={t} lang={lang} entityType="commission_rule_proposal" entityId={proposalId} action="payments.commission_rule_proposed" />}
          <p><Link href={COMMISSION_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((c) => <li key={c}>{t.t(codeKey(c))} <code>{c}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t('form.failure.untouched')}</p>
          <p><Link href={`${base}?${new URLSearchParams({ step: 'review', ...carried }).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
        </div>
      )}
    </section>
  );
}
