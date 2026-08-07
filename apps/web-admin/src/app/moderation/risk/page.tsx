// apps/web-admin/src/app/moderation/risk/page.tsx · W093, risk operations (PC-56 ADMIN-5d).
//
// The band census and the account ladder. Two refusals carry the page:
//   • THE PERCENTAGES. W093 prints "72% of active users" under the trusted count. The denominator is ACTIVE USERS,
//     and what the platform can count is SCORED users — a much smaller set, because the recompute job that produces
//     scores is never invoked by anything. A share of the scored population under a label that says active would
//     overstate the platform's health by however many accounts have never been scored. Unknown until both figures
//     are readable.
//   • THE CLUSTER BOARD. W093's central table is correlated risk clusters, and its own footnote says the clusters
//     table is backend-pending (DELTA-023). No correlation job exists. An empty table would read as "no fraud rings
//     found"; the truth is that nothing looks for them, and the page says so.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { RISK_BANDS, bandClass, readingClass, shareText, censusShortfall, type BandReading } from '../../../features/trust/trust-safety';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ts.risk.title'), robots: { index: false, follow: false } };
}

interface Board {
  census: Record<string, number> & { unrecognised: number; total: number };
  shares: Record<string, { pct: number; of: string } | null>;
  scoredTotal: number;
  activeTotal: number | null;
  ladderAdvisory: string;
  clusters: { available: boolean; reason: string };
}
interface Account { userId: string; tenantId: string | null; score: number | null; band: string | null; reading: BandReading; computedAt: string | null; name: string | null; phone: string | null }

export default async function RiskOpsPage({ searchParams }: { searchParams: { band?: string; cursor?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const band = searchParams.band && (RISK_BANDS as readonly string[]).includes(searchParams.band) ? searchParams.band : undefined;

  let b: Board | undefined; let accounts: Account[] = []; let next: string | null = null;
  let notice: string | undefined; let accountsNotice: string | undefined;
  try { b = (await adminGet<Board>('trust/risk/board')).data; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }
  try {
    const r = await adminGet<Account[]>('trust/risk/accounts', { band, cursor: searchParams.cursor });
    accounts = r.data; next = (r.meta as { nextCursor?: string | null } | undefined)?.nextCursor ?? null;
  } catch (e) {
    // A SEPARATE notice. The account ladder needs `risk.read` and the board only needs `moderation.read`, so an
    // analyst holding the narrower permission sees the census and is told plainly why the list is not there —
    // rather than an empty table that reads as "no accounts are at risk".
    accountsNotice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  const shortfall = b ? censusShortfall(b.census) : 0;

  return (
    <section>
      <p className="kv-backlink"><Link href="/moderation">{t.t('ts.backOverview')}</Link></p>
      <h1>{t.t('ts.risk.heading')}</h1>
      <p className="kv-muted">{t.t('ts.risk.lead')}</p>
      {b && <p className="kv-error" role="note">{t.t('ts.advisoryBanner')}</p>}

      {!b ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <div className="kv-stat-row">
            {RISK_BANDS.map((bd) => {
              const s = shareText(b!.shares?.[bd]);
              return (
                <div key={bd} className="kv-card kv-stat">
                  <div className="kv-stat__label"><span className={bandClass(bd)}>{t.t(`ts.band.${bd}`)}</span></div>
                  <div className="kv-stat__value">{(b!.census[bd] ?? 0).toLocaleString()}</div>
                  {/* A share with no active-user denominator is a dash, never 0% — under "trusted" that would be the
                      most alarming false statement on the board. */}
                  <div className="kv-detail__muted">{s.known ? t.t('ts.risk.shareOfActive', { pct: s.text }) : t.t('ts.risk.shareUnknown')}</div>
                </div>
              );
            })}
          </div>

          {b.census.unrecognised > 0 && (
            // A stored band nothing has a rule for. Displayed, not dropped — hiding it makes the board look complete.
            <p className="kv-error" role="alert">{t.t('ts.risk.unrecognised', { n: String(b.census.unrecognised) })}</p>
          )}
          {shortfall > 0 && <p className="kv-error" role="alert">{t.t('ts.risk.censusShortfall', { n: String(shortfall) })}</p>}
          <p className="kv-detail__muted">
            {t.t('ts.risk.scoredVsActive', {
              scored: String(b.scoredTotal),
              active: b.activeTotal === null ? t.t('common.unknown') : String(b.activeTotal),
            })}
          </p>

          <h2>{t.t('ts.risk.clustersHeading')}</h2>
          {/* NOT an empty table. */}
          <p className="kv-error" role="alert">{b.clusters.reason}</p>
        </>
      )}

      <h2>{t.t('ts.risk.accountsHeading')}</h2>
      <nav className="kv-filters">
        <Link href="/moderation/risk" className={!band ? 'kv-chip is-active' : 'kv-chip'}>{t.t('ts.bl.tab.all')}</Link>
        {RISK_BANDS.map((bd) => (
          <Link key={bd} href={`/moderation/risk?band=${bd}`} className={band === bd ? 'kv-chip is-active' : 'kv-chip'}>{t.t(`ts.band.${bd}`)}</Link>
        ))}
      </nav>
      {accountsNotice ? <p className="kv-error" role="alert">{accountsNotice}</p> : (
        <>
          <table className="kv-table">
            <thead><tr>
              <th>{t.t('ts.risk.col.account')}</th><th>{t.t('ts.risk.col.score')}</th>
              <th>{t.t('ts.risk.col.band')}</th><th>{t.t('ts.risk.col.reading')}</th><th>{t.t('ts.risk.col.computed')}</th>
            </tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.userId}>
                  <td>
                    <Link href={`/moderation/risk/accounts/${a.userId}`}>{a.name ?? t.t('ts.risk.noName')}</Link>
                    <div className="kv-detail__muted">{a.phone ?? t.t('common.dash')}</div>
                  </td>
                  <td>{a.score === null ? t.t('common.dash') : a.score}</td>
                  <td><span className={bandClass(a.band)}>{a.band ? t.t(`ts.band.${a.band}`) : t.t('common.unknown')}</span></td>
                  <td><span className={readingClass(a.reading)}>{t.t(`ts.reading.${a.reading?.kind ?? 'unknown'}`)}</span></td>
                  <td>{a.computedAt ?? t.t('common.dash')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {accounts.length === 0 && <p className="kv-muted">{t.t('ts.risk.noAccounts')}</p>}
          {next && <p className="kv-pager"><Link href={`/moderation/risk?${new URLSearchParams({ ...(band ? { band } : {}), cursor: next }).toString()}`}>{t.t('common.next')}</Link></p>}
        </>
      )}
    </section>
  );
}
