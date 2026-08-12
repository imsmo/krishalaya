// apps/web-tenant/src/app/disputes/page.tsx · W140, the disputes desk (PC-56 TENANT-3b).
// Server-first, requireSession-gated. Four KPI cards, four tabs, and a table whose "Disputed value" column now has a
// column behind it (0139) — every read degrades independently (Law 12), all copy via i18n, noindex.
//
// TWO THINGS THIS PAGE DELIBERATELY DOES NOT DO:
//   • It does not print a page-number pager. W140 draws "1 2" over "34 disputes (90d)"; a page number needs a
//     COUNT(*) over the filtered set on every click, and the tab counts already answer "how many" (the roster rule).
//   • It does not show a median of 0 when nothing has closed. `medianText` returns `noBasis` and the card says so —
//     a tenant reading "0 days" would conclude their desk is instant when it is empty.
//
// THE SELLER'S REVIEW-RESPONSE BLOCK STAYS, BELOW THE QUEUE, AND THAT IS A DELIBERATE CHOICE RATHER THAN AN
// OVERSIGHT. W140 is a dispute worklist and has no reputation widget, so the honest instinct was to remove it — but
// this page is the ONLY place in the console where a seller can answer a review about them (nothing else in
// apps/web-tenant calls reviews.respond), and deleting a shipped capability to match a screen's layout would take a
// surface away from the people using it. It moves when the reviews wave gives it a home; until then it sits under the
// desk, clearly separated, and the queue is the top of the page.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { tenantHasPerm } from '../../lib/auth';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { DISPUTE_TABS, DisputeTab, isDisputeTab, disputeTabHref, slaCell, disputedValue, medianText } from '../../features/disputes/console';
import type { DisputeKpis, DisputeQueueRow, ReviewSummary, ReviewItem, UserProfile } from '@krishalaya/sdk-js';
import { respondToReviewAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dsp.title'), robots: { index: false, follow: false } };
}

export default async function DisputesPage({ searchParams }: { searchParams: { view?: string; cursor?: string; ok?: string; error?: string } }) {
  await requireSession('/disputes');
  const t = getTranslator();
  const lang = getLang();
  const now = new Date();
  const tab: DisputeTab = isDisputeTab(searchParams.view) ? searchParams.view : 'all';
  const canResolve = tenantHasPerm('dispute.resolve');
  const canRefundPerm = tenantHasPerm('order.refund');

  let kpis: DisputeKpis | null = null;
  let counts: Record<string, number> | null = null;
  let rows: DisputeQueueRow[] = [];
  let nextCursor: string | null = null;
  let listFailed = false;

  const [kRes, lRes] = await Promise.allSettled([
    tenantClient().disputes.consoleKpis(),
    tenantClient().disputes.consoleList({ view: tab === 'all' ? undefined : tab, cursor: searchParams.cursor, limit: 50 }),
  ]);
  if (kRes.status === 'fulfilled') { kpis = kRes.value.kpis; counts = kRes.value.counts as Record<string, number>; }
  if (lRes.status === 'fulfilled') { rows = lRes.value.items; nextCursor = lRes.value.nextCursor; } else { listFailed = true; }

  // The review block below the desk (see the header note). Best-effort and independent: a reviews outage must not
  // take the dispute queue down with it (Law 12).
  let summary: ReviewSummary | null = null;
  let myReviews: ReviewItem[] = [];
  let me: UserProfile | null = null;
  try { me = await tenantClient().auth.me(); } catch { me = null; }
  if (me) {
    const [sumRes, revRes] = await Promise.allSettled([
      tenantClient().reviews.summary({ targetUserId: me.id }),
      tenantClient().reviews.list({ box: 'target', targetType: 'seller', targetId: me.id, limit: 20 }),
    ]);
    if (sumRes.status === 'fulfilled') summary = sumRes.value;
    if (revRes.status === 'fulfilled') myReviews = revRes.value.items;
  }
  const okQ = searchParams.ok; const errQ = searchParams.error;
  const reviewNotice =
    okQ === 'review' ? { kind: 'ok', msg: t.t('disputes.reviewResponded') } :
    errQ === 'review_illegal' ? { kind: 'err', msg: t.t('disputes.reviewIllegal') } :
    errQ === 'review_empty' ? { kind: 'err', msg: t.t('disputes.reviewEmpty') } :
    errQ === 'review_too_long' ? { kind: 'err', msg: t.t('disputes.reviewTooLong') } :
    errQ === 'review' ? { kind: 'err', msg: t.t('disputes.reviewError') } : null;

  const median = medianText(kpis?.medianResolutionHours ?? null);
  const money = (minor: string | null, ccy: string | null) => (minor ? formatMoneyMinor(minor, ccy ?? 'INR', lang) : t.t('common.dash'));

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('dsp.title')}</h1>
        <Link href="/returns" className="kv-btn--link">{t.t('dsp.returnsLink')}</Link>
      </div>
      <p className="kv-field__hint">{t.t('dsp.machine')}</p>

      {/* 0139 DEFECT 2, said on the screen rather than hidden: the freeze is per ORDER, not per disputed line. */}
      <p className="kv-notice" role="note">{t.t('dsp.freezeTruth')}</p>
      {!canResolve && <p className="kv-notice" role="note">{t.t('dsp.needsResolve')}</p>}
      {canResolve && !canRefundPerm && <p className="kv-notice" role="note">{t.t('dsp.needsRefundPerm')}</p>}

      <div className="kv-kpis">
        <div className="kv-kpi">
          <span className="kv-kpi__label">{t.t('dsp.kpiActive')}</span>
          <span className="kv-kpi__value">{kpis ? kpis.activeCount : t.t('common.dash')}</span>
          {kpis && <span className="kv-kpi__delta">{t.t('dsp.kpiActive24h', { n: String(kpis.activeUnder24h) })}</span>}
        </div>
        <div className="kv-kpi">
          <span className="kv-kpi__label">{t.t('dsp.kpiMedian', { days: String(kpis?.windowDays ?? 90) })}</span>
          <span className="kv-kpi__value">
            {median.kind === 'value' ? t.t('dsp.hours', { n: String(median.hours) }) : t.t('common.dash')}
          </span>
          <span className="kv-kpi__delta">
            {median.kind === 'noBasis' ? t.t('dsp.kpiMedianNoBasis') : t.t('dsp.kpiMedianBasis', { n: String(kpis?.resolvedInWindow ?? 0) })}
          </span>
        </div>
        <div className="kv-kpi">
          <span className="kv-kpi__label">{t.t('dsp.kpiOutcomes')}</span>
          <span className="kv-kpi__value">
            {kpis ? `${kpis.outcomes.raiser} / ${kpis.outcomes.respondent}` : t.t('common.dash')}
          </span>
          {/* W140's own words: "nobody 'wins', orders get fixed" — replacements are counted apart, never folded in. */}
          {kpis && <span className="kv-kpi__delta">{t.t('dsp.kpiAmicable', { n: String(kpis.outcomes.amicable), withdrawn: String(kpis.outcomes.noDecision) })}</span>}
          {kpis && kpis.outcomeUnknownParty > 0 && (
            <span className="kv-kpi__delta">{t.t('dsp.kpiUnknownParty', { n: String(kpis.outcomeUnknownParty) })}</span>
          )}
        </div>
        <div className="kv-kpi">
          <span className="kv-kpi__label">{t.t('dsp.kpiEscalated')}</span>
          <span className="kv-kpi__value">{kpis ? kpis.escalatedCount : t.t('common.dash')}</span>
          <span className="kv-kpi__delta">{t.t('dsp.kpiEscalatedNote')}</span>
        </div>
      </div>

      <nav className="kv-tabs" aria-label={t.t('dsp.tabs')}>
        {DISPUTE_TABS.map((v) => (
          <a key={v} href={disputeTabHref(v)} className={`kv-tab${v === tab ? ' kv-tab--active' : ''}`} aria-current={v === tab ? 'page' : undefined}>
            {t.t(`dsp.tab.${v}`)}
            {counts && counts[v] !== undefined && <span className="kv-tab__count"> {counts[v]}</span>}
          </a>
        ))}
      </nav>
      {counts && counts.unmapped > 0 && <p className="kv-error" role="alert">{t.t('dsp.unmapped', { n: String(counts.unmapped) })}</p>}

      {listFailed ? <p className="kv-error" role="alert">{t.t('dsp.loadError')}</p> : (
        <DataTable
          rows={rows}
          empty={t.t('dsp.empty')}
          columns={[
            {
              header: t.t('dsp.colSla'),
              cell: (d) => {
                const c = slaCell(d.status, d.slaDueAt, now);
                if (!c) return <span className="kv-muted">{t.t('common.dash')}</span>;
                if (c.kind === 'platform') return <span className="kv-muted">{t.t('dsp.slaPlatform')}</span>;
                return c.kind === 'overdue'
                  ? <strong className="kv-error-text">{t.t('dsp.slaOverdue', { n: String(c.hours) })}</strong>
                  : <span>{t.t('dsp.slaLeft', { n: String(c.hours) })}</span>;
              },
            },
            { header: t.t('dsp.colCase'), cell: (d) => <Link href={`/disputes/${d.id}`} className="kv-link">{d.id.slice(0, 8)}</Link> },
            { header: t.t('dsp.colSubject'), cell: (d) => <Link href={`/orders/${d.orderId}`} className="kv-link">{d.orderNo ?? d.orderId.slice(0, 8)}</Link> },
            {
              header: t.t('dsp.colReason'),
              cell: (d) => (
                <>
                  <span className="kv-mono">{d.reasonCode ? t.t(`rma.reason.${d.reasonCode}`) || d.reasonCode : t.t('dsp.reasonUnknown')}</span>
                  {/* AI triage is ADVISORY and labelled so — W141: "Advisory only — a human decides". */}
                  {d.aiTriageConfidence && (
                    <span className="kv-detail__muted"> {t.t('dsp.triage', { klass: d.aiTriageClassification ?? t.t('common.dash'), conf: d.aiTriageConfidence })}</span>
                  )}
                </>
              ),
            },
            {
              header: t.t('dsp.colDisputed'),
              cell: (d) => {
                const v = disputedValue(d);
                return v.kind === 'amount'
                  ? <span>{money(v.minor, d.currencyCode)}</span>
                  : <span className="kv-muted">{t.t('dsp.scopeNotRecorded')}</span>;
              },
            },
            {
              header: t.t('dsp.colStatus'),
              cell: (d) => (
                <>
                  <span className="kv-badge">{t.t(`dsp.status.${d.status}`) || d.status}</span>
                  {d.pendingApprovalId && <span className="kv-badge">{t.t('dsp.awaitingChecker')}</span>}
                </>
              ),
            },
            { header: t.t('dsp.colRaised'), cell: (d) => (d.createdAt ? formatDate(d.createdAt, lang) : t.t('common.dash')) },
          ]}
        />
      )}

      {/* Keyset, forward only: the cursor is a position in THIS ordered set, so it never rides a tab link. */}
      {nextCursor && (
        <p className="kv-pager">
          <a href={`/disputes?${tab === 'all' ? '' : `view=${tab}&`}cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">
            {t.t('common.nextPage')}
          </a>
        </p>
      )}
      <p className="kv-field__hint kv-note">{t.t('dsp.pagerNote')}</p>

      <h2 className="kv-section-title">{t.t('disputes.reviewsTitle')}</h2>
      <div className="kv-card">
        <h3 className="kv-card__title">{t.t('disputes.rating')}</h3>
        {summary ? (
          <p>{t.t('disputes.ratingValue', { stars: summary.averageStars.toString(), count: summary.count.toString() })}</p>
        ) : (
          <p className="kv-muted">{t.t('disputes.ratingNone')}</p>
        )}
      </div>
      {reviewNotice && <p className={reviewNotice.kind === 'ok' ? 'kv-notice' : 'kv-error'} role="status">{reviewNotice.msg}</p>}
      {myReviews.length === 0 ? (
        <p className="kv-muted">{t.t('disputes.reviewsNone')}</p>
      ) : (
        <ul className="kv-reviews" role="list">
          {myReviews.map((rv) => (
            <li key={rv.id} className="kv-review">
              <p className="kv-review__head">
                <span aria-label={t.t('disputes.reviewStarsLabel', { stars: rv.stars.toString() })}>{'★'.repeat(rv.stars)}{'☆'.repeat(Math.max(0, 5 - rv.stars))}</span>
                {rv.isVerifiedPurchase && <span className="kv-badge">{t.t('disputes.reviewVerified')}</span>}
                <span className="kv-muted">{rv.createdAt ? formatDate(rv.createdAt, lang) : t.t('common.dash')}</span>
              </p>
              {rv.body && <p className="kv-review__body">{rv.body}</p>}
              {rv.sellerResponse ? (
                <div className="kv-review__response">
                  <p className="kv-review__response-label">{t.t('disputes.reviewYourResponse')}</p>
                  <p>{rv.sellerResponse}</p>
                </div>
              ) : (
                <form action={respondToReviewAction} className="kv-review__form">
                  <input type="hidden" name="reviewId" value={rv.id} />
                  <label className="kv-label" htmlFor={`resp-${rv.id}`}>{t.t('disputes.reviewRespondLabel')}</label>
                  <textarea id={`resp-${rv.id}`} name="response" className="kv-input" rows={2} maxLength={4000} required />
                  <button type="submit" className="kv-btn">{t.t('disputes.reviewRespondCta')}</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
