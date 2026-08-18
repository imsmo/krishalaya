// apps/web-admin/src/app/support/coaching/page.tsx · THE COACHING LEDGER (PC-56 ADMIN-2c, canon W2019-25).
//
// The canon shows two buttons on the agent-performance screen: "schedule a shadow session" and "dismiss a signal". They
// are the two halves of one act — a lead looking at a signal about a person and deciding. One decides to intervene, the
// other decides not to.
//
// STORING ONLY THE FIRST WOULD HAVE BEEN THE EASY BUILD AND THE WRONG ONE. A ledger that records every intervention and
// none of the deliberate non-interventions reads as a lead who acts on everything and ignores the rest, which is the
// opposite of what a careful lead does. So dismissals are recorded, with a reason, and shown here in their own section.
//
// WHAT THIS PAGE SAYS OUT LOUD, because the records are statements about named people's work:
//   • They are platform-only. The tenant whose staff they concern cannot read them — migration 0100 grants the tenant
//     role nothing on this table, so it is not a convention that could be forgotten.
//   • Nothing can be edited or deleted. Only a session's outcome may be added afterwards, once.
//   • A session past its time with no account of what happened is SURFACED, not left to look complete. A coaching
//     ledger full of unsettled sessions tells you nothing while appearing thorough.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { createCoachingAction, settleCoachingAction } from '../actions';
import { Button, Callout, EmptyState, StatusPill, type StatusTone } from '@krishalaya/ui';
import {
  COACHING_KINDS, SETTLE_STATUSES, splitCoaching, overdueSettlement,
  MIN_RATIONALE, MIN_OUTCOME, type CoachingRow,
} from '../../../features/support/review';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('coach.title'), robots: { index: false, follow: false } };
}

const STATE_TONE: Record<string, StatusTone> = {
  scheduled: 'warning', held: 'success', missed: 'danger',
  cancelled: 'neutral', closed: 'neutral',
};

export default async function CoachingPage(
  { searchParams }: { searchParams: { ok?: string; error?: string; why?: string; agentUserId?: string; tenantId?: string } },
) {
  requireAdmin();
  const t = getTranslator();

  let rows: CoachingRow[] = []; let notice: string | undefined;
  try {
    const res = await adminGet<{ items: CoachingRow[] }>('support/coaching', {
      agentUserId: searchParams.agentUserId, tenantId: searchParams.tenantId,
    });
    rows = res.data?.items ?? [];
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const { actions, dismissals } = splitCoaching(rows);
  const overdue = overdueSettlement(rows);
  const settleable = rows.filter((r) => r.status === 'scheduled');

  const okKey = searchParams.ok;
  const errKey = searchParams.error?.startsWith('coach_') ? searchParams.error.slice(6) : searchParams.error;

  const row = (c: CoachingRow) => (
    <tr key={c.id}>
      <td>{c.agentUserId}</td>
      <td>{c.tenantSlug ?? c.tenantId}</td>
      <td>{t.t(`coach.kind.${c.kind}`)}</td>
      <td><StatusPill tone={STATE_TONE[c.status] ?? 'neutral'} label={t.t(`coach.state.${c.status}`)} /></td>
      <td>{c.rationale}</td>
      <td>
        {/* the signal, shown as the thing it actually was rather than as an id */}
        {c.signalScore !== null && c.signalScore !== undefined
          ? <>
              <Link href={`/support/csat/${encodeURIComponent(String(c.csatResponseId))}`}>{c.signalScore}/5</Link>
              {c.signalComment ? <> <span className="kv-detail__muted">{c.signalComment}</span></> : null}
            </>
          : c.signalNote ?? t.t('common.dash')}
      </td>
      <td>{c.scheduledFor ?? t.t('common.dash')}</td>
      <td>
        {c.outcome
          ? c.outcome
          : c.status === 'scheduled'
            // named, because a blank cell here would read as "nothing to report"
            ? <span className="kv-detail__muted">{t.t('coach.noOutcomeYet')}</span>
            : t.t('common.dash')}
      </td>
      <td>{c.authorAdminId}</td>
    </tr>
  );

  const head = (
    <thead><tr>
      <th scope="col">{t.t('coach.agent')}</th>
      <th scope="col">{t.t('coach.tenant')}</th>
      <th scope="col">{t.t('coach.kind')}</th>
      <th scope="col">{t.t('coach.state')}</th>
      <th scope="col">{t.t('coach.rationale')}</th>
      <th scope="col">{t.t('coach.signal')}</th>
      <th scope="col">{t.t('coach.scheduledFor')}</th>
      <th scope="col">{t.t('coach.outcome')}</th>
      <th scope="col">{t.t('coach.author')}</th>
    </tr></thead>
  );

  return (
    <section>
      <p className="kv-backlink"><Link href="/support">{t.t('support.back')}</Link></p>
      <h1>{t.t('coach.title')}</h1>
      <p className="kv-muted">{t.t('coach.lead')}</p>
      {/* said before any record is shown, because it governs all of them */}
      <Callout>{t.t('coach.sensitiveNote')}</Callout>

      {okKey && <p className="kv-success" role="status">{t.t(`coach.ok.${okKey}`)}</p>}
      {errKey && (
        <p className="kv-error" role="alert">
          {errKey === 'rejected' ? (searchParams.why ?? t.t('coach.error.generic')) : t.t(`coach.error.${errKey}`)}
        </p>
      )}

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          {/* a session past its time with no account of itself is the record quietly failing */}
          {overdue.length > 0 && (
            <p className="kv-error" role="alert">{t.t('coach.overdueWarn', { n: String(overdue.length) })}</p>
          )}

          <h2>{t.t('coach.actionsTitle')}</h2>
          {actions.length === 0 ? <EmptyState title={t.t('coach.none')} /> : (
            <table className="kv-table">{head}<tbody>{actions.map(row)}</tbody></table>
          )}

          {/* Its own section, deliberately. Half the point of this ledger. */}
          <h2>{t.t('coach.dismissalsTitle')}</h2>
          {dismissals.length === 0 ? <EmptyState title={t.t('coach.none')} /> : (
            <table className="kv-table">{head}<tbody>{dismissals.map(row)}</tbody></table>
          )}

          {/* ---------------- settle a session ---------------- */}
          {settleable.length > 0 && (
            <details className="kv-card kv-limit-form" open={overdue.length > 0}>
              <summary className="kv-card__title">{t.t('coach.settleTitle')}</summary>
              <p className="kv-field__hint">{t.t('coach.settleHint')}</p>
              <form action={settleCoachingAction} className="kv-form">
                <label htmlFor="settle-id" className="kv-field__label">{t.t('coach.kind')}</label>
                <select id="settle-id" name="id" className="kv-input" required defaultValue="">
                  <option value="" disabled>{t.t('coach.chooseKind')}</option>
                  {settleable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {t.t(`coach.kind.${c.kind}`)} · {c.agentUserId.slice(0, 8)} · {c.scheduledFor ?? ''}
                    </option>
                  ))}
                </select>
                <label htmlFor="settle-status" className="kv-field__label">{t.t('coach.settleStatus')}</label>
                <select id="settle-status" name="status" className="kv-input" defaultValue="held">
                  {SETTLE_STATUSES.map((s) => <option key={s} value={s}>{t.t(`coach.settle.${s}`)}</option>)}
                </select>
                <label htmlFor="settle-outcome" className="kv-field__label">{t.t('coach.outcome')}</label>
                <textarea id="settle-outcome" name="outcome" className="kv-input" rows={3} minLength={MIN_OUTCOME} maxLength={4000} />
                <Button type="submit">{t.t('coach.settle')}</Button>
              </form>
            </details>
          )}

          {/* ---------------- record coaching not tied to a rating ---------------- */}
          <details className="kv-card kv-limit-form">
            <summary className="kv-card__title">{t.t('coach.newTitle')}</summary>
            <p className="kv-field__hint">{t.t('coach.newHint')}</p>
            <form action={createCoachingAction} className="kv-form">
              <input type="hidden" name="returnTo" value="/support/coaching" />
              <label htmlFor="new-kind" className="kv-field__label">{t.t('coach.chooseKind')}</label>
              <select id="new-kind" name="kind" className="kv-input" defaultValue="shadow_session">
                {COACHING_KINDS.map((k) => <option key={k} value={k}>{t.t(`coach.kind.${k}`)}</option>)}
              </select>
              <label htmlFor="new-agent" className="kv-field__label">{t.t('coach.agentId')}</label>
              <input id="new-agent" name="agentUserId" className="kv-input" required />
              <label htmlFor="new-tenant" className="kv-field__label">{t.t('coach.tenantId')}</label>
              <input id="new-tenant" name="tenantId" className="kv-input" required />
              <label htmlFor="new-when" className="kv-field__label">{t.t('coach.scheduledFor')}</label>
              <input id="new-when" name="scheduledFor" type="datetime-local" className="kv-input" />
              <label htmlFor="new-signal" className="kv-field__label">{t.t('coach.signalNote')}</label>
              <input id="new-signal" name="signalNote" className="kv-input" maxLength={2000} />
              <p className="kv-field__hint">{t.t('coach.signalNoteHint')}</p>
              <label htmlFor="new-rationale" className="kv-field__label">{t.t('coach.rationale')}</label>
              <textarea id="new-rationale" name="rationale" className="kv-input" rows={3} required minLength={MIN_RATIONALE} maxLength={4000} />
              <Button type="submit" variant="danger">{t.t('coach.create')}</Button>
            </form>
          </details>
        </>
      )}
    </section>
  );
}
