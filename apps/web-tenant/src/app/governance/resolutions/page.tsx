// apps/web-tenant/src/app/governance/resolutions/page.tsx · W198 · RESOLUTIONS & VOTING · PC-56 TENANT-9b.
// (canon slug `insights/governance/resolutions`; the live governance area `/governance` is kept and redirects here.)
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • the OPEN cards — the live tally against TODAY's roll (an open vote IS today's), the rule fixed when voting opened,
//     the member's own ballot (this console never casts a vote for anybody: `ctx.userId` only, no "on behalf");
//   • PAST RESOLUTIONS — keyset-paged, GET-form filters (status / type / year); each row's result is its SNAPSHOT — the
//     roll recorded at close, the quorum fixed at open, the outcome the DATABASE wrote — or "not recorded" (F-13: before 9b
//     a closed AGM's turnout and "passed" were recomputed against today's roll every time somebody looked);
//   • "Draft resolution (board)" → the form chain; each row's open / close / withdraw / edit → the mutate / form chain;
//   • "How app voting works", "If it passes", the footer — every clause either TRUE or refused by name with its reason;
//   • six states: the content, Loading (loading.tsx), Flagged off, Restricted, Couldn't load (Retry = a page load), and the
//     two empty states in words.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { ResolutionCatalogue, ResolutionResults, ResolutionRow } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { env } from '../../../lib/env';
import {
  NEW_RESOLUTION_HREF, REGISTER_HREF, RESOLUTIONS_HREF, RESOLUTION_STATUSES, RESOLUTION_TYPES, actHref, actKey, actsFor, basisKey, bpPercent,
  choiceKey, editHref, formulaLine, govState, listFilters, listHref, majorityKey, outcomeKey, ruleVars, statusKey, typeKey,
} from '../../../features/governance/resolutions';
import { castVoteAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('res.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['voted', 'changed']);
const VOTE_ERR = new Set(['undeclared', 'notOpen', 'ineligible', 'generic']);

export default async function ResolutionsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(RESOLUTIONS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const filters = listFilters(searchParams);
  const sp = (k: string) => (typeof searchParams[k] === 'string' ? (searchParams[k] as string) : '');

  if (!env.featureMemberships) {
    return (
      <section>
        <h1>{t.t('res.title')}</h1>
        <div className="kv-card kv-card--notice" role="status"><strong>{t.t('res.state.flaggedOff.title')}</strong><p>{t.t('res.state.flaggedOff.body')}</p></div>
      </section>
    );
  }

  const m = tenantClient().memberships;
  let state: 'flaggedOff' | 'restricted' | 'notFound' | 'error' | null = null;
  let page: { items: ResolutionRow[]; nextCursor: string | null; zone: string | null } = { items: [], nextCursor: null, zone: null };
  let open: ResolutionRow[] = [];
  try {
    [page, { items: open }] = await Promise.all([
      m.resolutionsPage({ ...filters, limit: 20 }),
      m.resolutionsPage({ status: 'open', limit: 10 }),
    ]);
  } catch (e) { const err = e instanceof SdkError ? e : null; state = govState(err?.code, err?.status, true); }

  let cat: ResolutionCatalogue | null = null;
  // Can the caller DRAFT? The API's own review answers it (NO_PERMISSION) — the console never guesses a permission.
  let canDraft = false;
  const results = new Map<string, ResolutionResults>();
  if (!state) {
    const [c, pv, ...rs] = await Promise.allSettled([
      m.resolutionCatalogue(),
      m.previewResolution({}),
      ...open.map((r) => m.resolutionResults(r.id)),
    ]);
    if (c.status === 'fulfilled') cat = c.value as ResolutionCatalogue;
    canDraft = pv.status === 'fulfilled' && !(pv.value as { refusals: Array<{ code: string }> }).refusals.some((x) => x.code === 'NO_PERMISSION');
    rs.forEach((r, i) => { if (r.status === 'fulfilled') results.set(open[i].id, r.value as ResolutionResults); });
  }
  const dt = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: page.zone ?? undefined }) : null);
  const n = (v: number) => formatNumber(v, lang);
  const okKey = OK.has(sp('ok')) ? sp('ok') : null;
  const voteErr = VOTE_ERR.has(sp('voteError')) ? sp('voteError') : null;

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('res.breadcrumb')}><Link href={REGISTER_HREF}>{t.t('res.breadcrumb.governance')}</Link> / <span aria-current="page">{t.t('res.title')}</span></nav>
      <div className="kv-page-head">
        <h1>{t.t('res.title')}</h1>
        {canDraft && <Link href={`${NEW_RESOLUTION_HREF}?step=edit`} className="kv-btn kv-btn--primary">{t.t('res.draftBoard')}</Link>}
      </div>
      <p className="kv-field__hint">{t.t('res.hint')}</p>
      <nav className="kv-tabs" aria-label={t.t('res.tabs')}>
        <span className="kv-tab kv-tab--active" aria-current="page">{t.t('reg.tab.resolutions')}</span>
        <Link href={REGISTER_HREF} className="kv-tab">{t.t('reg.tab.register')}</Link>
      </nav>
      {okKey && <p className="kv-success" role="status">{t.t(`res.ok.${okKey}`)}</p>}
      {voteErr && <p className="kv-error" role="alert">{t.t(`res.voteError.${voteErr}`, { reason: sp('reason') ? t.t(`reg.notEligible.${['too_few_shares', 'too_new', 'suspended', 'not_a_member'].includes(sp('reason')) ? sp('reason') : 'not_a_member'}`, { n: Number(sp('short') || 0), d: sp('from') ? (formatDate(sp('from'), lang, { dateStyle: 'medium' }) ?? '') : '' }) : '' })}</p>}

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <strong>{t.t(`res.state.${state}.title`)}</strong>
          <p>{t.t(`res.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={listHref(filters)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('res.loadAgain')}</Link> <span className="kv-field__hint">{t.t('res.refused.retry')}</span></p>}
          {state === 'error' && <p className="kv-field__hint">{t.t('res.refused.memberApp')}</p>}
        </div>
      )}

      {!state && !canDraft && (
        <div className="kv-card kv-card--notice" role="note"><strong>{t.t('res.state.restricted.title')}</strong><p>{t.t('res.state.restricted.body')}</p><p className="kv-field__hint">{t.t('res.refused.board')}</p></div>
      )}

      {!state && (
        <>
          <h2>{t.t('res.openTitle')}</h2>
          {open.length === 0 ? (
            <div className="kv-card">
              <strong>{t.t('res.empty.open.title')}</strong>
              <p className="kv-detail__muted">{t.t('res.empty.open.body')}</p>
              {canDraft && <Link href={`${NEW_RESOLUTION_HREF}?step=edit`} className="kv-btn kv-btn--sm">{t.t('res.draft')}</Link>}
            </div>
          ) : open.map((r) => {
            const res = results.get(r.id);
            const tally = res?.result.tally ?? null;
            const rule = ruleVars(res?.result.rule ?? null);
            const f = formulaLine(r.payload, cat?.currency ?? null);
            const vote = (c: string) => tally?.byChoice.find((x) => x.choice === c)?.votes ?? 0;
            return (
              <article key={r.id} id={`r-${r.id}`} className="kv-card" aria-labelledby={`h-${r.id}`}>
                <p className="kv-badge">{t.t('res.openBadge')}</p>
                <h3 id={`h-${r.id}`}>{r.title}</h3>
                <p className="kv-detail__muted">
                  {t.t(typeKey(r.resolutionType))} · {t.t(majorityKey(r.majority))}
                  {r.votingCloses ? ` · ${t.t('res.closes', { when: dt(r.votingCloses) ?? '' })}` : ` · ${t.t('res.noClose')}`}
                </p>
                {r.body && <p>{r.body}</p>}
                {f && <p className="kv-field__hint">{t.t('res.payload')} {t.t(f.key, f.vars)}</p>}
                <p className="kv-field__hint">{t.t('res.refused.perLanguageText')}</p>
                {tally ? (
                  <dl className="kv-tiles">
                    <div className="kv-tile"><dt>{t.t('res.tile.cast')}</dt><dd><strong>{n(tally.cast)}</strong> / {n(tally.eligible)}</dd>
                      <dd className="kv-field__hint">{bpPercent(tally.turnoutBp)} · {t.t(tally.quorumMet ? 'res.tile.quorumMet' : 'res.tile.quorumNotMet', { q: bpPercent(tally.quorumBp) ?? '—' })}</dd></div>
                    <div className="kv-tile"><dt>{t.t('res.tile.inFavour')}</dt><dd><strong>{n(vote('for'))}</strong></dd>
                      <dd className="kv-field__hint">{tally.inFavourBp === null ? t.t('res.tile.noVotes') : t.t('res.tile.ofCast', { pct: bpPercent(tally.inFavourBp) ?? '' })}</dd></div>
                    <div className="kv-tile"><dt>{t.t('res.tile.againstAbstain')}</dt><dd><strong>{n(vote('against'))} / {n(vote('abstain'))}</strong></dd></div>
                  </dl>
                ) : <p className="kv-error" role="alert">{t.t('res.tallyUnavailable')}</p>}
                {rule && <p className="kv-field__hint">{t.t(rule.key, rule.vars)} · {t.t(res?.result.ruleFixedAt === 'open' ? 'res.rule.fixedAtOpen' : 'res.rule.fixedLater')}</p>}
                <p className="kv-field__hint">{t.t('res.liveNote')}</p>
                {(res?.choices.length ?? 0) > 0 && (
                  <form action={castVoteAction} className="kv-form">
                    <input type="hidden" name="id" value={r.id} />
                    <fieldset className="kv-fieldset">
                      <legend>{t.t('res.yourVote')}</legend>
                      {res!.choices.map((c) => (
                        <label key={c} className="kv-radio" htmlFor={`v-${r.id}-${c}`}>
                          <input type="radio" id={`v-${r.id}-${c}`} name="choice" value={c} required /> {t.t(choiceKey(c))}
                        </label>
                      ))}
                    </fieldset>
                    <p className="kv-field__hint">{t.t('res.yourVoteNote')}</p>
                    <button type="submit" className="kv-btn">{t.t('res.castBtn')}</button>
                  </form>
                )}
                {canDraft && (
                  <p className="kv-actions">{actsFor(r.status).map((a) => <Link key={a} href={actHref(r.id, a)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t(actKey(a))}</Link>)}</p>
                )}
              </article>
            );
          })}

          <h2>{t.t('res.pastTitle')}</h2>
          <form action={RESOLUTIONS_HREF} method="get" className="kv-card kv-form kv-filters" aria-label={t.t('res.filter')}>
            <label className="kv-field" htmlFor="f-status"><span>{t.t('res.filter.status')}</span>
              <select id="f-status" name="status" className="kv-select" defaultValue={filters.status ?? ''}>
                <option value="">{t.t('res.filter.any')}</option>
                {RESOLUTION_STATUSES.map((s) => <option key={s} value={s}>{t.t(statusKey(s))}</option>)}
              </select></label>
            <label className="kv-field" htmlFor="f-type"><span>{t.t('res.filter.type')}</span>
              <select id="f-type" name="type" className="kv-select" defaultValue={filters.type ?? ''}>
                <option value="">{t.t('res.filter.any')}</option>
                {RESOLUTION_TYPES.map((s) => <option key={s} value={s}>{t.t(typeKey(s))}</option>)}
              </select></label>
            <label className="kv-field" htmlFor="f-year"><span>{t.t('res.filter.year')}</span>
              <input id="f-year" name="year" className="kv-input" inputMode="numeric" pattern="\d{4}" maxLength={4} defaultValue={filters.year ? String(filters.year) : ''} /></label>
            <p className="kv-field__hint">{t.t('res.filter.yearHint', { zone: page.zone ?? '—' })}</p>
            <button type="submit" className="kv-btn kv-btn--sm">{t.t('res.filter.apply')}</button>{' '}
            <Link href={RESOLUTIONS_HREF} className="kv-btn--link">{t.t('res.filter.clear')}</Link>
          </form>
          {page.items.length === 0 ? (
            <div className="kv-card"><strong>{t.t('res.empty.past.title')}</strong><p className="kv-detail__muted">{t.t('res.empty.past.body')}</p></div>
          ) : (
            <table className="kv-table">
              <caption className="kv-detail__muted">{t.t('res.tableCaption', { n: n(page.items.length) })}</caption>
              <thead><tr>
                <th scope="col">{t.t('res.col.resolution')}</th><th scope="col">{t.t('res.col.type')}</th><th scope="col">{t.t('res.col.status')}</th>
                <th scope="col">{t.t('res.col.result')}</th><th scope="col">{t.t('res.col.turnout')}</th><th scope="col">{t.t('res.col.acts')}</th>
              </tr></thead>
              <tbody>{page.items.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.title}<span className="kv-field__hint"> · {t.t(majorityKey(r.majority))}{r.closedAt ? ` · ${t.t('res.closedOn', { when: dt(r.closedAt) ?? '' })}` : ''}</span></th>
                  <td>{t.t(typeKey(r.resolutionType))}{r.resolutionType === 'board_election' && <span className="kv-field__hint"> · {t.t('res.refused.boardElection')}</span>}</td>
                  <td>{t.t(statusKey(r.status))}</td>
                  <td>
                    {r.status === 'closed' ? <strong>{t.t(outcomeKey(r.result.outcome))}</strong> : r.status === 'open' ? t.t('res.result.running', { n: n(r.result.cast) }) : <span className="kv-field__hint">{t.t('res.result.none')}</span>}
                    <span className="kv-field__hint"> · {t.t(basisKey(r.result.basis))}</span>
                  </td>
                  <td>
                    {r.status === 'closed'
                      ? (r.result.turnoutBp === null
                        ? <span className="kv-field__hint">{t.t('res.turnout.notRecorded', { cast: n(r.result.cast) })}</span>
                        : <>{bpPercent(r.result.turnoutBp)} <span className="kv-field__hint">({n(r.result.cast)} / {n(r.result.eligibleAtClose ?? 0)} · {r.result.quorumBp === null ? t.t('res.quorum.notRecorded') : t.t(r.result.quorumMet ? 'res.tile.quorumMet' : 'res.tile.quorumNotMet', { q: bpPercent(r.result.quorumBp) ?? '—' })})</span></>)
                      : <span className="kv-field__hint">{t.t('res.turnout.notYet')}</span>}
                  </td>
                  <td>
                    {canDraft && r.status === 'draft' && <><Link href={editHref(r.id)} className="kv-btn--link">{t.t('res.edit')}</Link>{' · '}</>}
                    {canDraft && actsFor(r.status).map((a, i) => <span key={a}>{i > 0 ? ' · ' : ''}<Link href={actHref(r.id, a)} className="kv-btn--link">{t.t(actKey(a))}</Link></span>)}
                    {actsFor(r.status).length === 0 && <span className="kv-field__hint">{t.t('res.final')}</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
          {page.nextCursor && <p><Link href={listHref(filters, page.nextCursor)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('res.nextPage')}</Link></p>}

          <h2>{t.t('res.how.title')}</h2>
          <ol className="kv-steps">
            <li>{t.t('res.how.1')} <span className="kv-field__hint">{t.t('res.refused.smsVoice')} {t.t('res.refused.noticePeriod')}</span></li>
            <li>{t.t('res.how.2')} <span className="kv-field__hint">{t.t('res.refused.voiceReadout')}</span></li>
            <li>{t.t('res.how.3')} <span className="kv-field__hint">{t.t('res.refused.paperBallot')}</span></li>
          </ol>
          <h2>{t.t('res.passes.title')}</h2>
          <p>{t.t('res.passes.body')}</p>
          <p className="kv-field__hint">{t.t('res.refused.payoutConsole')} {t.t('res.refused.smsResult')}</p>
          <p className="kv-field__hint kv-note">{t.t('res.footer')}</p>
          <p className="kv-field__hint">{t.t('res.refused.autoClose')} {t.t('res.refused.closingSoon')}</p>
        </>
      )}
    </section>
  );
}
