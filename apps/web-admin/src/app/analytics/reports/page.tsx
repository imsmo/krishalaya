// apps/web-admin/src/app/analytics/reports/page.tsx · W111 (PC-56 ADMIN-10).
//
// **THE BUILDER RUNS A WHITELIST, AND THE SCREEN SAYS SO RATHER THAN OFFERING A DATASET DROPDOWN THAT LIES.** W111
// offers five datasets, four measures and free date inputs. Three of those datasets have no metric behind them and two
// of the measures are derived rather than stored — all six absences are listed with a reason, because a dropdown quietly
// three options short is a bug report and one that says why is documentation.
//
// TWO OF THE SCREEN'S OWN CLAIMS ARE NOW TRUE AND ONE IS NOT:
//   • "Max range 92 days · results capped at 50,000 rows" — enforced from this wave, and TIGHTER than the plane's
//     existing 366-day guard, because an ad-hoc scan and a dashboard chart are different risks against one table.
//   • "the 60s replica limit protects everyone" — the LIMIT is real: a statement timeout is set on the connection that
//     runs the query, inside the transaction, so it cannot be forgotten by a future route.
//   • "queries run on the analytics replica, never the primary" — **FALSE.** admin-api holds one pool on the primary and
//     there is no replica anywhere in the realm. Stated on the page (ADMIN-10-Q4), because this is the sentence an
//     operator relies on when deciding whether to run a 92-day report at 6 p.m. on a Friday.
//
// DELTA-028 IS CLOSED, AND HALF OF IT ALREADY WAS: the banner asked for "saved report definitions + schedules table" and
// `scheduled_reports` has existed since ADMIN-1e with a worker that claims it. This wave adds the definitions and points
// the schedules at them.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { archiveSavedAction, runReportAction, saveReportAction } from '../actions';
import { bucketKey, metricKey, replicaClass, replicaKey } from '../../../features/reports/dashboard';

import {
  Button, Callout, EmptyState, StatusPill,
} from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rp.builder.title'), robots: { index: false, follow: false } };
}

interface Vocabulary {
  metrics: string[];
  buckets: string[];
  measures: { measure: string; metric: string | null; note?: string }[];
  datasetsUnavailable: { dataset: string; reason: string }[];
  caps: { maxRangeDays: number; maxRows: number; statementTimeoutMs: number; fromDatabase: boolean };
  readsFromReplica: boolean;
  replicaGapOwner: string;
  delta028: { savedDefinitions: string; schedules: string; note: string };
}
interface Saved {
  id: string; slug: string; title: string; metric: string; bucket: string; windowDays: number;
  isShared: boolean; createdByAdminId: string; createdAt: string; archivedAt: string | null;
  schedules: { id: string; cadence: string; isActive: boolean; nextRunAt: string | null }[];
  schedulable: boolean;
}

export default async function ReportBuilderPage({ searchParams }: {
  searchParams: { ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();

  let v: Vocabulary | null = null; let saved: Saved[] = []; let notice: string | undefined;
  try {
    v = (await adminGet<Vocabulary>('reports/builder/vocabulary')).data ?? null;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'rp.restricted.builder' : 'rp.error.builder';
  }
  try { saved = (await adminGet<Saved[]>('reports/builder/saved')).data ?? []; } catch { saved = []; }

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/dashboard">{t.t('nav.dashboard')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('rp.builder.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('rp.builder.title')}</h1>
        <p className="kv-page__sub">{t.t('rp.builder.sub')}</p>
      </header>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}
      {searchParams.ok ? <Callout tone="success" live="polite">{t.t(`rp.ok.${searchParams.ok}`)}</Callout> : null}
      {searchParams.error ? <Callout tone="danger" live="assertive">{t.t(`rp.err.${searchParams.error}`)}</Callout> : null}

      {v ? (
        <>
          {/* THE CAPS, AND WHICH SERVER ANSWERS. */}
          <Callout>{t.t('rp.builder.caps', {
            days: String(v.caps.maxRangeDays),
            rows: v.caps.maxRows.toLocaleString('en-IN'),
            seconds: String(Math.round(v.caps.statementTimeoutMs / 1000)),
          })}</Callout>
          <p className={replicaClass(v.readsFromReplica)}>
            {t.t(replicaKey(v.readsFromReplica), { owner: v.replicaGapOwner })}
          </p>
          {/* The PII rule W111 states, kept because it is true: a whitelisted metric series is counts and money totals
              per bucket, and no person appears in one. */}
          <Callout>{t.t('rp.builder.pii')}</Callout>

          {/* WHAT THE CANON OFFERS THAT THIS PLANE CANNOT SERVE. */}
          {v.datasetsUnavailable.length > 0 ? (
            <section className="kv-panel" aria-labelledby="rp-gaps">
              <h2 id="rp-gaps" className="kv-panel__title">{t.t('rp.builder.unavailable')}</h2>
              <ul className="kv-list">
                {v.datasetsUnavailable.map((x) => (
                  <li key={x.dataset}><strong>{x.dataset}</strong> — <small>{x.reason}</small></li>
                ))}
                {v.measures.filter((m) => m.metric === null).map((m) => (
                  <li key={m.measure}><strong>{m.measure}</strong> — <small>{m.note}</small></li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* THE DEFINITION PANEL. */}
          <section className="kv-panel" aria-labelledby="rp-def">
            <h2 id="rp-def" className="kv-panel__title">{t.t('rp.builder.definition')}</h2>
            <form action={runReportAction}>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="rp-metric">{t.t('rp.builder.metric')}</label>
                <select className="kv-input" id="rp-metric" name="metric" defaultValue="gmv_minor">
                  {v.metrics.map((m) => <option key={m} value={m}>{t.t(metricKey(m))}</option>)}
                </select>
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="rp-bucket">{t.t('rp.builder.bucket')}</label>
                <select className="kv-input" id="rp-bucket" name="bucket" defaultValue="day">
                  {v.buckets.map((b) => <option key={b} value={b}>{t.t(bucketKey(b))}</option>)}
                </select>
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="rp-from">{t.t('rp.builder.from')}</label>
                <input className="kv-input" id="rp-from" name="from" type="date" defaultValue={monthAgo} required />
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="rp-to">{t.t('rp.builder.to')}</label>
                <input className="kv-input" id="rp-to" name="to" type="date" defaultValue={today} required />
              </div>
              <Button type="submit">{t.t('rp.builder.run')}</Button>
            </form>
          </section>

          {/* SAVED DEFINITIONS — and the schedules that run them, which existed all along. */}
          <section className="kv-panel" aria-labelledby="rp-saved">
            <h2 id="rp-saved" className="kv-panel__title">{t.t('rp.saved.title')}</h2>
            <Callout>{t.t('rp.saved.delta028', { note: v.delta028.note })}</Callout>
            {saved.length === 0 ? (
              <EmptyState title={t.t('rp.saved.empty.title')} body={t.t('rp.saved.empty.body')} />
            ) : (
              <table className="kv-table">
                <caption className="kv-table__caption">{t.t('rp.saved.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t.t('rp.saved.report')}</th>
                    <th scope="col">{t.t('rp.builder.metric')}</th>
                    <th scope="col">{t.t('rp.saved.window')}</th>
                    <th scope="col">{t.t('rp.saved.schedules')}</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {saved.map((s) => (
                    <tr key={s.id}>
                      <td>{s.title}<br /><small className="kv-mono">{s.slug}</small></td>
                      <td>{t.t(metricKey(s.metric))} · {t.t(bucketKey(s.bucket))}</td>
                      {/* RELATIVE, always — a saved definition pinned to two dates is wrong the day after it is saved. */}
                      <td>{t.t('rp.saved.lastNDays', { n: String(s.windowDays) })}</td>
                      <td>
                        {s.schedules.length === 0 ? t.t('rp.saved.noSchedule') : s.schedules.map((sc) => (
                          <StatusPill
                            key={sc.id}
                            tone="neutral"
                            icon={false}
                            label={`${sc.cadence}${sc.nextRunAt ? ` · ${sc.nextRunAt.slice(0, 10)}` : ''}`}
                          />
                        ))}
                      </td>
                      <td>
                        <form action={archiveSavedAction} className="kv-inline-form">
                          <input type="hidden" name="slug" value={s.slug} />
                          <Button type="submit" variant="tertiary">{t.t('rp.saved.archive')}</Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <form action={saveReportAction}>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="rp-slug">{t.t('rp.saved.slug')}</label>
                <input className="kv-input" id="rp-slug" name="slug" required pattern="[a-z][a-z0-9-]{1,59}"
                  aria-describedby="rp-slug-help" />
                <p className="kv-field__help" id="rp-slug-help">{t.t('rp.saved.slugHelp')}</p>
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="rp-title">{t.t('rp.saved.titleField')}</label>
                <input className="kv-input" id="rp-title" name="title" required minLength={3} maxLength={160} />
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="rp-smetric">{t.t('rp.builder.metric')}</label>
                <select className="kv-input" id="rp-smetric" name="metric" defaultValue="gmv_minor">
                  {v.metrics.map((m) => <option key={m} value={m}>{t.t(metricKey(m))}</option>)}
                </select>
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="rp-window">{t.t('rp.saved.windowDays')}</label>
                <input className="kv-input" id="rp-window" name="windowDays" type="number" min={1} max={366} defaultValue={30} />
                <p className="kv-field__help">{t.t('rp.saved.windowHelp')}</p>
              </div>
              <Button type="submit">{t.t('rp.saved.save')}</Button>
            </form>
          </section>
        </>
      ) : null}
    </main>
  );
}
