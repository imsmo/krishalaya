// apps/web-tenant/src/app/logistics/events/page.tsx · W236 (Shipment event explorer) — PC-56 TENANT-5a.
// Server-first, requireSession-gated, noindex. Keyset-paged, date-bounded, filtered in SQL.
//
// **THIS SCREEN HAD NOTHING BEHIND IT.** `shipment_events` has been written by every hop and every
// 90-second GPS ping since migration 0007, and `grep -rln "shipment_events" apps/api/src` returned the two
// writers, one test, and a BUYER-facing feed for ONE order in the orders module. The table the whole
// logistics desk rests on could not be read by the logistics desk, so W236 — "the ops debugging surface" —
// was a drawing.
//
// What this page says that the canon's screen cannot:
//   • the WINDOW it actually queried, and whether that window was clamped at the 90-day hot horizon — an
//     operator who asked for six months and silently got ninety days reads the empty stretch as "nothing
//     happened" instead of "you did not ask for that";
//   • the PRECISION of the coordinates in front of them: a non-lead sees ~100m rounding, and must know that
//     is what they are looking at or they will drive to the wrong gate;
//   • and, where a filter cannot be answered by a single row — a GPS gap is a property of two consecutive
//     points, not of one event — it says so rather than implying the list is the whole answer.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { EVENT_FILTERS, eventsHref, isEventFilter, precisionKey, windowKey } from '../../../features/logistics/shipments';
import type { ShipmentEventPage } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ship.events.title'), robots: { index: false, follow: false } };
}

export default async function ShipmentEventsPage({ searchParams }: { searchParams: { filter?: string; from?: string; to?: string; cursor?: string } }) {
  await requireSession('/logistics/events');
  const t = getTranslator();
  const lang = getLang();
  const filter = isEventFilter(searchParams.filter) ? searchParams.filter : 'all';

  let page: ShipmentEventPage | null = null;
  let failed = false;
  try {
    page = await tenantClient().shipments.events({
      filter, from: searchParams.from, to: searchParams.to, cursor: searchParams.cursor, limit: 50,
    });
  } catch { failed = true; }

  return (
    <section>
      <h1>{t.t('ship.events.title')}</h1>
      <p className="kv-field__hint">{t.t('ship.events.hint')}</p>

      <form method="get" action="/logistics/events" className="kv-inline-form" role="search" aria-label={t.t('ship.events.filterLabel')}>
        <label htmlFor="ev-from" className="kv-field__label">{t.t('ship.events.from')}</label>
        <input id="ev-from" name="from" type="date" defaultValue={searchParams.from ?? ''} className="kv-input" />
        <label htmlFor="ev-to" className="kv-field__label">{t.t('ship.events.to')}</label>
        <input id="ev-to" name="to" type="date" defaultValue={searchParams.to ?? ''} className="kv-input" />
        <label htmlFor="ev-filter" className="kv-field__label">{t.t('ship.events.filter')}</label>
        <select id="ev-filter" name="filter" defaultValue={filter} className="kv-input">
          {EVENT_FILTERS.map((f) => <option key={f} value={f}>{t.t(`ship.events.filter.${f}`)}</option>)}
        </select>
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('ship.events.apply')}</button>
      </form>

      {failed || !page ? (
        // Law 12 — the explorer is a read surface: it degrades to a sentence, and the events keep appending
        // server-side either way. The flag being off lands here too, which is why the copy says "not
        // available" rather than "nothing happened".
        <p className="kv-error" role="alert">{t.t('ship.events.loadError')}</p>
      ) : (
        <>
          <p className={page.window.clamped ? 'kv-card kv-card--notice' : 'kv-field__hint'} role={page.window.clamped ? 'status' : undefined}>
            {t.t(windowKey(page.window))} {page.window.from} → {page.window.to}
          </p>
          <p className="kv-field__hint">{t.t(precisionKey(page.precisionDp))}</p>
          {filter === 'gps_gap' && <p className="kv-field__hint">{t.t('ship.events.gapNote')}</p>}

          <DataTable
            rows={page.items}
            empty={t.t('ship.events.empty')}
            columns={[
              { header: t.t('ship.events.colWhen'), cell: (e) => formatDate(e.at, lang) },
              { header: t.t('ship.events.colShipment'), cell: (e) => <Link href={`/logistics/${e.shipmentId}`} className="kv-link">{e.shipmentId.slice(0, 8)}…</Link> },
              { header: t.t('ship.events.colEvent'), cell: (e) => <span className="kv-badge">{t.t(`logistics.status.${e.status}`) || e.status}</span> },
              { header: t.t('ship.events.colNote'), cell: (e) => e.note ?? t.t('common.dash') },
              {
                header: t.t('ship.events.colGps'),
                // An event with no coordinates prints a dash, never a zero: 0,0 is a real place in the Gulf
                // of Guinea and a console that draws it has told an operator where a vehicle is.
                cell: (e) => (e.lat === null || e.lng === null ? t.t('common.dash') : `${e.lat}, ${e.lng}`),
              },
            ]}
          />
          {page.nextCursor && (
            <p className="kv-pager">
              <a href={eventsHref(filter, page.window.from, page.window.to, page.nextCursor)} className="kv-btn--link">{t.t('common.nextPage')}</a>
            </p>
          )}
        </>
      )}
    </section>
  );
}
