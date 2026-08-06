// apps/web-tenant/src/app/governance/page.tsx · cooperative governance / AGM (PC-55 B8, on W54-7).
// Resolutions, the ballot, and the tally — the paperwork a cooperative actually runs on.
//
// THREE THINGS THIS PAGE IS CAREFUL ABOUT:
//   1. "OPEN" IS NOT ALWAYS "ACCEPTING VOTES". A resolution can be open with a window that has not started or has
//      already closed. The page states which, because a member who taps and is refused assumes the platform broke.
//   2. A CLOSED VOTE OFFERS NO WAY BACK. The API has no re-open transition, and this page renders none — re-opening
//      after members have seen a tally is how a cooperative's trust dies.
//   3. A DIVIDEND VOTE HAS NOT PAID ANYBODY. Carrying the vote authorises a payout run (PC-55 A8), which is a
//      separate, separately-gated act with its own maker-checker. The page says that instead of letting a green tally
//      imply money moved.
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import {
  RESOLUTION_TYPES, RESOLUTION_STATUSES, VOTE_CHOICES,
  hasPayoutConsequence, isResolutionStatus, offeredTransition, shareBps, sortTally, totalVotes, voteBlockedReason, votingLive,
  type ResolutionRow, type TallyRow,
} from '../../features/governance/agm';
import { castVoteAction, createResolutionAction, transitionResolutionAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gov.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['created', 'open', 'closed', 'voted']);
const ERR = new Set(['generic', 'forbidden', 'notFound', 'illegal', 'invalid',
  'res_title', 'res_type', 'res_body', 'res_opens', 'res_closes', 'res_windowOrder', 'res_choice', 'res_to']);

export default async function GovernancePage({ searchParams }: {
  searchParams: { status?: string; id?: string; ok?: string; error?: string };
}) {
  await requireSession('/governance');
  const t = getTranslator();
  const lang = getLang();
  const nowIso = new Date().toISOString();
  const status = isResolutionStatus(searchParams.status) ? searchParams.status : undefined;
  const openId = (searchParams.id ?? '').trim();

  let rows: ResolutionRow[] = []; let failed = false;
  try { rows = (await tenantClient().memberships.resolutions(status)) as ResolutionRow[]; }
  catch { failed = true; }

  // The results read is per-resolution, so it loads only for the one being inspected (and degrades on its own).
  let results: { resolution?: ResolutionRow; tally?: TallyRow[] } | null = null;
  if (openId) {
    try { results = await tenantClient().memberships.resolutionResults(openId); }
    catch { results = null; }
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <h1>{t.t('gov.title')}</h1>
      <p className="kv-field__hint">{t.t('gov.hint')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`gov.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`gov.error.${errKey}`)}</p>}

      <nav className="kv-tabs" aria-label={t.t('gov.filter')}>
        <a href="/governance" className={`kv-tab${!status ? ' kv-tab--active' : ''}`} aria-current={!status ? 'page' : undefined}>{t.t('gov.all')}</a>
        {RESOLUTION_STATUSES.map((s) => (
          <a key={s} href={`/governance?status=${s}`} className={`kv-tab${s === status ? ' kv-tab--active' : ''}`} aria-current={s === status ? 'page' : undefined}>{t.t(`gov.state.${s}`)}</a>
        ))}
      </nav>

      {failed ? <p className="kv-error" role="alert">{t.t('gov.loadError')}</p> : rows.length === 0 ? (
        <p className="kv-field__hint">{t.t('gov.empty')}</p>
      ) : rows.map((r) => {
        const live = votingLive(r, nowIso);
        const blocked = voteBlockedReason(r, nowIso, false);
        const next = offeredTransition(r.status);
        return (
          <div key={String(r.id)} className="kv-card">
            <div className="kv-page-head">
              <strong>{String(r.title ?? '')}</strong>
              <span className="kv-badge">{t.t(`gov.state.${String(r.status)}`) || String(r.status)}</span>
            </div>
            <p className="kv-detail__muted">
              {t.t(`gov.type.${String(r.resolutionType)}`) || String(r.resolutionType ?? '')}
              {r.votingOpens ? ` · ${t.t('gov.opens')}: ${formatDate(String(r.votingOpens), lang, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
              {r.votingCloses ? ` · ${t.t('gov.closes')}: ${formatDate(String(r.votingCloses), lang, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
            </p>
            {r.body ? <p className="kv-detail__muted">{String(r.body)}</p> : null}

            {/* the state that looks live and is not */}
            {r.status === 'open' && !live && blocked !== 'none' ? <p className="kv-notice" role="note">{t.t(`gov.blocked.${blocked}`)}</p> : null}
            {hasPayoutConsequence(r.resolutionType) ? <p className="kv-field__hint">{t.t('gov.payoutNote')}</p> : null}

            <div className="kv-actions">
              {next ? (
                <form action={transitionResolutionAction} className="kv-inline-form">
                  <input type="hidden" name="id" value={String(r.id ?? '')} />
                  <input type="hidden" name="to" value={next} />
                  <button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">{t.t(`gov.to.${next}`)}</button>
                </form>
              ) : <span className="kv-detail__muted">{t.t('gov.finalNote')}</span>}
              <a href={`/governance?${status ? `status=${status}&` : ''}id=${encodeURIComponent(String(r.id ?? ''))}`} className="kv-btn--link">{t.t('gov.viewResults')}</a>
            </div>

            {live ? (
              <form action={castVoteAction} className="kv-form">
                <input type="hidden" name="id" value={String(r.id ?? '')} />
                <label htmlFor={`c-${r.id}`} className="kv-form__label">{t.t('gov.yourVote')}</label>
                <select id={`c-${r.id}`} name="choice" className="kv-field__input" required defaultValue="">
                  <option value="" disabled>{t.t('gov.chooseVote')}</option>
                  {VOTE_CHOICES.map((c) => <option key={c} value={c}>{t.t(`gov.choice.${c}`)}</option>)}
                </select>
                <p className="kv-detail__muted">{t.t('gov.oneBallotNote')}</p>
                <button type="submit" className="kv-btn">{t.t('gov.castBtn')}</button>
              </form>
            ) : null}

            {openId === String(r.id) ? (
              results ? (() => {
                const tally = sortTally(results.tally ?? []);
                const total = totalVotes(tally);
                return (
                  <div className="kv-card">
                    <strong>{t.t('gov.results')}</strong>
                    {total === 0 ? <p className="kv-detail__muted">{t.t('gov.noVotesYet')}</p> : (
                      <ul className="kv-account-list">
                        {tally.map((row) => {
                          const bps = shareBps(row.votes, total);
                          return (
                            <li key={String(row.choice)}>
                              {t.t(`gov.choice.${String(row.choice)}`) || String(row.choice)} — {String(row.votes ?? 0)}
                              {bps !== null ? ` (${(bps / 100).toFixed(1)} %)` : ''}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <p className="kv-detail__muted">{t.t('gov.tallyNote', { n: String(total) })}</p>
                  </div>
                );
              })() : <p className="kv-error" role="alert">{t.t('gov.loadError')}</p>
            ) : null}
          </div>
        );
      })}

      <h2>{t.t('gov.newTitle')}</h2>
      <form action={createResolutionAction} className="kv-form kv-form__card">
        <label htmlFor="g-title" className="kv-form__label">{t.t('gov.resTitle')}</label>
        <input id="g-title" name="title" className="kv-field__input" minLength={3} maxLength={200} required />
        <label htmlFor="g-type" className="kv-form__label">{t.t('gov.resType')}</label>
        <select id="g-type" name="resolutionType" className="kv-field__input" required>
          {RESOLUTION_TYPES.map((k) => <option key={k} value={k}>{t.t(`gov.type.${k}`)}</option>)}
        </select>
        <label htmlFor="g-body" className="kv-form__label">{t.t('gov.resBody')}</label>
        <textarea id="g-body" name="body" className="kv-field__input" rows={3} maxLength={8000} />
        <label htmlFor="g-opens" className="kv-form__label">{t.t('gov.opens')}</label>
        <input id="g-opens" name="votingOpens" type="datetime-local" className="kv-field__input" />
        <label htmlFor="g-closes" className="kv-form__label">{t.t('gov.closes')}</label>
        <input id="g-closes" name="votingCloses" type="datetime-local" className="kv-field__input" />
        <p className="kv-detail__muted">{t.t('gov.windowHint')}</p>
        <button type="submit" className="kv-btn">{t.t('gov.createBtn')}</button>
      </form>
      <p className="kv-field__hint kv-note">{t.t('gov.footerNote')}</p>
    </section>
  );
}
