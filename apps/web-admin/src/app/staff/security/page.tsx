// apps/web-admin/src/app/staff/security/page.tsx · W439 "My security" (PC-56 ADMIN-9).
//
// My sessions, my step-up history, my dormancy. No permission is required to read this page or to end one of my own
// sessions — signing out a device I have lost is not a privileged act, and gating it would leave the one credential an
// attacker is actually using.
//
// **THE SESSION LIST AND THE REVOKE CONTROL ARE THE FIRST OF THEIR KIND ON THIS PLATFORM.** The `sid` claim has been
// minted and carried since the realm was built and read by nothing: `clearAdminSession()` deleted a cookie, and a copied
// bearer kept working until it expired. A revoked session is now refused by `AdminAuthGuard` on its next request.
//
// **THE FIDO2 KEY LIST IS NOT BUILT, AND W439'S OWN BANNER IS WRONG ABOUT WHY.** It says no credentials table exists in
// schema. One does — `fido2_credentials`, migration 0074 — and it references `users(id)`, the TENANT realm's table. So a
// platform operator has no row in it and cannot be given one without the cross-tenant identity the two-realm split
// exists to prevent (ADMIN-9-Q3). An empty key list would read as a fact about the operator; this reads as the fact
// about the schema that it is.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { revokeOwnSessionAction } from '../actions';
import {
  canRevokeSession, dormancyClass, dormancyKey, gateKey, keyListKey, keyListState, revokeLabelKey, sessionClass,
  sessionKey, sessionState, stepUpClass, stepUpOutcomeClass, stepUpStateKey, type Dormancy,
} from '../../../features/staff/operators';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('st.security.title'), robots: { index: false, follow: false } };
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
  sessions: {
    sessionId: string; current: boolean; firstSeenAt: string; lastSeenAt: string; ip: string | null;
    userAgent: string | null; tokenExpiresAt: string | null; revokedAt: string | null; revokeReason: string | null;
    expired: boolean;
  }[];
  liveSessions: number;
  stepUps: { gate: string; actionRoute: string; outcome: string; detail: string | null; userAgent: string | null; at: string }[];
  fido2: { keyListAvailable: boolean; tableExists: boolean; gap: string; knownFromToken: boolean };
}

export default async function MySecurityPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let m: Me | null = null; let notice: string | undefined;
  try {
    const res = await adminGet<Me>('staff/me');
    m = res.data ?? null;
  } catch (e) {
    notice = e instanceof AdminApiError ? 'st.error.me' : 'st.error.me';
  }

  const keys = m ? keyListState(m.fido2.keyListAvailable, 0) : 'unavailable';

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/staff/me">{t.t('st.me.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('st.security.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('st.security.title')}</h1>
        <p className="kv-page__sub">{t.t('st.security.sub')}</p>
      </header>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}
      {searchParams.ok ? <p className="kv-note is-ok" role="status">{t.t(`st.ok.${searchParams.ok}`)}</p> : null}
      {searchParams.error ? <p className="kv-note is-danger" role="alert">{t.t(`st.err.${searchParams.error}`)}</p> : null}

      {m ? (
        <>
          {/* THE KEYS — an honest absence rather than an empty list. */}
          <section className="kv-panel" aria-labelledby="st-keys">
            <h2 id="st-keys" className="kv-panel__title">{t.t('st.keys.title')}</h2>
            <p className="kv-note is-warn">{t.t(keyListKey(keys), { owner: m.fido2.gap })}</p>
            <p className="kv-note">
              {m.fido2.knownFromToken ? t.t('st.keys.factorPresent') : t.t('st.keys.factorAbsent')}
            </p>
          </section>

          {/* STEP-UP STATE + HISTORY */}
          <section className="kv-panel" aria-labelledby="st-su">
            <h2 id="st-su" className="kv-panel__title">{t.t('st.stepUp.title')}</h2>
            <p className={stepUpClass(m.session.stepUpStale, m.session.hardwareKeyFactor)}>
              {t.t(stepUpStateKey(m.session.stepUpStale, m.session.hardwareKeyFactor), {
                age: m.session.stepUpAgeSec === null ? '—' : String(Math.floor(m.session.stepUpAgeSec / 60)),
                max: String(Math.floor(m.session.stepUpMaxAgeSec / 60)),
              })}
            </p>
            {m.stepUps.length === 0 ? (
              // Recording began with this release, so an empty log is not a clean history — the same distinction the
              // residency evidence log had to make in ADMIN-8b.
              <p className="kv-note">{t.t('st.stepUp.noneYet')}</p>
            ) : (
              <table className="kv-table">
                <caption className="kv-table__caption">{t.t('st.stepUp.caption')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t.t('st.col.when')}</th>
                    <th scope="col">{t.t('st.col.gate')}</th>
                    <th scope="col">{t.t('st.col.action')}</th>
                    <th scope="col">{t.t('st.col.outcome')}</th>
                    <th scope="col">{t.t('st.col.device')}</th>
                  </tr>
                </thead>
                <tbody>
                  {m.stepUps.map((e, i) => (
                    <tr key={`${e.at}-${i}`}>
                      <td>{e.at.slice(0, 16).replace('T', ' ')}</td>
                      <td>{t.t(gateKey(e.gate))}</td>
                      <td>{e.actionRoute}</td>
                      <td>
                        {/* THE REFUSALS ARE THE HALF THAT MATTERS: a log of successes answers "did I re-authenticate";
                            only the refusals answer "did somebody try to reach a gated action without the key". */}
                        <span className={stepUpOutcomeClass(e.outcome)}>{t.t(`st.stepUp.${e.outcome}`)}</span>
                        {e.detail ? <><br /><small>{e.detail}</small></> : null}
                      </td>
                      <td>{e.userAgent ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="kv-note">{t.t('st.stepUp.immutable')}</p>
          </section>

          {/* DORMANCY */}
          <section className="kv-panel" aria-labelledby="st-dorm2">
            <h2 id="st-dorm2" className="kv-panel__title">{t.t('st.me.dormancy')}</h2>
            <p className={dormancyClass(m.dormancy)}>
              {t.t(dormancyKey(m.dormancy), {
                days: String(m.dormancy?.daysSinceSeen ?? 0),
                toSuspend: String(m.dormancy?.daysToSuspend ?? 0),
              })}
            </p>
            <p className="kv-note">{t.t('st.policy.lines', {
              dormant: String(m.policy.dormantAfterDays), suspend: String(m.policy.suspendAfterDays),
            })}</p>
            {/* The reactivation path W439 describes, and the half of it this realm enforces: a reinstatement needs two
                administrators, which is 0118's fourteenth maker-checker site. */}
            <p className="kv-note">{t.t('st.me.reactivation')}</p>
          </section>

          {/* SESSIONS — the first revocation this realm has ever had. */}
          <section className="kv-panel" aria-labelledby="st-sess2">
            <h2 id="st-sess2" className="kv-panel__title">{t.t('st.session.title')}</h2>
            <p className="kv-note">{t.t('st.session.takesEffect', { when: 'next request to admin-api' })}</p>
            {m.sessions.length === 0 ? (
              <p className="kv-note">{t.t('st.session.none')}</p>
            ) : (
              <table className="kv-table">
                <thead>
                  <tr>
                    <th scope="col">{t.t('st.col.device')}</th>
                    <th scope="col">{t.t('st.col.ip')}</th>
                    <th scope="col">{t.t('st.col.started')}</th>
                    <th scope="col">{t.t('st.col.state')}</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {m.sessions.map((s) => {
                    const state = sessionState(s);
                    return (
                      <tr key={s.sessionId}>
                        <td>{s.userAgent ?? '—'}<br /><small>{s.sessionId.slice(0, 12)}</small></td>
                        <td>{s.ip ?? '—'}</td>
                        <td>{s.firstSeenAt.slice(0, 16).replace('T', ' ')}
                          {s.tokenExpiresAt ? <><br /><small>{t.t('st.session.expires', { at: s.tokenExpiresAt.slice(11, 16) })}</small></> : null}
                        </td>
                        <td>
                          <span className={sessionClass(state)}>{t.t(sessionKey(state))}</span>
                          {s.revokeReason ? <><br /><small>{s.revokeReason}</small></> : null}
                        </td>
                        <td>
                          {canRevokeSession(state) ? (
                            <form action={revokeOwnSessionAction}>
                              <input type="hidden" name="sessionId" value={s.sessionId} />
                              <input className="kv-input kv-input--sm" name="reason" required minLength={5}
                                placeholder={t.t('st.session.reasonHint')} />
                              {/* The button says what pressing it does BEFORE it is pressed: revoking the session you
                                  are holding signs you out. */}
                              <button className="kv-btn kv-btn--danger" type="submit">{t.t(revokeLabelKey(state))}</button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
