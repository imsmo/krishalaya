// apps/web-ops/src/components/ops5/InsightsViews.tsx · PC-56 OPS-5b · THE ORGANISATION'S MILK, IN NUMBERS — W369 (`/insights`) and the contents of
// its export chain (W3321 queued / W3322 ready), presentational.
//
// What a person at the field desk SEES, signed in as themself (OPS-3 Q14-A): every figure `GET /v1/dairy/insights` returns, AS THE SERVER WORDS
// IT, for the WHOLE ORGANISATION (Q4-A, said on every group): kg a day and in total, the counter rate per kg (formatMoneyMinor with the read's own
// currency — never a fallback), pourers as counts, the payment cycles closed and with every bill approved beside the server's own refusal of a
// payout record, the weekly table by shift, the premium band in words, the rate cards in force, the bonus paid, and the spoilage refusal. What they
// are TOLD: Q2-A's and Q4-A's sentences verbatim (both verified at merge — the read carries no member row and has no centre filter; every pour
// row belongs to a centre, `milk_collections.mcc_id NOT NULL`). NEVER SHOWN: a member, a reason, a rank, a %, a share, a goal, a forecast, a
// schedule. NOTHING IS COMPUTED HERE: every number is the server's; the only conversions are notation (features/ops5/insights.ts kgText,
// rateMinor) — this file holds no arithmetic (pinned by test/ops5b-pages.spec.ts).
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { DairyChange, DairyInsights, DairyInsightsReady, DairyInsightWindow, DairyPremiumPrevious, ExportJob } from '@krishalaya/sdk-js';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { Tr } from '../../features/ops5/refusals';
import { atText } from '../../features/ops4/iot';
import {
  INSIGHT_WINDOWS, actHref, animalKey, downloadPath, exportHref, insightsHref, kgText, rateMinor, requesterKey, shaGroups, shiftKey,
  type DownloadError, type ExportError, type ExportJobState, type InsightsTransport,
} from '../../features/ops5/insights';
import { Ops5Refusals } from './Ops5Chain';

type Action = (formData: FormData) => Promise<void>;
const kg = (t: Tr, milli: unknown) => { const v = kgText(milli); return v === null ? t.t('ops5.ins.notGiven') : t.t('ops5.ins.kg', { v }); };
const money = (t: Tr, minor: string | null, currency: string, lang: string) => (minor === null || !currency ? t.t('ops5.ins.notGiven') : formatMoneyMinor(minor, currency, lang));
const at = (t: Tr, iso: unknown) => atText(iso) ?? t.t('ops5.timeUnknown');

/** The two sentences the page states, verbatim (Q2-A, Q4-A), and the scope label every figure group carries. */
export const INSIGHTS_STATEMENTS = ['ops5.ins.q2', 'ops5.ins.q4'] as const;

function Scope({ t, pours }: { t: Tr; pours: boolean }) {
  // Q4-A: the whole organisation, on every group. The pour groups carry the full sentence; the cycle and card groups are not pours, so they carry
  // the scope alone (the sentence's "from every centre's recorded pours" would be false of them).
  return <p className="kv-field__hint" data-kv-scope="organisation" data-kv-scope-pours={pours ? 'yes' : 'no'}>{t.t(pours ? 'ops5.ins.q4' : 'ops5.ins.scopeOrganisation')}</p>;
}
function Group({ t, id, pours, children }: { t: Tr; id: string; pours: boolean; children: ReactNode }) {
  return (
    <section className="kv-card" data-kv-group={id} aria-labelledby={`kv-ins-${id}`}>
      <h2 id={`kv-ins-${id}`} className="kv-card__title">{t.t(`ops5.ins.${id}.title`)}</h2>
      <Scope t={t} pours={pours} />
      {children}
    </section>
  );
}
function Fact({ label, children, k }: { label: string; children: ReactNode; k?: string }) {
  return <div className="kv-facts__row" data-kv-fact={k}><dt>{label}</dt><dd>{children}</dd></div>;
}

/** A change verdict in words: the previous window's figure as the server sent it — never a %, never a difference worked out here. */
function Previous({ t, change, show }: { t: Tr; change: DairyChange; show: (v: string) => string }) {
  switch (change.kind) {
    case 'changed': return <span data-kv-change="changed">{t.t('ops5.ins.change.previous', { v: show(change.from) })}</span>;
    case 'from_zero': return <span data-kv-change="from_zero">{t.t('ops5.ins.change.fromZero')}</span>;
    case 'to_zero': return <span data-kv-change="to_zero">{t.t('ops5.ins.change.previous', { v: show(change.from) })}</span>;
    case 'both_zero': return <span data-kv-change="both_zero">{t.t('ops5.ins.change.bothZero')}</span>;
    default: return <span data-kv-change="no_previous">{t.t('ops5.ins.change.noPrevious')}</span>;
  }
}

function WindowLinks({ t, w }: { t: Tr; w: DairyInsightWindow }) {
  return (
    <nav aria-label={t.t('ops5.ins.window.label')} className="kv-pager" data-kv-windows="">
      {INSIGHT_WINDOWS.map((x) => (
        <Link key={x} href={insightsHref(x)} className={x === w ? 'kv-btn' : 'kv-btn kv-btn--muted'} aria-current={x === w ? 'page' : undefined} data-kv-window={x}>
          {t.t('ops5.ins.window.days', { n: x })}
        </Link>
      ))}
    </nav>
  );
}

function ExportForm({ t, w, idemKey, action, error }: { t: Tr; w: DairyInsightWindow; idemKey: string; action: Action; error: ExportError | null }) {
  return (
    <section className="kv-card" data-kv-export="form" aria-labelledby="kv-ins-export">
      <h2 id="kv-ins-export" className="kv-card__title">{t.t('ops5.ins.export.title')}</h2>
      <p>{t.t('ops5.ins.export.statement')}</p>
      {error ? <p className="kv-error" role="alert" data-kv-export-error={error}>{t.t(`ops5.ins.export.error.${error}`)}</p> : null}
      <form action={action}>
        <input type="hidden" name="window" value={w} />
        <input type="hidden" name="key" value={idemKey} />
        <button type="submit" className="kv-btn">{t.t('ops5.ins.export.button', { n: w })}</button>
      </form>
    </section>
  );
}

function Ready({ t, lang, v }: { t: Tr; lang: string; v: DairyInsightsReady }) {
  const cur = v.currencyCode;
  const rate = (c: string) => money(t, rateMinor(c), cur, lang);
  const premiumPrev = (p: DairyPremiumPrevious) => {
    if (p.kind === 'measured') return t.t(`ops5.ins.premium.prev.${p.basis}`, { n: p.qualifying, of: p.pourers });
    return t.t(`ops5.ins.premium.prev.${p.kind}`);
  };
  return (
    <>
      <Group t={t} id="volume" pours>
        <dl className="kv-facts">
          <Fact k="per-day" label={t.t('ops5.ins.volume.perDay')}>{kg(t, v.volume.perDayMilli)}</Fact>
          <Fact k="total" label={t.t('ops5.ins.volume.total')}>{kg(t, v.volume.totalMilli)}</Fact>
          <Fact k="days" label={t.t('ops5.ins.volume.days')}>{t.t('ops5.ins.volume.daysWith', { n: v.volume.daysWithPours, of: v.volume.days })}</Fact>
          <Fact k="previous" label={t.t('ops5.ins.previousLabel')}><Previous t={t} change={v.volume.change} show={(x) => kg(t, x)} /></Fact>
        </dl>
        <p className="kv-field__hint">{t.t('ops5.ins.volume.basis')}</p>
      </Group>

      <Group t={t} id="rate" pours>
        {v.ratePerLitre.kind === 'measured' ? (
          <dl className="kv-facts">
            <Fact k="rate" label={t.t('ops5.ins.rate.perKg')}><span data-kv-money={cur}>{rate(v.ratePerLitre.centiMinorPerLitre)}</span></Fact>
            <Fact k="previous" label={t.t('ops5.ins.previousLabel')}><Previous t={t} change={v.ratePerLitre.change} show={rate} /></Fact>
          </dl>
        ) : <p data-kv-rate="no_pours">{t.t('ops5.ins.rate.noPours')}</p>}
        <p className="kv-field__hint">{t.t('ops5.ins.rate.basis')}</p>
      </Group>

      <Group t={t} id="pourers" pours>
        {v.pourers.kind === 'no_pourers' ? <p data-kv-pourers="none">{t.t('ops5.ins.pourers.none')}</p> : (
          <dl className="kv-facts" data-kv-pourers={v.pourers.kind}>
            <Fact k="active" label={t.t('ops5.ins.pourers.active')}>{v.pourers.active}</Fact>
            <Fact k="newcomers" label={t.t('ops5.ins.pourers.newcomers')}>{v.pourers.newcomers}</Fact>
            <Fact k="win-backs" label={t.t('ops5.ins.pourers.winBacks')}>{v.pourers.winBacks}</Fact>
            {v.pourers.kind === 'measured' ? <Fact k="continuing" label={t.t('ops5.ins.pourers.continuing')}>{v.pourers.continuing}</Fact> : null}
            {v.pourers.kind === 'measured' ? <Fact k="previous" label={t.t('ops5.ins.previousLabel')}><Previous t={t} change={v.pourers.change} show={(x) => x} /></Fact> : null}
          </dl>
        )}
        {v.pourers.kind === 'inconsistent' ? <p className="kv-error" data-kv-pourers-inconsistent="">{t.t('ops5.ins.pourers.inconsistent')}</p> : null}
        <p className="kv-field__hint">{t.t('ops5.ins.pourers.basis')}</p>
      </Group>

      <Group t={t} id="cycles" pours={false}>
        <p data-kv-payout={v.payoutStreak.kind} className="kv-statement">{t.t('ops5.ins.payout.refused')}</p>
        <dl className="kv-facts">
          <Fact k="closed" label={t.t('ops5.ins.cycles.closed')}>{v.payoutStreak.cyclesClosed}</Fact>
          <Fact k="approved" label={t.t('ops5.ins.cycles.allApproved')}>{v.payoutStreak.cyclesAllBillsApproved}</Fact>
        </dl>
      </Group>

      <Group t={t} id="shifts" pours>
        {v.byShift.buckets.length === 0 ? <p>{t.t('ops5.ins.shifts.none')}</p> : (
          <table className="kv-table" data-kv-buckets={v.byShift.buckets.length}>
            <thead><tr><th scope="col">{t.t('ops5.ins.shifts.week')}</th>{v.byShift.shifts.map((s) => <th key={s} scope="col">{t.t(shiftKey(s))}</th>)}<th scope="col">{t.t('ops5.ins.shifts.all')}</th></tr></thead>
            <tbody>
              {v.byShift.buckets.map((b) => (
                <tr key={b.from} data-kv-bucket={b.from}>
                  <th scope="row">{t.t('ops5.ins.range', { from: b.from, to: b.to })}</th>
                  {v.byShift.shifts.map((s) => <td key={s}>{kg(t, b.byShift[s] ?? null)}</td>)}
                  <td>{kg(t, b.totalMilli)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="kv-field__hint">{t.t('ops5.ins.shifts.basis')}</p>
      </Group>

      <Group t={t} id="premium" pours>
        <p data-kv-premium={v.premium.current.kind === 'measured' ? v.premium.current.basis : v.premium.current.kind}>
          {v.premium.current.kind === 'measured'
            ? t.t(`ops5.ins.premium.${v.premium.current.basis}`, { n: v.premium.current.qualifying, of: v.premium.current.pourers })
            : t.t(`ops5.ins.premium.${v.premium.current.kind}`)}
        </p>
        <p data-kv-premium-previous={v.premium.previous.kind}>{premiumPrev(v.premium.previous)}</p>
      </Group>

      <Group t={t} id="bonus" pours>
        <p><span data-kv-money={cur}>{money(t, v.bonusMinor, cur, lang)}</span></p>
        <p className="kv-field__hint" data-kv-slabs={v.slabsApplied ? 'on' : 'off'}>{t.t(v.slabsApplied ? 'ops5.ins.bonus.slabsOn' : 'ops5.ins.bonus.slabsOff')}</p>
      </Group>

      <Group t={t} id="cards" pours={false}>
        {v.rateCards.byAnimal.length === 0 ? <p data-kv-cards="none">{t.t('ops5.ins.cards.none')}</p> : (
          <ul className="kv-list" data-kv-cards={v.rateCards.byAnimal.length}>
            {v.rateCards.byAnimal.map((g) => (
              <li key={g.animalType} data-kv-animal={g.animalType} data-kv-ambiguous={g.ambiguous ? 'yes' : 'no'}>
                {t.t(animalKey(g.animalType))}{' · '}{t.t('ops5.ins.cards.inForce', { n: g.cards.length })}
                {g.cards.map((c) => <span key={c.id}>{' · '}{t.t('ops5.ins.cards.from', { from: c.effectiveFrom })}</span>)}
                {g.ambiguous ? <>{' · '}{t.t('ops5.ins.cards.ambiguous')}</> : null}
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group t={t} id="spoilage" pours={false}>
        <p data-kv-spoilage={v.spoilage.kind}>{t.t('ops5.ins.spoilage.refused')}</p>
      </Group>
    </>
  );
}

export function InsightsView({ t, lang, w, state, data, idemKey, exportAction, exportError }: {
  t: Tr; lang: string; w: DairyInsightWindow; state: 'ok' | InsightsTransport; data: DairyInsights | null;
  idemKey: string; exportAction: Action; exportError: ExportError | null;
}) {
  const kind = state !== 'ok' ? state : data?.kind ?? 'error';
  return (
    <section data-kv-ops5="insights" data-kv-state={kind}>
      <h1>{t.t('ops5.ins.title')}</h1>
      <p className="kv-field__hint">{t.t('ops5.ins.signedIn')}</p>
      <p className="kv-statement" data-kv-statement="ops5.ins.q2">{t.t('ops5.ins.q2')}</p>
      {state === 'off' ? <div className="kv-card" data-kv-off="dairy"><h2 className="kv-card__title">{t.t('ops5.ins.off.title')}</h2><p>{t.t('ops5.ins.off.dairy')}</p></div> : null}
      {state === 'forbidden' ? <div className="kv-card" data-kv-off="permission"><h2 className="kv-card__title">{t.t('ops5.ins.forbidden.title')}</h2><p>{t.t('ops5.ins.forbidden.body')}</p></div> : null}
      {state === 'error' ? (
        <div className="kv-card" role="alert" data-kv-error="read">
          <h2 className="kv-card__title">{t.t('ops5.ins.error.title')}</h2><p>{t.t('ops5.ins.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href={actHref(w, 'confirm')} data-kv-chain-link="retry">{t.t('ops5.error.retry')}</Link></p>
        </div>
      ) : null}
      {state === 'ok' && data ? (
        <>
          {data.kind === 'not_enabled' ? <div className="kv-card" data-kv-off="dairy_insights"><h2 className="kv-card__title">{t.t('ops5.ins.off.title')}</h2><p>{t.t('ops5.ins.off.insights')}</p></div> : null}
          {data.kind === 'unavailable' ? <div className="kv-card" data-kv-unavailable=""><p>{t.t('ops5.ins.unavailable')}</p></div> : null}
          {data.kind !== 'not_enabled' && data.kind !== 'unavailable' ? (
            <>
              <WindowLinks t={t} w={w} />
              <p data-kv-range="">
                {t.t('ops5.ins.range.current', { from: data.ranges.current.from, to: data.ranges.current.to, n: data.ranges.current.days })}{' '}
                {t.t('ops5.ins.range.previous', { from: data.ranges.previous.from, to: data.ranges.previous.to })}{' '}
                {t.t('ops5.ins.range.partial')}
              </p>
            </>
          ) : null}
          {data.kind === 'no_data' ? <div className="kv-card" data-kv-empty="no_data"><Scope t={t} pours /><p>{t.t('ops5.ins.noData', { from: data.ranges.lookbackFrom, to: data.ranges.current.to })}</p></div> : null}
          {data.kind === 'not_enough_history' && data.history.kind === 'not_enough_history' ? (
            <div className="kv-card" data-kv-empty="not_enough_history">
              <Scope t={t} pours />
              <p>{t.t('ops5.ins.history.short', { n: data.history.days, need: data.history.needDays })}</p>
              <p data-kv-pourers-so-far={data.pourersSoFar}>{t.t('ops5.ins.history.pourersSoFar', { n: data.pourersSoFar })}</p>
            </div>
          ) : null}
          {data.kind === 'ready' ? <Ready t={t} lang={lang} v={data} /> : null}
          {data.kind !== 'not_enabled' ? <ExportForm t={t} w={w} idemKey={idemKey} action={exportAction} error={exportError} /> : null}
        </>
      ) : null}
      <Ops5Refusals t={t} surface="insights" />
    </section>
  );
}

/** The export job (W3321 queued / W3322 ready) — `children` of the export chain. The plane decides the state; the page only reads it. */
export function ExportJobView({ t, w, state, job, meId, downloadError }: {
  t: Tr; w: DairyInsightWindow; state: ExportJobState | 'off' | 'forbidden' | 'notFound' | 'error'; job: ExportJob | null; meId: string | null; downloadError: DownloadError | null;
}) {
  if (!job || state === 'off' || state === 'forbidden' || state === 'notFound' || state === 'error') return null;
  const r = job.receipt;
  return (
    <div data-kv-export-job={job.id} data-kv-export-state={state}>
      {downloadError ? <p className="kv-error" role="alert" data-kv-download-error={downloadError}>{t.t(`ops5.ins.export.download.error.${downloadError}`)}</p> : null}
      {state === 'queued' ? (
        <dl className="kv-facts">
          {job.standing ? <Fact k="position" label={t.t('ops5.ins.export.position')}>{t.t('ops5.ins.export.positionValue', { n: job.standing.position, ahead: job.standing.ahead })}</Fact> : null}
          {job.standing ? (
            <Fact k="eta" label={t.t('ops5.ins.export.eta')}>
              {job.standing.eta.kind === 'estimate' ? t.t('ops5.ins.export.etaEstimate', { s: job.standing.eta.seconds, runs: job.standing.eta.sample }) : t.t('ops5.ins.export.etaNone')}
            </Fact>
          ) : null}
          <Fact k="queued-at" label={t.t('ops5.ins.export.queuedAt')}>{at(t, job.queuedAt)}</Fact>
          <Fact k="requester" label={t.t('ops5.ins.export.requester')}>{t.t(requesterKey(job.requestedBy, meId))}</Fact>
        </dl>
      ) : null}
      {(state === 'ready' || state === 'expired') && r ? (
        <dl className="kv-facts" data-kv-receipt="">
          <Fact k="file" label={t.t('ops5.ins.export.fileName')}><code>{r.fileName}</code></Fact>
          <Fact k="rows" label={t.t('ops5.ins.export.rows')}>{t.t('ops5.ins.export.rowsValue', { n: r.rowCount })}</Fact>
          <Fact k="sha256" label={t.t('ops5.ins.export.sha256')}><code data-kv-sha256={r.sha256}>{shaGroups(r.sha256)}</code></Fact>
          <Fact k="generated" label={t.t('ops5.ins.export.generatedAt')}>{at(t, r.generatedAt)}</Fact>
          <Fact k="requester" label={t.t('ops5.ins.export.requester')}>{t.t(requesterKey(r.requestedBy, meId))}</Fact>
          <Fact k="expires" label={t.t(state === 'expired' ? 'ops5.ins.export.expiredAt' : 'ops5.ins.export.expiresAt')}>{at(t, state === 'expired' ? job.expiredAt : job.expiresAt)}</Fact>
          {job.fetches ? <Fact k="fetches" label={t.t('ops5.ins.export.fetches')}>{t.t('ops5.ins.export.fetchesValue', { n: job.fetches.attempts, served: job.fetches.served, refused: job.fetches.refused })}</Fact> : null}
        </dl>
      ) : null}
      {state === 'ready' && job.download.kind === 'available' ? (
        <form method="post" action={downloadPath(job.id)} data-kv-download="">
          <input type="hidden" name="window" value={w} />
          <button type="submit" className="kv-btn">{t.t('ops5.ins.export.download', { s: job.download.linkTtlSec })}</button>
          <p className="kv-field__hint">{t.t('ops5.ins.export.downloadLogged')}</p>
        </form>
      ) : null}
      {state === 'failed' ? <p data-kv-failure={job.failure?.code ?? 'unknown'}>{t.t('ops5.ins.export.failedCode')} <code>{job.failure?.code ?? '—'}</code></p> : null}
      {state === 'queued' ? <p className="kv-pager"><Link className="kv-btn" href={exportHref(job.id, w)} data-kv-real="poll">{t.t('ops5.chain.checkAgain')}</Link></p> : null}
    </div>
  );
}
