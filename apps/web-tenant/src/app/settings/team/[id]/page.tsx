// apps/web-tenant/src/app/settings/team/[id]/page.tsx · W184 · ONE STAFF MEMBER — PC-56 TENANT-SW-c (F-15).
//
// (The member view `/people/[userId]` is a different thing — linked across.) Every section is the API's (`GET /v1/team/staff/:id`):
//   • roles + desks (desks via the 13b desk acts); • per-staff OVERRIDES with WHY (recorded), who granted it, until when, or
//     "legacy: no reason recorded (pre-0199)" — a money / PII grant needs a second administrator (the codes listed, from the API);
//   • 2FA state (confirmed / not enrolled — real); • conflict declarations (add / lift, with a reason);
//   • "Recent privileged actions" — the audit trail for this actor, filtered to privileged actions; the trail is gated by `audit.read` and
//     the `audit_trail` flag, and when either closes it the page SAYS so instead of printing nothing;
//   • Remove from team — reason required; the page prints the REAL bound on when sessions end (the API's), not the canon's typed "60s".
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { AuditEntry, StaffDetail } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../lib/i18n';
import {
  DESKS_HREF, TEAM_HREF, isPrivilegedAction, isUuid, memberHref, relationKey, sessionBoundVars, staffActHref, staffHref, swcPageState, twoFactorKey,
} from '../../../../features/swc/console';
import { auditHref } from '../../../../features/forms/chain';
import { AsOf } from '../../../../components/AsOf';
import { asOfLabels } from '../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swc.staff.title'), robots: { index: false, follow: false } };
}

export default async function StaffDetailPage({ params }: { params: { id: string } }) {
  await requireSession(staffHref(params.id));
  const t = getTranslator(); const lang = getLang();
  const n = (x: number) => formatNumber(x, lang);
  const at = (iso: string | null) => (iso ? formatDate(iso, lang, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : t.t('common.dash'));
  let s: StaffDetail | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state) { try { s = await tenantClient().team.staff(params.id); } catch (e) { const err = e instanceof SdkError ? e : null; state = swcPageState(err?.code, err?.status, true); } }
  if (!s) {
    return (
      <section>
        <p><Link href={TEAM_HREF} className="kv-btn--link">{t.t('swc.chain.back')}</Link></p>
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><h1>{t.t(`swc.state.${state ?? 'error'}.title`)}</h1><p>{t.t(`swc.state.${state ?? 'error'}.body`)}</p></div>
      </section>
    );
  }
  // "Recent privileged actions": the trail, gated by audit.read + the audit_trail flag — read, or said why not
  let actions: AuditEntry[] = []; let trail: 'ok' | 'off' | 'restricted' = 'ok';
  try { actions = (await tenantClient().audit.list({ actorUserId: s.userId, limit: 50 })).items.filter((a) => isPrivilegedAction(a.action)).slice(0, 15); }
  catch (e) { const err = e instanceof SdkError ? e : null; trail = err?.code === 'AUDITOR_REALM_OFF' || err?.status === 404 ? 'off' : 'restricted'; }
  const staffAssignments = s.assignments.filter((a) => a.isStaff && !a.revokedAt);
  const bound = sessionBoundVars(s.sessionEndBoundSec, s.accessTokenTtlSec);
  const checker = Object.entries(s.checkerCodes);

  return (
    <section>
      <nav aria-label={t.t('swc.breadcrumb.label')} className="kv-field__hint">{t.t('dk.breadcrumb.settings')} › <Link href={TEAM_HREF} className="kv-btn--link">{t.t('swc.team.title')}</Link> › {s.name ?? t.t('swc.unnamed')}</nav>
      <h1>{s.name ?? t.t('swc.unnamed')} <span className={`kv-badge kv-badge--${s.twoFactor === 'confirmed' ? 'ok' : 'muted'}`}>{t.t(twoFactorKey(s.twoFactor))}</span></h1>
      {/* PC-56 TENANT-SW-f · W318 §1: when this page's data was read — absolute IST + relative; stale past 1 h */}
      <AsOf at={new Date().toISOString()} labels={asOfLabels(t)} />
      <p className="kv-field__hint">{t.t('swc.staff.lastActive', { at: at(s.lastActiveAt) })} · <Link href={memberHref(s.userId)} className="kv-btn--link">{t.t('swc.staff.memberView')}</Link></p>
      {s.suspended && <p className="kv-card kv-card--notice">{t.t('swc.suspended')}</p>}

      <h2>{t.t('swc.staff.roles')}</h2>
      <table className="kv-table">
        <thead><tr><th scope="col">{t.t('swc.col.role')}</th><th scope="col">{t.t('swc.col.status')}</th><th scope="col">{t.t('swc.col.since')}</th><th scope="col">{t.t('swc.col.act')}</th></tr></thead>
        <tbody>{s.assignments.map((a) => (
          <tr key={a.id}><th scope="row">{a.roleCode}{a.isStaff && <span className="kv-field__hint"> · {t.t('swc.staff.seat')}</span>}</th>
            <td>{a.revokedAt ? t.t('swc.staff.revoked', { reason: a.revokeReason ?? t.t('swc.staff.noReasonLegacy') }) : a.isActive ? t.t('swc.staff.active') : t.t('swc.staff.pending')}</td>
            <td>{at(a.createdAt)}</td>
            <td>{a.isStaff && !a.revokedAt && !s!.isSelf ? <Link href={staffActHref(s!.userId, 'remove', { assignmentId: a.id })} className="kv-btn--link">{t.t('swc.staff.remove')}</Link> : s!.isSelf && a.isStaff ? <span className="kv-field__hint">{t.t('swc.code.REMOVE_SELF')}</span> : null}</td></tr>
        ))}</tbody>
      </table>
      <p className="kv-field__hint">{t.t('swc.staff.sessionBound', { sec: n(bound.sec), min: n(bound.ttlMin) })}{s.sessionCutoffAt ? ` · ${t.t('swc.staff.cutoffAt', { at: at(s.sessionCutoffAt) })}` : ''}</p>

      <h2>{t.t('swc.staff.desks')}</h2>
      {s.desks.length === 0 ? <p className="kv-field__hint">{t.t('swc.staff.noDesks')}</p> : <ul className="kv-list">{s.desks.map((d) => <li key={d.id}>{d.name} <span className="kv-field__hint">· {at(d.addedAt)}</span></li>)}</ul>}
      <p><Link href={DESKS_HREF} className="kv-btn--link">{t.t('swc.team.configureDesks')}</Link></p>

      <h2>{t.t('swc.staff.overrides')}</h2>
      {s.overrides.length === 0 ? <p className="kv-field__hint">{t.t('swc.staff.noOverrides')}</p> : (
        <table className="kv-table">
          <thead><tr><th scope="col">{t.t('swc.col.permission')}</th><th scope="col">{t.t('swc.col.grant')}</th><th scope="col">{t.t('swc.col.why')}</th><th scope="col">{t.t('swc.col.by')}</th><th scope="col">{t.t('swc.col.until')}</th><th scope="col">{t.t('swc.col.act')}</th></tr></thead>
          <tbody>{s.overrides.map((o) => (
            <tr key={`${o.userTenantRoleId}:${o.permissionCode}`}><th scope="row"><code>{o.permissionCode}</code>{s!.checkerCodes[o.permissionCode] && <span className="kv-badge kv-badge--warn"> {t.t(`swc.class.${s!.checkerCodes[o.permissionCode]}`)}</span>}</th>
              <td>{t.t(o.isGranted ? 'swc.staff.grant' : 'swc.staff.deny')}{!o.live && <span className="kv-field__hint"> · {t.t(o.revokedAt ? 'swc.staff.overrideRevoked' : 'swc.staff.overrideExpired')}</span>}</td>
              <td>{o.legacy ? <span className="kv-field__hint">{t.t('swc.staff.noReasonLegacy')}</span> : o.reason}</td>
              <td>{o.grantedByName ?? t.t('common.dash')}</td>
              <td>{o.expiresAt ? at(o.expiresAt) : t.t('swc.staff.noExpiry')}</td>
              <td>{o.live && <Link href={staffActHref(s!.userId, 'revoke_override', { userTenantRoleId: o.userTenantRoleId, permissionCode: o.permissionCode })} className="kv-btn--link">{t.t('swc.staff.revokeOverride')}</Link>}</td></tr>
          ))}</tbody>
        </table>
      )}
      {staffAssignments.length > 0 && <p><Link href={staffActHref(s.userId, 'override')} className="kv-btn">{t.t('swc.staff.addOverride')}</Link></p>}
      <p className="kv-field__hint">{t.t('swc.staff.checkerCodes', { codes: checker.map(([c]) => c).join(', ') })}</p>
      {s.proposals.filter((p) => p.status === 'proposed').map((p) => (
        <div key={p.id} className="kv-card kv-card--notice">
          <p>{t.t('swc.proposals.line', { who: s!.name ?? t.t('swc.unnamed'), perm: p.permissionCode, by: p.proposedByName ?? t.t('swc.unnamed') })} — {p.reason}</p>
          <p><Link href={staffActHref(s!.userId, 'confirm_proposal', { proposalId: p.id })} className="kv-btn--link">{t.t('swc.proposals.confirm')}</Link>{' · '}
            <Link href={staffActHref(s!.userId, 'refuse_proposal', { proposalId: p.id })} className="kv-btn--link">{t.t('swc.proposals.refuse')}</Link></p>
        </div>
      ))}

      <h2>{t.t('swc.staff.conflicts')}</h2>
      <p className="kv-field__hint">{t.t('swc.desk.recusalRule')}</p>
      {s.conflicts.length === 0 ? <p className="kv-field__hint">{t.t('swc.staff.noConflicts')}</p> : (
        <ul className="kv-list">{s.conflicts.map((c) => (
          <li key={c.id}>{c.memberName ?? t.t('swc.unnamed')} · {t.t(relationKey(c.relation))}{c.relationNote ? ` (${c.relationNote})` : ''} · {t.t(c.declaredVia === 'self' ? 'swc.conflict.self' : 'swc.conflict.admin')} · {c.active ? t.t('swc.conflict.active') : t.t('swc.conflict.lifted', { reason: c.revokeReason ?? '' })}
            {c.active && <> {' · '}<Link href={staffActHref(s!.userId, 'lift_conflict', { conflictId: c.id })} className="kv-btn--link">{t.t('swc.conflict.lift')}</Link></>}</li>
        ))}</ul>
      )}
      <p><Link href={staffActHref(s.userId, 'declare_conflict')} className="kv-btn--link">{t.t('swc.conflict.declareFor')}</Link></p>

      <h2>{t.t('swc.staff.privileged')}</h2>
      {trail !== 'ok' ? <p className="kv-card kv-card--notice">{t.t(trail === 'off' ? 'swc.staff.trailOff' : 'swc.staff.trailRestricted')}</p>
        : actions.length === 0 ? <p className="kv-field__hint">{t.t('swc.staff.noPrivileged')}</p> : (
          <ul className="kv-list">{actions.map((a) => <li key={a.id}><code>{a.action}</code> · {at(a.createdAt)}{a.reason ? <span className="kv-field__hint"> · {a.reason}</span> : null}
            {a.entityType && a.entityId && <> · <Link href={auditHref(a.entityType, a.entityId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></>}</li>)}</ul>
        )}
      <p className="kv-field__hint">{t.t('swc.staff.privilegedNote')}</p>
    </section>
  );
}
