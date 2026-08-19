// apps/web-tenant/src/app/logistics/page.tsx · W226 (Shipments) — the logistics desk's list (PC-56 TENANT-5a).
// Server-first, requireSession-gated, noindex. Keyset-paged; the tab rides in the URL (shareable).
//
// WHAT THIS PAGE SAYS THAT THE CANON'S SCREEN CANNOT:
//   • the NEXT MILESTONE per row — the one thing each shipment is waiting for — DERIVED from its status
//     rather than stored, so it cannot go stale the way a "next step" column would;
//   • "(driver unassigned)" as a real distinction: a vehicle booked with nobody driving it is the row an
//     operator must act on today, and it is not the same as a 3PL shipment that carries its own driver;
//   • and, where a shipment is `pending` because nobody has paid, WHY — W226 prints "payment clears first"
//     under its cumin row and states the rule beneath the table ("wheels never turn before money clears").
//     Until this wave NOTHING ENFORCED THAT: `ShipmentService` never read the order on create, assign,
//     schedule-pickup or pickup, so a shipment against an unpaid order could be given a driver, collected
//     from a farmer's gate and delivered. The gate is real now, and this screen shows its verdict.
//
// **THE PC-25 PERSONA RULING, RE-READ AGAINST THE CANON.** This file previously recorded that fleet CRUD
// (carriers/vehicles/slots/routes/zones/cold-chain) belongs to the LOGISTICS-PARTNER console and that a
// tenant sees oversight only. The canon disagrees: W225's sub-nav is "Overview · Shipments · Carriers ·
// Vehicles · Routes · Zones · Cold chain" inside the TENANT console, W229 is the tenant's own fleet
// register and W231 its recurring runs. The canon is the spec of record (00_MASTER.md §B), so those screens
// are TENANT-5b's to build — recorded here rather than silently reversed, because the ruling was deliberate
// and the next reader deserves to know it was revisited and why.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { TABS, driverGapKey, listHref, milestoneKey, statusesForTab, tabOf } from '../../features/logistics/shipments';
// PC-56 TENANT-5b · W225's sub-nav ("Overview · Shipments · Carriers · Vehicles · Routes · Zones · Cold chain"),
// which the canon prints on every logistics screen. Two of its entries now exist; the four with no screen are
// shown as unbuilt rather than hidden, so "not built" cannot be mistaken for "hidden from me by a permission".
import { LOGISTICS_NAV, navLabelKey } from '../../features/logistics/nav';
import type { Shipment } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('logistics.title'), robots: { index: false, follow: false } };
}

/** The API takes ONE status; a tab is a set of them. Fetched per status and merged, because the alternative
 *  — filtering a single page client-side — shows "6 of 24" when it means "6 on this page". */
async function loadTab(statuses: string[], cursor?: string) {
  const client = tenantClient();
  if (statuses.length === 1) return client.shipments.list({ box: 'all', status: statuses[0], cursor, limit: 50 });
  const pages = await Promise.all(statuses.map((s) => client.shipments.list({ box: 'all', status: s, limit: 50 })));
  const items = pages.flatMap((p) => p.items).sort((a, b) => String(b.id).localeCompare(String(a.id)));
  // A merged multi-status view cannot carry a single keyset cursor honestly, so it does not offer one and
  // the page says the view is bounded rather than paging into a sequence that does not exist.
  return { items: items.slice(0, 50), nextCursor: null as string | null, merged: items.length > 50 };
}

export default async function LogisticsPage({ searchParams }: { searchParams: { tab?: string; cursor?: string } }) {
  await requireSession('/logistics');
  const t = getTranslator();
  const lang = getLang();
  const tab = tabOf(searchParams.tab);

  let items: Shipment[] = []; let nextCursor: string | null = null; let bounded = false; let failed = false;
  try {
    const p = await loadTab(statusesForTab(tab), searchParams.cursor);
    items = p.items; nextCursor = p.nextCursor; bounded = 'merged' in p ? !!p.merged : false;
  } catch { failed = true; }

  return (
    <section>
      <h1>{t.t('logistics.title')}</h1>
      <p className="kv-field__hint">{t.t('logistics.hint')}</p>

      <nav className="kv-tabs" aria-label={t.t('logistics.nav.label')}>
        {LOGISTICS_NAV.map((i) => (i.href ? (
          <Link key={i.key} href={i.href} className={i.key === 'shipments' ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={i.key === 'shipments' ? 'page' : undefined}>
            {t.t(navLabelKey(i))}
          </Link>
        ) : (
          <span key={i.key} className="kv-tab kv-tab--muted" aria-disabled="true">{t.t(navLabelKey(i))}</span>
        )))}
      </nav>

      <nav className="kv-tabs" aria-label={t.t('ship.tabsLabel')}>
        {TABS.map((x) => (
          <Link key={x} href={listHref(x)} className={x === tab ? 'kv-tab kv-tab--on' : 'kv-tab'} aria-current={x === tab ? 'page' : undefined}>
            {t.t(`ship.tab.${x}`)}
          </Link>
        ))}
        <Link href="/logistics/events" className="kv-tab">{t.t('ship.events.title')}</Link>
      </nav>

      {failed ? <p className="kv-error" role="alert">{t.t('logistics.loadError')}</p> : (
        <>
          {bounded && <p className="kv-field__hint">{t.t('ship.list.bounded')}</p>}
          <DataTable
            rows={items}
            empty={t.t(`ship.empty.${tab}`)}
            columns={[
              { header: t.t('logistics.colShipment'), cell: (s) => <Link href={`/logistics/${s.id}`} className="kv-link">{s.awbNo ?? s.id.slice(0, 8)}</Link> },
              { header: t.t('logistics.colOrder'), cell: (s) => <Link href={`/orders/${s.orderId}`} className="kv-link">{s.orderId.slice(0, 8)}…</Link> },
              {
                header: t.t('ship.colCarrier'),
                cell: (s) => {
                  const gap = driverGapKey(s as unknown as { vehicleId?: string | null; riderUserId?: string | null; partnerId?: string | null });
                  return gap ? <span className="kv-badge kv-badge--warn">{t.t(gap)}</span> : <span>{t.t(s.partnerId ? 'ship.carrier.3pl' : 'ship.carrier.fleet')}</span>;
                },
              },
              // Money via formatMoneyMinor, never client math (Law 2). A shipment with no charge recorded
              // prints a dash — not ₹0, which would assert a free run somebody decided on.
              { header: t.t('ship.colCharge'), cell: (s) => (s.chargeMinor ? formatMoneyMinor(s.chargeMinor, 'INR', lang) : t.t('common.dash')) },
              { header: t.t('logistics.colStatus'), cell: (s) => <span className="kv-badge">{t.t(`logistics.status.${s.status}`) || s.status}</span> },
              {
                header: t.t('ship.colNextMilestone'),
                cell: (s) => {
                  const k = milestoneKey((s as unknown as { nextMilestone: Parameters<typeof milestoneKey>[0] }).nextMilestone);
                  return k ? t.t(k) : t.t('common.dash');
                },
              },
              { header: t.t('logistics.colPickup'), cell: (s) => (s.scheduledPickupAt ? formatDate(s.scheduledPickupAt, lang) : t.t('common.dash')) },
            ]}
          />
        </>
      )}
      {nextCursor && <p className="kv-pager"><a href={listHref(tab, nextCursor)} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}
    </section>
  );
}
