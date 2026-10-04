// apps/web-tenant/src/app/ops/logistics/cold-chain/threshold/page.tsx · set a band (form chain: edit → review → success / failure) ·
// PC-56 TENANT-SW-e. Every later reading copies THIS band at write; the body of a reading can never carry one.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../../../../../lib/session';
import { tenantHasPerm } from '../../../../../lib/auth';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { chainStep, chainStepKey } from '../../../../../features/forms/chain';
import { COLD_HREF, COLD_SUBJECT_TYPES, coldSubjectHref, failedCodes, isColdSubjectType, isUuid, sweCodeKey, thresholdRefusal } from '../../../../../features/swe/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { setThresholdAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.cold.setBand'), robots: { index: false, follow: false } }; }

export default async function ThresholdPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const base = `${COLD_HREF}/threshold`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const step = chainStep(searchParams.step);
  const g = (k: string, n: number) => (searchParams[k] ?? '').trim().slice(0, n);
  const v = { subjectType: g('subjectType', 20), subjectId: g('subjectId', 36), minC: g('minC', 6), maxC: g('maxC', 6), reason: g('reason', 500) };
  const problem = !isColdSubjectType(v.subjectType) ? 'type' : v.subjectType === 'bmc_unit' ? 'bmc' : !isUuid(v.subjectId) ? 'subject' : thresholdRefusal(v.minC, v.maxC, v.reason);
  const carried = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''));
  const thresholdId = isUuid(searchParams.thresholdId) ? searchParams.thresholdId : null;
  if (!tenantHasPerm('logistics.manage')) return <section><h1>{t.t('swe.cold.setBand')}</h1><div className="kv-card kv-card--notice" role="alert"><strong>{t.t('swe.state.restricted.title')}</strong><p>{t.t('swe.state.restricted.body')}</p></div></section>;
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.cold.title')}><Link href={COLD_HREF}>{t.t('swe.cold.title')}</Link> / <span aria-current="page">{t.t('swe.cold.setBand')}</span></nav>
      <h1>{t.t('swe.cold.setBand')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, !!problem))}</p>
      {(step === 'edit' || step === 'review') && (
        <form method="get" action={base} className="kv-card kv-form">
          <input type="hidden" name="step" value="review" />
          <label className="kv-field" htmlFor="t-type"><span>{t.t('swe.cold.col.kind')}</span>
            <select id="t-type" name="subjectType" className="kv-select" defaultValue={v.subjectType}><option value="">{t.t('swe.pick')}</option>
              {COLD_SUBJECT_TYPES.filter((x) => x !== 'bmc_unit').map((x) => <option key={x} value={x}>{t.t(`swe.cold.kind.${x}`)}</option>)}</select></label>
          <label className="kv-field" htmlFor="t-id"><span>{t.t('swe.cold.col.subject')}</span><input id="t-id" name="subjectId" className="kv-input" maxLength={36} defaultValue={v.subjectId} /></label>
          <label className="kv-field" htmlFor="t-min"><span>{t.t('swe.cold.minC')}</span><input id="t-min" name="minC" className="kv-input" inputMode="decimal" maxLength={6} defaultValue={v.minC} /></label>
          <label className="kv-field" htmlFor="t-max"><span>{t.t('swe.cold.maxC')}</span><input id="t-max" name="maxC" className="kv-input" inputMode="decimal" maxLength={6} defaultValue={v.maxC} /></label>
          <label className="kv-field" htmlFor="t-why"><span>{t.t('swe.reason')}</span><textarea id="t-why" name="reason" className="kv-textarea" rows={2} maxLength={500} defaultValue={v.reason} /></label>
          {step === 'review' && problem && <p className="kv-error">{t.t(`swe.cold.thresholdErr.${problem}`)}</p>}
          <p className="kv-field__hint">{t.t('swe.cold.bmcBand')}</p>
          <button type="submit" className="kv-btn">{t.t('swe.review')}</button>
        </form>
      )}
      {step === 'review' && !problem && (
        <div className="kv-card">
          <h2>{t.t('swe.reviewTitle')}</h2>
          <p>{t.t(`swe.cold.kind.${v.subjectType}`)} <code>{v.subjectId}</code> · {v.minC}–{v.maxC} °C</p>
          <p className="kv-field__hint">{t.t('swe.cold.method.band')}</p>
          <form action={setThresholdAction} className="kv-actions">
            {Object.entries(carried).map(([k, x]) => <input key={k} type="hidden" name={k} value={x} />)}
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <button type="submit" className="kv-btn kv-btn--primary">{t.t('swe.cold.setBand')}</button>{' '}<Link href={COLD_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
          </form>
        </div>
      )}
      {step === 'success' && (
        <><div className="kv-card kv-card--notice" role="status"><p>{t.t('swe.cold.bandSet')}</p></div>
          {thresholdId && <AuditEntryCard t={t} lang={lang} entityType="cold_chain_threshold" entityId={thresholdId} action="logistics.cold_chain_threshold_set" />}
          <p><Link href={isColdSubjectType(v.subjectType) && isUuid(v.subjectId) ? coldSubjectHref(v.subjectType, v.subjectId) : COLD_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p></>
      )}
      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failedCodes(searchParams.error).map((c) => <li key={c}>{t.t(sweCodeKey(c))} <code>{c}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t('form.failure.untouched')}</p>
          <p><Link href={`${base}?${new URLSearchParams({ step: 'review', ...carried }).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
        </div>
      )}
    </section>
  );
}
