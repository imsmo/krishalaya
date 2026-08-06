// apps/web-admin/src/app/support/csat/[id]/page.tsx · ONE RATING, reviewed (PC-56 ADMIN-2c, canon W056 + W2121-25).
//
// THE SCREEN THIS WAVE EXISTED TO MAKE POSSIBLE. ADMIN-2 could show a score and had to state in capital letters that
// there were no written comments, because `support_tickets` held a 1–5 integer and nothing else. Migration 0099 turned
// that column into an append-only ledger, so this page can show the farmer's own words, in the language they wrote them,
// at the time they wrote them.
//
// AND IT SHOWS THE THING THAT WAS BEING DESTROYED. `support_tickets.csat_score` is cleared on reopen, so a rating a
// farmer gave was DELETED the moment the desk reopened their ticket — and a reopen is most likely after a bad rating. The
// "every rating this ticket has had" section is that history. A 1 that became a 4 after the desk fixed something is the
// single most useful thing a lead can see here, and until now it was thrown away.
//
// THREE THINGS THIS PAGE REFUSES TO BLUR:
//   1. A DERIVED TIMESTAMP IS MARKED ON THE ROW. 0099's backfill had no rating time to copy. A caveat at the top of a
//      page does not travel with the row somebody screenshots, so the marker sits in the cell.
//   2. COACHING IS OFFERED ONLY WHERE IT IS COHERENT. After a verdict of `product_at_fault` the coaching form is NOT
//      rendered — coaching an agent for a product failure contradicts the verdict just filed. The reason is stated;
//      maker-checker by absence, not a disabled button.
//   3. "NO COMMENT" IS NOT "NO FEEDBACK". A score with no words is the common case and says so plainly.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { reviewCsatAction, createCoachingAction } from '../../actions';
import {
  CSAT_VERDICTS, COACHING_KINDS, verdictSupportsCoaching, MIN_FINDING, MIN_RATIONALE,
  type CsatRow, type ReviewRow, type CoachingRow,
} from '../../../../features/support/review';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rev.title'), robots: { index: false, follow: false } };
}

interface ResponseView {
  response: CsatRow & {
    subject?: string | null; ticketStatusNow?: string; statusWhenRated?: string;
    ratedAgentUserId?: string | null; tenantId: string;
  };
  reviews: ReviewRow[];
  ticketHistory: CsatRow[];
  agentCoaching: CoachingRow[];
}

const SCORE_CLASS = (n: number) => (n <= 2 ? 'kv-status--danger' : n === 3 ? 'kv-status--warn' : 'kv-status--ok');

export default async function CsatReviewPage(
  { params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string; why?: string } },
) {
  requireAdmin();
  const t = getTranslator();

  let view: ResponseView | null = null; let notice: string | undefined;
  try { view = (await adminGet<ResponseView>(`support/csat/${encodeURIComponent(params.id)}`)).data ?? null; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  if (!view) {
    return (
      <section>
        <p className="kv-backlink"><Link href="/support/insights/csat">{t.t('support.back')}</Link></p>
        <p className="kv-error" role="alert">{notice ?? t.t('rev.notFound')}</p>
      </section>
    );
  }

  const r = view.response;
  const reviews = view.reviews ?? [];
  const history = view.ticketHistory ?? [];
  const latestVerdict = reviews[0]?.verdict ?? null;
  // coaching is offered only after a verdict that actually blames the agent
  const coachingCoherent = !!latestVerdict && verdictSupportsCoaching(latestVerdict);

  const okKey = searchParams.ok;
  const errKey = searchParams.error?.startsWith('rev_') ? searchParams.error.slice(4)
    : searchParams.error?.startsWith('coach_') ? searchParams.error.slice(6) : searchParams.error;
  const errNs = searchParams.error?.startsWith('coach_') ? 'coach' : 'rev';

  return (
    <section>
      <p className="kv-backlink"><Link href="/support/insights/csat">{t.t('support.back')}</Link></p>
      <h1>{t.t('rev.title')}</h1>
      <p className="kv-muted">{t.t('rev.lead')}</p>

      {okKey && <p className="kv-success" role="status">{t.t(`rev.ok.${okKey}`)}</p>}
      {errKey && (
        <p className="kv-error" role="alert">
          {errKey === 'rejected'
            // the server's 422 says WHY coaching was refused; paraphrasing would lose the reason
            ? (searchParams.why ?? t.t('coach.error.generic'))
            : t.t(`${errNs}.error.${errKey}`)}
        </p>
      )}

      {/* ---------------- the rating ---------------- */}
      <h2>{t.t('rev.ratingHeading')}</h2>
      <dl className="kv-detail">
        <dt>{t.t('rev.score')}</dt>
        <dd><span className={`kv-status ${SCORE_CLASS(r.score)}`}>{r.score}/5</span></dd>
        <dt>{t.t('rev.ticket')}</dt>
        <dd>
          <Link href={`/support/tickets/${encodeURIComponent(r.ticketId)}`}>{r.ticketNo ?? r.ticketId.slice(0, 8)}</Link>
          {r.subject ? <> — {r.subject}</> : null}
        </dd>
        <dt>{t.t('rev.tenant')}</dt><dd>{r.tenantSlug ?? r.tenantId}</dd>
        <dt>{t.t('rev.when')}</dt>
        <dd>
          {r.ratedAt}
          {/* marked on the row, not only in a note at the top */}
          {r.ratedAtIsEstimated && <> <span className="kv-status kv-status--warn">{t.t('rev.estimated')}</span></>}
        </dd>
        <dt>{t.t('rev.statusWhenRated')}</dt><dd>{r.statusWhenRated ?? t.t('common.dash')}</dd>
        <dt>{t.t('rev.statusNow')}</dt><dd>{r.ticketStatusNow ?? t.t('common.dash')}</dd>
        <dt>{t.t('rev.agent')}</dt><dd>{r.ratedAgentUserId ?? t.t('common.dash')}</dd>
        <dt>{t.t('rev.words')}</dt>
        <dd>
          {r.comment
            ? <>{r.comment} <span className="kv-detail__muted">({t.t('rev.language')}: {r.commentLanguage ?? t.t('common.dash')})</span></>
            // a score with no words is the common case, and it is not "no feedback"
            : <span className="kv-detail__muted">{t.t('rev.noWords')}</span>}
        </dd>
      </dl>

      {/* ---------------- every rating this ticket has had ---------------- */}
      <h2>{t.t('rev.historyTitle')}</h2>
      <p className="kv-field__hint">{t.t('rev.historyHint')}</p>
      {history.length <= 1 ? <p className="kv-empty">{t.t('rev.historyOne')}</p> : (
        <table className="kv-table">
          <thead><tr>
            <th scope="col">{t.t('rev.score')}</th>
            <th scope="col">{t.t('rev.when')}</th>
            <th scope="col">{t.t('rev.statusWhenRated')}</th>
            <th scope="col">{t.t('rev.words')}</th>
          </tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id ?? h.ratedAt}>
                <td><span className={`kv-status ${SCORE_CLASS(h.score)}`}>{h.score}/5</span></td>
                <td>
                  {h.ratedAt}
                  {h.ratedAtIsEstimated && <> <span className="kv-status kv-status--warn">{t.t('rev.estimated')}</span></>}
                </td>
                <td>{(h as any).ticketStatus ?? t.t('common.dash')}</td>
                <td>{h.comment ?? <span className="kv-detail__muted">{t.t('rev.noWords')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ---------------- verdicts already filed ---------------- */}
      <h2>{t.t('rev.reviewsTitle')}</h2>
      {reviews.length === 0 ? <p className="kv-empty">{t.t('rev.reviewsNone')}</p> : (
        <table className="kv-table">
          <thead><tr>
            <th scope="col">{t.t('rev.verdict')}</th>
            <th scope="col">{t.t('rev.finding')}</th>
            <th scope="col">{t.t('rev.reviewer')}</th>
            <th scope="col">{t.t('rev.reviewedAt')}</th>
            <th scope="col">{t.t('rev.coachingLinked')}</th>
          </tr></thead>
          <tbody>
            {reviews.map((rv) => (
              <tr key={rv.id}>
                <td>{t.t(`rev.verdict.${rv.verdict}`)}</td>
                <td>{rv.finding}</td>
                <td>{rv.reviewerAdminId}</td>
                <td>{rv.reviewedAt}</td>
                <td>{rv.coachingId
                  ? <span className="kv-status kv-status--ok">{t.t('rev.coachingLinked')}</span>
                  : t.t('common.dash')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ---------------- file a verdict ---------------- */}
      <details className="kv-card kv-limit-form" open={reviews.length === 0}>
        <summary className="kv-card__title">{t.t('rev.fileTitle')}</summary>
        <p className="kv-field__hint">{t.t('rev.fileHint')}</p>
        <form action={reviewCsatAction} className="kv-form">
          <input type="hidden" name="id" value={params.id} />
          <label htmlFor="verdict" className="kv-field__label">{t.t('rev.verdict')}</label>
          <select id="verdict" name="verdict" className="kv-input" required defaultValue="">
            <option value="" disabled>{t.t('rev.chooseVerdict')}</option>
            {CSAT_VERDICTS.map((v) => <option key={v} value={v}>{t.t(`rev.verdict.${v}`)}</option>)}
          </select>
          <label htmlFor="finding" className="kv-field__label">{t.t('rev.finding')}</label>
          <textarea id="finding" name="finding" className="kv-input" rows={3} required minLength={MIN_FINDING} maxLength={4000} />
          <button type="submit" className="kv-btn">{t.t('rev.file')}</button>
        </form>
      </details>

      {/* ---------------- coaching, only where it is coherent ---------------- */}
      {latestVerdict && (
        coachingCoherent ? (
          <details className="kv-card kv-limit-form">
            <summary className="kv-card__title">{t.t('coach.newTitle')}</summary>
            <p className="kv-notice" role="note">{t.t('rev.coachingAvailable')}</p>
            <p className="kv-field__hint">{t.t('coach.newHint')}</p>
            <form action={createCoachingAction} className="kv-form">
              <input type="hidden" name="returnTo" value={`/support/csat/${params.id}`} />
              <input type="hidden" name="agentUserId" value={r.ratedAgentUserId ?? ''} />
              <input type="hidden" name="tenantId" value={r.tenantId} />
              <input type="hidden" name="csatResponseId" value={params.id} />
              <input type="hidden" name="csatReviewId" value={reviews[0]?.id ?? ''} />
              <label htmlFor="kind" className="kv-field__label">{t.t('coach.chooseKind')}</label>
              <select id="kind" name="kind" className="kv-input" defaultValue="shadow_session">
                {COACHING_KINDS.filter((k) => k !== 'signal_dismissed').map((k) => (
                  <option key={k} value={k}>{t.t(`coach.kind.${k}`)}</option>
                ))}
              </select>
              <label htmlFor="scheduledFor" className="kv-field__label">{t.t('coach.scheduledFor')}</label>
              <input id="scheduledFor" name="scheduledFor" type="datetime-local" className="kv-input" />
              <label htmlFor="rationale" className="kv-field__label">{t.t('coach.rationale')}</label>
              <textarea id="rationale" name="rationale" className="kv-input" rows={3} required minLength={MIN_RATIONALE} maxLength={4000} />
              <button type="submit" className="kv-btn kv-btn--danger">{t.t('coach.create')}</button>
            </form>
          </details>
        ) : (
          // NOT a disabled button: the control is absent and the reason is stated
          <p className="kv-notice" role="note">{t.t('rev.coachingUnavailable')}</p>
        )
      )}

      {/* ---------------- close the signal without acting ---------------- */}
      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('coach.dismissTitle')}</summary>
        <p className="kv-field__hint">{t.t('coach.dismissHint')}</p>
        <form action={createCoachingAction} className="kv-form">
          <input type="hidden" name="returnTo" value={`/support/csat/${params.id}`} />
          <input type="hidden" name="kind" value="signal_dismissed" />
          <input type="hidden" name="agentUserId" value={r.ratedAgentUserId ?? ''} />
          <input type="hidden" name="tenantId" value={r.tenantId} />
          <input type="hidden" name="csatResponseId" value={params.id} />
          <label htmlFor="dismiss-rationale" className="kv-field__label">{t.t('coach.rationale')}</label>
          <textarea id="dismiss-rationale" name="rationale" className="kv-input" rows={3} required minLength={MIN_RATIONALE} maxLength={4000} />
          <button type="submit" className="kv-btn kv-btn--muted">{t.t('coach.dismiss')}</button>
        </form>
      </details>

      <p className="kv-field__hint"><Link href="/support/coaching">{t.t('support.coachingLink')}</Link></p>
    </section>
  );
}
