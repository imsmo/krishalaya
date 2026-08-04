// apps/web-ops/src/app/equipment/page.tsx · CHC home (PC-33 OW-3): the rental queue (status filter, keyset
// preserving it) + the asset register with availability toggles. Row → /equipment/[id] for the lifecycle.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { opsClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { RENTAL_STATUSES, isRentalStatus } from '../../features/equipment/manage';
import type { EquipmentAsset, EquipmentRental } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('chc.title'), robots: { index: false, follow: false } };
}

export default async function EquipmentPage({ searchParams }: { searchParams: { status?: string; cursor?: string } }) {
  await requireSession('/equipment');
  const t = getTranslator();
  const lang = getLang();
  const status = isRentalStatus(searchParams.status) ? searchParams.status : undefined;

  let rentals: EquipmentRental[] = []; let nextCursor: string | null = null; let rentalsFailed = false;
  try {
    const p = await opsClient().equipment.rentals({ status, cursor: searchParams.cursor, limit: 50 });
    rentals = p.items; nextCursor = p.nextCursor;
  } catch { rentalsFailed = true; }

  let assets: EquipmentAsset[] = []; let assetsFailed = false;
  try { assets = (await opsClient().equipment.assets({ limit: 50 })).items; }
  catch { assetsFailed = true; }

  const assetName = (id: string) => assets.find((a) => a.id === id)?.defaultName ?? id.slice(0, 8);
  const pager = (cursor: string) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    qs.set('cursor', cursor);
    return `/equipment?${qs.toString()}`;
  };

  return (
    <section>
      <h1>{t.t('chc.title')}</h1>
      <p className="kv-field__hint">{t.t('chc.hint')}</p>

      <h2>{t.t('chc.rentals')}</h2>
      <form method="get" action="/equipment" className="kv-inline-form" role="search" aria-label={t.t('chc.filterLabel')}>
        <label htmlFor="ch-status" className="kv-field__label">{t.t('chc.colStatus')}</label>
        <select id="ch-status" name="status" defaultValue={status ?? ''} className="kv-input">
          <option value="">{t.t('chc.status.any')}</option>
          {RENTAL_STATUSES.map((s) => <option key={s} value={s}>{t.t(`chc.status.${s}`)}</option>)}
        </select>
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('chc.apply')}</button>
      </form>

      {rentalsFailed ? <p className="kv-error" role="alert">{t.t('chc.loadError')}</p> : (
        <DataTable
          rows={rentals}
          empty={t.t('chc.rentalsEmpty')}
          columns={[
            { header: t.t('chc.colRental'), cell: (r) => <Link href={`/equipment/${r.id}`} className="kv-link">{(r.assetName ?? assetName(r.assetId))} · {r.quantity} {r.unitCode}</Link> },
            { header: t.t('chc.colStatus'), cell: (r) => <span className="kv-badge">{t.t(`chc.status.${r.status}`) || r.status}</span> },
            { header: t.t('chc.colAdvance'), cell: (r) => (r.advanceMinor ? formatMoneyMinor(r.advanceMinor, 'INR', lang) : t.t('common.dash')) },
            { header: t.t('chc.colScheduled'), cell: (r) => (r.scheduledAt ? formatDate(r.scheduledAt, lang) : t.t('common.dash')) },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={pager(nextCursor)} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}

      <h2>{t.t('chc.assets')}</h2>
      {assetsFailed ? <p className="kv-error" role="alert">{t.t('chc.loadError')}</p> : (
        <DataTable
          rows={assets}
          empty={t.t('chc.assetsEmpty')}
          columns={[
            { header: t.t('chc.colAsset'), cell: (a) => a.defaultName },
            { header: t.t('chc.colStatus'), cell: (a) => <span className="kv-badge">{a.status ?? t.t('common.dash')}</span> },
          ]}
        />
      )}
      <p className="kv-field__hint kv-note">{t.t('chc.livestockNote')}</p>
    </section>
  );
}
