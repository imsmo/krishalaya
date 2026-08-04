// apps/web-partner/src/app/routes/[id]/page.tsx · Village Run route detail + edit + active toggle (GET
// logistics/routes/:id; 404 → notFound). PATCH :id edits name/runWeekday/villages/vehicle/consolidation; POST
// :id/active toggles. Degrade-never-die. All copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import { WEEKDAYS, weekdayKey, type RouteRow } from '../../../features/logistics/network';
import { updateRouteAction, setRouteActiveAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('net.routeDetailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['created', 'updated', 'activated', 'deactivated']);
const ERR = new Set(['routeName', 'runWeekday', 'villageRegionIds', 'vehicleId', 'consolidationUserId', 'noChange', 'forbidden', 'conflict', 'notFound', 'generic']);

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="kv-facts__row"><dt>{label}</dt><dd>{value}</dd></div>;
}

export default async function RouteDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requirePartner();
  const t = getTranslator();

  let r: RouteRow | undefined;
  let notice: string | undefined;
  try {
    r = (await partnerClient().request<RouteRow>('GET', `logistics/routes/${params.id}`)).data;
  } catch (e) {
    if (e instanceof SdkError && e.status === 404) notFound();
    notice = t.t('dash.unavailable');
  }

  if (!r) {
    return <section><p className="kv-backlink"><Link href="/routes">{t.t('net.backRoutes')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const wdDefault = r.runWeekday === null ? '' : String(r.runWeekday);

  return (
    <section>
      <p className="kv-backlink"><Link href="/routes">{t.t('net.backRoutes')}</Link></p>
      <h1>{r.defaultName}</h1>
      <p><span className={`kv-status kv-status--${r.isActive ? 'ok' : 'muted'}`}>{t.t(r.isActive ? 'common.active' : 'common.inactive')}</span></p>
      {okKey && <p className="kv-success" role="status">{t.t(`net.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`net.err.${errKey}`)}</p>}

      <dl className="kv-facts">
        <Field label={t.t('net.runWeekday')} value={t.t(weekdayKey(r.runWeekday))} />
        <Field label={t.t('net.colVillages')} value={String(r.villageRegionIds.length)} />
        <Field label={t.t('net.vehicleId')} value={r.vehicleId ? `${r.vehicleId.slice(0, 8)}…` : t.t('common.dash')} />
        <Field label={t.t('net.consolidationUserId')} value={r.consolidationUserId ? `${r.consolidationUserId.slice(0, 8)}…` : t.t('common.dash')} />
      </dl>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('net.editRoute')}</summary>
        <form action={updateRouteAction} className="kv-form">
          <input type="hidden" name="id" value={r.id} />
          <label className="kv-field__label">{t.t('net.routeName')}</label>
          <input name="defaultName" className="kv-input" maxLength={150} defaultValue={r.defaultName} />
          <label className="kv-field__label">{t.t('net.runWeekday')}</label>
          <select name="runWeekday" className="kv-input" defaultValue={wdDefault}>
            <option value="">{t.t('net.wd.any')}</option>
            {WEEKDAYS.map((d) => <option key={d} value={d}>{t.t(weekdayKey(d))}</option>)}
          </select>
          <label className="kv-field__label">{t.t('net.villageRegionIds')}</label>
          <textarea name="villageRegionIds" className="kv-input" rows={2} defaultValue={r.villageRegionIds.join(' ')} placeholder={t.t('net.regionIdsHint')} />
          <label className="kv-field__label">{t.t('net.vehicleId')}</label>
          <input name="vehicleId" className="kv-input" defaultValue={r.vehicleId ?? ''} placeholder={t.t('net.uuidHint')} />
          <label className="kv-field__label">{t.t('net.consolidationUserId')}</label>
          <input name="consolidationUserId" className="kv-input" defaultValue={r.consolidationUserId ?? ''} placeholder={t.t('net.uuidHint')} />
          <button type="submit" className="kv-btn">{t.t('net.save')}</button>
        </form>
      </details>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('net.activeTitle')}</summary>
        <form action={setRouteActiveAction} className="kv-inline-form">
          <input type="hidden" name="id" value={r.id} />
          <input type="hidden" name="isActive" value={r.isActive ? 'false' : 'true'} />
          <button type="submit" className={`kv-btn${r.isActive ? ' kv-btn--danger' : ''}`}>{t.t(r.isActive ? 'net.deactivate' : 'net.activate')}</button>
        </form>
      </details>
    </section>
  );
}
