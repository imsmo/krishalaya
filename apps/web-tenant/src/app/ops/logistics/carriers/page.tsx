// apps/web-tenant/src/app/ops/logistics/carriers/page.tsx · W228 · Carriers — PC-56 TENANT-SW-e (F-19).
//
// The tenant's 3PLs, its own fleets and its riders: kind, the contact (masked), capability (vehicles · capacity · reefer), the real
// "Shipments 30d" (shipments assigned in 30 days), "On-time" REFUSED BY NAME (shipments carry no promised-delivery time — the API says
// so and the console prints its sentence, never a number), and for a rider: KYC as recorded on the rider's role, "wage-protected" when a
// rider payout-terms row (or the tenant default) exists, "insured through the platform" REFUSED BY NAME. "New carrier" is the form chain
// (W2378–W2381); activate / deactivate with a reason is the mutate chain (W2382–W2384). Every state drawn.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { CarrierRow, Refused } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { tenantHasPerm } from '../../../../lib/auth';
import { getTranslator } from '../../../../lib/i18n';
import { DataTable } from '../../../../components/DataTable';
import { CARRIERS_HREF, PARTNER_KINDS, isPartnerKind, refusedKey, swePageState } from '../../../../features/swe/console';
import { AsOf } from '../../../../components/AsOf';
import { asOfLabels } from '../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.carriers.title'), robots: { index: false, follow: false } }; }

export default async function CarriersPage({ searchParams }: { searchParams: { kind?: string; cursor?: string; inactive?: string } }) {
  await requireSession(CARRIERS_HREF);
  const t = getTranslator();
  const canManage = tenantHasPerm('logistics.manage');
  const kind = isPartnerKind(searchParams.kind) ? searchParams.kind : undefined;
  let items: CarrierRow[] = []; let next: string | null = null; let onTime: Refused | null = null; let state: string | null = null;
  try {
    const p = await tenantClient().carriers.list({ partnerKind: kind, activeOnly: searchParams.inactive !== 'yes', includePlatform: true, cursor: searchParams.cursor, limit: 50 });
    items = p.items; next = p.nextCursor; onTime = p.onTime;
  } catch (e) { state = swePageState(e instanceof SdkError ? e.status : undefined, true); }
  const q = (o: Record<string, string | undefined>) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) u.set(k, v); const s = u.toString(); return s ? `${CARRIERS_HREF}?${s}` : CARRIERS_HREF; };
  const capability = (c: CarrierRow) => t.t('swe.carriers.capability', { vehicles: String(c.capability.vehicles), kg: c.capability.capacityKg }) + (c.capability.reefer ? ` · ${t.t('swe.carriers.reefer')}` : '');

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.carriers.title')}><span>{t.t('swa.ops')}</span> / <span>{t.t('swa.logistics')}</span> / <span aria-current="page">{t.t('swe.carriers.title')}</span></nav>
      <div className="kv-page-head">
        <h1>{t.t('swe.carriers.title')}</h1>
        {/* PC-56 TENANT-SW-f · W318 §1: when this page's data was read — absolute IST + relative; stale past 1 h */}
        <AsOf at={new Date().toISOString()} labels={asOfLabels(t)} />
        {canManage && !state && <Link href={`${CARRIERS_HREF}/new`} className="kv-btn kv-btn--primary">{t.t('swe.carriers.new')}</Link>}
      </div>
      <p className="kv-field__hint">{t.t('swe.carriers.subtitle')}</p>
      <form method="get" action={CARRIERS_HREF} className="kv-inline-form">
        <label className="kv-field" htmlFor="c-kind"><span>{t.t('swe.carriers.col.kind')}</span>
          <select id="c-kind" name="kind" className="kv-select" defaultValue={kind ?? ''}>
            <option value="">{t.t('swe.carriers.allKinds')}</option>
            {PARTNER_KINDS.map((k) => <option key={k} value={k}>{t.t(`swe.carriers.kind.${k}`)}</option>)}
          </select></label>
        <label className="kv-field" htmlFor="c-inactive"><input id="c-inactive" type="checkbox" name="inactive" value="yes" defaultChecked={searchParams.inactive === 'yes'} /> <span>{t.t('swe.carriers.showInactive')}</span></label>
        <button type="submit" className="kv-btn--link">{t.t('swe.filter')}</button>
      </form>
      {state ? (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`swe.state.${state}.title`)}</strong><p>{t.t(`swe.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={CARRIERS_HREF} className="kv-btn--link">{t.t('swe.retry')}</Link></p>}
        </div>
      ) : items.length === 0 ? (
        <div className="kv-card kv-card--notice" role="status"><strong>{t.t('swe.carriers.empty.title')}</strong><p>{t.t('swe.carriers.empty.body')}</p></div>
      ) : (
        <>
          <DataTable rows={items} empty={t.t('swe.carriers.empty.title')} columns={[
            { header: t.t('swe.carriers.col.carrier'), cell: (c) => <span><strong>{c.defaultName}</strong>{c.scope === 'platform' ? ` · ${t.t('swe.carriers.platform')}` : ''}{c.providerCode ? <span className="kv-detail__muted"> · {c.providerCode}</span> : null}</span> },
            { header: t.t('swe.carriers.col.kind'), cell: (c) => t.t(`swe.carriers.kind.${c.partnerKind}`) },
            { header: t.t('swe.carriers.col.contact'), cell: (c) => c.contactMasked ?? c.rider?.phoneMasked ?? t.t('common.dash') },
            { header: t.t('swe.carriers.col.capability'), cell: capability },
            { header: t.t('swe.carriers.col.shipments30d'), cell: (c) => String(c.shipments30d) },
            { header: t.t('swe.carriers.col.onTime'), cell: (c) => <span className="kv-badge kv-badge--muted" title={t.t(refusedKey(c.onTime.code))}>{t.t('swe.refusedShort')}</span> },
            { header: t.t('swe.carriers.col.rider'), cell: (c) => (c.rider ? (
              <span>
                {t.t(`swe.carriers.kyc.${c.rider.kycVerified ? 'verified' : 'not'}`)} <span className="kv-detail__muted">({c.rider.kyc})</span><br />
                {t.t(`swe.carriers.wage.${c.rider.wageTerms}`)}<br />
                <span className="kv-detail__muted">{t.t('swe.carriers.insured')}: {t.t('swe.refusedShort')}</span>
              </span>) : t.t('common.dash')) },
            { header: t.t('swe.carriers.col.status'), cell: (c) => <span>{t.t(c.isActive ? 'swe.active' : 'swe.inactive')}{c.statusReason ? <span className="kv-detail__muted"> · {c.statusReason}</span> : null}</span> },
            { header: '', cell: (c) => (canManage && c.scope !== 'platform'
              ? <Link href={`${CARRIERS_HREF}/act?act=${c.isActive ? 'deactivate' : 'activate'}&id=${c.id}`} className="kv-btn--link">{t.t(`swe.carriers.act.${c.isActive ? 'deactivate' : 'activate'}`)}</Link>
              : <span className="kv-detail__muted">{t.t('common.dash')}</span>) },
          ]} />
          {next && <p><Link href={q({ kind, inactive: searchParams.inactive, cursor: next })} className="kv-btn--link">{t.t('swe.next')}</Link></p>}
        </>
      )}
      <div className="kv-card">
        <h2>{t.t('swe.methods')}</h2>
        <ul className="kv-list">
          <li>{t.t('swe.carriers.method.shipments30d')}</li>
          <li>{t.t('swe.carriers.col.onTime')}: {t.t(refusedKey(onTime?.code ?? 'NO_PROMISED_DELIVERY_TIME'))}</li>
          <li>{t.t('swe.carriers.method.kyc')}</li>
          <li>{t.t('swe.carriers.method.wage')}</li>
          <li>{t.t('swe.carriers.insured')}: {t.t(refusedKey('NO_RIDER_INSURANCE_RECORD'))}</li>
        </ul>
      </div>
    </section>
  );
}
