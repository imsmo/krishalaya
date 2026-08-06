// apps/web-admin/src/app/support/csat/queue/page.tsx · RATINGS AWAITING REVIEW (PC-56 ADMIN-2c, canon W2121-25).
//
// THE QUEUE IS DELIBERATELY NOT "ALL LOW SCORES". It is low scores nobody has judged yet. Those are different lists and
// the difference matters twice over:
//   • A queue that re-shows work a colleague finished ten minutes ago is a queue people stop trusting, and then stop
//     using, and then the reviews stop happening.
//   • The COUNT at the top means something different. "41 low scores this month" conflates a bad month with a month
//     nobody looked at; "6 unjudged" is a statement about our own process, which is the thing a lead can act on.
//
// Keyset-paged on (ratedAt, id) rather than offset: with ratings arriving while somebody works through the list, an
// OFFSET page silently repeats and skips rows — and a skipped row here is a farmer's complaint nobody read.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { csatSample, estimatedCount, withVerbatim, type CsatRow } from '../../../../features/support/review';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rev.queueTitle'), robots: { index: false, follow: false } };
}

interface QueueView { items: CsatRow[]; maxScore: number; nextCursor: string | null }

const SCORE_CLASS = (n: number) => (n <= 2 ? 'kv-status--danger' : n === 3 ? 'kv-status--warn' : 'kv-status--ok');

export default async function CsatQueuePage(
  { searchParams }: { searchParams: { cursor?: string; maxScore?: string } },
) {
  requireAdmin();
  const t = getTranslator();

  // DROPPED rather than clamped when out of range: a score ceiling is a question about the data, and a stale link should
  // show the default scope rather than a silently different one.
  const maxScore = /^[1-5]$/.test(searchParams.maxScore ?? '') ? searchParams.maxScore : undefined;

  let view: QueueView | null = null; let notice: string | undefined;
  try { view = (await adminGet<QueueView>('support/csat/queue', { cursor: searchParams.cursor, maxScore })).data ?? null; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const rows = view?.items ?? [];
  const sample = csatSample(rows);
  const estimated = estimatedCount(rows);
  const commented = withVerbatim(rows).length;

  /** ONE href builder for the chips AND the pager, so a filter cannot survive a page turn on one path and not the other. */
  const href = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { maxScore, cursor: searchParams.cursor, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) sp.append(k, v);
    const s = sp.toString();
    return `/support/csat/queue${s ? `?${s}` : ''}`;
  };

  return (
    <section>
      <p className="kv-backlink"><Link href="/support/insights/csat">{t.t('support.back')}</Link></p>
      <h1>{t.t('rev.queueTitle')}</h1>
      <p className="kv-muted">{t.t('rev.queueLead')}</p>

      <nav className="kv-filters" aria-label={t.t('rev.maxScore')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Link key={n} href={href({ maxScore: String(n), cursor: undefined })}
            className={`kv-chip${String(view?.maxScore ?? 3) === String(n) ? ' is-active' : ''}`}
            aria-current={String(view?.maxScore ?? 3) === String(n) ? 'true' : undefined}>
            ≤ {n}
          </Link>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : rows.length === 0 ? (
        // a positive statement, not a blank: every low score in scope has been dealt with one way or the other
        <p className="kv-empty">{t.t('rev.queueEmpty')}</p>
      ) : (
        <>
          {/* The honest summary. No average below the sample floor — a number on a screen gets quoted, footnotes do not. */}
          <p className="kv-card__title">
            {sample.tooFew
              ? t.t('rev.sampleTooFew', { n: String(sample.n) })
              : t.t('rev.sampleAvg', { avg: String(sample.avg), n: String(sample.n) })}
            {' '}{t.t('rev.withComments', { n: String(commented) })}
          </p>
          {estimated > 0 && <p className="kv-notice" role="note">{t.t('rev.estimatedNote', { n: String(estimated) })}</p>}

          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('rev.score')}</th>
              <th scope="col">{t.t('rev.when')}</th>
              <th scope="col">{t.t('rev.ticket')}</th>
              <th scope="col">{t.t('rev.tenant')}</th>
              <th scope="col">{t.t('rev.words')}</th>
              <th scope="col">{t.t('rev.agent')}</th>
              <th scope="col">{t.t('rev.open')}</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const id = r.id ?? r.responseId ?? '';
                return (
                  <tr key={id || r.ratedAt}>
                    <td><span className={`kv-status ${SCORE_CLASS(r.score)}`}>{r.score}/5</span></td>
                    <td>
                      {r.ratedAt}
                      {r.ratedAtIsEstimated && <> <span className="kv-status kv-status--warn">{t.t('rev.estimated')}</span></>}
                    </td>
                    <td><Link href={`/support/tickets/${encodeURIComponent(r.ticketId)}`}>{r.ticketNo ?? r.ticketId.slice(0, 8)}</Link></td>
                    <td>{r.tenantSlug ?? r.tenantId ?? t.t('common.dash')}</td>
                    <td>
                      {r.comment
                        ? <>{r.comment}{r.commentLanguage ? <> <span className="kv-detail__muted">({r.commentLanguage})</span></> : null}</>
                        : <span className="kv-detail__muted">{t.t('rev.noWords')}</span>}
                    </td>
                    <td><code>{String(r.agentUserId ?? r.assigneeUserId ?? '').slice(0, 8) || t.t('common.dash')}</code></td>
                    <td>{id ? <Link href={`/support/csat/${encodeURIComponent(id)}`}>{t.t('rev.open')}</Link> : t.t('common.dash')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {view?.nextCursor && (
            <p className="kv-pager">
              <Link className="kv-btn" href={href({ cursor: view.nextCursor })}>{t.t('common.nextPage')}</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
