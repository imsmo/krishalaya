// apps/web-tenant/src/app/team/roles/page.tsx · the staff-permissions matrix: assign/revoke roles + set
// per-assignment permission overrides. Server-first, requireSession-gated. Loads the role catalogue, permission
// catalogue, and current assignments in parallel; each degrades independently (Law 12). Platform-scope roles are
// shown read-only (never offered as assignable — Law 11). All writes go through Server Actions → the audited,
// RBAC-gated API, which is the authority on escalation. All copy via i18n; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { assignableRoles, canGrantPermission } from '../../../features/team/permissions';
import { assignRoleAction, revokeRoleAction, setOverrideAction } from './actions';
import type { RoleDef, PermissionDef, RoleAssignment } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('roles.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['assigned', 'revoked', 'override']);

export default async function RolesPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/team/roles');
  const t = getTranslator();

  let roles: RoleDef[] = []; let perms: PermissionDef[] = []; let assignments: RoleAssignment[] = [];
  let rolesFailed = false; let permsFailed = false; let asgFailed = false;
  const [rRes, pRes, aRes] = await Promise.allSettled([
    tenantClient().rbac.roles({ activeOnly: true }),
    tenantClient().rbac.permissions(),
    tenantClient().rbac.assignments(),
  ]);
  if (rRes.status === 'fulfilled') roles = rRes.value; else rolesFailed = true;
  if (pRes.status === 'fulfilled') perms = pRes.value; else permsFailed = true;
  if (aRes.status === 'fulfilled') assignments = aRes.value; else asgFailed = true;

  const assignable = assignableRoles(roles);
  const assignableCsv = assignable.map((r) => r.code).join(',');
  const grantablePerms = perms.filter((p) => canGrantPermission(p.code)); // hide UNGRANTABLE from the grant picker

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error || null;

  return (
    <section>
      <h1>{t.t('roles.title')}</h1>
      <p className="kv-muted">{t.t('roles.subtitle')} · <Link href="/team">{t.t('roles.backToTeam')}</Link></p>
      {okKey && <p className="kv-success" role="status">{t.t(`roles.ok.${okKey}`)}</p>}
      {errorKey && <p className="kv-error" role="alert">{errorKey === 'escalation' ? t.t('roles.error.escalation') : `${t.t('roles.error.generic')}: ${errorKey}`}</p>}

      <h2 className="kv-section-title">{t.t('roles.assign.title')}</h2>
      {rolesFailed ? <p className="kv-error" role="alert">{t.t('roles.loadError')}</p> : (
        <form action={assignRoleAction} className="kv-form kv-form--grid">
          <input type="hidden" name="assignable" value={assignableCsv} />
          <label className="kv-label">{t.t('roles.assign.user')}
            <input className="kv-input" name="userId" type="text" required placeholder={t.t('roles.assign.userHint')} />
          </label>
          <label className="kv-label">{t.t('roles.assign.role')}
            <select className="kv-input" name="roleCode" required defaultValue="">
              <option value="" disabled>{t.t('roles.assign.rolePlaceholder')}</option>
              {assignable.map((r) => <option key={r.code} value={r.code}>{r.defaultName}{r.requiresApproval ? ` (${t.t('roles.needsApproval')})` : ''}</option>)}
            </select>
          </label>
          <button type="submit" className="kv-btn">{t.t('roles.assign.submit')}</button>
        </form>
      )}
      <p className="kv-muted kv-fine">{t.t('roles.assign.platformNote')}</p>

      <h2 className="kv-section-title">{t.t('roles.assignments.title')}</h2>
      {asgFailed ? <p className="kv-error" role="alert">{t.t('roles.loadError')}</p> : (
        <DataTable
          rows={assignments}
          empty={t.t('roles.assignments.empty')}
          columns={[
            { header: t.t('roles.assignments.user'), cell: (a) => a.userId },
            { header: t.t('roles.assignments.role'), cell: (a) => a.roleCode },
            { header: t.t('roles.assignments.status'), cell: (a) => a.approvedAt ? <span className="kv-badge">{t.t('roles.active')}</span> : <span className="kv-badge">{t.t('roles.pending')}</span> },
            { header: '', cell: (a) => (
              <form action={revokeRoleAction}><input type="hidden" name="id" value={a.id} /><button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">{t.t('roles.revoke')}</button></form>
            ) },
          ]}
        />
      )}

      <h2 className="kv-section-title">{t.t('roles.override.title')}</h2>
      <p className="kv-muted">{t.t('roles.override.help')}</p>
      {(permsFailed || asgFailed) ? <p className="kv-error" role="alert">{t.t('roles.loadError')}</p> : (
        <form action={setOverrideAction} className="kv-form kv-form--grid">
          <label className="kv-label">{t.t('roles.override.assignment')}
            <select className="kv-input" name="userTenantRoleId" required defaultValue="">
              <option value="" disabled>{t.t('roles.override.assignmentPlaceholder')}</option>
              {assignments.map((a) => <option key={a.id} value={a.id}>{a.userId} · {a.roleCode}</option>)}
            </select>
          </label>
          <label className="kv-label">{t.t('roles.override.permission')}
            <select className="kv-input" name="permissionCode" required defaultValue="">
              <option value="" disabled>{t.t('roles.override.permissionPlaceholder')}</option>
              {grantablePerms.map((p) => <option key={p.code} value={p.code}>{p.defaultName} ({p.code})</option>)}
            </select>
          </label>
          <label className="kv-label">{t.t('roles.override.effect')}
            <select className="kv-input" name="isGranted" defaultValue="true">
              <option value="true">{t.t('roles.override.grant')}</option>
              <option value="false">{t.t('roles.override.deny')}</option>
            </select>
          </label>
          <button type="submit" className="kv-btn">{t.t('roles.override.submit')}</button>
        </form>
      )}
      <p className="kv-muted kv-fine">{t.t('roles.override.ungrantableNote')}</p>
    </section>
  );
}
