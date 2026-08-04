// apps/web-partner/src/app/fleet/vehicles/[id]/page.tsx · vehicle detail + edit + active toggle (GET
// logistics/vehicles/:id; 404 → notFound). PATCH :id edits capacity/refrigerated; POST :id/active toggles. regNo +
// carrier are immutable here. Degrade-never-die. All copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePartner } from '../../../../lib/session';
import { partnerClient } from '../../../../lib/api-client';
import { getTranslator } from '../../../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import { type VehicleRow } from '../../../../features/logistics/fleet';
import { updateVehicleAction, setVehicleActiveAction } from '../../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('fleet.vehicleDetailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['created', 'updated', 'activated', 'deactivated']);
const ERR = new Set(['capacity', 'noChange', 'forbidden', 'conflict', 'notFound', 'generic']);

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="kv-facts__row"><dt>{label}</dt><dd>{value}</dd></div>;
}

export default async function VehicleDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requirePartner();
  const t = getTranslator();

  let v: VehicleRow | undefined;
  let notice: string | undefined;
  try {
    v = (await partnerClient().request<VehicleRow>('GET', `logistics/vehicles/${params.id}`)).data;
  } catch (e) {
    if (e instanceof SdkError && e.status === 404) notFound();
    notice = t.t('dash.unavailable');
  }

  if (!v) {
    return <section><p className="kv-backlink"><Link href="/fleet/vehicles">{t.t('fleet.backVehicles')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <p className="kv-backlink"><Link href="/fleet/vehicles">{t.t('fleet.backVehicles')}</Link></p>
      <h1>{v.regNo}</h1>
      <p><span className={`kv-status kv-status--${v.isActive ? 'ok' : 'muted'}`}>{t.t(v.isActive ? 'common.active' : 'common.inactive')}</span></p>
      {okKey && <p className="kv-success" role="status">{t.t(`fleet.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`fleet.err.${errKey}`)}</p>}

      <dl className="kv-facts">
        <Field label={t.t('fleet.partnerId')} value={<Link href={`/fleet/carriers/${encodeURIComponent(v.partnerId)}`}>{v.partnerId.slice(0, 8)}…</Link>} />
        <Field label={t.t('fleet.capacity')} value={v.capacityKg === null ? t.t('common.dash') : String(v.capacityKg)} />
        <Field label={t.t('fleet.refrigerated')} value={t.t(v.isRefrigerated ? 'common.yes' : 'common.no')} />
      </dl>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('fleet.editVehicle')}</summary>
        <form action={updateVehicleAction} className="kv-form">
          <input type="hidden" name="id" value={v.id} />
          <label className="kv-field__label">{t.t('fleet.capacity')}</label>
          <input name="capacityKg" className="kv-input" inputMode="numeric" defaultValue={v.capacityKg === null ? '' : String(v.capacityKg)} placeholder={t.t('fleet.capacityHint')} />
          <label className="kv-field__label"><input type="checkbox" name="isRefrigerated" value="true" defaultChecked={v.isRefrigerated} /> {t.t('fleet.refrigeratedField')}</label>
          <button type="submit" className="kv-btn">{t.t('fleet.save')}</button>
        </form>
      </details>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('fleet.activeTitle')}</summary>
        <form action={setVehicleActiveAction} className="kv-inline-form">
          <input type="hidden" name="id" value={v.id} />
          <input type="hidden" name="isActive" value={v.isActive ? 'false' : 'true'} />
          <button type="submit" className={`kv-btn${v.isActive ? ' kv-btn--danger' : ''}`}>{t.t(v.isActive ? 'fleet.deactivate' : 'fleet.activate')}</button>
        </form>
      </details>
    </section>
  );
}
