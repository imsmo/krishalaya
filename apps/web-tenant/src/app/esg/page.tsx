// apps/web-tenant/src/app/esg/page.tsx · W423 · THE ESG DASHBOARD — NO METHOD, NO METRIC · PC-56 TENANT-9d.
//
// The canon's page prints fourteen figures and says each "already lives somewhere else in this platform with evidence
// attached". Three do. So this page prints the canon's own law as the page: every row of 0183's registry with its verdict —
// a FIGURE only where a published method meets a recorded fact (`published_with_fact`), and otherwise a sentence: "method
// published — nothing recorded yet", "no method published" (with what fact it would need), or, for carbon, "no programme
// recorded". Never 0, never a dash that reads as zero. Every method cited links to its own page (the canon's `#method-…` and
// `#source-…` anchors had no targets). Freshness is the source fact's time in the cooperative's zone, a stale figure DATED.
// The audit row says what is true: append-only; the hash chain is the money ledger's. Beside each metric: the cooperative's
// own published words (a disclosure — never a figure).
// Six states: content · Loading (loading.tsx) · Flagged off (the web switch, or the API's 404) · Read-only for your role ·
// Restricted (403 — no esg.read) · Couldn't load. "No data yet" when no row has a figure; "Stale" per row.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import type { EsgDashboard } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { getLang, getTranslator } from '../../lib/i18n';
import { env } from '../../lib/env';
import {
  DASHBOARD_REFUSALS, ESG_HREF, PILLARS, REPORT_HREF, actHref, byNameKey, civilLabel, editDisclosureHref, esgState, factLines, methodHref,
  newDisclosureHref, noValueKey, pick, pillarKey, statusKey, valueShown, verdictKey,
} from '../../features/esg/esg';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('esg.title'), robots: { index: false, follow: false } };
}

export default async function EsgDashboardPage() {
  if (!env.featureEsg) notFound();
  await requireSession(ESG_HREF);
  const t = getTranslator();
  const lang = getLang();
  const fmt = (n: number) => formatNumber(n, lang);
  // An instant from the API is shown in the COOPERATIVE'S zone (F-17), never the server's or the browser's.
  const inZone = (iso: string | null, zone: string) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }) : '');

  let d: EsgDashboard | null = null; let state: string | null = null;
  try { d = await tenantClient().esg.dashboard(); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = esgState(err?.code, err?.status, true); }

  return (
    <section>
      <h1>{t.t('esg.title')}</h1>
      <p>{t.t('esg.lead')}</p>
      <p className="kv-field__hint"><Link href={REPORT_HREF} className="kv-btn--link">{t.t('esg.toReport')}</Link></p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`esg.state.${state}.title`)}</strong><p>{t.t(`esg.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={ESG_HREF} className="kv-btn--link">{t.t('esg.state.reload')}</Link> <span className="kv-field__hint">{t.t(byNameKey('retry'))}</span></p>}
        </div>
      )}

      {d && (
        <>
          <p className="kv-field__hint">{t.t('esg.clock', { today: d.clock.today, zone: d.clock.zone })}</p>
          {d.counts.published_with_fact === 0 && (
            <div className="kv-card kv-card--notice" role="status"><strong>{t.t('esg.state.noData.title')}</strong><p>{t.t('esg.state.noData.body')}</p></div>
          )}
          {!d.canDisclose && (
            <div className="kv-card kv-card--notice" role="note"><strong>{t.t('esg.state.readOnly.title')}</strong><p>{t.t('esg.state.readOnly.body')}</p></div>
          )}
          <p className="kv-field__hint">{t.t('esg.counts', { withFact: fmt(d.counts.published_with_fact), noFact: fmt(d.counts.published_no_fact), noMethod: fmt(d.counts.no_method), noProgramme: fmt(d.counts.no_programme) })}</p>

          {PILLARS.map((p) => (
            <div key={p} className="kv-card">
              <h2>{t.t(pillarKey(p))}</h2>
              <table className="kv-table">
                <caption className="kv-sr-only">{t.t(pillarKey(p))}</caption>
                <thead><tr>
                  <th scope="col">{t.t('esg.col.metric')}</th><th scope="col">{t.t('esg.col.value')}</th><th scope="col">{t.t('esg.col.method')}</th>
                  <th scope="col">{t.t('esg.col.source')}</th><th scope="col">{t.t('esg.col.freshness')}</th>
                </tr></thead>
                <tbody>{d.rows.filter((r) => r.pillar === p).map((r) => (
                  <tr key={r.metricCode}>
                    <th scope="row">
                      {pick(r.name, lang)}
                      <div><span className={r.verdict === 'published_with_fact' ? 'kv-badge' : 'kv-badge kv-badge--muted'}>{t.t(verdictKey(r.verdict))}</span></div>
                    </th>
                    <td>
                      {valueShown(r) && r.fact
                        ? <ul className="kv-list">{factLines(r.fact, fmt).map((l) => <li key={l.key}>{t.t(l.key, l.vars)}</li>)}</ul>
                        : <p><strong>{t.t(noValueKey(r.verdict))}</strong></p>}
                      {r.needs && <p className="kv-field__hint">{pick(r.needs, lang)}</p>}
                      {r.disclosure && (
                        <div className="kv-card kv-card--notice">
                          <p className="kv-field__hint">{t.t('esg.disclosure.published', { when: inZone(r.disclosure.publishedAt, d!.clock.zone), zone: d!.clock.zone })}</p>
                          <p>{r.disclosure.texts[lang] ?? r.disclosure.texts.en ?? Object.values(r.disclosure.texts)[0]}</p>
                          <p className="kv-field__hint">{t.t('esg.disclosure.wordsNotFigures')}</p>
                          {d!.canDisclose && <p><Link href={actHref(r.disclosure.id, 'withdraw')} className="kv-btn--link">{t.t('esg.act.withdraw')}</Link></p>}
                        </div>
                      )}
                      {d!.canDisclose && r.drafts.map((x) => (
                        <p key={x.id} className="kv-field__hint">
                          {t.t(statusKey(x.status))} · <Link href={editDisclosureHref(x.id)} className="kv-btn--link">{t.t('esg.disclosure.edit')}</Link>{' · '}
                          <Link href={actHref(x.id, 'publish')} className="kv-btn--link">{t.t('esg.act.publish')}</Link>{' · '}
                          <Link href={actHref(x.id, 'withdraw')} className="kv-btn--link">{t.t('esg.act.discard')}</Link>
                        </p>
                      ))}
                      {d!.canDisclose && <p><Link href={newDisclosureHref(r.metricCode)} className="kv-btn--link">{t.t('esg.disclosure.write')}</Link></p>}
                    </td>
                    <td>
                      {r.method.status === 'published' && r.method.ref
                        ? <Link href={methodHref(r.metricCode)}>{t.t('esg.method.cite', { ref: r.method.ref, version: String(r.method.version ?? '') })}</Link>
                        : <Link href={methodHref(r.metricCode)} className="kv-field__hint">{t.t('esg.method.none')}</Link>}
                    </td>
                    <td>{r.method.sourceTables.length ? <code>{r.method.sourceTables.join(' · ')}</code> : <span className="kv-field__hint">{t.t('esg.source.none')}</span>}</td>
                    <td>
                      {r.freshness
                        ? <>{t.t(r.freshness.rule === 'catalogue_now' ? 'esg.freshness.now' : 'esg.freshness.asOf', { when: civilLabel(r.freshness.asOf) ?? '', zone: r.freshness.zone })}
                            {r.freshness.stale && r.freshness.staleAfterDays !== null && <div><span className="kv-badge kv-badge--muted">{t.t('esg.freshness.stale', { days: fmt(r.freshness.staleAfterDays) })}</span></div>}</>
                        : <span className="kv-field__hint">{t.t('esg.freshness.none')}</span>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ))}

          <div className="kv-card" role="note">
            <p>{t.t('esg.footer.carbon')}</p>
            <p><em>{t.t('esg.footer.quote')}</em></p>
            <h2>{t.t('esg.byName.heading')}</h2>
            <ul className="kv-list">{DASHBOARD_REFUSALS.map((r) => <li key={r}>{t.t(byNameKey(r))}</li>)}</ul>
          </div>
        </>
      )}
    </section>
  );
}
