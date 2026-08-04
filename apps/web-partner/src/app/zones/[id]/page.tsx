// apps/web-partner/src/app/zones/[id]/page.tsx · delivery-zone detail + edit + active toggle (GET logistics/zones/:id;
// 404 → notFound). PATCH :id edits name/pincodes/regionIds/charge; POST :id/active toggles. Degrade-never-die. All
// copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import { type ZoneRow } from '../../../features/logistics/network';
import { updateZoneAction, setZoneActiveAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('net.zoneDetailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['created', 'updated', 'activated', 'deactivated']);
const ERR = new Set(['zoneName', 'pincodes', 'regionIds', 'chargeDefinitionId', 'noChange', 'forbidden', 'conflict', 'notFound', 'generic']);

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="kv-facts__row"><dt>{label}</dt><dd>{value}</dd></div>;
}

export default async function ZoneDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requirePartner();
  const t = getTranslator();

  let z: ZoneRow | undefined;
  let notice: string | undefined;
  try {
    z = (await partnerClient().request<ZoneRow>('GET', `logistics/zones/${params.id}`)).data;
  } catch (e) {
    if (e instanceof SdkError && e.status === 404) notFound();
    notice = t.t('dash.unavailable');
  }

  if (!z) {
    return <section><p className="kv-backlink"><Link href="/zones">{t.t('net.backZones')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <p className="kv-backlink"><Link href="/zones">{t.t('net.backZones')}</Link></p>
      <h1>{z.defaultName}</h1>
      <p><span className={`kv-status kv-status--${z.isActive ? 'ok' : 'muted'}`}>{t.t(z.isActive ? 'common.active' : 'common.inactive')}</span></p>
      {okKey && <p className="kv-success" role="status">{t.t(`net.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`net.err.${errKey}`)}</p>}

      <dl className="kv-facts">
        <Field label={t.t('net.colPincodes')} value={String(z.pincodes.length)} />
        <Field label={t.t('net.colRegions')} value={String(z.regionIds.length)} />
        <Field label={t.t('net.chargeDefinitionId')} value={z.chargeDefinitionId ? `${z.chargeDefinitionId.slice(0, 8)}…` : t.t('common.dash')} />
      </dl>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('net.editZone')}</summary>
        <form action={updateZoneAction} className="kv-form">
          <input type="hidden" name="id" value={z.id} />
          <label className="kv-field__label">{t.t('net.zoneName')}</label>
          <input name="defaultName" className="kv-input" maxLength={120} defaultValue={z.defaultName} />
          <label className="kv-field__label">{t.t('net.pincodes')}</label>
          <textarea name="pincodes" className="kv-input" rows={3} defaultValue={z.pincodes.join(' ')} placeholder={t.t('net.pincodesHint')} />
          <label className="kv-field__label">{t.t('net.regionIds')}</label>
          <textarea name="regionIds" className="kv-input" rows={2} defaultValue={z.regionIds.join(' ')} placeholder={t.t('net.regionIdsHint')} />
          <label className="kv-field__label">{t.t('net.chargeDefinitionId')}</label>
          <input name="chargeDefinitionId" className="kv-input" defaultValue={z.chargeDefinitionId ?? ''} placeholder={t.t('net.uuidHint')} />
          <button type="submit" className="kv-btn">{t.t('net.save')}</button>
        </form>
      </details>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('net.activeTitle')}</summary>
        <form action={setZoneActiveAction} className="kv-inline-form">
          <input type="hidden" name="id" value={z.id} />
          <input type="hidden" name="isActive" value={z.isActive ? 'false' : 'true'} />
          <button type="submit" className={`kv-btn${z.isActive ? ' kv-btn--danger' : ''}`}>{t.t(z.isActive ? 'net.deactivate' : 'net.activate')}</button>
        </form>
      </details>
    </section>
  );
}
