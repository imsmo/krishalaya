// apps/web-tenant/src/app/disputes/page.tsx · the tenant's disputes moderation view + the seller's review rating.
// Server-first, requireSession-gated. Loads the dispute queue (disputes.list box=all, keyset) and the rating
// summary (auth.me() → reviews.summary({ targetUserId })) in parallel, each degrading independently (Law 12).
// All copy via i18n; noindex. The API enforces dispute.resolve + tenant scope server-side.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import type { Dispute, ReviewSummary, ReviewItem, UserProfile } from '@krishalaya/sdk-js';
import { respondToReviewAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('disputes.title'), robots: { index: false, follow: false } };
}

export default async function DisputesPage({ searchParams }: { searchParams: { cursor?: string; status?: string; ok?: string; error?: string } }) {
  await requireSession('/disputes');
  const t = getTranslator();
  const lang = getLang();

  let disputes: Dispute[] = []; let nextCursor: string | null = null; let failed = false;
  let summary: ReviewSummary | null = null;
  // Rating needs the seller's own id; resolve it then read the summary (best-effort).
  let me: UserProfile | null = null;
  const [dRes, meRes] = await Promise.allSettled([
    tenantClient().disputes.list({ box: 'all', status: searchParams.status, cursor: searchParams.cursor, limit: 50 }),
    tenantClient().auth.me(),
  ]);
  if (dRes.status === 'fulfilled') { disputes = dRes.value.items; nextCursor = dRes.value.nextCursor; } else { failed = true; }
  if (meRes.status === 'fulfilled') me = meRes.value;
  // The seller's own reviews + the rating aggregate both need the seller's id; read them once it's known (best-effort).
  let myReviews: ReviewItem[] = [];
  if (me) {
    const [sumRes, revRes] = await Promise.allSettled([
      tenantClient().reviews.summary({ targetUserId: me.id }),
      tenantClient().reviews.list({ box: 'target', targetType: 'seller', targetId: me.id, limit: 20 }),
    ]);
    if (sumRes.status === 'fulfilled') summary = sumRes.value;
    if (revRes.status === 'fulfilled') myReviews = revRes.value.items;
  }

  const ok = searchParams.ok; const err = searchParams.error;
  const notice =
    ok === 'review' ? { kind: 'ok', msg: t.t('disputes.reviewResponded') } :
    err === 'review_illegal' ? { kind: 'err', msg: t.t('disputes.reviewIllegal') } :
    err === 'review_empty' ? { kind: 'err', msg: t.t('disputes.reviewEmpty') } :
    err === 'review_too_long' ? { kind: 'err', msg: t.t('disputes.reviewTooLong') } :
    err === 'review' ? { kind: 'err', msg: t.t('disputes.reviewError') } : null;

  return (
    <section>
      <h1>{t.t('disputes.title')}</h1>

      {notice && <p className={notice.kind === 'ok' ? 'kv-notice' : 'kv-error'} role="status">{notice.msg}</p>}

      <div className="kv-card">
        <h2 className="kv-card__title">{t.t('disputes.rating')}</h2>
        {summary ? (
          <p>{t.t('disputes.ratingValue', { stars: summary.averageStars.toString(), count: summary.count.toString() })}</p>
        ) : (
          <p className="kv-muted">{t.t('disputes.ratingNone')}</p>
        )}
      </div>

      <h2 className="kv-section-title">{t.t('disputes.reviewsTitle')}</h2>
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

      <h2 className="kv-section-title">{t.t('disputes.queue')}</h2>
      {failed ? <p className="kv-error" role="alert">{t.t('disputes.loadError')}</p> : (
        <DataTable
          rows={disputes}
          empty={t.t('disputes.empty')}
          columns={[
            { header: t.t('disputes.colId'), cell: (d) => <Link href={`/disputes/${d.id}`} className="kv-link">{d.id.slice(0, 8)}</Link> },
            { header: t.t('disputes.colOrder'), cell: (d) => <Link href={`/orders/${d.orderId}`} className="kv-link">{d.orderId.slice(0, 8)}</Link> },
            { header: t.t('disputes.colStatus'), cell: (d) => <span className="kv-badge">{d.status}</span> },
            { header: t.t('disputes.colSla'), cell: (d) => (d.slaDueAt ? formatDate(d.slaDueAt, lang) : t.t('common.dash')) },
            { header: t.t('disputes.colCreated'), cell: (d) => (d.createdAt ? formatDate(d.createdAt, lang) : t.t('common.dash')) },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={`/disputes?cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}
    </section>
  );
}
