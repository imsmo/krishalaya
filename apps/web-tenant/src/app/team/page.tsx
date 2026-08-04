// apps/web-tenant/src/app/team/page.tsx · the tenant's staff roster + role assignments. Server-first,
// requireSession-gated. Lists role assignments (rbac.assignments; ?pending=1 shows only the approval queue),
// approves a pending assignment (Server Action), and admin-adds a member who can't self-register (users.create).
// The UI reflects RBAC; the server authorises every change within the caller's own tenant (not god-mode). All
// copy via i18n; degrades to empty/error; noindex.
//
// This page is the roster + approval queue + admin-add. The full role→permission matrix (assign/revoke roles,
// per-assignment overrides) lives at /team/roles (P1-11), wired to rbac.roles/permissions/assign/revoke/setOverride
// — all escalation-guarded SERVER-SIDE (platform roles not assignable; UNGRANTABLE perms blocked; granter-subset).
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { isPending } from '../../features/team/form';
import { approveAssignmentAction, addUserAction } from './actions';
import type { RoleAssignment } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('team.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['approve', 'add', 'phone', 'illegal']);

export default async function TeamPage({ searchParams }: { searchParams: { pending?: string; ok?: string; error?: string } }) {
  await requireSession('/team');
  const t = getTranslator();
  const pendingOnly = searchParams.pending === '1';

  let rows: RoleAssignment[] = []; let failed = false;
  try { rows = await tenantClient().rbac.assignments({ pendingOnly }); }
  catch { failed = true; }

  const okKey = searchParams.ok && ['approved', 'added'].includes(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <h1>{t.t('team.title')}</h1>
      <p className="kv-muted"><Link href="/team/roles">{t.t('team.manageRoles')}</Link></p>
      {okKey && <p className="kv-success" role="status">{t.t(`team.ok.${okKey}`)}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t(`team.error.${errorKey}`)}</p>}

      <nav className="kv-notif-filters" aria-label={t.t('team.filters')}>
        <Link href="/team" className={`kv-btn--link${!pendingOnly ? ' is-active' : ''}`} aria-current={!pendingOnly ? 'page' : undefined}>{t.t('team.all')}</Link>
        <Link href="/team?pending=1" className={`kv-btn--link${pendingOnly ? ' is-active' : ''}`} aria-current={pendingOnly ? 'page' : undefined}>{t.t('team.pending')}</Link>
      </nav>

      {failed ? <p className="kv-error" role="alert">{t.t('team.loadError')}</p> : (
        <DataTable
          rows={rows}
          empty={t.t('team.empty')}
          columns={[
            { header: t.t('team.colUser'), cell: (a) => a.userId.slice(0, 8) },
            { header: t.t('team.colRole'), cell: (a) => a.roleCode },
            { header: t.t('team.colKyc'), cell: (a) => <span className="kv-badge">{a.kycStatus}</span> },
            { header: t.t('team.colActive'), cell: (a) => (a.isActive ? t.t('team.yes') : t.t('common.dash')) },
            { header: t.t('team.colState'), cell: (a) => (isPending(a)
              ? <form action={approveAssignmentAction} className="kv-inline-form"><input type="hidden" name="id" value={a.id} /><button type="submit" className="kv-btn--link">{t.t('team.approve')}</button></form>
              : <span className="kv-muted">{t.t('team.approved')}</span>) },
          ]}
        />
      )}

      <details className="kv-card">
        <summary className="kv-card__title">{t.t('team.addMember')}</summary>
        <p className="kv-field__hint">{t.t('team.addHint')}</p>
        <form action={addUserAction} className="kv-form">
          <label htmlFor="phone" className="kv-field__label">{t.t('team.phone')}</label>
          <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="off" className="kv-input" required placeholder="+91 98765 43210" />
          <label htmlFor="fullName" className="kv-field__label">{t.t('team.name')}</label>
          <input id="fullName" name="fullName" className="kv-input" />
          <label htmlFor="languageCode" className="kv-field__label">{t.t('team.language')}</label>
          <input id="languageCode" name="languageCode" className="kv-input" placeholder="hi / en / gu" />
          <label htmlFor="countryCode" className="kv-field__label">{t.t('team.country')}</label>
          <input id="countryCode" name="countryCode" className="kv-input" placeholder="IN" />
          <button type="submit" className="kv-btn">{t.t('team.add')}</button>
        </form>
      </details>

      <p className="kv-field__hint kv-note">{t.t('team.assignUnavailable')}</p>
    </section>
  );
}
