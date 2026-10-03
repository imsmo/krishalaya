// apps/web-tenant/src/app/twin/scenarios/page.tsx · W421 · SCENARIOS — ASSUMPTIONS YOU CAN SEE, EACH WITH ITS SOURCE · PC-56 TENANT-12.
//
// The canon badges two runs "twin-model v0.9 · AI-labelled · run 7a1c…9e02" and pre-fills "source defaults" (IMD −20 %, input cost
// index +4 %). No model is registered, no run has ever happened and no such series is recorded here — so this page lists scenarios,
// shows each one's assumptions sheet (value · unit · cited source · as-of · who set it) with its full history, and offers "Run",
// which opens the mutate chain that states and RECORDS the gate's refusal (TWIN_NO_MODEL_REGISTERED). No run hash, no model badge,
// no "Replay" (nothing to replay). States: content · No scenarios yet · Loading · Flagged off (the API's 404) · Restricted (403) ·
// "Running is restricted" (no twin.run) · Couldn't load.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { TwinScenarioDetail, TwinScenarioPage, TwinScenarioStatus } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getLang, getTranslator } from '../../../lib/i18n';
import {
  NEW_SCENARIO_HREF, SCENARIOS_HREF, SCENARIO_STATUSES, TWIN_HREF, actHref, assumptionsHref, cellKey, isUuid, keyLabel, refusalKey, resultsHref,
  scenarioHref, statusKey, templateKey, twinState, unitKey,
} from '../../../features/twin/twin';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('twin.scenarios.title'), robots: { index: false, follow: false } };
}

export default async function TwinScenariosPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(SCENARIOS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const fmt = (n: number) => formatNumber(n, lang);
  const day = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium' }) : '');
  const status = (SCENARIO_STATUSES as readonly string[]).includes(searchParams.status ?? '') ? (searchParams.status as TwinScenarioStatus) : undefined;
  const cursor = typeof searchParams.cursor === 'string' && searchParams.cursor.length < 200 ? searchParams.cursor : undefined;
  const id = isUuid(searchParams.id) ? searchParams.id : null;

  let page: TwinScenarioPage | null = null; let state: string | null = null;
  try { page = await tenantClient().twin.scenarios({ status, cursor, limit: 25 }); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = twinState(err?.code, err?.status); }
  let detail: TwinScenarioDetail | null = null; let detailState: string | null = null;
  if (id && page) {
    try { detail = await tenantClient().twin.scenario(id); }
    catch (e) { const err = e instanceof SdkError ? e : null; detailState = twinState(err?.code, err?.status, true); }
  }
  const tab = (s?: string) => `${SCENARIOS_HREF}${s ? `?status=${s}` : ''}`;

  return (
    <section>
      <nav aria-label={t.t('twin.breadcrumb.label')} className="kv-field__hint">
        {t.t('twin.breadcrumb.area')} › <Link href={TWIN_HREF} className="kv-btn--link">{t.t('twin.overview.crumb')}</Link> › {t.t('twin.scenarios.crumb')}
      </nav>
      <h1>{t.t('twin.scenarios.title')}</h1>
      <p>{t.t('twin.scenarios.lede')}</p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(state === 'flaggedOff' ? 'twin.state.scenariosOff.title' : `twin.state.${state}.title`)}</strong>
          <p>{t.t(state === 'flaggedOff' ? 'twin.state.scenariosOff.body' : `twin.state.${state}.body`)}</p>
          {state === 'flaggedOff' && <p><Link href={TWIN_HREF} className="kv-btn--link">{t.t('twin.state.toLocked')}</Link></p>}
          {state === 'error' && <p><Link href={SCENARIOS_HREF} className="kv-btn--link">{t.t('twin.state.reload')}</Link></p>}
        </div>
      )}

      {page && (
        <>
          {page.canRun
            ? <p><Link href={`${NEW_SCENARIO_HREF}?step=edit`} className="kv-btn kv-btn--primary">{t.t('twin.scenarios.new')}</Link></p>
            : <div className="kv-card kv-card--notice" role="note"><strong>{t.t('twin.state.runRestricted.title')}</strong><p>{t.t('twin.state.runRestricted.body')}</p></div>}
          <p className="kv-chips">
            <Link href={tab()} className={`kv-chip${!status ? ' kv-chip--on' : ''}`}>{t.t('twin.scenarios.all', { n: fmt(page.total) })}</Link>
            {SCENARIO_STATUSES.map((s) => <Link key={s} href={tab(s)} className={`kv-chip${status === s ? ' kv-chip--on' : ''}`}>{t.t(statusKey(s))} ({fmt(page!.counts[s])})</Link>)}
          </p>

          {page.items.length === 0 ? (
            <div className="kv-empty-state" role="status">
              <strong>{t.t('twin.scenarios.empty.title')}</strong><p>{t.t('twin.scenarios.empty.body')}</p>
              {page.canRun && <p><Link href={`${NEW_SCENARIO_HREF}?step=edit`} className="kv-btn kv-btn--primary">{t.t('twin.scenarios.startFromTemplate')}</Link></p>}
            </div>
          ) : (
            <table className="kv-table">
              <caption className="kv-sr-only">{t.t('twin.scenarios.title')}</caption>
              <thead><tr>
                <th scope="col">{t.t('twin.scenarios.col.scenario')}</th><th scope="col">{t.t('twin.scenarios.col.status')}</th>
                <th scope="col">{t.t('twin.scenarios.col.lastRun')}</th><th scope="col">{t.t('twin.scenarios.col.model')}</th><th scope="col">{t.t('twin.scenarios.col.acts')}</th>
              </tr></thead>
              <tbody>{page.items.map((s) => (
                <tr key={s.id}>
                  <th scope="row"><Link href={scenarioHref(s.id)}>{s.name}</Link><div className="kv-field__hint">{t.t(templateKey(s.templateCode))}{s.productName ? ` · ${s.productName}` : ''}</div></th>
                  <td><span className={s.status === 'archived' ? 'kv-badge kv-badge--muted' : 'kv-badge'}>{t.t(statusKey(s.status))}</span></td>
                  <td>{s.lastAttempt
                    ? <>{t.t('twin.scenarios.attemptRefused', { when: day(s.lastAttempt.createdAt), who: s.lastAttempt.requestedBy ?? t.t('twin.someone') })}<div className="kv-field__hint">{t.t(refusalKey(s.lastAttempt.refusalCode ?? 'unknown'))} · {t.t('twin.scenarios.attempts', { n: fmt(s.attempts) })}</div></>
                    : <span className="kv-field__hint">{t.t('twin.scenarios.notAsked')}</span>}</td>
                  <td><span className="kv-field__hint">{t.t(cellKey(s.cell))}</span></td>
                  <td>
                    {s.acts.includes('edit') && page!.canRun && <><Link href={assumptionsHref(s.id)} className="kv-btn--link">{t.t('twin.scenarios.editAssumptions')}</Link>{' · '}</>}
                    {s.acts.includes('run') && <><Link href={actHref(s.id, 'run')} className="kv-btn--link">{t.t('twin.scenarios.run')}</Link>{' · '}</>}
                    <Link href={resultsHref(s.id)} className="kv-btn--link">{t.t('twin.scenarios.results')}</Link>
                    {s.acts.includes('archive') && page!.canRun && <>{' · '}<Link href={actHref(s.id, 'archive')} className="kv-btn--link">{t.t('twin.scenarios.archive')}</Link></>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {page.nextCursor && <p className="kv-pager"><Link href={`${SCENARIOS_HREF}?${new URLSearchParams({ ...(status ? { status } : {}), cursor: page.nextCursor }).toString()}`} className="kv-btn--link">{t.t('twin.next')}</Link></p>}
          <p className="kv-field__hint">{t.t('twin.scenarios.versionNote')}</p>
        </>
      )}

      {detailState && <div className="kv-card kv-card--notice" role="alert"><strong>{t.t(`twin.state.${detailState}.title`)}</strong><p>{t.t(`twin.state.${detailState}.body`)}</p></div>}
      {detail && (
        <div className="kv-card" id="sheet">
          <h2>{t.t('twin.sheet.title', { name: detail.scenario.name })}</h2>
          <p className="kv-field__hint">{t.t(statusKey(detail.scenario.status))} · {t.t(templateKey(detail.scenario.templateCode))}{detail.scenario.archiveReason ? ` · ${t.t('twin.sheet.archived', { reason: detail.scenario.archiveReason })}` : ''}</p>
          <table className="kv-table">
            <caption className="kv-sr-only">{t.t('twin.sheet.title', { name: detail.scenario.name })}</caption>
            <thead><tr><th scope="col">{t.t('twin.sheet.col.key')}</th><th scope="col">{t.t('twin.sheet.col.value')}</th><th scope="col">{t.t('twin.sheet.col.source')}</th><th scope="col">{t.t('twin.sheet.col.editedBy')}</th></tr></thead>
            <tbody>
              {detail.assumptions.map((a) => (
                <tr key={a.key}>
                  <th scope="row">{t.t(keyLabel(a.key))}</th>
                  <td>{a.value} {t.t(unitKey(a.unit))}</td>
                  <td>{a.citation}<div className="kv-field__hint">{t.t('twin.sheet.asOf', { day: a.asOf })}</div></td>
                  <td>{a.setBy ?? t.t('twin.someone')}<div className="kv-field__hint">{day(a.setAt)}</div></td>
                </tr>
              ))}
              {detail.missingKeys.map((k) => <tr key={k}><th scope="row">{t.t(keyLabel(k))}</th><td colSpan={3}><span className="kv-field__hint">{t.t('twin.sheet.notSet')}</span></td></tr>)}
            </tbody>
          </table>
          <p className="kv-field__hint">{t.t('twin.sheet.noDefaults')}</p>
          {detail.canRun && detail.scenario.status !== 'archived' && <p><Link href={assumptionsHref(detail.scenario.id)} className="kv-btn kv-btn--primary">{t.t('twin.sheet.save')}</Link></p>}

          <h3>{t.t('twin.sheet.history')}</h3>
          {detail.history.length === 0 ? <p className="kv-field__hint">{t.t('twin.sheet.historyNone')}</p> : (
            <ul className="kv-list">{detail.history.map((h) => (
              <li key={h.id}>{t.t(h.oldValue === null ? 'twin.sheet.historySet' : 'twin.sheet.historyChanged', { key: t.t(keyLabel(h.key)), from: h.oldValue ?? '', to: h.newValue, who: h.setBy ?? t.t('twin.someone'), when: day(h.setAt) })}
                <div className="kv-field__hint">{h.newCitation} · {t.t('twin.sheet.asOf', { day: h.newAsOf })}</div></li>
            ))}</ul>
          )}
          <h3>{t.t('twin.sheet.attempts')}</h3>
          {detail.attempts.length === 0 ? <p className="kv-field__hint">{t.t('twin.scenarios.notAsked')}</p> : (
            <ul className="kv-list">{detail.attempts.map((r) => <li key={r.id}>{t.t('twin.scenarios.attemptRefused', { when: day(r.createdAt), who: r.requestedBy ?? t.t('twin.someone') })} — {t.t(refusalKey(r.refusalCode ?? 'unknown'))}</li>)}</ul>
          )}
        </div>
      )}

      <p><em>{t.t('twin.quote.dispose')}</em></p>
    </section>
  );
}
