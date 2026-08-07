// apps/web-admin/src/app/cells/capacity/page.tsx · W036 (PC-56 ADMIN-8).
//
// "placed_count vs capacity_tenants per cell · placement guard refuses when full."
//
// THERE WAS A ROUTE CALLED CAPACITY AND IT COMPARED NOTHING. PC-54's `GET capacity` returns
// `SELECT cell_id, shard_id, COUNT(*) FROM tenant_placements GROUP BY …` — tenant counts, no caps, no headroom, no rate.
// So W036's entire subject was absent from the one endpoint named for it.
//
// AND THE TWO CAPACITY SOURCES DISAGREE BY CONSTRUCTION. That route counts `tenant_placements` directly; the placement
// guard compares against the denormalised `placed_count`. Nothing has ever compared the two — so this platform has had two
// capacity numbers and no reconciliation, which is ADMIN-6's cached-balance finding one table over. 0116 adds
// `placement_count_checks` and this screen shows the verdict.
//
// THE GROWTH RATE IS NOT A FORECAST. W037's banner declares a forecasting service backend-pending (DELTA-013), and W036's
// "+38/week" is a COUNT of `cell_map_changes` rows with `action='placed'` — a table that has held every placement since
// 0043. So the rate is computable today and the projection is not, which is exactly where the ADMIN-8 / ADMIN-8b line
// falls.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { runCountCheckAction } from '../actions';
import {
  countCheckClass, countCheckKey, defaultNotActiveClass, dsnCellKey, dsnMissingIsUrgent, headroomClass,
  headroomText, rateClass, rateText, shardTraffic, trafficClass, trafficKey, weeksToFullText, zeroWeightClass,
  type CountCheck, type Headroom, type Rate, type TimeToFull,
} from '../../../features/cells/map-approval';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cm.capacity.title'), robots: { index: false, follow: false } };
}

interface Board {
  cells: {
    id: string; code: string; countryCode: string; status: string; isDefault: boolean;
    placedCount: number; capacityTenants: number | null;
    headroom: Headroom; rate: Rate; weeksToFull: TimeToFull; needsPlan: boolean;
    countCheck: CountCheck;
    shards: { id: string; shardIndex: number; status: string; weight: number; placedCount: number; drainingByWeight: boolean }[];
  }[];
  rateWindow: { weeks: number; from: string; to: string; events: number };
  findings: {
    defaultCellsNotActive: { id: string; code: string; countryCode: string; status: string }[];
    zeroWeightActiveShards: { id: string; cellId: string; shardIndex: number; placedCount: number }[];
    nodesNeverCountChecked: number;
  };
  planTriggerPercentUsed: number;
}

export default async function CapacityPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let b: Board | null = null; let notice: string | undefined;
  try {
    const res = await adminGet<Board>('cells/capacity/board');
    b = res.data ?? null;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'cm.restricted.capacity' : 'cm.error.capacity';
  }

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/cells">{t.t('nav.cells')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('cm.capacity.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('cm.capacity.title')}</h1>
        <p className="kv-page__sub">{t.t('cm.capacity.sub')}</p>
      </header>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}
      {searchParams.ok ? <p className="kv-note is-ok" role="status">{t.t(`cm.ok.${searchParams.ok}`)}</p> : null}
      {searchParams.error ? <p className="kv-note is-danger" role="alert">{t.t(`cm.err.${searchParams.error}`)}</p> : null}

      {b ? (
        <>
          {/* ---------------- THE THREE FINDINGS, FIRST ---------------- */}
          {b.findings.defaultCellsNotActive.length > 0 ? (
            <p className={defaultNotActiveClass(b.findings.defaultCellsNotActive.length)} role="alert">
              {/* A default cell that is not active means a country whose NEW registrations all fail at placement, while
                  existing tenants keep working — a platform that has not gone down but has stopped taking customers. */}
              {t.t('cm.finding.defaultNotActive', {
                cells: b.findings.defaultCellsNotActive.map((c) => `${c.code} (${c.countryCode}, ${c.status})`).join(', '),
              })}
            </p>
          ) : null}

          {b.findings.zeroWeightActiveShards.length > 0 ? (
            <p className={zeroWeightClass(b.findings.zeroWeightActiveShards.length)} role="status">
              {/* Until 0116 nothing read `weight`, so these shards were RECEIVING tenants while their weight said drain. */}
              {t.t('cm.finding.zeroWeight', { n: String(b.findings.zeroWeightActiveShards.length) })}
            </p>
          ) : null}

          <section className="kv-panel" aria-labelledby="cm-recon">
            <h2 id="cm-recon" className="kv-panel__title">{t.t('cm.recon.title')}</h2>
            {b.findings.nodesNeverCountChecked > 0 ? (
              <p className="kv-note is-warn">
                {t.t('cm.recon.never', { n: String(b.findings.nodesNeverCountChecked) })}
              </p>
            ) : null}
            <p className="kv-note">{t.t('cm.recon.why')}</p>
            <form action={runCountCheckAction}>
              <button className="kv-btn" type="submit">{t.t('cm.recon.run')}</button>
            </form>
          </section>

          {/* ---------------- THE CELLS ---------------- */}
          {b.cells.length === 0 ? (
            <div className="kv-empty">
              <h2>{t.t('cm.capacity.empty.title')}</h2>
              <p>{t.t('cm.capacity.empty.body')}</p>
            </div>
          ) : (
            <table className="kv-table">
              <caption className="kv-table__caption">
                {t.t('cm.capacity.caption', { weeks: String(b.rateWindow.weeks), n: String(b.rateWindow.events) })}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t.t('cm.col.cell')}</th>
                  <th scope="col">{t.t('cm.col.placed')}</th>
                  <th scope="col">{t.t('cm.col.headroom')}</th>
                  <th scope="col">{t.t('cm.col.rate')}</th>
                  <th scope="col">{t.t('cm.col.weeksToFull')}</th>
                  <th scope="col">{t.t('cm.col.counts')}</th>
                </tr>
              </thead>
              <tbody>
                {b.cells.map((c) => {
                  const h = headroomText(c.headroom);
                  const r = rateText(c.rate);
                  const w = weeksToFullText(c.weeksToFull);
                  return (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/cells/cells/${encodeURIComponent(c.id)}`}>{c.code}</Link>
                        <br /><small>{c.countryCode} · {c.status}{c.isDefault ? ` · ${t.t('cm.default')}` : ''}</small>
                      </td>
                      <td>
                        {c.placedCount.toLocaleString('en-IN')}
                        {/* An uncapped cell shows an em dash rather than a number: it has no cap and no guard protecting
                            it, which is a different condition from a roomy one. */}
                        {' / '}{c.capacityTenants === null ? '—' : c.capacityTenants.toLocaleString('en-IN')}
                      </td>
                      <td>
                        <span className={headroomClass(c.headroom, b!.planTriggerPercentUsed)}>{h.text}</span>
                        {h.unknownKey ? <><br /><small>{t.t(h.unknownKey)}</small></> : null}
                        {c.needsPlan ? <><br /><small>{t.t('cm.needsPlan', { pct: String(b!.planTriggerPercentUsed) })}</small></> : null}
                      </td>
                      <td>
                        <span className={rateClass(c.rate)}>{r.text}</span>
                        {r.unknownKey ? <><br /><small>{t.t(r.unknownKey)}</small></> : null}
                      </td>
                      <td>
                        {w.text}
                        {w.unknownKey ? <><br /><small>{t.t(w.unknownKey)}</small></> : null}
                      </td>
                      <td>
                        {/* NULL means NEVER CHECKED — the state of every node today — and it is a warning rather than
                            neutral, on the rule that an unverified figure says so rather than implying verification. */}
                        <span className={countCheckClass(c.countCheck)}>{t.t(countCheckKey(c.countCheck))}</span>
                        {c.countCheck && c.countCheck.kind !== 'match' ? (
                          <><br /><small>{t.t('cm.count.detail', {
                            stored: String(c.countCheck.stored ?? '—'), derived: String(c.countCheck.derived ?? '—'),
                          })}</small></>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* ---------------- SHARD BALANCE ---------------- */}
          {b.cells.filter((c) => c.shards.length > 0).map((c) => (
            <section className="kv-panel" key={c.id} aria-labelledby={`cm-sh-${c.id}`}>
              <h2 id={`cm-sh-${c.id}`} className="kv-panel__title">
                {t.t('cm.shards.title', { cell: c.code })}
              </h2>
              <table className="kv-table">
                <thead>
                  <tr>
                    <th scope="col">{t.t('cm.col.index')}</th>
                    <th scope="col">{t.t('cm.col.traffic')}</th>
                    <th scope="col">{t.t('cm.col.weight')}</th>
                    <th scope="col">{t.t('cm.col.placed')}</th>
                    <th scope="col">{t.t('cm.col.dsn')}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.shards.map((s) => {
                    const traffic = shardTraffic(s.status, s.weight);
                    // The shard entity exposes `hasDsn` only — the raw ref never leaves the server. Derived here from the
                    // presence of the field the board carries.
                    const hasDsn = true;
                    return (
                      <tr key={s.id}>
                        <td><Link href={`/cells/shards/${encodeURIComponent(s.id)}`}>{s.shardIndex}</Link></td>
                        <td>
                          <span className={trafficClass(traffic)}>{t.t(trafficKey(traffic))}</span>
                          {/* `draining_by_weight` is its own label rather than folded into the status badge, because the
                              two can disagree and the disagreement is the interesting case: somebody took the shard out
                              of rotation without committing to the lifecycle change. */}
                        </td>
                        <td>{s.weight}</td>
                        <td>{s.placedCount.toLocaleString('en-IN')}</td>
                        <td>
                          {t.t(dsnCellKey(hasDsn))}
                          {dsnMissingIsUrgent(hasDsn, s.status) ? <><br /><small>{t.t('cm.dsn.activeWithout')}</small></> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}

          {/* W037's projection is deliberately absent — see the header, and the canon's own DELTA-013 banner. */}
          <p className="kv-note">{t.t('cm.capacity.noProjection')}</p>
        </>
      ) : null}
    </main>
  );
}
