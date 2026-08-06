// apps/web-admin/src/app/support/insights/csat/page.tsx · CSAT EXPLORER (PC-56 ADMIN-2 · deepened by ADMIN-2c, canon W056).
//
// THE VERBATIM COLUMN EXISTS NOW. ADMIN-2 shipped this page with a warning in capital letters: the canon's
// "Verbatim (translated)" column had nothing behind it, because `support_tickets` held a 1–5 integer and no comment
// field. Migration 0099 made every rating an append-only ledger row carrying the farmer's own words and the language
// they wrote them in, so the column is real and the warning is gone.
//
// WHAT REPLACED THE WARNING IS NARROWER AND TRUER: when nobody in the window wrote anything, the page says THAT — a fact
// about the window rather than a limitation of the record. Those were the same sentence before and they are not now.
//
// TWO MORE HONESTIES, both still load-bearing:
//   1. A DERIVED TIMESTAMP IS MARKED ON THE ROW. 0099's backfill had no rating time to copy (the column never existed),
//      so those rows carry the ticket's resolution time and say so in the cell — not in a footnote, which does not
//      travel with a screenshot.
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
  // PC-56 ADMIN-2c: a rating is now a LEDGER ROW (migration 0099), so it has its own id — which is what the review
  // drill-in is keyed on. `ticketId` is no longer unique here either: one ticket can carry several ratings now that a
  // reopen stops deleting the previous one.
  responseId?: string;
  ticketId: string; ticketNo: string; tenantSlug: string | null; score: number;
  severity: string; assigneeUserId: string | null; ratedAt: string;
  ratedAtIsEstimated?: boolean;
  comment?: string | null; commentLanguage?: string | null;
  reviewCount?: number; latestVerdict?: string | null;
}
interface CsatView {
  window: { from: string; to: string };
  distribution: CsatBucket[]; ratedCount: number; averageBps: number | null;
  scores: ScoreRow[]; verbatimsAvailable: boolean; verbatimCount?: number; estimatedRatedAtCount?: number;
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
                {/* PC-56 ADMIN-2c: the column ADMIN-2 had to report as impossible */}
                <th scope="col">{t.t('rev.words')}</th>
                <th scope="col">{t.t('rev.open')}</th>
              </tr></thead>
              <tbody>
                {(view?.scores ?? []).map((s) => (
                  <tr key={s.responseId ?? s.ticketId}>
                    <td>
                      {formatDate(s.ratedAt)}
                      {/* marked on the row: a caveat at the foot of a page does not travel with a screenshot */}
                      {s.ratedAtIsEstimated && <> <span className="kv-status kv-status--warn">{t.t('rev.estimated')}</span></>}
                    </td>
                    <td>
                      <span className={`kv-status ${isLowScore(s.score) ? 'kv-status--danger' : 'kv-status--ok'}`}>{s.score}</span>
                    </td>
                    <td><Link href={`/support/tickets/${encodeURIComponent(s.ticketId)}`}>{s.ticketNo}</Link></td>
                    <td>{s.tenantSlug ?? t.t('common.dash')}</td>
                    <td><code>{String(s.assigneeUserId ?? '').slice(0, 8) || t.t('common.dash')}</code></td>
                    <td>
                      {s.comment
                        ? <>{s.comment}{s.commentLanguage ? <> <span className="kv-detail__muted">({s.commentLanguage})</span></> : null}</>
                        // a score with no words is the common case; it is not "no feedback"
                        : <span className="kv-detail__muted">{t.t('rev.noWords')}</span>}
                    </td>
                    <td>
                      {s.responseId
                        ? <Link href={`/support/csat/${encodeURIComponent(s.responseId)}`}>
                            {s.reviewCount && s.reviewCount > 0 ? t.t('rev.reviewedAlready') : t.t('rev.open')}
                          </Link>
                        : t.t('common.dash')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* NOT the old "this platform cannot store comments" warning — migration 0099 closed that. This says whether
              anybody in THIS WINDOW wrote something, which is a fact about the window. */}
          {view && view.verbatimsAvailable && (view.verbatimCount ?? 0) === 0 && (
            <p className="kv-notice" role="note">{t.t('csat.noVerbatims')}</p>
          )}
          {(view?.estimatedRatedAtCount ?? 0) > 0 && (
            <p className="kv-notice" role="note">{t.t('rev.estimatedNote', { n: String(view?.estimatedRatedAtCount ?? 0) })}</p>
          )}
          <p className="kv-field__hint">{t.t('csat.ratedAtNote')}</p>

          <p className="kv-field__hint">
            <Link href="/support/csat/queue">{t.t('rev.queueTitle')}</Link>
            {' · '}<Link href="/support/coaching">{t.t('support.coachingLink')}</Link>
            {' · '}<Link href="/support/exports">{t.t('support.exportsLink')}</Link>
          </p>
        </>
      )}
    </section>
  );
}
