// apps/web-admin/src/app/moderation/insights/page.tsx · W098, trust & safety insights (PC-56 ADMIN-5d).
//
// W098 asks the only question that matters and refuses the easy answer: "Is the marketplace getting safer without
// getting harsher? Both lines must trend right." A page reporting only enforcement would look best at the moment the
// platform became unusable for honest farmers.
//
// MOST OF THIS PAGE IS EMPTY TILES WITH REASONS, AND THAT IS THE HONEST RENDERING. Verified, one by one: nothing
// values a prevented fraud loss; measuring friction on honest users needs a record of who was held and nothing holds
// anything; no order or settlement carries a confirmed-fraud marker; and there is no post-outcome survey of reporters
// anywhere on the platform. Every one of those, filled with a zero, would be a FLATTERING claim — no fraud, no
// friction, no losses. That asymmetry is why the unknown/zero distinction is enforced by the type rather than by
// remembering to be careful.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { tileText, tileValue, sampleNote, type Tile } from '../../../features/trust/trust-safety';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ts.ins.title'), robots: { index: false, follow: false } };
}

interface Insights {
  windowDays: number;
  tiles: { fraudLossPrevented: Tile; honestUserFriction: Tile; appealOverturnRate: Tile; medianTimeToAction: Tile; falseActionRate: Tile };
  lowSample: { appealOverturnRate: boolean; falseActionRate: boolean };
  medianSample: { n: number; capped: boolean } | null;
  reasons: { reasons: { code: string; count: number }[]; unresolved: number; total: number } | null;
  ecosystem: { trustedShare: Tile; gmvTouchedByFraud: Tile; reportersWouldReportAgain: Tile };
  scoredTotal: number | null;
  activeTotal: number | null;
}

function Stat({ label, tile, note, t }: { label: string; tile: Tile; note?: string | null; t: ReturnType<typeof getTranslator> }) {
  const v = tileValue(tile);
  return (
    <div className="kv-card kv-stat">
      <div className="kv-stat__label">{label}</div>
      <div className="kv-stat__value">{tileText(tile)}</div>
      {/* The REASON, not a blank. A blank cell makes an un-measurable metric look like an oversight. */}
      {!v.known && tile && tile.kind === 'unavailable' && <div className="kv-detail__muted">{tile.reason}</div>}
      {v.known && note && <div className="kv-status kv-status--warn">{t.t('ts.ins.lowSample', { n: note })}</div>}
    </div>
  );
}

export default async function TrustInsightsPage({ searchParams }: { searchParams: { days?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const days = /^[0-9]{1,3}$/.test(searchParams.days ?? '') ? searchParams.days : undefined;

  let i: Insights | undefined; let notice: string | undefined;
  try { i = (await adminGet<Insights>('trust/insights', { days })).data; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  if (!i) {
    return (
      <section>
        <p className="kv-backlink"><Link href="/moderation">{t.t('ts.backOverview')}</Link></p>
        <h1>{t.t('ts.ins.heading')}</h1>
        {/* W098's own error state is right and worth keeping: operational queues are unaffected by an insights failure. */}
        <p className="kv-error" role="alert">{notice}</p>
        <p className="kv-muted">{t.t('ts.ins.queuesUnaffected')}</p>
      </section>
    );
  }

  return (
    <section>
      <p className="kv-backlink"><Link href="/moderation">{t.t('ts.backOverview')}</Link></p>
      <h1>{t.t('ts.ins.heading')}</h1>
      <p className="kv-muted">{t.t('ts.ins.lead')}</p>
      <nav className="kv-filters">
        {[30, 90, 365].map((d) => (
          <Link key={d} href={`/moderation/insights?days=${d}`} className={i!.windowDays === d ? 'kv-chip is-active' : 'kv-chip'}>
            {t.t('ts.ins.days', { d: String(d) })}
          </Link>
        ))}
      </nav>

      <div className="kv-stat-row">
        <Stat label={t.t('ts.ins.tile.fraudLoss')} tile={i.tiles.fraudLossPrevented} t={t} />
        <Stat label={t.t('ts.ins.tile.friction')} tile={i.tiles.honestUserFriction} t={t} />
        <Stat label={t.t('ts.ins.tile.overturn')} tile={i.tiles.appealOverturnRate} note={sampleNote(i.lowSample.appealOverturnRate, null)} t={t} />
        <Stat label={t.t('ts.ins.tile.median')} tile={i.tiles.medianTimeToAction} t={t} />
        <Stat label={t.t('ts.ins.tile.falseAction')} tile={i.tiles.falseActionRate} note={sampleNote(i.lowSample.falseActionRate, null)} t={t} />
      </div>
      {i.medianSample?.capped && <p className="kv-detail__muted">{t.t('ts.ins.medianCapped', { n: String(i.medianSample.n) })}</p>}

      <h2>{t.t('ts.ins.reasonsHeading')}</h2>
      {!i.reasons ? <p className="kv-error" role="alert">{t.t('ts.ins.reasonsUnavailable')}</p> : (
        <>
          <table className="kv-table">
            <thead><tr><th>{t.t('ts.ins.col.reason')}</th><th>{t.t('ts.ins.col.count')}</th></tr></thead>
            <tbody>
              {i.reasons.reasons.map((r) => <tr key={r.code}><td>{r.code}</td><td>{r.count}</td></tr>)}
            </tbody>
          </table>
          {i.reasons.reasons.length === 0 && <p className="kv-muted">{t.t('ts.ins.noReports')}</p>}
          {/* NOT folded into `other`. `other` is a reason somebody chose; an unresolvable id is a broken join, and
              merging the two makes a data fault look like a user's choice. */}
          {i.reasons.unresolved > 0 && <p className="kv-error" role="alert">{t.t('ts.ins.unresolvedReasons', { n: String(i.reasons.unresolved) })}</p>}
        </>
      )}

      <h2>{t.t('ts.ins.ecosystemHeading')}</h2>
      <div className="kv-stat-row">
        <Stat label={t.t('ts.ins.tile.trustedShare')} tile={i.ecosystem.trustedShare} t={t} />
        <Stat label={t.t('ts.ins.tile.gmvFraud')} tile={i.ecosystem.gmvTouchedByFraud} t={t} />
        <Stat label={t.t('ts.ins.tile.wouldReport')} tile={i.ecosystem.reportersWouldReportAgain} t={t} />
      </div>
      <p className="kv-detail__muted">
        {t.t('ts.ins.scoredVsActive', {
          scored: i.scoredTotal === null ? t.t('common.unknown') : String(i.scoredTotal),
          active: i.activeTotal === null ? t.t('common.unknown') : String(i.activeTotal),
        })}
      </p>
    </section>
  );
}
