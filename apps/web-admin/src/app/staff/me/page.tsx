// apps/web-admin/src/app/staff/me/page.tsx · W438 "My work" (PC-56 ADMIN-9).
//
// The session-and-step-up strip, dormancy, and quick links. **THE DESK TILES ARE NOT BUILT HERE AND THE PAGE SAYS SO
// (ADMIN-9-Q4).** W438 aggregates "assigned to you" counts across four other planes — tickets, recon exceptions,
// moderation reports, approvals awaiting you as checker — and not one of those planes has an assignment model for a
// PLATFORM operator: every `assigned_to` on this platform is an FK to `users`, the tenant realm's table. The counts
// would have to be invented, or silently rendered as "everything open on the plane" under a heading that says "assigned
// to you". Both are worse than an honest absence.
//
// WHAT IS REAL AND IS BUILT: the four-hour session and its step-up age (read from the token's own `auth_time`), the
// dormancy countdown against the policy row, the restrictions actually biting, and quick links that are LOCKED RATHER
// THAN HIDDEN per Law 11 — W438 makes that point itself: "locked tiles are not hidden, they name the role that unlocks
// them." A hidden tile teaches an operator the platform is smaller than it is.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import {
  QUICK_LINKS, dormancyClass, dormancyKey, lockedByRestriction, quickLinkUnlocked, stepUpClass, stepUpStateKey,
  type Dormancy,
} from '../../../features/staff/operators';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('st.me.title'), robots: { index: false, follow: false } };
}

interface Me {
  adminUserId: string; roles: string[]; amr: string[];
  session: {
    sessionId: string | null; stepUpAgeSec: number | null; stepUpMaxAgeSec: number; stepUpStale: boolean;
    nextStepUpInSec: number | null; tokenExpiresAt: string | null; hardwareKeyFactor: boolean;
  };
  dormancy: Dormancy | null;
  firstSeenAt: string | null;
  policy: { dormantAfterDays: number; suspendAfterDays: number };
  policyFromDatabase: boolean;
  permissions: { effective: string[]; grantedByRoles: string[]; restrictedCodes: string[]; godMode: boolean };
  restrictions: { permissionCode: string; reason: string; expiresAt: string | null }[];
  liveSessions: number;
  registryEnabled: boolean;
}

export default async function MyWorkPage() {
  requireAdmin();
  const t = getTranslator();

  let m: Me | null = null; let notice: string | undefined;
  try {
    const res = await adminGet<Me>('staff/me');
    m = res.data ?? null;
  } catch (e) {
    notice = e instanceof AdminApiError ? 'st.error.me' : 'st.error.me';
  }

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/dashboard">{t.t('nav.dashboard')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('st.me.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('st.me.title')}</h1>
        <p className="kv-page__sub">
          {m ? t.t('st.me.sub', { id: m.adminUserId.slice(0, 8), roles: m.roles.join(', ') || '—' }) : ''}
        </p>
      </header>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}

      {m ? (
        <>
          {!m.registryEnabled ? <p className="kv-note is-danger" role="alert">{t.t('st.roster.registryOff')}</p> : null}

          {/* SESSION & STEP-UP — two independent facts, rendered as two rows because a four-hour session with a re-auth
              twelve minutes ago is a different posture from one with none. */}
          <section className="kv-panel" aria-labelledby="st-session">
            <h2 id="st-session" className="kv-panel__title">{t.t('st.me.session')}</h2>
            <p className={stepUpClass(m.session.stepUpStale, m.session.hardwareKeyFactor)}>
              {t.t(stepUpStateKey(m.session.stepUpStale, m.session.hardwareKeyFactor), {
                age: m.session.stepUpAgeSec === null ? '—' : String(Math.floor(m.session.stepUpAgeSec / 60)),
                max: String(Math.floor(m.session.stepUpMaxAgeSec / 60)),
              })}
            </p>
            <dl className="kv-dl">
              <div><dt>{t.t('st.me.factor')}</dt><dd>{m.amr.join(', ') || '—'}</dd></div>
              <div><dt>{t.t('st.me.nextStepUp')}</dt><dd>
                {m.session.nextStepUpInSec === null ? t.t('st.me.stepUpNow')
                  : t.t('st.me.inMinutes', { n: String(Math.floor(m.session.nextStepUpInSec / 60)) })}
              </dd></div>
              <div><dt>{t.t('st.me.sessionExpires')}</dt><dd>
                {m.session.tokenExpiresAt ? m.session.tokenExpiresAt.slice(11, 16) : '—'}
              </dd></div>
              <div><dt>{t.t('st.me.liveSessions')}</dt><dd>
                {m.liveSessions} · <Link href="/staff/security">{t.t('st.nav.security')}</Link>
              </dd></div>
            </dl>
          </section>

          {/* DORMANCY — my own, computed from the same policy row the guard reads. */}
          <section className="kv-panel" aria-labelledby="st-dorm">
            <h2 id="st-dorm" className="kv-panel__title">{t.t('st.me.dormancy')}</h2>
            <p className={dormancyClass(m.dormancy)}>
              {t.t(dormancyKey(m.dormancy), {
                days: String(m.dormancy?.daysSinceSeen ?? 0),
                toSuspend: String(m.dormancy?.daysToSuspend ?? 0),
              })}
            </p>
            <p className="kv-note">
              {t.t('st.policy.lines', {
                dormant: String(m.policy.dormantAfterDays), suspend: String(m.policy.suspendAfterDays),
              })}
              {!m.policyFromDatabase ? ` ${t.t('st.policy.fallback')}` : ''}
            </p>
          </section>

          {/* RESTRICTIONS ON ME — shown to me, because being told which permission was removed and why is the
              difference between a control and an unexplained failure. */}
          {m.restrictions.length > 0 ? (
            <section className="kv-panel" aria-labelledby="st-mine">
              <h2 id="st-mine" className="kv-panel__title">{t.t('st.me.restrictions')}</h2>
              <ul className="kv-list">
                {m.restrictions.map((r) => (
                  <li key={r.permissionCode}>
                    <span className="kv-badge is-warn">{r.permissionCode}</span> {r.reason}
                    {r.expiresAt ? ` · ${t.t('st.restriction.until', { at: r.expiresAt.slice(0, 10) })}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* **THE DESK TILES, NAMED AS ABSENT.** */}
          <section className="kv-panel" aria-labelledby="st-desks">
            <h2 id="st-desks" className="kv-panel__title">{t.t('st.me.desks')}</h2>
            <p className="kv-note is-warn">{t.t('st.me.desksAbsent')}</p>
          </section>

          {/* QUICK LINKS — locked, never hidden. */}
          <section className="kv-panel" aria-labelledby="st-quick">
            <h2 id="st-quick" className="kv-panel__title">{t.t('st.me.quick')}</h2>
            <p className="kv-note">{t.t('st.me.quickNote')}</p>
            <ul className="kv-list">
              {QUICK_LINKS.map((l) => {
                const open = quickLinkUnlocked(l, m!.permissions.effective);
                const byRestriction = !open && lockedByRestriction(l, m!.permissions.grantedByRoles, m!.permissions.restrictedCodes);
                return (
                  <li key={l.href}>
                    {open ? (
                      <Link href={l.href}>{t.t(l.labelKey)}</Link>
                    ) : (
                      <span aria-disabled="true" className="kv-locked">
                        {t.t(l.labelKey)}{' — '}
                        {/* Two different sentences, because one is answered by asking for a role and the other by
                            asking why the restriction is there. */}
                        <small>{byRestriction
                          ? t.t('st.me.lockedByRestriction', { code: l.permission ?? '' })
                          : t.t('st.me.lockedByRole', { perm: l.permission ?? '' })}</small>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {m.permissions.godMode ? <p className="kv-note is-warn">{t.t('st.perms.godMode')}</p> : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
