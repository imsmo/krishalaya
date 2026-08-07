// apps/web-admin/src/app/staff/[id]/page.tsx · W104's operator detail + deactivation (PC-56 ADMIN-9).
//
// One operator: what the realm has observed, what their permissions actually are after restrictions, their sessions, and
// the controls that remove access.
//
// **THE APPROVE-REINSTATEMENT CONTROL IS ABSENT FOR THE REQUESTER, NEVER DISABLED** — maker-checker by absence, and the
// fourteenth site. The server refuses three ways over (`assertReinstatable`, the UPDATE's own `<>` predicate, and 0118's
// CHECK) because this is the door back into god mode; a greyed-out button would teach an operator that the rule is a UI
// preference.
//
// **BOTH PERMISSION SETS ARE SHOWN.** "Your roles hold this and a restriction removes it" is a different answer from
// "your roles do not hold this", and an operator who cannot tell them apart escalates the wrong problem.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin, adminUserId } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import {
  canApproveReinstate, canRequestReinstate, canRevokeSession, dormancyClass, dormancyKey, gateKey,
  pastLineIsNotSuspended, reinstateAbsenceKey, restrictionClass, restrictionCodeLabel, restrictionKey,
  restrictionState, revokeLabelKey, sessionClass, sessionKey, sessionState, statusClass, statusKey, stepUpOutcomeClass,
  suspendKindKey, type Dormancy,
} from '../../../features/staff/operators';
import {
  liftRestrictionAction, requestReinstateAction, reinstateOperatorAction, restrictOperatorAction,
  revokeOperatorSessionAction, suspendOperatorAction,
} from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('st.operator.title'), robots: { index: false, follow: false } };
}

interface Operator {
  adminUserId: string; status: string; lastRoles: string[]; lastAmr: string[];
  firstSeenAt: string; lastSeenAt: string; lastSeenIp: string | null; requestCount: number; note: string | null;
  dormancy: Dormancy;
  suspension: {
    at: string | null; kind: string | null; reason: string | null; byAdminId: string | null;
    reinstateRequestedByAdminId: string | null; reinstateReason: string | null;
  } | null;
  reinstatedAt: string | null; reinstatedByAdminId: string | null;
  permissions: { grantedByRoles: string[]; effective: string[]; removedByRestriction: string[]; godMode: boolean };
  restrictions: {
    id: string; permissionCode: string; reason: string; appliedByAdminId: string; createdAt: string;
    expiresAt: string | null; liftedAt: string | null; liftedByAdminId: string | null; liftReason: string | null;
    inForce: boolean; inert: boolean;
  }[];
  sessions: {
    sessionId: string; firstSeenAt: string; lastSeenAt: string; ip: string | null; userAgent: string | null;
    authTimeAt: string | null; amr: string[]; tokenExpiresAt: string | null;
    revokedAt: string | null; revokedByAdminId: string | null; revokeReason: string | null; expired: boolean;
  }[];
  liveSessions: number;
  stepUps: { gate: string; actionRoute: string; outcome: string; detail: string | null; userAgent: string | null; at: string }[];
  denyOnlyRationale: string;
  revocationTakesEffect: string;
}

export default async function OperatorPage({ params, searchParams }: {
  params: { id: string }; searchParams: { ok?: string; error?: string };
}) {
  requireAdmin();
  const t = getTranslator();
  const me = adminUserId();
  const nowMs = Date.now();

  let o: Operator | null = null; let notice: string | undefined;
  try {
    const res = await adminGet<Operator>(`staff/operators/${encodeURIComponent(params.id)}`);
    o = res.data ?? null;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = e instanceof AdminApiError && e.status === 403 ? 'st.restricted.roster' : 'st.error.operator';
  }
  if (!o && !notice) notFound();

  const isSelf = !!o && o.adminUserId === me;
  const suspension = o?.suspension ?? null;
  const showRequest = !!suspension && canRequestReinstate({ status: o!.status, reinstateRequestedByAdminId: suspension.reinstateRequestedByAdminId });
  const showApprove = !!suspension && canApproveReinstate({ status: o!.status, reinstateRequestedByAdminId: suspension.reinstateRequestedByAdminId }, me);
  const absence = suspension ? reinstateAbsenceKey({ status: o!.status, reinstateRequestedByAdminId: suspension.reinstateRequestedByAdminId }, me) : null;

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/staff">{t.t('st.roster.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{params.id.slice(0, 8)}</span>
      </nav>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}
      {searchParams.ok ? <p className="kv-note is-ok" role="status">{t.t(`st.ok.${searchParams.ok}`)}</p> : null}
      {searchParams.error ? <p className="kv-note is-danger" role="alert">{t.t(`st.err.${searchParams.error}`)}</p> : null}

      {o ? (
        <>
          <header className="kv-page__head">
            <h1>{t.t('st.operator.title')} {o.adminUserId.slice(0, 8)}</h1>
            <p className="kv-page__sub">
              <span className={statusClass(o.status)}>{t.t(statusKey(o.status))}</span>{' '}
              <span className={dormancyClass(o.dormancy)}>{t.t(dormancyKey(o.dormancy), {
                days: String(o.dormancy.daysSinceSeen), toSuspend: String(o.dormancy.daysToSuspend ?? 0),
              })}</span>
              {isSelf ? <> · {t.t('st.operator.thisIsYou')}</> : null}
            </p>
          </header>

          {/* THE OBSERVED RECORD. Every field is something the realm saw on a real request. */}
          <section className="kv-panel" aria-labelledby="st-observed">
            <h2 id="st-observed" className="kv-panel__title">{t.t('st.operator.observed')}</h2>
            <dl className="kv-dl">
              <div><dt>{t.t('st.col.operator')}</dt><dd>{o.adminUserId}</dd></div>
              <div><dt>{t.t('st.col.rolesSeen')}</dt><dd>{o.lastRoles.join(', ') || '—'}</dd></div>
              <div><dt>{t.t('st.col.factor')}</dt><dd>{o.lastAmr.join(', ') || '—'}</dd></div>
              <div><dt>{t.t('st.operator.firstSeen')}</dt><dd>{o.firstSeenAt.slice(0, 16).replace('T', ' ')}</dd></div>
              <div><dt>{t.t('st.col.lastSeen')}</dt><dd>{o.lastSeenAt.slice(0, 16).replace('T', ' ')} {o.lastSeenIp ? `· ${o.lastSeenIp}` : ''}</dd></div>
              <div><dt>{t.t('st.operator.requests')}</dt><dd>{o.requestCount.toLocaleString('en-IN')}</dd></div>
            </dl>
            {/* NO NAME, AND THE ABSENCE IS EXPLAINED — the admin token carries no name claim, so a display name here
                would be invented. */}
            <p className="kv-note">{t.t('st.operator.noName')}</p>
            {pastLineIsNotSuspended(o.dormancy)
              ? <p className="kv-note is-danger">{t.t('st.dormancy.notYetSuspended')}</p> : null}
          </section>

          {/* PERMISSIONS — both sets. */}
          <section className="kv-panel" aria-labelledby="st-perms">
            <h2 id="st-perms" className="kv-panel__title">{t.t('st.perms.title')}</h2>
            {o.permissions.godMode ? <p className="kv-note is-warn">{t.t('st.perms.godMode')}</p> : null}
            <p>{t.t('st.perms.counts', {
              effective: String(o.permissions.effective.length),
              granted: String(o.permissions.grantedByRoles.length),
            })}</p>
            {o.permissions.removedByRestriction.length > 0 ? (
              <p className="kv-note is-warn">
                {t.t('st.perms.removed', { list: o.permissions.removedByRestriction.join(', ') })}
              </p>
            ) : null}
            <p className="kv-note">
              {t.t('st.perms.source')}{' '}<Link href="/staff/roles">{t.t('st.nav.roles')}</Link>
            </p>
          </section>

          {/* RESTRICTIONS — deny only, and the rationale quoted from the backend so there is one wording. */}
          <section className="kv-panel" aria-labelledby="st-restr">
            <h2 id="st-restr" className="kv-panel__title">{t.t('st.restriction.title')}</h2>
            <p className="kv-note is-warn">{o.denyOnlyRationale}</p>
            {o.restrictions.length === 0 ? (
              <p className="kv-note">{t.t('st.restriction.none')}</p>
            ) : (
              <table className="kv-table">
                <thead>
                  <tr>
                    <th scope="col">{t.t('st.col.permission')}</th>
                    <th scope="col">{t.t('st.col.reason')}</th>
                    <th scope="col">{t.t('st.col.applied')}</th>
                    <th scope="col">{t.t('st.col.state')}</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {o.restrictions.map((r) => {
                    const state = restrictionState(r, nowMs);
                    const label = restrictionCodeLabel(r.permissionCode);
                    return (
                      <tr key={r.id}>
                        <td>{t.t(label.key, { code: label.code ?? '' })}</td>
                        <td>{r.reason}</td>
                        <td>{r.appliedByAdminId.slice(0, 8)} · {r.createdAt.slice(0, 10)}
                          {r.expiresAt ? <><br /><small>{t.t('st.restriction.until', { at: r.expiresAt.slice(0, 10) })}</small></> : null}
                        </td>
                        <td>
                          <span className={restrictionClass(state)}>{t.t(restrictionKey(state))}</span>
                          {/* A restriction that removes nothing is not protecting anything, and a reader told "in
                              force" would believe it is why something else is failing. */}
                          {state === 'inert' ? <><br /><small>{t.t('st.restriction.inertWhy')}</small></> : null}
                        </td>
                        <td>
                          {state === 'in_force' || state === 'inert' ? (
                            <form action={liftRestrictionAction}>
                              <input type="hidden" name="adminUserId" value={o.adminUserId} />
                              <input type="hidden" name="restrictionId" value={r.id} />
                              <input className="kv-input kv-input--sm" name="reason" required minLength={10}
                                placeholder={t.t('st.restriction.liftReason')} />
                              <button className="kv-btn kv-btn--link" type="submit">{t.t('st.restriction.lift')}</button>
                            </form>
                          ) : r.liftedAt ? <small>{t.t('st.restriction.liftedBy', { who: (r.liftedByAdminId ?? '').slice(0, 8), at: r.liftedAt.slice(0, 10) })}</small> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            <form action={restrictOperatorAction}>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="st-code">{t.t('st.col.permission')}</label>
                <input className="kv-input" id="st-code" name="permissionCode" required maxLength={80}
                  aria-describedby="st-code-help" />
                <p className="kv-field__help" id="st-code-help">{t.t('st.restriction.codeHelp')}</p>
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="st-rreason">{t.t('st.col.reason')}</label>
                <input className="kv-input" id="st-rreason" name="reason" required minLength={10} maxLength={2000} />
              </div>
              <div className="kv-field">
                <label className="kv-field__label" htmlFor="st-expiry">{t.t('st.restriction.expiryDays')}</label>
                <input className="kv-input" id="st-expiry" name="expiresInDays" type="number" min={1} max={3650} />
                <p className="kv-field__help">{t.t('st.restriction.expiryHelp')}</p>
              </div>
              <input type="hidden" name="adminUserId" value={o.adminUserId} />
              <button className="kv-btn" type="submit">{t.t('st.restriction.add')}</button>
            </form>
          </section>

          {/* SESSIONS */}
          <section className="kv-panel" aria-labelledby="st-sess">
            <h2 id="st-sess" className="kv-panel__title">{t.t('st.session.title')}</h2>
            <p className="kv-note">{t.t('st.session.takesEffect', { when: o.revocationTakesEffect })}</p>
            {o.sessions.length === 0 ? (
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
                  {o.sessions.map((s) => {
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
                            <form action={revokeOperatorSessionAction}>
                              <input type="hidden" name="adminUserId" value={o.adminUserId} />
                              <input type="hidden" name="sessionId" value={s.sessionId} />
                              <input className="kv-input kv-input--sm" name="reason" required minLength={5}
                                placeholder={t.t('st.session.reasonHint')} />
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

          {/* THE ACCESS CONTROLS */}
          <section className="kv-panel" aria-labelledby="st-access">
            <h2 id="st-access" className="kv-panel__title">{t.t('st.access.title')}</h2>

            {o.status === 'active' ? (
              <form action={suspendOperatorAction}>
                <p className="kv-note is-warn">{t.t('st.access.suspendWhat')}</p>
                {isSelf ? <p className="kv-note">{t.t('st.access.suspendSelf')}</p> : null}
                <div className="kv-field">
                  <label className="kv-field__label" htmlFor="st-sreason">{t.t('st.col.reason')}</label>
                  <input className="kv-input" id="st-sreason" name="reason" required minLength={10} maxLength={2000}
                    placeholder={t.t('st.access.suspendReasonHint')} />
                </div>
                <input type="hidden" name="adminUserId" value={o.adminUserId} />
                <button className="kv-btn kv-btn--danger" type="submit">{t.t('st.access.suspend')}</button>
              </form>
            ) : (
              <>
                <dl className="kv-dl">
                  <div><dt>{t.t('st.access.suspendedAt')}</dt><dd>{suspension?.at?.slice(0, 16).replace('T', ' ') ?? '—'}</dd></div>
                  <div><dt>{t.t('st.access.suspendedKind')}</dt><dd>{t.t(suspendKindKey(suspension?.kind ?? null))}</dd></div>
                  <div><dt>{t.t('st.col.reason')}</dt><dd>{suspension?.reason ?? '—'}</dd></div>
                  <div><dt>{t.t('st.access.suspendedBy')}</dt><dd>{suspension?.byAdminId?.slice(0, 8) ?? t.t('st.suspend.bySystem')}</dd></div>
                </dl>

                {/* **REINSTATEMENT: TWO PEOPLE, AND THE CONTROL IS ABSENT RATHER THAN DISABLED.** */}
                <p className="kv-note is-warn">{t.t('st.reinstate.rule')}</p>
                {absence ? <p className="kv-note">{t.t(absence)}</p> : null}

                {showRequest ? (
                  <form action={requestReinstateAction}>
                    <div className="kv-field">
                      <label className="kv-field__label" htmlFor="st-rrreason">{t.t('st.reinstate.reason')}</label>
                      <input className="kv-input" id="st-rrreason" name="reason" required minLength={10} maxLength={2000} />
                    </div>
                    <input type="hidden" name="adminUserId" value={o.adminUserId} />
                    <button className="kv-btn" type="submit">{t.t('st.reinstate.request')}</button>
                  </form>
                ) : null}

                {suspension?.reinstateRequestedByAdminId ? (
                  <p className="kv-note">
                    {t.t('st.reinstate.requestedBy', {
                      who: suspension.reinstateRequestedByAdminId.slice(0, 8),
                      reason: suspension.reinstateReason ?? '',
                    })}
                  </p>
                ) : null}

                {showApprove ? (
                  <form action={reinstateOperatorAction}>
                    <input type="hidden" name="adminUserId" value={o.adminUserId} />
                    <button className="kv-btn kv-btn--primary" type="submit">{t.t('st.reinstate.approve')}</button>
                  </form>
                ) : null}
              </>
            )}
          </section>

          {/* STEP-UP HISTORY — including the refusals, which are the half a security page exists for. */}
          <section className="kv-panel" aria-labelledby="st-stepup">
            <h2 id="st-stepup" className="kv-panel__title">{t.t('st.stepUp.title')}</h2>
            {o.stepUps.length === 0 ? (
              <p className="kv-note">{t.t('st.stepUp.none')}</p>
            ) : (
              <table className="kv-table">
                <thead>
                  <tr>
                    <th scope="col">{t.t('st.col.when')}</th>
                    <th scope="col">{t.t('st.col.gate')}</th>
                    <th scope="col">{t.t('st.col.action')}</th>
                    <th scope="col">{t.t('st.col.outcome')}</th>
                  </tr>
                </thead>
                <tbody>
                  {o.stepUps.map((e, i) => (
                    <tr key={`${e.at}-${i}`}>
                      <td>{e.at.slice(0, 16).replace('T', ' ')}</td>
                      <td>{t.t(gateKey(e.gate))}</td>
                      <td>{e.actionRoute}</td>
                      <td>
                        <span className={stepUpOutcomeClass(e.outcome)}>{t.t(`st.stepUp.${e.outcome}`)}</span>
                        {e.detail ? <><br /><small>{e.detail}</small></> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
