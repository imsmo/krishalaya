// apps/web-admin/src/app/support/tickets/[id]/page.tsx · support ticket detail + computed SLA state + the one
// consequential write (escalate). Server component: requireAdmin gates, fetches GET /v1/support/tickets/:id
// (404 → notFound). Escalation (raise severity / move to 'escalated' / reassign to a platform lead) is offered
// only when the ticket is still escalatable (features/support mirrors the state machine; a resolved/closed ticket
// can't be escalated) as a Server-Action form carrying a mandatory audit reason; admin-api re-authorises with
// support.oversight.manage + FIDO2 + step-up, so a 403 degrades to a re-auth notice. Money-free. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { ticketStatusKey, severityKey, slaKey, canEscalate, higherSeverities, type TicketRow } from '../../../../features/support/ticket';
import {
  REPLY_LANGUAGES, MIN_BODY, deliveredCount, stuckRows, stateTone, stateKey, type ReplyRow,
} from '../../../../features/support/reply';
import { escalateTicketAction, resolveTicketAction, replyToFarmerAction } from '../../actions';

import { Button, Callout, EmptyState, StatusPill, type StatusTone } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('support.detailTitle'), robots: { index: false, follow: false } };
}

const SEV_TONE: Record<string, StatusTone> = { P0: 'danger', P1: 'danger', P2: 'warning', P3: 'neutral' };
const OK = new Set(['escalated', 'resolved', 'queued']);
const ERR = new Set(['severity', 'reassign', 'reason', 'outcome', 'invalid', 'illegal', 'elevation', 'notFound', 'generic']);
// PC-56 ADMIN-2d: the reply form's own error namespace (prep_*), plus the server's verbatim 422
const REPLY_ERR = new Set(['body', 'bodyLong', 'language', 'rejected']);

export default async function TicketDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string; why?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let ticket: TicketRow | undefined; let notice: string | undefined;
  try { ticket = (await adminGet<TicketRow>(`support/tickets/${encodeURIComponent(params.id)}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  if (!ticket) {
    return <section><p className="kv-backlink"><Link href="/support">{t.t('support.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  // PC-56 ADMIN-2d. Fetched separately and allowed to fail on its own (Law 12): the reply history is important, and a
  // ticket an operator needs to read must not go dark because one extra read broke.
  let replies: ReplyRow[] = []; let repliesUnavailable = false;
  try {
    const res = await adminGet<{ items: ReplyRow[] }>(`support/tickets/${encodeURIComponent(params.id)}/replies`);
    replies = res.data?.items ?? [];
  } catch { repliesUnavailable = true; }
  const delivered = deliveredCount(replies);
  const stuck = stuckRows(replies);

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const replyErr = searchParams.error?.startsWith('prep_') ? searchParams.error.slice(5) : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const sev = severityKey(ticket.severity);
  const statusK = ticketStatusKey(ticket.status);
  const slaK = slaKey(ticket.sla);
  const raiseTargets = higherSeverities(sev);

  return (
    <section>
      <p className="kv-backlink"><Link href="/support">{t.t('support.back')}</Link></p>
      <h1>{ticket.ticketNo}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(okKey === 'queued' ? 'prep.ok.queued' : `support.ok.${okKey}`)}</p>}
      {replyErr && (
        <p className="kv-error" role="alert">
          {replyErr === 'rejected'
            ? t.t('prep.error.rejected', { why: searchParams.why ?? '' })
            : t.t(`prep.error.${REPLY_ERR.has(replyErr) ? replyErr : 'generic'}`)}
        </p>
      )}
      {errKey && <p className="kv-error" role="alert">{t.t(`support.error.${errKey}`)}</p>}
      {slaK === 'breached' && <p className="kv-error" role="alert">{t.t('support.breachedNote')}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('support.subject')}</dt><dd>{ticket.subject ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.tenant')}</dt><dd>{ticket.tenantId ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.severity')}</dt><dd><StatusPill tone={SEV_TONE[sev] ?? 'neutral'} label={t.t(`support.sev.${sev}`)} /></dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.status')}</dt><dd>{t.t(`support.state.${statusK}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.sla')}</dt><dd><StatusPill tone={slaK === 'breached' ? 'danger' : 'success'} label={t.t(`support.slaState.${slaK}`)} /></dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.channel')}</dt><dd>{ticket.channel}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.assignee')}</dt><dd>{ticket.assigneeUserId ?? t.t('support.unassigned')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.firstResponseDue')}</dt><dd>{ticket.slaFirstResponseDue ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.resolutionDue')}</dt><dd>{ticket.slaResolutionDue ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.createdAt')}</dt><dd>{ticket.createdAt ?? t.t('common.dash')}</dd></div>
      </dl>

      {/* ---------------- PC-56 ADMIN-2d · the platform's own replies ---------------- */}
      <h2>{t.t('prep.historyTitle')}</h2>
      {repliesUnavailable ? (
        <p className="kv-error" role="alert">{t.t('notice.generic')}</p>
      ) : replies.length === 0 ? (
        <EmptyState title={t.t('prep.none')} />
      ) : (
        <>
          {/* what the farmer RECEIVED, not what was written — the operator would otherwise read the list as answers */}
          <p className="kv-field__hint">
            {t.t('prep.deliveredOf', { delivered: String(delivered), total: String(replies.length) })}
          </p>
          {stuck.length > 0 && (
            <p className="kv-error" role="alert">{t.t('prep.stuckWarn', { n: String(stuck.length) })}</p>
          )}
          <table className="kv-table">
            <thead><tr>
              <th scope="col">{t.t('prep.when')}</th>
              <th scope="col">{t.t('prep.state')}</th>
              <th scope="col">{t.t('prep.words')}</th>
              <th scope="col">{t.t('prep.language')}</th>
              <th scope="col">{t.t('prep.author')}</th>
            </tr></thead>
            <tbody>
              {replies.map((r) => (
                <tr key={r.id}>
                  <td>{r.queuedAt}</td>
                  <td>
                    <StatusPill tone={stateTone(r.status)} label={t.t(`prep.state.${stateKey(r.status)}`)} />
                    {/* the server's own sentence about this row, so the console cannot invent a cheerier wording */}
                    {r.stateNote ? <> <span className="kv-detail__muted">{r.stateNote}</span></> : null}
                  </td>
                  <td>{r.body}</td>
                  <td>{r.languageCode ? t.t(`prep.lang.${r.languageCode}`) : t.t('common.dash')}</td>
                  <td><code>{String(r.authorAdminId ?? '').slice(0, 8) || t.t('common.dash')}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="kv-field__hint">{t.t('prep.smsNote')}</p>

      <details className="kv-card kv-limit-form">
        <summary className="kv-card__title">{t.t('prep.title')}</summary>
        <p className="kv-field__hint">{t.t('prep.lead')}</p>
        {/* the tenant can read this. Said BEFORE the box, not after it. */}
        <Callout>{t.t('prep.visibleToTenant')}</Callout>
        {/* and pressing the button does not send */}
        <Callout>{t.t('prep.queuedWarn')}</Callout>
        <form action={replyToFarmerAction} className="kv-form">
          <input type="hidden" name="id" value={ticket.id} />
          <label htmlFor="reply-language" className="kv-field__label">{t.t('prep.language')}</label>
          <select id="reply-language" name="languageCode" className="kv-input" required defaultValue="">
            <option value="" disabled>{t.t('prep.language')}</option>
            {REPLY_LANGUAGES.map((l) => <option key={l} value={l}>{t.t(`prep.lang.${l}`)}</option>)}
          </select>
          <p className="kv-field__hint">{t.t('prep.languageHint')}</p>
          <label htmlFor="reply-body" className="kv-field__label">{t.t('prep.body')}</label>
          <textarea id="reply-body" name="body" className="kv-input" rows={4} required minLength={MIN_BODY} maxLength={4000} />
          <p className="kv-field__hint">{t.t('prep.bodyHint')}</p>
          <Button type="submit">{t.t('prep.send')}</Button>
        </form>
      </details>

      <h2>{t.t('support.escalateHeading')}</h2>
      {canEscalate(statusK) ? (
        <form action={escalateTicketAction} className="kv-card kv-action-card">
          <input type="hidden" name="id" value={ticket.id} />
          <p className="kv-field__hint">{t.t('support.escalateNote')}</p>
          <label htmlFor="severity" className="kv-field__label">{t.t('support.raiseSeverity')}</label>
          <select id="severity" name="severity" className="kv-input" defaultValue="">
            <option value="">{t.t('support.keepSeverity')}</option>
            {raiseTargets.map((s) => <option key={s} value={s}>{t.t(`support.sev.${s}`)}</option>)}
          </select>
          <label htmlFor="reassignToUserId" className="kv-field__label">{t.t('support.reassign')}</label>
          <input id="reassignToUserId" name="reassignToUserId" className="kv-input" placeholder={t.t('support.reassignHint')} />
          <label htmlFor="escalateReason" className="kv-field__label">{t.t('support.reason')}</label>
          <input id="escalateReason" name="reason" className="kv-input" required minLength={3} maxLength={1000} />
          <Button type="submit" variant="danger">{t.t('support.escalate')}</Button>
        </form>
      ) : <p className="kv-muted">{t.t('support.escalateClosed')}</p>}

      {/* PC-56 ADMIN-2b · RESOLVE from the oversight plane (canon W049). The outcome is mandatory: a ticket closed from
          outside the tenant's own desk with nothing saying what was done is unanswerable when the farmer comes back.
          Maker-checker by ABSENCE — on a terminal ticket the form is not rendered at all rather than disabled. */}
      <h2>{t.t('support.resolveTitle')}</h2>
      {canEscalate(statusK) ? (
        <form action={resolveTicketAction} className="kv-card kv-action-card">
          <input type="hidden" name="id" value={ticket.id} />
          <p className="kv-field__hint">{t.t('support.resolveHint')}</p>
          {/* Said where an operator would otherwise assume the farmer has been answered. */}
          <Callout>{t.t('support.replyGap')}</Callout>
          <label htmlFor="outcome" className="kv-field__label">{t.t('support.outcome')}</label>
          <textarea id="outcome" name="outcome" className="kv-input" rows={3} required minLength={10} maxLength={2000} />
          <Button type="submit">{t.t('support.resolve')}</Button>
        </form>
      ) : <p className="kv-muted">{t.t('support.escalateClosed')}</p>}
    </section>
  );
}
