// apps/web-admin/src/app/staff/page.tsx · W104 (PC-56 ADMIN-9).
//
// **THE ROSTER W104 HAD NO SOURCE FOR.** Its four KPIs — "Active staff 31 · FIDO2 enrolled 31/31 · Permission overrides
// 9 · Dormant > 30d 2" — described a registry that did not exist: no table on this platform held a platform operator,
// and `AdminAuthGuard` authorised every request from a token alone.
//
// SO EVERY NUMBER HERE IS LABELLED AS OBSERVED. This realm can count the operators it has SEEN; the IdP holds the staff
// list and this realm cannot enumerate it (ADMIN-9-Q1). An operator provisioned last week who has not yet signed in does
// not appear on this page, and no query here would find them — which is a smaller claim than W104's and a true one.
//
// THREE THINGS THIS PAGE DELIBERATELY DOES NOT RENDER:
//   * NAMES. The admin token carries no name claim, so a roster of "Arif M. · ari•••@krishalaya.com" would be a roster
//     of values this realm cannot obtain. It shows the operator id the audit trail already uses.
//   * "FIDO2 31/31". `fido2_credentials` (0074) keys on `users(id)` — the TENANT realm's table — so no platform operator
//     has a row and none can (ADMIN-9-Q3). What is knowable is whether their last token asserted a hardware-key factor.
//   * "SUSPENDED" FOR A DORMANT OPERATOR. Nothing sweeps: the suspension happens when they next try to use the realm.
//     The column says "past the line — will be refused and suspended at the next request", because claiming a
//     suspension that has not happened is the defect this programme has found six times.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { getTranslator } from '../../lib/i18n';
import {
  censusLabelKey, dormancyClass, dormancyKey, fido2ClaimKey, pastLineIsNotSuspended, statusClass, statusKey,
  suspendKindKey, type Dormancy,
} from '../../features/staff/operators';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('st.roster.title'), robots: { index: false, follow: false } };
}

interface OperatorRow {
  adminUserId: string; status: string;
  lastRoles: string[]; lastAmr: string[]; hasHardwareKeyFactor: boolean;
  firstSeenAt: string; lastSeenAt: string; requestCount: number;
  dormancy: Dormancy; suspendKind: string | null; suspendReason: string | null;
  suspendedByAdminId: string | null; reinstateRequestedByAdminId: string | null;
  restrictionCount: number;
}
interface Meta {
  nextCursor: string | null;
  census: { total: number; active: number; suspended: number; dormant: number; pastLine: number; restricted: number; seenToday: number };
  policy: { dormantAfterDays: number; suspendAfterDays: number; touchIntervalSec: number };
  policyFromDatabase: boolean;
  registryEnabled: boolean;
  censusBasis: string;
  censusCaveatOwner: string;
  fido2EnrolmentKnown: boolean;
  fido2Gap: string;
}

const STATUSES = ['active', 'suspended'] as const;

export default async function StaffRosterPage({ searchParams }: {
  searchParams: { status?: string; cursor?: string; ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const status = (STATUSES as readonly string[]).includes(searchParams.status ?? '') ? searchParams.status : undefined;

  let rows: OperatorRow[] = []; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (searchParams.cursor) q.set('cursor', searchParams.cursor);
    const res = await adminGet<OperatorRow[]>(`staff/operators?${q.toString()}`);
    rows = res.data ?? []; meta = res.meta as unknown as Meta;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'st.restricted.roster' : 'st.error.roster';
  }

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/dashboard">{t.t('nav.dashboard')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('st.roster.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('st.roster.title')}</h1>
        <p className="kv-page__sub">{t.t('st.roster.sub')}</p>
      </header>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}
      {searchParams.ok ? <p className="kv-note is-ok" role="status">{t.t(`st.ok.${searchParams.ok}`)}</p> : null}
      {searchParams.error ? <p className="kv-note is-danger" role="alert">{t.t(`st.err.${searchParams.error}`)}</p> : null}

      {meta ? (
        <>
          {/* **THE REGISTRY SWITCH.** If it is off, this page is a record of a control that is not being consulted, and
              that has to be the loudest thing on the screen. */}
          {!meta.registryEnabled ? (
            <p className="kv-note is-danger" role="alert">{t.t('st.roster.registryOff')}</p>
          ) : null}

          {/* THE CENSUS, with its basis attached to it rather than in a footnote somebody will read once. */}
          <section className="kv-panel" aria-labelledby="st-census">
            <h2 id="st-census" className="kv-panel__title">{t.t('st.census.title')}</h2>
            <dl className="kv-stat-row">
              <div><dt>{t.t('st.census.seen')}</dt><dd>{meta.census.total}</dd></div>
              <div><dt>{t.t('st.census.active')}</dt><dd>{meta.census.active}</dd></div>
              <div><dt>{t.t('st.census.suspended')}</dt><dd>{meta.census.suspended}</dd></div>
              <div><dt>{t.t('st.census.dormant')}</dt><dd>{meta.census.dormant}</dd></div>
              <div><dt>{t.t('st.census.pastLine')}</dt><dd className={meta.census.pastLine > 0 ? 'is-danger' : undefined}>{meta.census.pastLine}</dd></div>
              <div><dt>{t.t('st.census.restricted')}</dt><dd>{meta.census.restricted}</dd></div>
              <div><dt>{t.t('st.census.seenToday')}</dt><dd>{meta.census.seenToday}</dd></div>
            </dl>
            <p className="kv-note is-warn">{t.t(censusLabelKey(), { owner: meta.censusCaveatOwner })}</p>
            {/* The claim W104 makes that this platform cannot make, and the reason. */}
            <p className="kv-note is-warn">{t.t(fido2ClaimKey(meta.fido2EnrolmentKnown), { owner: meta.fido2Gap })}</p>
            <p className="kv-note">
              {t.t('st.policy.lines', {
                dormant: String(meta.policy.dormantAfterDays),
                suspend: String(meta.policy.suspendAfterDays),
              })}
              {!meta.policyFromDatabase ? ` ${t.t('st.policy.fallback')}` : ''}
            </p>
          </section>

          <nav className="kv-filters" aria-label={t.t('st.filter.status')}>
            <Link className={`kv-chip${!status ? ' is-active' : ''}`} href="/staff">{t.t('common.all')}</Link>
            {STATUSES.map((s) => (
              <Link key={s} className={`kv-chip${status === s ? ' is-active' : ''}`} href={`/staff?status=${s}`}>
                {t.t(statusKey(s))}
              </Link>
            ))}
            <Link className="kv-chip" href="/staff/roles">{t.t('st.nav.roles')}</Link>
            <Link className="kv-chip" href="/staff/security">{t.t('st.nav.security')}</Link>
            <Link className="kv-chip" href="/staff/me">{t.t('st.nav.myWork')}</Link>
          </nav>

          {rows.length === 0 ? (
            <div className="kv-empty">
              <h2>{t.t('st.roster.empty.title')}</h2>
              {/* An empty roster in a realm that has just started recording is not an empty platform — it is a platform
                  that has not yet seen a request. Said explicitly, because the opposite reading is the natural one. */}
              <p>{t.t('st.roster.empty.body')}</p>
            </div>
          ) : (
            <table className="kv-table">
              <caption className="kv-table__caption">{t.t('st.roster.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.t('st.col.operator')}</th>
                  <th scope="col">{t.t('st.col.rolesSeen')}</th>
                  <th scope="col">{t.t('st.col.factor')}</th>
                  <th scope="col">{t.t('st.col.restrictions')}</th>
                  <th scope="col">{t.t('st.col.lastSeen')}</th>
                  <th scope="col">{t.t('st.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.adminUserId}>
                    <td>
                      <Link href={`/staff/${encodeURIComponent(o.adminUserId)}`}>{o.adminUserId.slice(0, 8)}</Link>
                      <br /><small>{t.t('st.col.since', { at: o.firstSeenAt.slice(0, 10) })}</small>
                    </td>
                    <td>
                      {o.lastRoles.length === 0 ? '—' : o.lastRoles.join(', ')}
                      {/* "Last seen carrying", never "role": an operator's roles can change at the IdP without this
                          realm hearing about it until their next request. */}
                      <br /><small>{t.t('st.col.rolesSeenHint')}</small>
                    </td>
                    <td>
                      {o.hasHardwareKeyFactor
                        ? <span className="kv-badge is-ok">{t.t('st.factor.hwk')}</span>
                        : <span className="kv-badge is-warn">{t.t('st.factor.none')}</span>}
                    </td>
                    <td>{o.restrictionCount === 0 ? '—' : `−${o.restrictionCount}`}</td>
                    <td>
                      {o.lastSeenAt.slice(0, 16).replace('T', ' ')}
                      <br />
                      <span className={dormancyClass(o.dormancy)}>{t.t(dormancyKey(o.dormancy), {
                        days: String(o.dormancy?.daysSinceSeen ?? 0),
                        toSuspend: String(o.dormancy?.daysToSuspend ?? 0),
                      })}</span>
                      {/* THE SENTENCE THAT KEEPS THIS COLUMN HONEST. */}
                      {pastLineIsNotSuspended(o.dormancy)
                        ? <><br /><small>{t.t('st.dormancy.notYetSuspended')}</small></>
                        : null}
                    </td>
                    <td>
                      <span className={statusClass(o.status)}>{t.t(statusKey(o.status))}</span>
                      {o.status === 'suspended' ? (
                        <>
                          <br /><small>{t.t(suspendKindKey(o.suspendKind))}</small>
                          {o.reinstateRequestedByAdminId
                            ? <><br /><small>{t.t('st.reinstate.pending')}</small></>
                            : null}
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {meta.nextCursor ? (
            <nav className="kv-pager" aria-label={t.t('common.pagination')}>
              <Link className="kv-btn" href={`/staff?${status ? `status=${status}&` : ''}cursor=${encodeURIComponent(meta.nextCursor)}`}>
                {t.t('common.next')}
              </Link>
            </nav>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
