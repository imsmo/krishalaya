// apps/web-admin/src/app/analytics/mandi-pulse/page.tsx · W107 (PC-56 ADMIN-SWEEP).
//
// **THE SENTENCE ON THIS SCREEN THAT WAS TRUE OF NO CODE:** "3 price-anomaly holds today: ambassador_manual entries
// > 20% off modal are quarantined for review before feeding farmer alerts — bad data never reaches a selling decision."
//
// `MandiPriceService.ingest` inserted the observation and fired every matching farmer price alert in the SAME
// transaction, with no anomaly check on the path. An ambassador who typed ₹64,200 instead of ₹6,420 sent "groundnut is
// above your threshold" to every subscribed farmer in that region, in Gujarati — and W109's own timeline shows what
// happens next: "Price alert hit · alerted in Gujarati, listed same day."
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { guardClass, lagCellKey, moveClass, moveKey, pctFromBp, rupees, type Pulse } from '../../../features/market/pulse';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mp11.title'), robots: { index: false, follow: false } };
}

interface Meta { guardState: string; ingestLagOwner: string; stalenessBasis: string }

export default async function MandiPulsePage() {
  requireAdmin();
  const t = getTranslator();

  let p: Pulse | undefined; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<Pulse>('market/pulse');
    p = res.data as unknown as Pulse; meta = res.meta as unknown as Meta;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'mp11.restricted' : 'mp11.error.pulse';
  }

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/dashboard">{t.t('nav.dashboard')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('mp11.title')}</span>
      </nav>
      <header className="kv-page__head">
        <h1>{t.t('mp11.title')}</h1>
        <p className="kv-page__sub">{t.t('mp11.sub')}</p>
      </header>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}

      {p && meta ? (
        <>
          <section className="kv-stats" aria-label={t.t('mp11.census')}>
            <div className="kv-stat"><dt>{t.t('mp11.stat.points')}</dt><dd>{p.pointsToday.toLocaleString('en-IN')}</dd></div>
            <div className="kv-stat"><dt>{t.t('mp11.stat.mandis')}</dt><dd>{p.activeMandis.toLocaleString('en-IN')}</dd></div>
            {/* THE TILE THE CANON DOES NOT PRINT AND THE PLANE EXISTS FOR. */}
            <div className="kv-stat"><dt>{t.t('mp11.stat.held')}</dt><dd>{p.heldToday}</dd></div>
            <div className="kv-stat"><dt>{t.t('mp11.stat.stale')}</dt><dd>{p.staleMandis}</dd></div>
          </section>

          {/* THE GUARD, IN WORDS. Its three states are the wave's finding. */}
          <p className={guardClass(meta.guardState)}>
            {t.t(meta.guardState, { held: String(p.heldToday), manual: String(p.manualSharePct) })}
          </p>
          <p className="kv-note">
            <Link href="/analytics/mandi-pulse/quarantine">{t.t('mp11.openQueue', { n: String(p.heldOpen) })}</Link>
          </p>

          {/* THE FIGURE WITH NO SOURCE UNTIL THIS RELEASE — absent with its reason, never a flattering zero. */}
          <p className="kv-note">
            {t.t(lagCellKey(p.ingestLagP95Minutes, p.ingestLagSampleSize), {
              n: String(p.ingestLagP95Minutes ?? 0), samples: String(p.ingestLagSampleSize),
              stamped: String(p.stampedToday), owner: meta.ingestLagOwner,
            })}
          </p>
          <p className="kv-note"><small>{t.t(meta.stalenessBasis)}</small></p>

          <section className="kv-panel" aria-labelledby="mp11-mix">
            <h2 id="mp11-mix" className="kv-panel__title">{t.t('mp11.mix')}</h2>
            <ul className="kv-list">
              {p.sourceMix.map((s) => (
                <li key={s.source}>
                  {s.source} — {s.pct}% ({s.n.toLocaleString('en-IN')})
                  {/* Manual entry is where a typo comes from, so its share is called out rather than left in a list. */}
                  {s.source === 'ambassador_manual' ? <> · <strong>{t.t('mp11.mix.manualNote')}</strong></> : null}
                </li>
              ))}
            </ul>
            {p.sourceMix.length === 0 ? <p className="kv-note">{t.t('mp11.mix.empty')}</p> : null}
          </section>

          <section className="kv-panel" aria-labelledby="mp11-movers">
            <h2 id="mp11-movers" className="kv-panel__title">{t.t('mp11.movers')}</h2>
            {p.movers.length === 0 ? (
              <p className="kv-note">{t.t('mp11.movers.empty')}</p>
            ) : (
              <table className="kv-table">
                <caption className="kv-table__caption">{t.t('mp11.movers.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t.t('mp11.col.product')}</th>
                    <th scope="col">{t.t('mp11.col.region')}</th>
                    <th scope="col">{t.t('mp11.col.modal')}</th>
                    <th scope="col">{t.t('mp11.col.move')}</th>
                    <th scope="col">{t.t('mp11.col.arrivals')}</th>
                  </tr>
                </thead>
                <tbody>
                  {p.movers.map((m, i) => (
                    <tr key={`${m.productId}-${i}`}>
                      <td>{m.productName ?? m.productId.slice(0, 8)}</td>
                      <td>{m.regionName ?? '—'}</td>
                      {/* Rendered from bigint paise. No client-side money math beyond a divide-by-100 for display. */}
                      <td>{rupees(m.modalMinor)}</td>
                      <td>
                        <span className={moveClass(m.changeBp)}>
                          {t.t(moveKey(m.changeBp), { pct: m.changeBp === null ? '—' : pctFromBp(m.changeBp) })}
                        </span>
                      </td>
                      <td>{m.arrivalsQty ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {/* Movers read ACCEPTED observations only: a held price must not appear in a chart either, or an operator
                would act on a number the platform has refused to send a farmer. */}
            <p className="kv-note"><small>{t.t('mp11.movers.acceptedOnly')}</small></p>
          </section>
        </>
      ) : null}
    </main>
  );
}
