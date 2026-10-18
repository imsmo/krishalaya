// apps/web-partner/src/components/partner1/SettingsView.tsx · PC-56 PARTNER-1a · founder D5 — ORGANISATION SETTINGS (canon W269), presentational.
//
// Identity from `/v1/partner/me` (legal name, partner kind "(fixed)", the regulator reference MASKED by the API, the partner code); the
// published decision promise (`sla.decision_hours`, set only by the platform — admin realm) beside the actual latency from the dashboard read,
// or "not published yet"; the TEAM over PARTNER-0's `/v1/partner/team` (administrators only): each member's name, role, authenticator app
// yes/no, joined — no mail address, no "last active", no hardware-key column; pending invites with Revoke; Remove a member (both with their
// own confirm and a reason); the invite chain (W3006–W3008, REAL); "Save changes" is DECOR (W3002–W3005: nothing here is writable by a
// partner). The truths printed as they are: one person may hold more than one role (0225 UNIQUE (user, partner, ROLE)) — so the canon's
// "maker and checker can never be the same person" is refused; "application reads are logged" (PARTNER-0's audit rows) is TRUE.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatDate } from '@krishalaya/i18n';
import type { PartnerDashboard, PartnerMe, PartnerTeam } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { RefusalList } from './RefusalList';
import { hoursText } from '../../features/partner1/dashboard';
import { actErrorKey, REASON_MIN, roleKey } from '../../features/partner1/settings';

export type TeamState = { kind: 'ok'; team: PartnerTeam } | { kind: 'admins_only' } | { kind: 'error' };
export interface SettingsViewProps {
  t: Tr; lang: string; me: PartnerMe | null; sla: PartnerDashboard['sla'] | null; team: TeamState;
  invite: ReactNode | null; notice?: { done?: 'revoked' | 'removed' | null; failed?: string | null };
}

const day = (v: string | null, lang: string) => (v ? formatDate(v, lang, { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }) : '');

export function SettingsView({ t, lang, me, sla, team, invite, notice }: SettingsViewProps) {
  const org = me?.organisation ?? null;
  const promise = org?.slaDecisionHours ?? null;
  const median = sla ? hoursText(sla.medianSec) : null; const p90 = sla ? hoursText(sla.p90Sec) : null;
  return (
    <section data-kv-settings={org ? 'ok' : 'error'}>
      <h1>{t.t('partner1.settings.title')}</h1>
      {notice?.done && <p className="kv-success" role="status">{t.t(`partner1.act.done.${notice.done}`)}</p>}
      {notice?.failed && <p className="kv-error" role="alert" data-kv-failed={notice.failed}>{t.t(actErrorKey(notice.failed), { min: REASON_MIN })}</p>}

      <div className="kv-card" data-kv-identity>
        <h2 className="kv-card__title">{t.t('partner1.settings.identity')}</h2>
        {!org ? <p role="alert">{t.t('partner1.settings.error')}</p> : (
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('partner1.settings.legalName')}</dt><dd>{org.name}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('partner1.settings.kind')}</dt><dd>{org.kind} <span className="kv-muted">{t.t('partner1.settings.kindFixed')}</span></dd></div>
            <div className="kv-facts__row"><dt>{t.t('partner1.settings.regulatorRef')}</dt><dd>{org.regulatorRefMasked ?? t.t('partner1.settings.notRecorded')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('partner1.settings.code')}</dt><dd>{org.code}</dd></div>
          </dl>
        )}
      </div>

      <div className="kv-card" data-kv-sla={promise ?? 'none'}>
        <h2 className="kv-card__title">{t.t('partner1.settings.slaTitle')}</h2>
        <p>{promise === null ? t.t('partner1.dash.slaNone') : t.t('partner1.dash.slaPromise', { hours: promise })}</p>
        {sla && <p>{median === null || p90 === null ? t.t('partner1.dash.slaActualNone', { days: sla.windowDays })
          : t.t('partner1.dash.slaActual', { days: sla.windowDays, median, p90, count: sla.decided })}</p>}
        <p className="kv-field__hint">{t.t('partner1.settings.slaWho')}</p>
      </div>

      <div className="kv-card" data-kv-team={team.kind}>
        <h2 className="kv-card__title">{t.t('partner1.settings.teamTitle')}</h2>
        {team.kind === 'admins_only' && <p>{t.t('partner1.settings.teamAdminsOnly')}</p>}
        {team.kind === 'error' && <p role="alert">{t.t('partner1.settings.teamError')}</p>}
        {team.kind === 'ok' && (
          <>
            {team.team.members.filter((m) => m.active).length <= 1 && <p className="kv-muted">{t.t('partner1.settings.teamNone')}</p>}
            <table className="kv-table">
              <thead><tr>
                <th scope="col">{t.t('partner1.settings.colName')}</th><th scope="col">{t.t('partner1.settings.colRole')}</th>
                <th scope="col">{t.t('partner1.settings.colTotp')}</th><th scope="col">{t.t('partner1.settings.colJoined')}</th><th scope="col">{t.t('partner1.settings.colActions')}</th>
              </tr></thead>
              <tbody>{team.team.members.filter((m) => m.active).map((m) => (
                <tr key={m.membershipId} data-kv-member={m.membershipId}>
                  <td>{m.name ?? t.t('partner1.settings.unnamed')}</td>
                  <td>{t.t(roleKey(m.roleCode))}</td>
                  <td>{t.t(m.twoFactor ? 'partner1.settings.totpYes' : 'partner1.settings.totpNo')}</td>
                  <td>{day(m.since, lang)}</td>
                  <td><Link className="kv-btn--link" href={`/account/settings?act=remove_member&id=${encodeURIComponent(m.membershipId)}`}>{t.t('partner1.settings.remove')}</Link></td>
                </tr>
              ))}</tbody>
            </table>
            <h3>{t.t('partner1.settings.invitesTitle')}</h3>
            {team.team.invites.length === 0 ? <p>{t.t('partner1.settings.invitesNone')}</p> : (
              <ul className="kv-list">{team.team.invites.map((i) => (
                <li key={i.id} data-kv-invite-row={i.id}>
                  {i.phoneMasked} · {t.t(roleKey(i.roleCode))} · {t.t('partner1.settings.inviteExpires', { date: day(i.expiresAt, lang) })}
                  {i.sendFailure === 'platform_handover' && <span className="kv-muted"> · {t.t('partner1.settings.inviteHandover')}</span>}{' '}
                  <Link className="kv-btn--link" href={`/account/settings?act=revoke_invite&id=${encodeURIComponent(i.id)}`}>{t.t('partner1.settings.revoke')}</Link>
                </li>
              ))}</ul>
            )}
            {invite}
          </>
        )}
        <p className="kv-field__hint">{t.t('partner1.settings.rolesTruth')}</p>
        <p className="kv-field__hint">{t.t('partner1.settings.logged')}</p>
      </div>

      <div className="kv-card" data-kv-decor="save">
        <p><Link className="kv-btn kv-btn--muted" href="/account/settings?form=review">{t.t('partner1.settings.save')}</Link></p>
        <p className="kv-field__hint">{t.t('partner1.settings.saveRefused')}</p>
      </div>

      <RefusalList t={t} surface="settings" />
    </section>
  );
}

/** The revoke-invite / remove-member confirm: what will happen, a reason (≥ REASON_MIN), Confirm posts to the server action; Cancel goes back. */
export function ActConfirm({ t, act, id, subject, action }: {
  t: Tr; act: 'revoke_invite' | 'remove_member'; id: string; subject: { phone?: string; name?: string; role: string } | null; action: string | ((fd: FormData) => void);
}) {
  if (!subject) {
    return <section className="kv-card" data-kv-act={act} data-kv-act-missing><p>{t.t('partner1.act.notFound')}</p><p><Link className="kv-btn" href="/account/settings">{t.t('partner1.act.cancel')}</Link></p></section>;
  }
  const revoke = act === 'revoke_invite';
  return (
    <section className="kv-card kv-chain" data-kv-act={act}>
      <h1>{t.t(revoke ? 'partner1.revoke.title' : 'partner1.remove.title')}</h1>
      <p>{revoke ? t.t('partner1.revoke.body', { phone: subject.phone ?? '', role: t.t(roleKey(subject.role)), min: REASON_MIN })
        : t.t('partner1.remove.body', { name: subject.name ?? t.t('partner1.settings.unnamed'), role: t.t(roleKey(subject.role)), min: REASON_MIN })}</p>
      <form action={action as never} className="kv-form">
        <input type="hidden" name="act" value={act} />
        <input type="hidden" name="id" value={id} />
        <label className="kv-field" htmlFor="p1-reason"><span className="kv-field__label">{t.t('partner1.reason')}</span>
          <textarea id="p1-reason" name="reason" className="kv-input" required minLength={REASON_MIN} maxLength={500} />
        </label>
        <button type="submit" className={`kv-btn${revoke ? '' : ' kv-btn--danger'}`}>{t.t('partner1.act.proceed')}</button>{' '}
        <Link className="kv-btn kv-btn--muted" href="/account/settings">{t.t('partner1.act.cancel')}</Link>
      </form>
    </section>
  );
}
