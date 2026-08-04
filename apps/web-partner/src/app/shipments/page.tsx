// apps/web-partner/src/app/shipments/page.tsx · the 3PL shipment queue (GET shipments). box chips (all = tenant ops
// view / mine = the rider's own assigned shipments) + status chips drive the API filter; the API scopes the list to
// this partner (RLS + shipment RBAC) — you can never page into another partner's book. Keyset (?cursor=). A failed
// call degrades to a notice, never a 500. All copy via i18n; status tone via the pure helper; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import {
  SHIPMENT_STATUSES, SHIPMENT_BOXES, statusKey, statusTone, boxKey, buildListQuery, shipmentsHref, type ShipmentRow,
} from '../../features/logistics/shipment';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ship.queueTitle'), robots: { index: false, follow: false } };
}

export default async function ShipmentsPage({ searchParams }: { searchParams: { box?: string; status?: string; cursor?: string } }) {
  await requirePartner();
  const t = getTranslator();
  const q = buildListQuery(searchParams);

  let rows: ShipmentRow[] = [];
  let nextCursor: string | undefined;
  let notice: string | undefined;
  try {
    const res = await partnerClient().request<ShipmentRow[]>('GET', 'shipments', { query: { box: q.box, status: q.status, cursor: q.cursor, limit: q.limit } });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch { notice = t.t('dash.unavailable'); }

  const columns: Column<ShipmentRow>[] = [
    { header: t.t('ship.colShipment'), cell: (r) => <Link href={`/shipments/${r.id}`}>{r.id.slice(0, 8)}…</Link> },
    { header: t.t('ship.colOrder'), cell: (r) => `${r.orderId.slice(0, 8)}…` },
    { header: t.t('ship.colAwb'), cell: (r) => r.awbNo ?? t.t('common.dash') },
    { header: t.t('ship.colStatus'), cell: (r) => <span className={`kv-status kv-status--${statusTone(r.status)}`}>{t.t(statusKey(r.status))}</span> },
    { header: t.t('ship.colCreated'), cell: (r) => (r.createdAt ? formatDate(r.createdAt, 'en') : t.t('common.dash')) },
  ];

  return (
    <section>
      <h1>{t.t('ship.queueTitle')}</h1>
      <p className="kv-muted">{t.t('ship.queueLead')}</p>

      <nav className="kv-filters" aria-label={t.t('ship.filterBox')}>
        {SHIPMENT_BOXES.map((b) => (
          <Link key={b} href={shipmentsHref(b, q.status)} className={`kv-chip${q.box === b ? ' is-active' : ''}`} aria-current={q.box === b ? 'true' : undefined}>{t.t(boxKey(b))}</Link>
        ))}
      </nav>
      <nav className="kv-filters" aria-label={t.t('ship.filterStatus')}>
        <Link href={shipmentsHref(q.box)} className={`kv-chip${!q.status ? ' is-active' : ''}`} aria-current={!q.status ? 'true' : undefined}>{t.t('ship.filterAll')}</Link>
        {SHIPMENT_STATUSES.map((s) => (
          <Link key={s} href={shipmentsHref(q.box, s)} className={`kv-chip${q.status === s ? ' is-active' : ''}`} aria-current={q.status === s ? 'true' : undefined}>{t.t(statusKey(s))}</Link>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={columns} rows={rows} empty={t.t('ship.empty')} />
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={shipmentsHref(q.box, q.status, nextCursor)}>{t.t('common.nextPage')}</Link></p>}
        </>
      )}
    </section>
  );
}
