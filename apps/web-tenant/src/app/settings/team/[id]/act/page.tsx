// apps/web-tenant/src/app/settings/team/[id]/act/page.tsx · THE STAFF CHAINS — PC-56 TENANT-SW-c.
//   • the FORM chain W2768–W2771 ("Save changes"): add an OVERRIDE — the assignment, the permission, grant or deny, WHY (10–500, required —
//     F-15) and an optional expiry; a money / PII grant becomes a proposal a SECOND administrator confirms (the page says which codes);
//   • the MUTATE chain W2772–W2774: Remove from team (reason required; the REAL session bound printed), revoke an override (reason),
//     record / lift a conflict declaration (reason), confirm / refuse a privileged-override proposal; "Retry" is a page load, refused by name.
// confirm → success (with the audit entry the act wrote) → failure (every refusal by name; nothing written). Server component.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { StaffDetail } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../lib/i18n';
import { mutateStep, mutateStepKey } from '../../../../../features/mutate/chain';
import {
  CONFLICT_RELATIONS, REASON_MAX, REASON_MIN, isStaffAct, isUuid, parseCodes, relationKey, sessionBoundVars, staffActHref, staffHref, swcCodeKey, swcPageState,
} from '../../../../../features/swc/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { declareConflictForAction, liftConflictAction, overrideAction, proposalAction, removeAction, revokeOverrideAction } from '../../team-actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swc.staffAct.title'), robots: { index: false, follow: false } };
}

export default async function StaffActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  await requireSession(staffHref(params.id));
  const t = getTranslator(); const lang = getLang();
  const act = isStaffAct(searchParams.act) ? searchParams.act : 'override';
  const step = mutateStep(searchParams.step);
  let s: StaffDetail | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state && step === 'confirm' && act !== 'retry') { try { s = await tenantClient().team.staff(params.id); } catch (e) { const err = e instanceof SdkError ? e : null; state = swcPageState(err?.code, err?.status, true); } }
  let members: Array<{ userId: string; name: string | null; roles: string[] }> = [];
  const q = (searchParams.q ?? '').slice(0, 60);
  if (s && act === 'declare_conflict') { try { members = (await tenantClient().team.members(q)).filter((m) => m.userId !== s!.userId).slice(0, 20); } catch { members = []; } }
  const back = staffHref(params.id);
  const hidden = <input type="hidden" name="userId" value={params.id} />;
  const reasonField = (id: string) => (
    <label className="kv-field" htmlFor={id}><span>{t.t('swc.field.reason')}</span>
      <textarea id={id} name="reason" className="kv-textarea" rows={2} minLength={REASON_MIN} maxLength={REASON_MAX} required /></label>);
  const staffAssignments = s ? s.assignments.filter((a) => a.isStaff && !a.revokedAt) : [];
  const bound = s ? sessionBoundVars(s.sessionEndBoundSec, s.accessTokenTtlSec) : null;

  return (
    <section>
      <nav aria-label={t.t('swc.breadcrumb.label')} className="kv-field__hint"><Link href={back} className="kv-btn--link">{s?.name ?? t.t('swc.staff.title')}</Link> › {t.t(`swc.staffAct.${act}.title`)}</nav>
      <h1>{t.t(`swc.staffAct.${act}.title`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('swc.chain.module')}</p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`swc.state.${state}.title`)}</strong><p>{t.t(`swc.state.${state}.body`)}</p></div>}
      {act === 'retry' && <p className="kv-card kv-card--notice">{t.t('swc.refused.retry')} <Link href={back} className="kv-btn--link">{t.t('swc.chain.back')}</Link></p>}

      {step === 'confirm' && s && act === 'override' && (
        <form action={overrideAction} className="kv-card kv-form">{hidden}
          <label className="kv-field" htmlFor="ov-utr"><span>{t.t('swc.field.assignment')}</span>
            <select id="ov-utr" name="userTenantRoleId" className="kv-select" required>{staffAssignments.map((a) => <option key={a.id} value={a.id}>{a.roleCode}</option>)}</select></label>
          <label className="kv-field" htmlFor="ov-code"><span>{t.t('swc.field.permission')}</span><input id="ov-code" name="permissionCode" className="kv-input" required pattern="[a-z][a-z0-9_.]{1,79}" /></label>
          <label className="kv-field" htmlFor="ov-grant"><span>{t.t('swc.field.grantOrDeny')}</span>
            <select id="ov-grant" name="isGranted" className="kv-select" defaultValue="true"><option value="true">{t.t('swc.staff.grant')}</option><option value="false">{t.t('swc.staff.deny')}</option></select></label>
          <label className="kv-field" htmlFor="ov-exp"><span>{t.t('swc.field.expiresAt')}</span><input id="ov-exp" name="expiresAt" type="datetime-local" className="kv-input" /></label>
          {reasonField('ov-reason')}
          <p className="kv-field__hint">{t.t('swc.staffAct.override.rule', { codes: Object.keys(s.checkerCodes).join(', ') })}</p>
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('swc.staffAct.override.proceed')}</button>{' '}<Link href={back} className="kv-btn--link">{t.t('swc.chain.cancel')}</Link>
        </form>
      )}

      {step === 'confirm' && s && act === 'revoke_override' && (
        <form action={revokeOverrideAction} className="kv-card kv-form">{hidden}
          <input type="hidden" name="userTenantRoleId" value={isUuid(searchParams.userTenantRoleId) ? searchParams.userTenantRoleId : ''} />
          <input type="hidden" name="permissionCode" value={(searchParams.permissionCode ?? '').slice(0, 80)} />
          <p>{t.t('swc.staffAct.revoke_override.object', { perm: (searchParams.permissionCode ?? '').slice(0, 80) })}</p>
          {reasonField('ro-reason')}
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('swc.staffAct.revoke_override.proceed')}</button>{' '}<Link href={back} className="kv-btn--link">{t.t('swc.chain.cancel')}</Link>
        </form>
      )}

      {step === 'confirm' && s && act === 'remove' && (
        <form action={removeAction} className="kv-card kv-form">{hidden}
          <label className="kv-field" htmlFor="rm-utr"><span>{t.t('swc.field.assignment')}</span>
            <select id="rm-utr" name="assignmentId" className="kv-select" required defaultValue={isUuid(searchParams.assignmentId) ? searchParams.assignmentId : undefined}>
              {staffAssignments.map((a) => <option key={a.id} value={a.id}>{a.roleCode}</option>)}</select></label>
          <ul className="kv-list"><li>{t.t('swc.staffAct.remove.what')}</li>
            <li>{t.t('swc.staff.sessionBound', { sec: formatNumber(bound!.sec, lang), min: formatNumber(bound!.ttlMin, lang) })}</li>
            <li>{t.t('swc.staffAct.remove.lastAdmin')}</li></ul>
          {reasonField('rm-reason')}
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('swc.staffAct.remove.proceed')}</button>{' '}<Link href={back} className="kv-btn--link">{t.t('swc.chain.cancel')}</Link>
        </form>
      )}

      {step === 'confirm' && s && act === 'declare_conflict' && (
        <div className="kv-card">
          <form action={`${back}/act`} method="get" className="kv-form kv-filters">
            <input type="hidden" name="act" value="declare_conflict" /><input type="hidden" name="step" value="confirm" />
            <label className="kv-field" htmlFor="dc-q"><span>{t.t('swc.field.memberSearch')}</span><input id="dc-q" name="q" className="kv-input" defaultValue={q} maxLength={60} /></label>
            <button type="submit" className="kv-btn--link">{t.t('swc.field.search')}</button>
          </form>
          <form action={declareConflictForAction} className="kv-form">{hidden}
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <label className="kv-field" htmlFor="dc-member"><span>{t.t('swc.field.member')}</span>
              <select id="dc-member" name="memberUserId" className="kv-select" required defaultValue="">
                <option value="" disabled>{t.t('swc.field.memberChoose')}</option>
                {members.map((m) => <option key={m.userId} value={m.userId}>{m.name ?? t.t('swc.unnamed')} · {m.roles.join(', ')}</option>)}</select></label>
            <label className="kv-field" htmlFor="dc-rel"><span>{t.t('swc.field.relation')}</span>
              <select id="dc-rel" name="relation" className="kv-select" required>{CONFLICT_RELATIONS.map((r) => <option key={r} value={r}>{t.t(relationKey(r))}</option>)}</select></label>
            <label className="kv-field" htmlFor="dc-note"><span>{t.t('swc.field.relationNote')}</span><input id="dc-note" name="relationNote" className="kv-input" maxLength={200} /></label>
            {reasonField('dc-reason')}
            <p className="kv-field__hint">{t.t('swc.desk.recusalRule')}</p>
            <button type="submit" className="kv-btn kv-btn--primary">{t.t('swc.staffAct.declare_conflict.proceed')}</button>{' '}<Link href={back} className="kv-btn--link">{t.t('swc.chain.cancel')}</Link>
          </form>
        </div>
      )}

      {step === 'confirm' && s && act === 'lift_conflict' && (
        <form action={liftConflictAction} className="kv-card kv-form">{hidden}
          <input type="hidden" name="conflictId" value={isUuid(searchParams.conflictId) ? searchParams.conflictId : ''} />
          <p>{t.t('swc.staffAct.lift_conflict.rule')}</p>
          {reasonField('lc-reason')}
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('swc.staffAct.lift_conflict.proceed')}</button>{' '}<Link href={back} className="kv-btn--link">{t.t('swc.chain.cancel')}</Link>
        </form>
      )}

      {step === 'confirm' && s && (act === 'confirm_proposal' || act === 'refuse_proposal') && (() => {
        const p = s!.proposals.find((x) => x.id === searchParams.proposalId);
        return p ? (
          <form action={proposalAction} className="kv-card kv-form">{hidden}
            <input type="hidden" name="proposalId" value={p.id} /><input type="hidden" name="act" value={act} />
            <p>{t.t('swc.proposals.line', { who: s!.name ?? t.t('swc.unnamed'), perm: p.permissionCode, by: p.proposedByName ?? t.t('swc.unnamed') })} — {p.reason}</p>
            <p className="kv-field__hint">{t.t('swc.staffAct.confirm_proposal.rule')}</p>
            {act === 'refuse_proposal' && reasonField('pr-reason')}
            <button type="submit" className="kv-btn kv-btn--primary">{t.t(`swc.staffAct.${act}.proceed`)}</button>{' '}<Link href={back} className="kv-btn--link">{t.t('swc.chain.cancel')}</Link>
          </form>
        ) : <p className="kv-error">{t.t('swc.code.OVERRIDE_PROPOSAL_NOT_FOUND')}</p>;
      })()}

      {step === 'success' && (
        <>
          <div className="kv-card kv-success" role="status">
            <strong>{t.t(act === 'override' && searchParams.status === 'proposed' ? 'swc.staffAct.override.proposed' : `swc.staffAct.${act}.done`)}</strong>
            {act === 'remove' && searchParams.bound && <p>{t.t('swc.staffAct.remove.ended', { sec: searchParams.bound.replace(/\D/g, '').slice(0, 6) })}</p>}
            <p><Link href={back} className="kv-btn kv-btn--primary">{t.t('swc.chain.back')}</Link></p>
          </div>
          {act === 'remove' && isUuid(searchParams.assignmentId) && <AuditEntryCard t={t} lang={lang} entityType="user_tenant_role" entityId={searchParams.assignmentId} action="role.revoked" />}
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('swc.chain.failure')}</strong>
          <ul className="kv-list">{(parseCodes(searchParams.error).length ? parseCodes(searchParams.error) : ['unknown']).map((c) => <li key={c}>{t.t(swcCodeKey(c))}</li>)}</ul>
          <p>{t.t('swc.chain.untouched')}</p>
          <p><Link href={staffActHref(params.id, act)} className="kv-btn--link">{t.t('swc.chain.retry')}</Link> <span className="kv-field__hint">{t.t('swc.refused.retry')}</span></p>
        </div>
      )}
    </section>
  );
}
