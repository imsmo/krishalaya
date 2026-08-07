// apps/web-admin/src/app/staff/roles/page.tsx · W105 (PC-56 ADMIN-9).
//
// **THE MATRIX IS REAL AND THE SUBMIT-DIFF CONTROL CANNOT EXIST — and W105 settles both halves in its own words.** Its
// error state reads: "Enforcement reads from the compiled policy, not this view." That is exactly true, and it is why
// this screen is buildable as a READ of `owner-roles.ts` (the object every admin request is authorised against) and
// unbuildable as a write: granting a platform permission means editing a frozen TypeScript constant and deploying.
//
// A console that appeared to submit a role diff would write to a table nothing reads, and W105's own promise — "grants
// take effect on next session; revokes take effect immediately" — would be false in both halves. So there is no Submit
// control, with the reason on the page rather than an unexplained absence that reads as an unbuilt feature.
//
// TWO PLACES WHERE THE CANON'S TENANT VOCABULARY DOES NOT FIT, AND THE DIFFERENCE MATTERS:
//   * "permission codes are DB truth (permissions.code)" is true of TENANT roles and false of platform ones by design.
//     Law 11 keeps these codes in the god-mode realm precisely so no row in the tenant database can grant one.
//   * "18 members" implies an assignment list. This realm can only count operators whose LAST TOKEN carried the role.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { cellClass, cellStateKey, matrixIsWritable } from '../../../features/staff/operators';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('st.matrix.title'), robots: { index: false, follow: false } };
}

interface MatrixRow {
  permission: string; group: string;
  cells: { role: string; state: string }[];
}
interface Meta {
  roles: { role: string; isGodMode: boolean; permissionCount: number; observedMembers: number }[];
  groups: string[];
  group: string | null;
  permissionCount: number;
  roleCount: number;
  source: string;
  writable: boolean;
  noWritePathReason: string;
  godModeOnly: string[];
  membershipBasis: string;
  membershipCaveatOwner: string;
}

export default async function RoleMatrixPage({ searchParams }: { searchParams: { group?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const group = (searchParams.group ?? '').trim() || undefined;

  let rows: MatrixRow[] = []; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<MatrixRow[]>(`staff/roles${group ? `?group=${encodeURIComponent(group)}` : ''}`);
    rows = res.data ?? []; meta = res.meta as unknown as Meta;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'st.restricted.matrix' : 'st.error.matrix';
  }

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/staff">{t.t('st.roster.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('st.matrix.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('st.matrix.title')}</h1>
        <p className="kv-page__sub">{t.t('st.matrix.sub')}</p>
      </header>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}

      {meta ? (
        <>
          {/* **NO SUBMIT CONTROL, AND THE REASON IS THE FIRST THING ON THE PAGE.** */}
          <p className="kv-note is-warn">{meta.noWritePathReason}</p>
          <p className="kv-note">
            {t.t('st.matrix.source', { source: meta.source })} ·{' '}
            {t.t('st.matrix.counts', { perms: String(meta.permissionCount), roles: String(meta.roleCount) })}
          </p>

          {/* THE HOLES IN A LEAST-PRIVILEGE CATALOGUE: permissions no ordinary role holds, so every use of them is a use
              of the most powerful credential on the platform. */}
          {meta.godModeOnly.length > 0 ? (
            <p className="kv-note is-warn">
              {t.t('st.matrix.godModeOnly', { n: String(meta.godModeOnly.length), list: meta.godModeOnly.join(', ') })}
            </p>
          ) : null}

          <nav className="kv-filters" aria-label={t.t('st.matrix.filterGroup')}>
            <Link className={`kv-chip${!group ? ' is-active' : ''}`} href="/staff/roles">{t.t('common.all')}</Link>
            {meta.groups.map((g) => (
              <Link key={g} className={`kv-chip${group === g ? ' is-active' : ''}`}
                href={`/staff/roles?group=${encodeURIComponent(g)}`}>{g}</Link>
            ))}
          </nav>

          {/* ROLE SUMMARY — with membership labelled as observed. */}
          <section className="kv-panel" aria-labelledby="st-roles">
            <h2 id="st-roles" className="kv-panel__title">{t.t('st.matrix.roles')}</h2>
            <table className="kv-table">
              <thead>
                <tr>
                  <th scope="col">{t.t('st.col.role')}</th>
                  <th scope="col">{t.t('st.col.permCount')}</th>
                  <th scope="col">{t.t('st.col.observedMembers')}</th>
                </tr>
              </thead>
              <tbody>
                {meta.roles.map((r) => (
                  <tr key={r.role}>
                    <td>
                      {r.role}
                      {r.isGodMode ? <> <span className="kv-badge is-warn">{t.t('st.matrix.godMode')}</span></> : null}
                    </td>
                    {/* A god-mode role's count is the whole catalogue, not the literal length of `['*']` — "super_admin
                        holds 1 permission" is arithmetically true and a lie about what it can do. */}
                    <td>{r.permissionCount}</td>
                    <td>{r.observedMembers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="kv-note is-warn">{t.t('st.matrix.membershipObserved', { owner: meta.membershipCaveatOwner })}</p>
          </section>

          {rows.length === 0 ? (
            <div className="kv-empty">
              <h2>{t.t('st.matrix.empty.title')}</h2>
              <p>{t.t('st.matrix.empty.body')}</p>
            </div>
          ) : (
            <div className="kv-table-scroll">
              <table className="kv-table">
                <caption className="kv-table__caption">{t.t('st.matrix.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t.t('st.col.permission')}</th>
                    <th scope="col">{t.t('st.col.group')}</th>
                    {meta.roles.map((r) => <th key={r.role} scope="col">{r.role}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.permission}>
                      <th scope="row">
                        <Link href={`/staff/roles/${encodeURIComponent(row.permission)}`}>{row.permission}</Link>
                      </th>
                      <td>{row.group}</td>
                      {row.cells.map((c) => (
                        <td key={c.role} className={cellClass(c.state)}>
                          {/* God mode is its own state rather than a tick: "holds whatever is defined, including codes a
                              future deploy adds" is a different fact from "holds this". */}
                          <span className="kv-visually-hidden">{t.t(cellStateKey(c.state))}</span>
                          {c.state === 'granted' ? '●' : c.state === 'god_mode' ? '★' : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Asserted rather than assumed: if this ever returns true, the page is lying and the spec fails. */}
          {matrixIsWritable() ? <p className="kv-note is-danger">{t.t('st.matrix.writableBug')}</p> : null}
        </>
      ) : null}
    </main>
  );
}
