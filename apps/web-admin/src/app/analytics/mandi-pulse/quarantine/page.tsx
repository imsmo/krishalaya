// apps/web-admin/src/app/analytics/mandi-pulse/quarantine/page.tsx · W107's anomaly holds (PC-56 ADMIN-SWEEP).
//
// The worklist that makes "bad data never reaches a selling decision" true. Every row here is a price a farmer was NOT
// told about, waiting for a human — and before this wave every one of them would have been an SMS instead.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { decidePriceAction } from '../actions';
import { rupees } from '../../../../features/market/pulse';
import {
  canDecide, decidedNoticeKey, severityClass, severityKey,
} from '../../../../features/market/quarantine';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mp11.q.title'), robots: { index: false, follow: false } };
}

interface Row {
  id: string; priceDate: string; productId: string; productName: string | null; regionName: string | null;
  mandiName: string | null; source: string; modalMinor: string; referenceModalMinor: string | null;
  deviationBp: number | null; anomalyState: string; ingestedAt: string | null;
}
interface Meta { releaseNote: string; feedbackOwner: string; emptyMeaning: string }

export default async function QuarantinePage({ searchParams }: {
  searchParams: { all?: string; ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const includeDecided = searchParams.all === '1';

  let rows: Row[] = []; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<Row[]>(`market/quarantine${includeDecided ? '?includeDecided=true' : ''}`);
    rows = res.data ?? []; meta = res.meta as unknown as Meta;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'mp11.restricted' : 'mp11.error.queue';
  }

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/analytics/mandi-pulse">{t.t('mp11.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('mp11.q.title')}</span>
      </nav>
      <header className="kv-page__head">
        <h1>{t.t('mp11.q.title')}</h1>
        <p className="kv-page__sub">{t.t('mp11.q.sub')}</p>
      </header>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}
      {searchParams.ok ? <p className="kv-note is-ok" role="status">{t.t(`mp11.ok.${searchParams.ok}`)}</p> : null}
      {searchParams.error ? <p className="kv-note is-danger" role="alert">{t.t(`mp11.err.${searchParams.error}`)}</p> : null}

      {meta ? (
        <>
          {/* WHAT RELEASING DOES AND DOES NOT DO, above the controls rather than under them. */}
          <p className="kv-note is-warn">{t.t(meta.releaseNote)}</p>
          <p className="kv-note"><small>{t.t('mp11.q.feedback', { owner: meta.feedbackOwner })}</small></p>
        </>
      ) : null}

      <nav className="kv-filters" aria-label={t.t('mp11.q.filterGroup')}>
        <Link className={`kv-chip${!includeDecided ? ' is-active' : ''}`} href="/analytics/mandi-pulse/quarantine">
          {t.t('mp11.q.heldOnly')}
        </Link>
        <Link className={`kv-chip${includeDecided ? ' is-active' : ''}`} href="/analytics/mandi-pulse/quarantine?all=1">
          {t.t('mp11.q.withDecided')}
        </Link>
      </nav>

      {rows.length === 0 && !notice ? (
        <div className="kv-empty">
          <h2>{t.t('mp11.q.emptyTitle')}</h2>
          {/* An empty queue means two opposite things and the pulse's manual share tells them apart. */}
          <p>{t.t(meta?.emptyMeaning ?? 'mp11.q.emptyMeaning')}</p>
          <Link className="kv-btn" href="/analytics/mandi-pulse">{t.t('mp11.q.backToPulse')}</Link>
        </div>
      ) : (
        <table className="kv-table">
          <caption className="kv-table__caption">{t.t('mp11.q.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t.t('mp11.col.when')}</th>
              <th scope="col">{t.t('mp11.col.product')}</th>
              <th scope="col">{t.t('mp11.col.reported')}</th>
              <th scope="col">{t.t('mp11.col.reference')}</th>
              <th scope="col">{t.t('mp11.col.deviation')}</th>
              <th scope="col">{t.t('mp11.col.act')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const decided = decidedNoticeKey(r.anomalyState);
              return (
                <tr key={`${r.id}-${r.priceDate}`}>
                  <td>{r.priceDate}<br /><small>{r.source}</small></td>
                  <td>
                    {r.productName ?? r.productId.slice(0, 8)}
                    <br /><small>{r.mandiName ?? r.regionName ?? '—'}</small>
                  </td>
                  <td>{rupees(r.modalMinor)}</td>
                  {/* The reference AS IT WAS at ingestion, not recomputed: recomputing would compare today's market to
                      yesterday's typo. */}
                  <td>{r.referenceModalMinor ? rupees(r.referenceModalMinor) : t.t('mp11.q.noReference')}</td>
                  <td>
                    <span className={severityClass(r.deviationBp)}>
                      {t.t(severityKey(r.deviationBp), { pct: r.deviationBp === null ? '—' : (r.deviationBp / 100).toFixed(0) })}
                    </span>
                  </td>
                  <td>
                    {canDecide(r.anomalyState) ? (
                      <>
                        <form action={decidePriceAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="priceDate" value={r.priceDate} />
                          <input type="hidden" name="decision" value="released" />
                          <input className="kv-input" name="note" required minLength={20} maxLength={300}
                            aria-label={t.t('mp11.q.note')} />
                          <button className="kv-btn" type="submit">{t.t('mp11.q.release')}</button>
                        </form>
                        <form action={decidePriceAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="priceDate" value={r.priceDate} />
                          <input type="hidden" name="decision" value="rejected" />
                          <input className="kv-input" name="note" required minLength={20} maxLength={300}
                            aria-label={t.t('mp11.q.note')} />
                          <button className="kv-btn" type="submit">{t.t('mp11.q.reject')}</button>
                        </form>
                        <p className="kv-field__help">{t.t('mp11.q.noteHelp')}</p>
                      </>
                    ) : (
                      <p className="kv-note">{t.t(decided ?? 'mp11.decided.notHeld')}</p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
