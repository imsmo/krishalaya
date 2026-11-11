// apps/web-gov/src/components/gov2/ApplicationsViews.tsx · PC-56 GOV-2c — W330 (`/applications`), W331 (`/applications/[id]`) and the
// act chain's pieces (W3159–W3161), presentational (rendered by the pages and by the render tests). GOV-2 Q1-A, Q2-A, Q3-A, Q4-A
// (lead-applied 2026-11-10; the founder may reopen).
//
// Every value printed is one GOV-2a's read returned. The list never names a farmer or an organisation and never lists an unsent application
// (the API walls it; the status filter cannot ask for it). One application shows ONLY the fields its version declared, as the read gives
// them (personal ones arrive masked); an undeclared key is never printed — nothing but `form` is iterated. No money helper, no money figure
// (Q1-A); approving carries nothing but the act. No download of any kind is offered (Q4-A). The acts are links to the act chain; each is
// OFFERED by `offeredActs` (a mirror of the API, never a grant). All copy via i18n; no inline styles; no physical direction.
import type { ReactNode } from 'react';
import type { GovApplication, GovApplicationOpened, GovMe, GovScheme } from '@krishalaya/sdk-js';
import { Gov2Refusals } from './Gov2Chain';
import { atUtc } from '../../features/gov1/access';
import { ltrOrNull, ltrText } from '../../features/rtl/span';
import type { Tr } from '../../features/gov2/refusals';
import { asStored } from '../../features/gov2/schemes';
import {
  ACT_ERRORS, actHref, canCheck, canDecide, GOV_LISTED_STATUSES, listHref, offeredActs, REJECTION_CODES, shortId, statusKey,
  type ActFacts, type AppsState, type AppState, type DecisionFact, type GovActName,
} from '../../features/gov2/applications';

type Action = string | ((fd: FormData) => Promise<void>);
const formAction = (a: Action) => a as never;
const dash = (t: Tr, v: string | null) => v ?? t.t('common.dash');

function States({ t, state, retry, forbiddenKey }: { t: Tr; state: string; retry: string; forbiddenKey: string }) {
  return (
    <>
      {state === 'off' ? <p className="kv-notice" data-kv-notice="off">{t.t('gov2.off')}</p> : null}
      {state === 'forbidden' ? <p className="kv-notice" data-kv-notice="forbidden">{t.t(forbiddenKey)}</p> : null}
      {state === 'error' ? (
        <div className="kv-notice" data-kv-notice="error">
          <p>{t.t('gov2.error')}</p>
          <p className="kv-pager"><a className="kv-btn" href={retry} data-kv-retry="">{t.t('common.retry')}</a></p>
        </div>
      ) : null}
    </>
  );
}

/** W330 — applications to the authority's schemes. */
export function ApplicationsListView({ t, state, me, items, schemes, status, scheme, cursor, nextCursor, lang = 'en' }: {
  t: Tr; state: AppsState; me: GovMe | null; items: GovApplication[]; schemes: GovScheme[];
  status?: string; scheme?: string; cursor?: string; nextCursor: string | null;
  /** PC-56 RTL-1f: the page language — under a preview (rtl) language each scheme code and instant is isolated left-to-right. */
  lang?: string;
}) {
  const rows = state === 'ok' ? items : [];
  return (
    <section data-kv-page="applications" data-kv-state={state}>
      <h1>{t.t('gov2.apps.title')}</h1>
      {me ? <p className="kv-muted" data-kv-signed-in="">{t.t('gov1.dash.signedIn', { authority: me.authority?.name ?? t.t('common.dash') })}</p> : null}
      <p className="kv-statement" data-kv-statement="gov2.q4">{t.t('gov2.q4')}</p>
      <p className="kv-statement" data-kv-statement="gov2.q3">{t.t('gov2.q3')}</p>
      <p className="kv-muted">{t.t('gov2.apps.lead')}</p>
      <form method="get" action="/applications" className="kv-form" data-kv-filters="" aria-label={t.t('gov2.apps.filter.label')}>
        <label htmlFor="apps-scheme" className="kv-field__label">{t.t('gov2.apps.filter.scheme')}</label>
        <select id="apps-scheme" className="kv-select" name="scheme" defaultValue={scheme ?? ''}>
          <option value="">{t.t('gov2.apps.filter.allSchemes')}</option>
          {schemes.map((s) => <option key={s.id} value={s.id}>{`${s.name} (${ltrText(s.code, lang)})`}</option>)}
        </select>
        <label htmlFor="apps-status" className="kv-field__label">{t.t('gov2.apps.filter.status')}</label>
        <select id="apps-status" className="kv-select" name="status" defaultValue={status ?? ''} data-kv-status-filter="">
          <option value="">{t.t('gov2.apps.filter.allStatuses')}</option>
          {GOV_LISTED_STATUSES.map((s) => <option key={s} value={s}>{t.t(statusKey(s))}</option>)}
        </select>
        <button className="kv-btn" type="submit" data-kv-filter-apply="">{t.t('gov2.apps.filter.apply')}</button>
      </form>
      <States t={t} state={state} retry="/applications?do=reread&act=confirm" forbiddenKey="gov2.apps.forbidden" />
      {state === 'empty' ? <p className="kv-muted" data-kv-empty="no-application">{t.t('gov2.apps.empty')}</p> : null}
      {rows.length > 0 ? (
        <table className="kv-table" data-kv-applications={rows.length}>
          <thead><tr>
            <th scope="col">{t.t('gov2.apps.col.application')}</th><th scope="col">{t.t('gov2.apps.col.scheme')}</th>
            <th scope="col">{t.t('gov2.apps.col.version')}</th><th scope="col">{t.t('gov2.apps.col.status')}</th>
            <th scope="col">{t.t('gov2.apps.col.submitted')}</th><th scope="col">{t.t('gov2.apps.col.decided')}</th>
          </tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} data-kv-application={a.id} data-kv-app-status={a.status}>
                <th scope="row"><a className="kv-link" href={`/applications/${a.id}`} data-kv-open={a.id}>{shortId(a.id)}</a></th>
                <td>{`${a.scheme.name} (${ltrText(a.scheme.code, lang)})`}</td>
                <td>{t.t('gov2.versionN', { n: String(a.schemeVersion) })}</td>
                <td>{t.t(statusKey(a.status))}</td>
                <td>{dash(t, ltrOrNull(atUtc(a.submittedAt), lang))}</td>
                <td>{dash(t, ltrOrNull(atUtc(a.decidedAt), lang))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="kv-pager">
        {cursor ? <a className="kv-link" href={listHref({ status, scheme })} data-kv-page-first="">{t.t('gov2.apps.first')}</a> : null}
        {state === 'ok' && nextCursor ? <> <a className="kv-btn" href={listHref({ status, scheme, cursor: nextCursor })} data-kv-page-next="">{t.t('gov2.apps.next')}</a></> : null}
      </p>
      <Gov2Refusals t={t} surface="applications" />
    </section>
  );
}

function Fact({ t, k, id, children }: { t: Tr; k: string; id: string; children: ReactNode }) {
  return <div className="kv-facts__row" data-kv-field={id}><dt>{t.t(k)}</dt><dd>{children}</dd></div>;
}

/** W331 — one application: what the read gives, the acts as offers. */
export function ApplicationDetailView({ t, state, me, id, app, facts = null, decision = null }: {
  t: Tr; state: AppState; me: GovMe; id: string; app: GovApplicationOpened | null; facts?: ActFacts | null; decision?: DecisionFact;
}) {
  const a = state === 'ok' ? app : null;
  const acts: GovActName[] = a ? offeredActs(me, a.status, facts) : [];
  return (
    <section data-kv-page="application" data-kv-state={state}>
      <p className="kv-pager"><a className="kv-link" href="/applications" data-kv-nav="list">{t.t('gov2.app.backToList')}</a></p>
      <h1>{a ? `${t.t('gov2.app.title')} ${shortId(a.id)}` : t.t('gov2.app.title')}</h1>
      <p className="kv-statement" data-kv-statement="gov2.q2">{t.t('gov2.q2')}</p>
      <p className="kv-statement" data-kv-statement="gov2.q1">{t.t('gov2.q1')}</p>
      <p className="kv-statement" data-kv-statement="gov2.q3">{t.t('gov2.q3')}</p>
      <States t={t} state={state} retry={`/applications/${encodeURIComponent(id)}?do=reread&act=confirm`} forbiddenKey="gov2.apps.forbidden" />
      {state === 'not_found' ? <p className="kv-notice" data-kv-notice="not-found">{t.t('gov2.app.notFound')}</p> : null}
      {a ? (
        <>
          <dl className="kv-facts">
            <Fact t={t} k="gov2.app.number" id="number">{shortId(a.id)}</Fact>
            <Fact t={t} k="gov2.app.scheme" id="scheme"><a className="kv-link" href={`/schemes/${a.scheme.id}`}>{`${a.scheme.name} (${a.scheme.code})`}</a></Fact>
            <Fact t={t} k="gov2.app.status" id="status"><span data-kv-app-status={a.status}>{t.t(statusKey(a.status))}</span></Fact>
            <Fact t={t} k="gov2.app.version" id="version">{t.t('gov2.versionN', { n: String(a.schemeVersion) })}</Fact>
            <Fact t={t} k="gov2.app.submitted" id="submitted">{dash(t, atUtc(a.submittedAt))}</Fact>
            <Fact t={t} k="gov2.app.decided" id="decided">{dash(t, atUtc(a.decidedAt))}</Fact>
          </dl>
          <p className="kv-muted" data-kv-fact="version-pin">{t.t('gov2.app.versionRule', { n: String(a.schemeVersion) })}</p>
          <p className="kv-muted" data-kv-fact="history">{t.t('gov2.app.history')}</p>
          <h2 className="kv-card__title">{t.t('gov2.app.fields')}</h2>
          {a.formDeclared && a.form.length > 0 ? (
            <ul data-kv-fields={a.form.length}>
              {a.form.map((f) => (
                <li key={f.key} data-kv-form-field={f.key} data-kv-personal={f.personal ? 'yes' : 'no'}>
                  {f.label}: {dash(t, asStored(f.value))}{f.personal ? <span className="kv-fine"> ({t.t('gov2.app.personal')})</span> : null}
                </li>
              ))}
            </ul>
          ) : <p data-kv-fields="none">{t.t('gov2.app.noFields', { n: String(a.schemeVersion) })}</p>}
          <h2 className="kv-card__title" id="decide">{t.t('gov2.app.acts')}</h2>
          {!canCheck(me) ? <p className="kv-muted" data-kv-role-note="read-only">{t.t('gov2.app.readOnly')}</p> : null}
          {canCheck(me) && !canDecide(me) ? <p className="kv-muted" data-kv-role-note="head-decides">{t.t('gov2.app.headDecides')}</p> : null}
          {decision ? <p className="kv-notice" data-kv-decision-fact={decision}>{t.t(decision === 'no_head' ? 'gov2.app.fact.noHead' : 'gov2.app.fact.alone')}</p> : null}
          {acts.length > 0 ? (
            <ul className="kv-actions" data-kv-acts="application">
              {acts.map((x) => <li key={x}><a className="kv-btn" href={actHref(a.id, x)} data-kv-offer={x}>{t.t(`gov2.act.${x}`)}</a></li>)}
            </ul>
          ) : canCheck(me) ? <p className="kv-muted" data-kv-no-acts="">{t.t('gov2.app.noActs')}</p> : null}
          {acts.includes('approve') && facts === null ? <p className="kv-muted" data-kv-fact="cannot-tell">{t.t('gov2.app.cannotTell')}</p> : null}
        </>
      ) : null}
      <Gov2Refusals t={t} surface="application" />
    </section>
  );
}

/** The act's confirm form (W3159): the key minted when it was shown; reject — a listed reason and a sentence; clarify — a sentence. The form
 *  carries the id, the act, the key and (reject / clarify) the reason and the sentence — nothing else. */
export function ActForm({ t, appId, act, idemKey, action }: { t: Tr; appId: string; act: GovActName; idemKey: string; action: Action }) {
  return (
    <form action={formAction(action)} className="kv-form" data-kv-form={act}>
      <input type="hidden" name="id" value={appId} />
      <input type="hidden" name="act" value={act} />
      <input type="hidden" name="key" value={idemKey} />
      <p data-kv-form-app="">{t.t('gov2.form.application', { id: shortId(appId) })}</p>
      {act === 'approve' ? <p className="kv-statement" data-kv-statement="gov2.q1">{t.t('gov2.q1')}</p> : null}
      {act === 'reject' ? (
        <>
          <label htmlFor="act-reason" className="kv-field__label">{t.t('gov2.form.reasonCode')}</label>
          <select id="act-reason" className="kv-select" name="reasonCode" required defaultValue="" data-kv-reasons={REJECTION_CODES.length}>
            <option value="" disabled>{t.t('gov2.form.chooseReason')}</option>
            {REJECTION_CODES.map((c) => <option key={c} value={c}>{t.t(`gov2.reason.${c}`)}</option>)}
          </select>
        </>
      ) : null}
      {act === 'reject' || act === 'clarify' ? (
        <>
          <label htmlFor="act-note" className="kv-field__label">{t.t(act === 'reject' ? 'gov2.form.note' : 'gov2.form.question')}</label>
          <textarea id="act-note" className="kv-textarea" name="note" minLength={10} maxLength={500} required />
        </>
      ) : null}
      <button className="kv-btn" type="submit" data-kv-confirm={act}>{t.t(`gov2.form.confirm.${act}`)}</button>
    </form>
  );
}

/** ?act=success — the status the SERVER returned. */
export function ActDoneNote({ t, status }: { t: Tr; status: string | null }) {
  return <p className="kv-success" data-kv-done={status ?? 'unknown'}>{t.t('gov2.form.done', { status: t.t(statusKey(status ?? '')) })}</p>;
}
/** ?act=failure — the named refusal; nothing changed. */
export function ActFailureNote({ t, error }: { t: Tr; error: string }) {
  const code = ACT_ERRORS[error] ? error : 'ACT_FAILED';
  return (
    <>
      <p className="kv-error" role="alert" data-kv-error={code}>{t.t(ACT_ERRORS[code])}</p>
      <p className="kv-muted">{t.t('gov2.form.nothingChanged')}</p>
    </>
  );
}
