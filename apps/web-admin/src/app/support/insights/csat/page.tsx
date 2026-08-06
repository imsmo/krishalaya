// apps/web-admin/src/app/support/insights/csat/page.tsx · CSAT EXPLORER (PC-56 ADMIN-2, canon W056).
//
// TWO HONESTIES ON THIS PAGE:
//   1. THE CANON'S "VERBATIM (TRANSLATED)" COLUMN DOES NOT EXIST, and the page says so instead of rendering an empty
//      column. `support_tickets` stores a 1–5 score and no comment field (0012), so there is nothing to translate. An
//      empty column would read as "nobody wrote anything", which is a claim about farmers rather than about our schema.
//      Queued as ADMIN-2-Q1.
//   2. AN UNRATED WINDOW IS NOT A BAD ONE. With no ratings the distribution renders nothing at all rather than five
//      zero bars, which would draw a chart implying everybody scored 1, and the average is absent rather than 0%.
//
// The low-score review queue is the part of a CSAT dashboard anybody acts on, so it leads.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { formatDate } from '@krishalaya/i18n';
import { bpsToPercent } from '../../../../features/reports/report';
import { csatShares, isLowScore, LOW_SCORE_MAX, type CsatBucket } from '../../../../features/support/desk';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('csat.title'), robots: { index: false, follow: false } };
}

interface ScoreRow {
  ticketId: string; ticketNo: string; tenantSlug: string | null; score: number;
  severity: string; assigneeUserId: string | null; ratedAt: string;
}
interface CsatView {
  window: { from: string; to: string };
  distribution: CsatBucket[]; ratedCount: number; averageBps: number | null;
  scores: ScoreRow[]; verbatimsAvailable: boolean;
}

export default async function CsatPage({ searchParams }: { searchParams: { days?: string; low?: string } }) {
  requireAdmin();
  const t = getTranslator();

  const days = /^\d{1,3}$/.test(searchParams.days ?? '') ? Math.min(Math.max(Number(searchParams.days), 1), 365) : 30;
  const lowOnly = searchParams.low !== '0';
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);

  let view: CsatView | null = null; let notice: string | undefined;
  try {
    view = (await adminGet<CsatView>('support/insights/csat', {
      from: from.toISOString(), to: to.toISOString(),
      ...(lowOnly ? { maxScore: LOW_SCORE_MAX } : {}), limit: 100,
    })).data ?? null;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const shares = csatShares(view?.distribution ?? []);

  return (
    <section>
      <p className="kv-backlink"><Link href="/support/insights">{t.t('csat.backToInsights')}</Link></p>
      <h1>{t.t('csat.title')}</h1>

      <nav className="kv-tabs" aria-label={t.t('csat.filter')}>
        {[7, 30, 90].map((d) => (
          <Link key={d} href={`/support/insights/csat?days=${d}&low=${lowOnly ? '1' : '0'}`}
            className={`kv-tab${d === days ? ' kv-tab--active' : ''}`} aria-current={d === days ? 'page' : undefined}>
            {t.t('ins.lastDays', { n: String(d) })}
          </Link>
        ))}
        <Link href={`/support/insights/csat?days=${days}&low=${lowOnly ? '0' : '1'}`} className="kv-tab">
          {t.t(lowOnly ? 'csat.showAll' : 'csat.showLowOnly', { max: String(LOW_SCORE_MAX) })}
        </Link>
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          {/* The headline. Absent — not 0% — when nothing was rated. */}
          <p className="kv-card__title">
            {view?.averageBps === null || view?.averageBps === undefined
              ? t.t('csat.noneRated')
              : t.t('csat.headline', { pct: bpsToPercent(view.averageBps), n: String(view.ratedCount) })}
          </p>

          {shares.length === 0 ? <p className="kv-empty">{t.t('csat.noDistribution')}</p> : (
            <table className="kv-table">
              <thead><tr>
                <th scope="col">{t.t('csat.score')}</th>
                <th scope="col">{t.t('csat.count')}</th>
                <th scope="col">{t.t('csat.share')}</th>
              </tr></thead>
              <tbody>
                {shares.map((s) => (
                  <tr key={s.score}>
                    <td>{s.score}{isLowScore(s.score) && <> <span className="kv-status kv-status--warn">{t.t('csat.low')}</span></>}</td>
                    <td>{s.n}</td>
                    <td>
                      {bpsToPercent(s.shareBps)}%
                      <span className="kv-bar" style={{ width: `${Math.round(s.shareBps / 100)}%` }} aria-hidden="true" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2>{t.t(lowOnly ? 'csat.reviewQueue' : 'csat.allScores')}</h2>
          {(view?.scores ?? []).length === 0 ? <p className="kv-empty">{t.t('csat.noScores')}</p> : (
            <table className="kv-table">
              <thead><tr>
                <th scope="col">{t.t('csat.when')}</th>
                <th scope="col">{t.t('csat.score')}</th>
                <th scope="col">{t.t('csat.ticket')}</th>
                <th scope="col">{t.t('csat.tenant')}</th>
                <th scope="col">{t.t('csat.agent')}</th>
              </tr></thead>
              <tbody>
                {(view?.scores ?? []).map((s) => (
                  <tr key={s.ticketId}>
                    <td>{formatDate(s.ratedAt)}</td>
                    <td>
                      <span className={`kv-status ${isLowScore(s.score) ? 'kv-status--danger' : 'kv-status--ok'}`}>{s.score}</span>
                    </td>
                    <td><Link href={`/support/tickets/${encodeURIComponent(s.ticketId)}`}>{s.ticketNo}</Link></td>
                    <td>{s.tenantSlug ?? t.t('common.dash')}</td>
                    <td><code>{String(s.assigneeUserId ?? '').slice(0, 8) || t.t('common.dash')}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* The missing column, named rather than rendered empty. */}
          {view && !view.verbatimsAvailable && <p className="kv-notice" role="note">{t.t('csat.noVerbatims')}</p>}
          <p className="kv-field__hint">{t.t('csat.ratedAtNote')}</p>
        </>
      )}
    </section>
  );
}
