// apps/web-ops/src/app/warehouse/page.tsx · warehouse operations home (PC-32 OW-2): storage bookings across
// the tenant's warehouses (status filter in the URL, keyset paging preserving it) + the eNWR receipt register.
// Row → /warehouse/[id] where the deposit lifecycle + assay + eNWR issue live. Sections degrade independently.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { opsClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { BOOKING_STATUSES, isBookingStatus } from '../../features/warehouse/manage';
import type { StorageBooking, NwrReceipt } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('wh.title'), robots: { index: false, follow: false } };
}

export default async function WarehousePage({ searchParams }: { searchParams: { status?: string; cursor?: string } }) {
  await requireSession('/warehouse');
  const t = getTranslator();
  const lang = getLang();
  const status = isBookingStatus(searchParams.status) ? searchParams.status : undefined;

  let bookings: StorageBooking[] = []; let nextCursor: string | null = null; let bookingsFailed = false;
  try {
    const p = await opsClient().warehousing.bookings({ status, cursor: searchParams.cursor, limit: 50 });
    bookings = p.items; nextCursor = p.nextCursor;
  } catch { bookingsFailed = true; }

  let nwrs: NwrReceipt[] = []; let nwrsFailed = false;
  try { nwrs = (await opsClient().warehousing.nwrs({ limit: 20 })).items; }
  catch { nwrsFailed = true; }

  const pager = (cursor: string) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    qs.set('cursor', cursor);
    return `/warehouse?${qs.toString()}`;
  };

  return (
    <section>
      <h1>{t.t('wh.title')}</h1>
      <p className="kv-field__hint">{t.t('wh.hint')}</p>

      <h2>{t.t('wh.bookings')}</h2>
      <form method="get" action="/warehouse" className="kv-inline-form" role="search" aria-label={t.t('wh.filterLabel')}>
        <label htmlFor="wh-status" className="kv-field__label">{t.t('wh.colStatus')}</label>
        <select id="wh-status" name="status" defaultValue={status ?? ''} className="kv-input">
          <option value="">{t.t('wh.status.any')}</option>
          {BOOKING_STATUSES.map((s) => <option key={s} value={s}>{t.t(`wh.status.${s}`)}</option>)}
        </select>
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('wh.apply')}</button>
      </form>

      {bookingsFailed ? <p className="kv-error" role="alert">{t.t('wh.loadError')}</p> : (
        <DataTable
          rows={bookings}
          empty={t.t('wh.bookingsEmpty')}
          columns={[
            { header: t.t('wh.colBooking'), cell: (b) => <Link href={`/warehouse/${b.id}`} className="kv-link">{(b.productName ?? b.productId.slice(0, 8))} · {b.quantity} {b.unitCode}</Link> },
            { header: t.t('wh.colWarehouse'), cell: (b) => b.warehouseName ?? b.warehouseId.slice(0, 8) },
            { header: t.t('wh.colStatus'), cell: (b) => <span className="kv-badge">{t.t(`wh.status.${b.status}`) || b.status}</span> },
            { header: t.t('wh.colArrival'), cell: (b) => (b.expectedArrival ? formatDate(b.expectedArrival, lang) : t.t('common.dash')) },
            { header: t.t('wh.colFee'), cell: (b) => (b.feeMinor ? formatMoneyMinor(b.feeMinor, 'INR', lang) : t.t('common.dash')) },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={pager(nextCursor)} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}

      <h2>{t.t('wh.nwrs')}</h2>
      {nwrsFailed ? <p className="kv-error" role="alert">{t.t('wh.loadError')}</p> : (
        <DataTable
          rows={nwrs}
          empty={t.t('wh.nwrsEmpty')}
          columns={[
            { header: t.t('wh.colEnwr'), cell: (n) => <span className="kv-mono">{n.enwrNo}</span> },
            { header: t.t('wh.colRepo'), cell: (n) => <span className="kv-badge">{n.repository}</span> },
            { header: t.t('wh.colValuation'), cell: (n) => formatMoneyMinor(n.valuationMinor, 'INR', lang) },
            { header: t.t('wh.colStatus'), cell: (n) => <span className="kv-badge">{n.status}</span> },
            { header: t.t('wh.colExpires'), cell: (n) => (n.expiresAt ? formatDate(n.expiresAt, lang) : t.t('common.dash')) },
          ]}
        />
      )}
    </section>
  );
}
