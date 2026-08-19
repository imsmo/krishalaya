// apps/web-tenant/src/app/logistics/[id]/tracking/page.tsx · W235 (Live tracking) — PC-56 TENANT-5a.
// Server-first, requireSession-gated, noindex. Read-only: the dispatcher's actions live on the detail page.
//
// **THE THREE NUMBERS THIS SCREEN REFUSES TO DRAW.** W235's canon prints "ETA 17:30", "traffic-adjusted ETA
// holds", "72% of route · 38 km remaining". None of the three is derivable on this platform:
//   • there is no routing engine, no traffic feed, and no ETA field anywhere — the buyer-facing
//     `OrderTracking` type already carries an earlier wave's ruling in its own comment, "No ETA field exists
//     (the app shows ETA as '—' rather than fabricating one)", and the tenant console inherits it rather
//     than quietly deciding otherwise. An ETA is the one number on this page a farmer plans an afternoon
//     around, which is the worst possible place to guess;
//   • no route geometry is stored — only hops and breadcrumbs — so a percentage OF A ROUTE cannot be
//     computed. The bar shows progress through the MILESTONES, which is true and checkable, and says so.
// What it shows instead is a fact: where the shipment was last seen, and when.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { etaKey, lastSeenKey, possessionIsProven, possessionKey, progressPct, segmentStyle } from '../../../../features/logistics/shipments';
import type { ShipmentTrail } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ship.tracking.title'), robots: { index: false, follow: false } };
}

export default async function ShipmentTrackingPage({ params }: { params: { id: string } }) {
  await requireSession(`/logistics/${params.id}/tracking`);
  const t = getTranslator();
  const lang = getLang();

  let trail: ShipmentTrail | null = null;
  let failed = false;
  try {
    trail = await tenantClient().shipments.trail(params.id);
  } catch (e) {
    // A missing or foreign id is a 404 (IDOR guard, server-side). Anything else degrades to a sentence.
    if ((e as { status?: number })?.status === 404) notFound();
    failed = true;
  }
  if (failed || !trail) {
    return (
      <section>
        <h1>{t.t('ship.tracking.title')}</h1>
        <p className="kv-error" role="alert">{t.t('ship.tracking.loadError')}</p>
        <p><Link href={`/logistics/${params.id}`} className="kv-link">{t.t('ship.backToShipment')}</Link></p>
      </section>
    );
  }

  const s = trail.shipment as unknown as { status: string; possessionProof: 'both_ends' | 'delivery_only' | 'pickup_only' | 'neither' };
  const pct = progressPct(trail.progress);

  return (
    <section>
      <h1>{t.t('ship.tracking.title')}</h1>
      <p className="kv-field__hint">
        <Link href={`/logistics/${params.id}`} className="kv-link">{t.t('ship.backToShipment')}</Link>
      </p>

      <p><span className="kv-badge">{t.t(`logistics.status.${s.status}`) || s.status}</span></p>

      {/* Milestone progress — NOT a percentage of a route. The label says which it is. */}
      {pct === null ? (
        <p className="kv-field__hint">{t.t('ship.tracking.offJourney')}</p>
      ) : (
        <p className="kv-field__hint" aria-label={t.t('ship.tracking.progressLabel')}>
          {t.t('ship.tracking.progress')} {trail.progress?.step}/{trail.progress?.of} ({pct}%)
        </p>
      )}

      {/* The ETA the canon draws and this platform cannot compute. Stated, not hidden. */}
      <p className="kv-card kv-card--notice" role="status">{t.t(etaKey())}</p>

      <p className="kv-field__hint">
        {trail.lastKnown
          ? `${t.t(lastSeenKey(true))} ${formatDate(trail.lastKnown.at, lang)}${trail.lastKnown.lat !== null ? ` · ${trail.lastKnown.lat}, ${trail.lastKnown.lng}` : ''}`
          : t.t(lastSeenKey(false))}
      </p>

      <p className={possessionIsProven(s.possessionProof) ? 'kv-field__hint' : 'kv-card kv-card--notice'} role={possessionIsProven(s.possessionProof) ? undefined : 'status'}>
        {t.t(possessionKey(s.possessionProof))}
      </p>

      <h2>{t.t('ship.tracking.trail')}</h2>
      {trail.points.length === 0 ? (
        <p className="kv-field__hint">{t.t('ship.tracking.noEvents')}</p>
      ) : (
        <ol className="kv-timeline">
          {trail.points.map((p) => (
            <li key={`${p.at}-${p.status}`} data-segment={segmentStyle(p.gapBefore)}>
              {/* W235: "a signal gap draws a dotted segment, never a teleport. ETA widens honestly." The gap
                  is LABELLED as well as styled — a dotted line is invisible to a screen reader. */}
              {p.gapBefore && <span className="kv-badge kv-badge--muted">{t.t('ship.tracking.gap')}</span>}{' '}
              <strong>{t.t(`logistics.status.${p.status}`) || p.status}</strong>{' · '}
              {formatDate(p.at, lang)}
              {p.note ? ` · ${p.note}` : ''}
              {p.lat !== null && p.lng !== null ? ` · ${p.lat}, ${p.lng}` : ''}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
