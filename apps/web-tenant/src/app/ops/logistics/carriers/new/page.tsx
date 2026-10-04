// apps/web-tenant/src/app/ops/logistics/carriers/new/page.tsx · W2378 form-error / W2379 review → W2380 success → W2381 failure — "New
// carrier" · PC-56 TENANT-SW-e. Kind (3PL · own fleet · rider), name, the business contact (shown masked on review, never carried in the
// URL after the write), the vehicle line a fleet or rider brings (registration · capacity · reefer), and for a rider the user who holds
// the delivery-partner role. Nothing is written until review; the success screen reads the audit entry back.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../../../../../lib/session';
import { tenantHasPerm } from '../../../../../lib/auth';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { chainStep, chainStepKey } from '../../../../../features/forms/chain';
import { CARRIERS_HREF, PARTNER_KINDS, carrierRefusals, failedCodes, isUuid, maskTail, readCarrierDraft, sweCodeKey } from '../../../../../features/swe/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { createCarrierAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.carriers.new'), robots: { index: false, follow: false } }; }

export default async function NewCarrierPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const base = `${CARRIERS_HREF}/new`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const step = chainStep(searchParams.step);
  const d = readCarrierDraft(searchParams);
  const refusals = carrierRefusals(d);
  const err = (f: string) => refusals.filter((r) => r.field === f).map((r) => t.t(`swe.carriers.form.err.${r.code}`)).join(' ');
  const carried = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== ''));
  const failed = failedCodes(searchParams.error);
  const carrierId = isUuid(searchParams.carrierId) ? searchParams.carrierId : null;
  if (!tenantHasPerm('logistics.manage')) {
    return <section><h1>{t.t('swe.carriers.new')}</h1><div className="kv-card kv-card--notice" role="alert"><strong>{t.t('swe.state.restricted.title')}</strong><p>{t.t('swe.state.restricted.body')}</p></div></section>;
  }
  const field = (name: string, label: string, input: JSX.Element, hint?: string) => (
    <label className="kv-field" htmlFor={`c-${name}`}><span>{label}</span>{input}{hint && <span className="kv-field__hint">{hint}</span>}{step === 'review' && err(name) && <span className="kv-error">{err(name)}</span>}</label>
  );
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.carriers.title')}><Link href={CARRIERS_HREF}>{t.t('swe.carriers.title')}</Link> / <span aria-current="page">{t.t('swe.carriers.new')}</span></nav>
      <h1>{t.t('swe.carriers.new')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, refusals.length > 0))}</p>
      {(step === 'edit' || step === 'review') && (
        <form method="get" action={base} className="kv-card kv-form">
          <input type="hidden" name="step" value="review" />
          {field('partnerKind', t.t('swe.carriers.col.kind'), <select id="c-partnerKind" name="partnerKind" className="kv-select" defaultValue={d.partnerKind}>
            <option value="">{t.t('swe.pick')}</option>{PARTNER_KINDS.map((k) => <option key={k} value={k}>{t.t(`swe.carriers.kind.${k}`)}</option>)}</select>, t.t('swe.carriers.form.kindHint'))}
          {field('defaultName', t.t('swe.carriers.form.name'), <input id="c-defaultName" name="defaultName" className="kv-input" maxLength={120} defaultValue={d.defaultName} />)}
          {field('providerCode', t.t('swe.carriers.form.provider'), <input id="c-providerCode" name="providerCode" className="kv-input" maxLength={60} defaultValue={d.providerCode} />, t.t('swe.carriers.form.providerHint'))}
          {field('riderUserId', t.t('swe.carriers.form.rider'), <input id="c-riderUserId" name="riderUserId" className="kv-input" maxLength={36} defaultValue={d.riderUserId} />, t.t('swe.carriers.form.riderHint'))}
          {field('contactPhone', t.t('swe.carriers.form.phone'), <input id="c-contactPhone" name="contactPhone" className="kv-input" inputMode="tel" maxLength={16} defaultValue={d.contactPhone} />, t.t('swe.carriers.form.phoneHint'))}
          <label className="kv-field" htmlFor="c-cold"><input id="c-cold" type="checkbox" name="supportsColdChain" value="yes" defaultChecked={d.supportsColdChain === 'yes'} /> <span>{t.t('swe.carriers.form.cold')}</span></label>
          <fieldset className="kv-fieldset"><legend>{t.t('swe.carriers.form.vehicle')}</legend>
            <p className="kv-field__hint">{t.t('swe.carriers.form.vehicleHint')}</p>
            {field('regNo', t.t('swe.carriers.form.regNo'), <input id="c-regNo" name="regNo" className="kv-input" maxLength={20} defaultValue={d.regNo} />)}
            {field('capacityKg', t.t('swe.carriers.form.capacity'), <input id="c-capacityKg" name="capacityKg" className="kv-input" inputMode="numeric" maxLength={6} defaultValue={d.capacityKg} />)}
            <label className="kv-field" htmlFor="c-reefer"><input id="c-reefer" type="checkbox" name="isRefrigerated" value="yes" defaultChecked={d.isRefrigerated === 'yes'} /> <span>{t.t('swe.carriers.reefer')}</span></label>
          </fieldset>
          <button type="submit" className="kv-btn">{t.t('swe.review')}</button>
        </form>
      )}
      {step === 'review' && refusals.length === 0 && (
        <div className="kv-card">
          <h2>{t.t('swe.reviewTitle')}</h2>
          <dl className="kv-detail">
            <dt>{t.t('swe.carriers.col.kind')}</dt><dd>{t.t(`swe.carriers.kind.${d.partnerKind}`)}</dd>
            <dt>{t.t('swe.carriers.form.name')}</dt><dd>{d.defaultName}</dd>
            {d.providerCode && <><dt>{t.t('swe.carriers.form.provider')}</dt><dd>{d.providerCode}</dd></>}
            {d.riderUserId && <><dt>{t.t('swe.carriers.form.rider')}</dt><dd><code>{d.riderUserId}</code></dd></>}
            <dt>{t.t('swe.carriers.form.phone')}</dt><dd>{d.contactPhone ? maskTail(d.contactPhone) : t.t('common.dash')}</dd>
            <dt>{t.t('swe.carriers.form.cold')}</dt><dd>{t.t(d.supportsColdChain === 'yes' ? 'swe.yes' : 'swe.no')}</dd>
            <dt>{t.t('swe.carriers.form.vehicle')}</dt><dd>{d.regNo ? `${d.regNo}${d.capacityKg ? ` · ${d.capacityKg} kg` : ''}${d.isRefrigerated ? ` · ${t.t('swe.carriers.reefer')}` : ''}` : t.t('common.dash')}</dd>
          </dl>
          <p className="kv-field__hint">{t.t('swe.carriers.form.wall')}</p>
          <form action={createCarrierAction} className="kv-actions">
            {Object.entries(carried).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <button type="submit" className="kv-btn kv-btn--primary">{t.t('swe.carriers.form.submit')}</button>{' '}
            <Link href={CARRIERS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
          </form>
        </div>
      )}
      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t('swe.carriers.form.done')}</p></div>
          {carrierId && <AuditEntryCard t={t} lang={lang} entityType="logistics_partner" entityId={carrierId} action="logistics.partner_registered" />}
          <p><Link href={CARRIERS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}
      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((c) => <li key={c}>{t.t(sweCodeKey(c))} <code>{c}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t('form.failure.untouched')}</p>
          <p><Link href={`${base}?${new URLSearchParams({ step: 'review', ...carried }).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
        </div>
      )}
    </section>
  );
}
