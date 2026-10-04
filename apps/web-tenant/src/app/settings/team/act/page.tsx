// apps/web-tenant/src/app/settings/team/act/page.tsx · THE TEAM MUTATE CHAIN (W2335–W2337) for the acts beside "Invite staff" — PC-56
// TENANT-SW-c: REVOKE an invite (a reason 10–500) and ADD STAFF DIRECTLY — the exception act when an invite cannot be used, audited as
// such, with a reason; the seat is checked by the API and the database. "Retry" is a page load (refused by name as a mutation).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { DeskBoard, TeamOverview } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../lib/i18n';
import { mutateStep, mutateStepKey } from '../../../../features/mutate/chain';
import { REASON_MAX, REASON_MIN, TEAM_HREF, isTeamAct, isUuid, parseCodes, staffHref, swcCodeKey, swcPageState } from '../../../../features/swc/console';
import { AuditEntryCard } from '../../../people/ambassadors/AuditEntryCard';
import { addDirectlyAction, revokeInviteAction } from '../team-actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swc.teamAct.title'), robots: { index: false, follow: false } };
}

export default async function TeamActPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(TEAM_HREF);
  const t = getTranslator(); const lang = getLang();
  const act = isTeamAct(searchParams.act) && searchParams.act !== 'invite' ? searchParams.act : 'add_directly';
  const step = mutateStep(searchParams.step);
  const inviteId = isUuid(searchParams.inviteId) ? searchParams.inviteId : '';
  let ov: TeamOverview | null = null; let board: DeskBoard | null = null; let state: string | null = null;
  if (step === 'confirm' && act !== 'retry') {
    try { ov = await tenantClient().team.overview({ limit: 1 }); } catch (e) { const err = e instanceof SdkError ? e : null; state = swcPageState(err?.code, err?.status); }
    if (act === 'add_directly') { try { board = await tenantClient().desks.board(); } catch { board = null; } }
  }
  const invite = ov?.invites.find((i) => i.id === inviteId) ?? null;

  return (
    <section>
      <nav aria-label={t.t('swc.breadcrumb.label')} className="kv-field__hint">{t.t('dk.breadcrumb.settings')} › <Link href={TEAM_HREF} className="kv-btn--link">{t.t('swc.team.title')}</Link> › {t.t(`swc.teamAct.${act}.title`)}</nav>
      <h1>{t.t(`swc.teamAct.${act}.title`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('swc.chain.module')}</p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`swc.state.${state}.title`)}</strong><p>{t.t(`swc.state.${state}.body`)}</p></div>}
      {act === 'retry' && <p className="kv-card kv-card--notice">{t.t('swc.refused.retry')} <Link href={TEAM_HREF} className="kv-btn--link">{t.t('swc.chain.back')}</Link></p>}

      {step === 'confirm' && ov && act === 'revoke_invite' && (
        <div className="kv-card">
          {invite ? <p>{t.t('swc.teamAct.revoke_invite.object', { phone: invite.phoneMasked, role: invite.roleCode })}</p> : <p className="kv-error">{t.t('swc.code.INVITE_NOT_FOUND')}</p>}
          {invite && (
            <form action={revokeInviteAction} className="kv-form">
              <input type="hidden" name="inviteId" value={inviteId} />
              <label className="kv-field" htmlFor="rv-reason"><span>{t.t('swc.field.reason')}</span>
                <textarea id="rv-reason" name="reason" className="kv-textarea" rows={2} minLength={REASON_MIN} maxLength={REASON_MAX} required /></label>
              <p className="kv-field__hint">{t.t('swc.teamAct.revoke_invite.rule')}</p>
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('swc.teamAct.revoke_invite.proceed')}</button>{' '}<Link href={TEAM_HREF} className="kv-btn--link">{t.t('swc.chain.cancel')}</Link>
            </form>
          )}
        </div>
      )}

      {step === 'confirm' && ov && act === 'add_directly' && (
        <div className="kv-card">
          <p>{t.t('swc.teamAct.add_directly.lede')}</p>
          <form action={addDirectlyAction} className="kv-form">
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <label className="kv-field" htmlFor="ad-phone"><span>{t.t('swc.field.phone')}</span><input id="ad-phone" name="phone" type="tel" className="kv-input" required minLength={8} maxLength={20} /></label>
            <label className="kv-field" htmlFor="ad-name"><span>{t.t('swc.field.fullName')}</span><input id="ad-name" name="fullName" className="kv-input" maxLength={200} /></label>
            <label className="kv-field" htmlFor="ad-role"><span>{t.t('swc.field.role')}</span>
              <select id="ad-role" name="roleCode" className="kv-select" required defaultValue=""><option value="" disabled>{t.t('swc.field.roleChoose')}</option>{ov.staffRoles.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <fieldset className="kv-field"><legend>{t.t('swc.field.desks')}</legend>
              {(board?.desks ?? []).filter((d) => d.status === 'active').map((d) => <label key={d.id} className="kv-check"><input type="checkbox" name="deskIds" value={d.id} /> {d.name}</label>)}</fieldset>
            <label className="kv-field" htmlFor="ad-reason"><span>{t.t('swc.field.reason')}</span>
              <textarea id="ad-reason" name="reason" className="kv-textarea" rows={2} minLength={REASON_MIN} maxLength={REASON_MAX} required /></label>
            <p className="kv-field__hint">{t.t('swc.teamAct.add_directly.rule')}</p>
            <button type="submit" className="kv-btn kv-btn--primary">{t.t('swc.teamAct.add_directly.proceed')}</button>{' '}<Link href={TEAM_HREF} className="kv-btn--link">{t.t('swc.chain.cancel')}</Link>
          </form>
        </div>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-success" role="status">
            <strong>{t.t(`swc.teamAct.${act}.done`)}</strong>
            <p>{isUuid(searchParams.userId) && <Link href={staffHref(searchParams.userId)} className="kv-btn--link">{t.t('swc.teamAct.openStaff')}</Link>}{' '}<Link href={TEAM_HREF} className="kv-btn kv-btn--primary">{t.t('swc.chain.back')}</Link></p>
          </div>
          {act === 'revoke_invite' && inviteId && <AuditEntryCard t={t} lang={lang} entityType="staff_invite" entityId={inviteId} action="team.invite.revoked" />}
          {act === 'add_directly' && isUuid(searchParams.userId) && <AuditEntryCard t={t} lang={lang} entityType="user" entityId={searchParams.userId} action="team.staff.added_directly" />}
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('swc.chain.failure')}</strong>
          <ul className="kv-list">{(parseCodes(searchParams.error).length ? parseCodes(searchParams.error) : ['unknown']).map((c) => <li key={c}>{t.t(swcCodeKey(c))}</li>)}</ul>
          <p>{t.t('swc.chain.untouched')}</p>
          <p><Link href={`/settings/team/act?act=${act}${inviteId ? `&inviteId=${inviteId}` : ''}&step=confirm`} className="kv-btn--link">{t.t('swc.chain.retry')}</Link> <span className="kv-field__hint">{t.t('swc.refused.retry')}</span></p>
        </div>
      )}
    </section>
  );
}
