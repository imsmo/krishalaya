// apps/web-tenant/src/app/listings/qc/page.tsx · W126, the QC queue (PC-56 TENANT-2a).
//
// EVERY NUMBER HERE IS MEASURED, AND THE PAGE SAYS OVER WHAT: the waiting clock starts at qc_submitted_at
// (0138 — never backfilled), so a listing parked in review before the clock existed shows "before the clock"
// rather than an invented age; the median is over the last 7 days' CLOCKED decisions and prints its sample
// size; "today" is the UTC calendar day and says so. "Take next" opens the listing that has waited LONGEST —
// no claim row exists by decision (0138's header): a collision costs a duplicate look, never a double write.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { QcQueuePayload } from '@krishalaya/sdk-js';
import { waitingAge, QC_TARGET_HOURS } from '../../../features/listings/console';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('qc.title'), robots: { index: false, follow: false } };
}

export default async function QcQueuePage({ searchParams }: { searchParams: { ok?: string } }) {
  await requireSession('/listings/qc');
  const t = getTranslator();
  const lang = getLang();

  let d: QcQueuePayload | undefined; let failed = false; let denied = false;
  try { d = await tenantClient().listings.qcQueue(); }
  catch (e: any) { if (e?.status === 403) denied = true; else failed = true; }

  const now = new Date();

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('qc.title')}</h1>
        <p className="kv-muted">{t.t('qc.sub', { target: String(QC_TARGET_HOURS) })}</p>
        <p className="kv-fine"><Link href="/listings" className="kv-link">← {t.t('listings.title')}</Link></p>
      </div>

      {searchParams.ok === 'approved' && <p className="kv-success" role="status">{t.t('qc.ok.approved')}</p>}
      {searchParams.ok === 'rejected' && <p className="kv-success" role="status">{t.t('qc.ok.rejected')}</p>}
      {/* W126's restricted state, in the canon's own terms: deciding needs listing.approve. */}
      {denied && <p className="kv-error" role="alert">{t.t('qc.denied')}</p>}
      {failed && <p className="kv-error" role="alert">{t.t('qc.loadError')}</p>}

      {d && (
        <>
          <div className="kv-cards">
            <div className="kv-card">
              <span className="kv-card__title">{t.t('qc.tile.waiting')}</span>
              <strong>{d.kpis.waiting}</strong>
              <span className="kv-fine">{d.kpis.oldestSubmittedAt
                ? t.t('qc.tile.oldest', { h: String((waitingAge(d.kpis.oldestSubmittedAt, now) as { hours: number }).hours), target: String(QC_TARGET_HOURS) })
                : t.t('qc.tile.noOldest')}</span>
              {d.kpis.unclockedWaiting > 0 && <span className="kv-fine">{t.t('qc.tile.unclocked', { n: String(d.kpis.unclockedWaiting) })}</span>}
            </div>
            <div className="kv-card">
              <span className="kv-card__title">{t.t('qc.tile.approvedToday')}</span>
              <strong>{d.kpis.approvedToday}</strong>
              <span className="kv-fine">{t.t('qc.tile.todayBasis')}</span>
            </div>
            <div className="kv-card">
              <span className="kv-card__title">{t.t('qc.tile.rejectedToday')}</span>
              <strong>{d.kpis.rejectedToday}</strong>
              <span className="kv-fine">{t.t('qc.tile.todayBasis')}</span>
            </div>
            <div className="kv-card">
              <span className="kv-card__title">{t.t('qc.tile.median')}</span>
              <strong>{d.kpis.medianDecisionMinutes7d === null ? t.t('qc.tile.unmeasured') : t.t('qc.tile.medianVal', { m: String(d.kpis.medianDecisionMinutes7d) })}</strong>
              <span className="kv-fine">{d.kpis.medianDecisionMinutes7d === null
                ? t.t('qc.tile.medianWhy')
                : t.t('qc.tile.medianOver', { n: String(d.kpis.decided7d) })}</span>
            </div>
          </div>

          {d.queue.length === 0 ? (
            <p className="kv-empty-state">{t.t('qc.empty')}</p>
          ) : (
            <>
              <p className="kv-fine">
                <Link href={`/listings/qc/${encodeURIComponent(d.queue[0].id)}`} className="kv-btn">{t.t('qc.takeNext')}</Link>
                {' '}{t.t('qc.takeNextNote')}
              </p>
              <table className="kv-table">
                <caption className="kv-visually-hidden">{t.t('qc.title')}</caption>
                <thead><tr>
                  <th>{t.t('qc.col.waiting')}</th><th>{t.t('qc.col.listing')}</th><th>{t.t('qc.col.seller')}</th>
                  <th>{t.t('qc.col.qty')}</th><th>{t.t('qc.col.price')}</th><th />
                </tr></thead>
                <tbody>
                  {d.queue.map((r) => {
                    const age = waitingAge(r.qcSubmittedAt, now);
                    return (
                      <tr key={r.id}>
                        <td>{age.kind === 'aged'
                          ? <span className={age.overTarget ? 'kv-error' : undefined}>{t.t('qc.ageH', { h: String(age.hours) })}</span>
                          : <span className="kv-fine">{t.t('qc.beforeClock')}</span>}</td>
                        <td><Link href={`/listings/qc/${encodeURIComponent(r.id)}`} className="kv-link">{r.title}</Link></td>
                        <td>{r.sellerName ?? t.t('common.dash')}</td>
                        <td>{r.quantityTotal} {r.unitCode}</td>
                        <td>{formatMoneyMinor(r.priceMinor, r.currencyCode, lang)} / {r.unitCode}</td>
                        <td><Link href={`/listings/qc/${encodeURIComponent(r.id)}`} className="kv-link">{t.t('lc.review')}</Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {/* W126's own rule, kept on the page it governs. */}
          <p className="kv-fine kv-note">{t.t('qc.bandRule')}</p>
        </>
      )}
    </section>
  );
}
