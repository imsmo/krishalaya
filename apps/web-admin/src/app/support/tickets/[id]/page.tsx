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
import { escalateTicketAction, resolveTicketAction } from '../../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('support.detailTitle'), robots: { index: false, follow: false } };
}

const SEV_CLASS: Record<string, string> = { P0: 'kv-status--danger', P1: 'kv-status--danger', P2: 'kv-status--warn', P3: 'kv-status--muted' };
const OK = new Set(['escalated', 'resolved']);
const ERR = new Set(['severity', 'reassign', 'reason', 'outcome', 'invalid', 'illegal', 'elevation', 'notFound', 'generic']);

export default async function TicketDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
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

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const sev = severityKey(ticket.severity);
  const statusK = ticketStatusKey(ticket.status);
  const slaK = slaKey(ticket.sla);
  const raiseTargets = higherSeverities(sev);

  return (
    <section>
      <p className="kv-backlink"><Link href="/support">{t.t('support.back')}</Link></p>
      <h1>{ticket.ticketNo}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`support.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`support.error.${errKey}`)}</p>}
      {slaK === 'breached' && <p className="kv-error" role="alert">{t.t('support.breachedNote')}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('support.subject')}</dt><dd>{ticket.subject ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.tenant')}</dt><dd>{ticket.tenantId ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.severity')}</dt><dd><span className={`kv-status ${SEV_CLASS[sev]}`}>{t.t(`support.sev.${sev}`)}</span></dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.status')}</dt><dd>{t.t(`support.state.${statusK}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.sla')}</dt><dd><span className={`kv-status ${slaK === 'breached' ? 'kv-status--danger' : 'kv-status--ok'}`}>{t.t(`support.slaState.${slaK}`)}</span></dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.channel')}</dt><dd>{ticket.channel}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.assignee')}</dt><dd>{ticket.assigneeUserId ?? t.t('support.unassigned')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.firstResponseDue')}</dt><dd>{ticket.slaFirstResponseDue ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.resolutionDue')}</dt><dd>{ticket.slaResolutionDue ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('support.createdAt')}</dt><dd>{ticket.createdAt ?? t.t('common.dash')}</dd></div>
      </dl>

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
          <button type="submit" className="kv-btn kv-btn--danger">{t.t('support.escalate')}</button>
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
          <p className="kv-notice" role="note">{t.t('support.replyGap')}</p>
          <label htmlFor="outcome" className="kv-field__label">{t.t('support.outcome')}</label>
          <textarea id="outcome" name="outcome" className="kv-input" rows={3} required minLength={10} maxLength={2000} />
          <button type="submit" className="kv-btn">{t.t('support.resolve')}</button>
        </form>
      ) : <p className="kv-muted">{t.t('support.escalateClosed')}</p>}
    </section>
  );
}
