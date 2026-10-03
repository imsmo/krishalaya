// apps/web-tenant/src/app/ops/logistics/zones/new/page.tsx · W2848 form-error / W2849 review → W2850 success → W2851 failure — "New zone
// (checker)" · PC-56 TENANT-SW-a. Name, pincodes (one per line or comma-separated), the fee definition (only the tenant's definitions a second
// person approved on W150 are offered — the API refuses any other), reason. Nothing is written until review; success is a PROPOSAL.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import type { ZoneFeeDefinition } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { tenantHasPerm } from '../../../../../lib/auth';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { chainStep, chainStepKey } from '../../../../../features/forms/chain';
import { ZONES_HREF, codeKey, isUuid, parsePincodes, readZoneDraft, zoneRefusals } from '../../../../../features/swa/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { proposeZoneAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swa.zone.new'), robots: { index: false, follow: false } }; }

export default async function NewZonePage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const base = `${ZONES_HREF}/new`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const step = chainStep(searchParams.step);
  const d = readZoneDraft(searchParams);
  let defs: ZoneFeeDefinition[] = [];
  try { defs = await tenantClient().tenantConfig.zoneFeeDefinitions(); } catch { defs = []; }
  const refusals = zoneRefusals(d, defs.map((x) => x.id));
  const err = (f: string) => refusals.filter((r) => r.field === f).map((r) => t.t(`swa.zone.form.err.${r.code}`)).join(' ');
  const parsed = parsePincodes(d.pincodes);
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z0-9_]{2,60}$/.test(x));
  const carried = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== ''));
  const proposalId = isUuid(searchParams.proposalId) ? searchParams.proposalId : null;
  if (!tenantHasPerm('logistics.zones.manage')) {
    return <section><h1>{t.t('swa.zone.new')}</h1><div className="kv-card kv-card--notice" role="alert"><strong>{t.t('swa.zone.state.restricted.title')}</strong><p>{t.t('swa.zone.state.restricted.body')}</p></div></section>;
  }
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swa.zone.title')}><Link href={ZONES_HREF}>{t.t('swa.zone.title')}</Link> / <span aria-current="page">{t.t('swa.zone.new')}</span></nav>
      <h1>{t.t('swa.zone.new')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, refusals.length > 0))}</p>
      {(step === 'edit' || step === 'review') && (
        <form method="get" action={base} className="kv-card kv-form">
          <input type="hidden" name="step" value="review" />
          <label className="kv-field" htmlFor="z-name"><span>{t.t('swa.zone.form.name')}</span>
            <input id="z-name" name="defaultName" className="kv-input" maxLength={120} defaultValue={d.defaultName} required />{step === 'review' && err('defaultName') && <span className="kv-error">{err('defaultName')}</span>}</label>
          <label className="kv-field" htmlFor="z-pins"><span>{t.t('swa.zone.form.pincodes')}</span>
            <textarea id="z-pins" name="pincodes" className="kv-textarea" rows={4} defaultValue={d.pincodes} /><span className="kv-field__hint">{t.t('swa.zone.form.pincodesHint')}</span>
            {step === 'review' && err('pincodes') && <span className="kv-error">{err('pincodes')}{parsed.bad.length ? ` (${parsed.bad.join(', ')})` : ''}</span>}</label>
          <label className="kv-field" htmlFor="z-fee"><span>{t.t('swa.zone.form.fee')}</span>
            <select id="z-fee" name="chargeDefinitionId" className="kv-select" defaultValue={d.chargeDefinitionId}>
              <option value="">{t.t('swa.zone.noFee')}</option>
              {defs.map((x) => <option key={x.id} value={x.id}>{x.label ?? x.chargeCode} · {t.t(`swa.zone.calc.${x.calcMethod}`)}</option>)}
            </select><span className="kv-field__hint">{t.t(defs.length ? 'swa.zone.form.feeHint' : 'swa.zone.form.noApprovedFees')}</span>{step === 'review' && err('chargeDefinitionId') && <span className="kv-error">{err('chargeDefinitionId')}</span>}</label>
          <label className="kv-field" htmlFor="z-why"><span>{t.t('swa.com.form.reason')}</span>
            <textarea id="z-why" name="reason" className="kv-textarea" rows={2} maxLength={500} defaultValue={d.reason} required />{step === 'review' && err('reason') && <span className="kv-error">{err('reason')}</span>}</label>
          <button type="submit" className="kv-btn">{t.t('swa.com.form.review')}</button>
        </form>
      )}
      {step === 'review' && refusals.length === 0 && (
        <div className="kv-card">
          <h2>{t.t('swa.com.form.reviewTitle')}</h2>
          <dl className="kv-detail">
            <dt>{t.t('swa.zone.form.name')}</dt><dd>{d.defaultName}</dd>
            <dt>{t.t('swa.zone.form.pincodes')}</dt><dd>{t.t('swa.zone.form.pinCount', { n: String(parsed.pins.length) })}</dd>
            <dt>{t.t('swa.zone.form.fee')}</dt><dd>{d.chargeDefinitionId ? (defs.find((x) => x.id === d.chargeDefinitionId)?.label ?? d.chargeDefinitionId) : t.t('swa.zone.noFee')}</dd>
          </dl>
          <p className="kv-field__hint">{t.t('swa.zone.form.checker')}</p>
          <form action={proposeZoneAction} className="kv-actions">
            {Object.entries(carried).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <button type="submit" className="kv-btn kv-btn--primary">{t.t('swa.zone.form.submit')}</button>{' '}
            <Link href={ZONES_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
          </form>
        </div>
      )}
      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t('swa.zone.form.done')}</p></div>
          {proposalId && <AuditEntryCard t={t} lang={lang} entityType="delivery_zone_proposal" entityId={proposalId} action="logistics.delivery_zone_change_proposed" />}
          <p><Link href={ZONES_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
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
