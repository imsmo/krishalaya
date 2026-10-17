// apps/web-storefront/src/components/sweep/TrackingSection.tsx · PC-56 STORE-SWEEP-b · C2 (founder D1 — canon W292 as a SECTION, DELTA `tracking_route`)
// — WHAT A BUYER SEES OF A DELIVERY, on `/<slug>/orders/[id]#tracking`, right after "Where it stands". Server component; the page passes the ORDER's
// organisation's `logistics` flag state and the tracking read's outcome (it reads `api.orders.tracking(id)` only while the flag is ON):
//   • off      → "This organisation does not record deliveries here." (the W317 flagged-off shape; "see store settings" refused — a buyer has none);
//   • unknown  → the flag could not be read — said; the read is not attempted (never a guess);
//   • error    → the read failed — the section's own sentence and a plain reload link; the rest of the order page renders (Law 12);
//   • pending  → no shipment yet, or one still `pending`: "No journey updates yet.";
//   • journey  → the status chip, the milestones with their times (features/sweep/tracking.ts `journeyRows` — status + time ONLY), "a delivery
//                partner is assigned" (never who), the count of attempts that did not succeed (no price, no ladder), the partner's reference when set.
// Refused by name below (RefusalList `tracking`): the map and any position, the person, phone and call, the vehicle and plate, the arrival time and
// slot, the handover code, text messages, re-attempt pricing, a refund on return, stop reasons, store settings and "Loading".
import { formatNumber } from '@krishalaya/i18n';
import { getTranslator, getLang } from '../../lib/i18n';
import { when } from '../OrderTimeline';
import { RefusalList } from '../RefusalList';
import { journeyRows, partnerLine, type TrackingLoad, type TrackingState } from '../../features/sweep/tracking';

const TONE: Record<string, 'done' | 'waiting' | 'closed' | 'trouble'> = { delivered: 'done', cancelled: 'closed', returned: 'closed', failed: 'trouble' };

export function TrackingSection({ state, load, reloadHref }: { state: TrackingState; load: TrackingLoad; reloadHref: string }) {
  const t = getTranslator();
  const lang = getLang();
  const data = load && load.ok ? load.data : null;
  const rows = state === 'journey' ? journeyRows(data) : [];
  const partner = state === 'journey' ? partnerLine(data?.shipment) : null;
  const status = state === 'journey' ? String(data?.shipment?.status ?? '') : '';
  const label = (s: string) => { const k = `sweep.tracking.status.${s}`; const v = t.t(k); return v === k ? s : v; };
  return (
    <section className="kv-order__section" aria-labelledby="tracking-h" id="tracking" data-kv-tracking={state}>
      <h2 id="tracking-h">{t.t('sweep.tracking.title')}</h2>
      {state === 'off' && <p className="kv-detail__muted" data-kv-state="flag-off">{t.t('sweep.tracking.off')}</p>}
      {state === 'unknown' && <p className="kv-detail__muted" data-kv-state="unknown">{t.t('sweep.tracking.unknown')}</p>}
      {state === 'error' && (
        <div className="kv-state kv-state--error" role="status" data-kv-state="error">
          <p>{t.t('sweep.tracking.error')}</p>
          <a href={reloadHref} className="kv-btn--link" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
      )}
      {state === 'pending' && <p className="kv-detail__muted" data-kv-state="empty">{t.t('sweep.tracking.pending')}</p>}
      {state === 'journey' && (
        <>
          <p>
            {t.t('sweep.tracking.statusLabel')}{' '}
            <span className={`kv-chip kv-chip--${TONE[status] ?? 'waiting'}`} data-kv-shipment={status}>{label(status)}</span>
          </p>
          {rows.length === 0 ? (
            <p className="kv-detail__muted" data-kv-state="empty">{t.t('sweep.tracking.pending')}</p>
          ) : (
            <>
              <h3 className="kv-detail__muted">{t.t('sweep.tracking.journey')}</h3>
              <ol className="kv-timeline" data-kv-journey={rows.length}>
                {rows.map((r) => (
                  <li key={`${r.status}-${r.at}`} data-kv-step={r.status}>
                    <span>{label(r.status)}</span>
                    <span className="kv-detail__muted"> · <time dateTime={r.at}>{when(r.at, lang)}</time></span>
                  </li>
                ))}
              </ol>
            </>
          )}
          {partner?.assigned && <p className="kv-detail__muted" data-kv-assigned="partner">{t.t('sweep.tracking.assigned')}</p>}
          {partner?.attempts != null && <p className="kv-detail__muted" data-kv-attempts={partner.attempts}>{t.t('sweep.tracking.attempts', { count: formatNumber(partner.attempts, lang) })}</p>}
          {partner?.awb && <p className="kv-detail__muted" data-kv-awb="partner">{t.t('sweep.tracking.awb', { awb: partner.awb })}</p>}
        </>
      )}
      <RefusalList surface="tracking" />
    </section>
  );
}
