// apps/web-admin/src/app/analytics/demand-map/page.tsx · W108 + W2136–W2140, the demand map (PC-56 ADMIN-SWEEP-c3).
//
// DELTA-027'S THREE WARNINGS, DRAWN AS THE PAGE: the three sources are three separate columns and one of them —
// search interest — is an honest absence (nothing on the platform records a search query; a number would
// manufacture demand). District aggregates only, at admin_regions level 2. The k-anonymity floor is printed on
// the page and applied to the file: cells below it are marked here and absent there. The "map" plots the only
// geometry the platform has (district centroids) — boundary polygons exist nowhere and are named as the gap they
// are, not faked in SVG. And the canon's Retry/rebuild chain (W2138–W2140) is absent-not-disabled: the read
// recomputes on every request, so the error state's remedy is the page itself, freshly asked.
import type { Metadata } from 'next';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { exportDemandAction } from './actions';
import { formatMinor } from '../../../features/analytics/farmer360';
import { heatBucket, projectCentroids, weekLabel, gapClass, EXPORT_REASON_MIN } from '../../../features/analytics/demand-map';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dm.title'), robots: { index: false, follow: false } };
}

interface CellVerdict { kind: 'gap' | 'covered' | 'unvalued'; pct?: number }
interface Cell {
  districtId: string; districtName: string; productId: string; productName: string;
  demandMinor: string | null; unvaluedN: number; buyersN: number; requirementsN: number;
  supplyMinor: string | null; listingsN: number; verdict: CellVerdict; belowFloor: boolean;
}
interface DistrictIntensity {
  districtId: string; districtName: string; demandMinor: string; requirementsN: number;
  orderFlowMinor: string | null; ordersN: number; centroid: { lat: number; lng: number } | null;
}
interface PageModel {
  week: { isoWeek: string; start: string; end: string };
  intensity: DistrictIntensity[];
  gaps: Cell[]; gapsTotal: number; cellsTotal: number;
  searchInterest: { kind: 'not_recorded'; reason: string };
  floor: { k: number; basis: string };
  accounting: {
    openRequirements: number;
    categoryOnly: { n: number; basis: string }; nonInr: { n: number; basis: string };
    unlocatable: { n: number; basis: string }; ordersUnlocatable: { n: number; basis: string };
  };
  bases: { demand: string; supply: string; orderFlow: string; district: string };
}

const HEAT_OPACITY = [0.12, 0.3, 0.5, 0.75, 1];
const ERR = new Set(['reason', 'exportGrant', 'assembly', 'generic']);

export default async function DemandMapPage({ searchParams }: { searchParams: { week?: string; ok?: string; error?: string; receipt?: string; suppressed?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const sp = searchParams;

  let d: PageModel | undefined; let notice: string | undefined; let assemblyError: string | undefined;
  try {
    d = (await adminGet<PageModel>('analytics/demand-map', sp.week ? { week: sp.week } : undefined)).data;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 503) assemblyError = e.message;   // the failing SOURCE, by name
    else if (e instanceof AdminApiError && e.status === 422) notice = t.t('dm.badWeek');
    else notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  const withCentroid = d ? d.intensity.filter((i) => i.centroid !== null) : [];
  const projected = new Map(projectCentroids(withCentroid.map((i) => ({ id: i.districtId, lat: i.centroid!.lat, lng: i.centroid!.lng }))).map((p) => [p.id, p]));
  const maxDemand = d && d.intensity.length > 0 ? d.intensity[0].demandMinor : '0';

  return (
    <section>
      <h1>{t.t('dm.heading')}</h1>
      <p className="kv-muted">{t.t('dm.lead')}</p>

      {notice && <p className="kv-error" role="alert">{notice}</p>}
      {/* W108's error state, with the canon's own reassurance kept because it is TRUE of a read-only assembly. */}
      {assemblyError && (
        <div role="alert">
          <p className="kv-error">{assemblyError}</p>
          <p className="kv-detail__muted">{t.t('dm.retryIsReload')}</p>
        </div>
      )}
      {sp.ok === 'exported' && (
        <p className="kv-notice" role="status">
          {t.t('dm.exported', { receipt: sp.receipt ?? '', suppressed: sp.suppressed ?? '0' })}
        </p>
      )}
      {sp.error && ERR.has(sp.error) && <p className="kv-error" role="alert">{t.t(`dm.error.${sp.error}` as never)}</p>}

      {d && (
        <>
          <p>
            <span className="kv-status kv-status--warn">{weekLabel(d.week.isoWeek, d.week.start, d.week.end)}</span>{' '}
            <span className="kv-detail__muted">{t.t('dm.twoClocks')}</span>
          </p>

          {/* The three warnings, printed where the canon put its growth cards — as the page's own rules. */}
          <p className="kv-detail__muted">{t.t('dm.privacyLine')}</p>
          <p className="kv-detail__muted">{d.floor.basis}</p>

          <h2>{t.t('dm.searchHeading')}</h2>
          <p className="kv-notice" role="note">{t.t('dm.searchNotRecorded')}</p>
          <p className="kv-detail__muted">{d.searchInterest.reason}</p>

          <h2>{t.t('dm.intensityHeading')}</h2>
          {d.intensity.length === 0 ? (
            <p className="kv-empty">{t.t('dm.empty')}</p>
          ) : (
            <>
              {withCentroid.length > 0 && (
                <svg viewBox="0 0 100 62" role="img" aria-label={t.t('dm.mapAria')} style={{ maxWidth: 640, width: '100%' }}>
                  {withCentroid.map((i) => {
                    const p = projected.get(i.districtId)!;
                    const b = heatBucket(i.demandMinor, maxDemand);
                    return (
                      <g key={i.districtId}>
                        <circle cx={p.xPct} cy={p.yPct * 0.62} r={1.6 + b * 0.8} fill="currentColor" opacity={HEAT_OPACITY[b]} />
                        <text x={p.xPct} y={p.yPct * 0.62 + 4.6} textAnchor="middle" style={{ fontSize: 2.4 }}>{i.districtName}</text>
                      </g>
                    );
                  })}
                </svg>
              )}
              {/* Centroid marks, not boundaries — the gap is named, not painted over. */}
              <p className="kv-detail__muted">{t.t('dm.centroidNote')}</p>
              <table className="kv-table">
                <thead><tr>
                  <th>{t.t('dm.col.district')}</th><th>{t.t('dm.col.demand')}</th>
                  <th>{t.t('dm.col.requirements')}</th><th>{t.t('dm.col.orderFlow')}</th><th>{t.t('dm.col.orders')}</th>
                </tr></thead>
                <tbody>
                  {d.intensity.map((i) => (
                    <tr key={i.districtId}>
                      <td>{i.districtName}{i.centroid === null && <span className="kv-detail__muted"> · {t.t('dm.noCentroid')}</span>}</td>
                      <td>{i.demandMinor === '0' ? <span className="kv-detail__muted">{t.t('dm.none')}</span> : formatMinor(i.demandMinor)}</td>
                      <td>{i.requirementsN}</td>
                      <td>{i.orderFlowMinor === null ? <span className="kv-detail__muted">{t.t('dm.none')}</span> : formatMinor(i.orderFlowMinor)}</td>
                      <td>{i.ordersN}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h2>{t.t('dm.gapsHeading')}</h2>
          <p className="kv-muted">{t.t('dm.gapsLead')}</p>
          {d.gaps.length === 0 ? (
            <p className="kv-empty">{t.t('dm.noGaps')}</p>
          ) : (
            <>
              <table className="kv-table">
                <thead><tr>
                  <th>{t.t('dm.col.productDistrict')}</th><th>{t.t('dm.col.demand')}</th><th>{t.t('dm.col.buyers')}</th>
                  <th>{t.t('dm.col.supply')}</th><th>{t.t('dm.col.gap')}</th>
                </tr></thead>
                <tbody>
                  {d.gaps.map((c) => (
                    <tr key={`${c.districtId}:${c.productId}`}>
                      <td>{c.productName} · {c.districtName}</td>
                      <td>{c.demandMinor === null ? '' : formatMinor(c.demandMinor)}{c.unvaluedN > 0 && <span className="kv-detail__muted"> {t.t('dm.plusUnvalued', { n: String(c.unvaluedN) })}</span>}</td>
                      <td>{c.buyersN}{c.belowFloor && <span className="kv-detail__muted"> · {t.t('dm.belowFloor', { k: String(d.floor.k) })}</span>}</td>
                      <td>{c.supplyMinor === null ? <span className="kv-detail__muted">{t.t('dm.noSupply')}</span> : formatMinor(c.supplyMinor)}</td>
                      <td>{c.verdict.kind === 'gap' && <span className={gapClass(c.verdict.pct!)}>{c.verdict.pct}%</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.gapsTotal > d.gaps.length && <p className="kv-detail__muted">{t.t('dm.gapsCapped', { shown: String(d.gaps.length), total: String(d.gapsTotal) })}</p>}
            </>
          )}

          {/* Unknown ≠ zero, in counts: what the map could NOT place, value or convert. */}
          <h2>{t.t('dm.accountingHeading')}</h2>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('dm.acct.open')}</dt><dd>{d.accounting.openRequirements}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('dm.acct.categoryOnly')}</dt><dd>{d.accounting.categoryOnly.n}<div className="kv-detail__muted">{d.accounting.categoryOnly.basis}</div></dd></div>
            <div className="kv-facts__row"><dt>{t.t('dm.acct.unlocatable')}</dt><dd>{d.accounting.unlocatable.n}<div className="kv-detail__muted">{d.accounting.unlocatable.basis}</div></dd></div>
            <div className="kv-facts__row"><dt>{t.t('dm.acct.nonInr')}</dt><dd>{d.accounting.nonInr.n}<div className="kv-detail__muted">{d.accounting.nonInr.basis}</div></dd></div>
            <div className="kv-facts__row"><dt>{t.t('dm.acct.ordersUnlocatable')}</dt><dd>{d.accounting.ordersUnlocatable.n}<div className="kv-detail__muted">{d.accounting.ordersUnlocatable.basis}</div></dd></div>
          </dl>
          <p className="kv-detail__muted">{d.bases.demand}</p>
          <p className="kv-detail__muted">{d.bases.supply}</p>
          <p className="kv-detail__muted">{d.bases.orderFlow}</p>
          <p className="kv-detail__muted">{d.bases.district}</p>

          {/* W2136/W2137 met as the synchronous truth (ADMIN-10-Q1): receipt here, no queue page. */}
          <h2>{t.t('dm.exportHeading')}</h2>
          <p className="kv-muted">{t.t('dm.exportLead', { k: String(d.floor.k) })}</p>
          <form action={exportDemandAction}>
            <input type="hidden" name="week" value={d.week.isoWeek} />
            <label htmlFor="dm-reason">{t.t('dm.exportReason')}</label>
            <input id="dm-reason" name="reason" required minLength={EXPORT_REASON_MIN} placeholder={t.t('dm.exportReasonHint')} />
            <button type="submit" className="kv-btn">{t.t('dm.exportSubmit')}</button>
          </form>

          {/* The gaps behind this page, named — not faked. */}
          <h2>{t.t('dm.backendHeading')}</h2>
          <p className="kv-detail__muted">{t.t('dm.gapSearchLog')}</p>
          <p className="kv-detail__muted">{t.t('dm.gapBoundaries')}</p>
          <p className="kv-detail__muted">{t.t('dm.gapNoRebuild')}</p>
        </>
      )}
    </section>
  );
}
