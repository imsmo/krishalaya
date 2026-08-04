// apps/web-tenant/src/app/logistics/page.tsx · tenant-wide shipments oversight (PC-25). Server-first,
// requireSession-gated, noindex. shipments.list(box=all) is tenant-scoped by the API token; a status filter
// (server-enum only, features/logistics/oversight) rides in the URL (shareable), keyset "next page" preserves it.
// Each row links to its ORDER detail — the single home of the deliver mutation (PoD OTP + photo live there;
// no duplicate mutation surface here).
//
// PERSONA RULING (recorded PC-25): fleet CRUD (carriers/vehicles/slots/routes/zones/cold-chain readings) is the
// LOGISTICS-PARTNER console's surface (web-partner, built) — a tenant sees oversight + its own delivery zones
// (/settings). Returns + COD-recon have no API module yet → recorded MISSING-BACKEND, never faked here.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { SHIPMENT_STATUSES, isShipmentStatus, oversightHref } from '../../features/logistics/oversight';
import type { Shipment } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('logistics.title'), robots: { index: false, follow: false } };
}

export default async function LogisticsPage({ searchParams }: { searchParams: { status?: string; cursor?: string } }) {
  await requireSession('/logistics');
  const t = getTranslator();
  const lang = getLang();
  const status = isShipmentStatus(searchParams.status) ? searchParams.status : undefined;

  let items: Shipment[] = []; let nextCursor: string | null = null; let failed = false;
  try {
    const p = await tenantClient().shipments.list({ box: 'all', status, cursor: searchParams.cursor, limit: 50 });
    items = p.items; nextCursor = p.nextCursor;
  } catch { failed = true; }

  return (
    <section>
      <h1>{t.t('logistics.title')}</h1>
      <p className="kv-field__hint">{t.t('logistics.hint')}</p>

      <form method="get" action="/logistics" className="kv-inline-form" role="search" aria-label={t.t('logistics.filterLabel')}>
        <label htmlFor="l-status" className="kv-field__label">{t.t('logistics.status')}</label>
        <select id="l-status" name="status" defaultValue={status ?? ''} className="kv-input">
          <option value="">{t.t('logistics.status.any')}</option>
          {SHIPMENT_STATUSES.map((s) => <option key={s} value={s}>{t.t(`logistics.status.${s}`)}</option>)}
        </select>
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('logistics.apply')}</button>
      </form>

      {failed ? <p className="kv-error" role="alert">{t.t('logistics.loadError')}</p> : (
        <DataTable
          rows={items}
          empty={t.t('logistics.empty')}
          columns={[
            { header: t.t('logistics.colShipment'), cell: (s) => <Link href={`/logistics/${s.id}`} className="kv-link">{s.awbNo ?? s.id.slice(0, 8)}</Link> },
            { header: t.t('logistics.colOrder'), cell: (s) => <Link href={`/orders/${s.orderId}`} className="kv-link">{s.orderId.slice(0, 8)}…</Link> },
            { header: t.t('logistics.colStatus'), cell: (s) => <span className="kv-badge">{t.t(`logistics.status.${s.status}`) || s.status}</span> },
            { header: t.t('logistics.colPickup'), cell: (s) => (s.scheduledPickupAt ? formatDate(s.scheduledPickupAt, lang) : t.t('common.dash')) },
            { header: t.t('logistics.colDelivered'), cell: (s) => (s.deliveredAt ? formatDate(s.deliveredAt, lang) : t.t('common.dash')) },
            { header: t.t('logistics.colOtp'), cell: (s) => (s.requiresOtp ? t.t('logistics.otpYes') : t.t('common.dash')) },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={oversightHref(status, nextCursor)} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}
    </section>
  );
}
