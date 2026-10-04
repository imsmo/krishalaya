// apps/web-tenant/src/app/settings/team/page.tsx · W183 · THE TEAM — PC-56 TENANT-SW-c.
//
// Founder decisions: STAFF SEATS PER PLAN · SMS INVITE TOKEN · TOTP 2FA FOR STAFF. Every figure is the API's (`GET /v1/team`):
//   • the seats tile — "N of M staff seats (<plan>)", a REAL count against the plan's `staff_seats`, or "unlimited (<plan>)";
//   • the table — Name · Role · Desks · Overrides (count) · 2FA (confirmed / not enrolled) · Last active (`users.last_active_at`) — µs keyset;
//   • "Maker-checker pairs live here" — for each rule the platform enforces with a second person, who holds the maker permission and who
//     can check, DERIVED from effective permissions (roles ∪ overrides ∪ desks − denies), never typed;
//   • pending invites (phone masked) with Revoke; privileged-override proposals waiting for a second administrator;
//   • Configure desks (13b) · Invite staff (chain W2335–W2337) · Add staff directly (the exception act, with a reason).
// "Team restricted — only tenant_admin manages staff" is the page's restricted state. Server component; no inline handlers.
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { TeamOverview } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getLang, getTranslator } from '../../../lib/i18n';
import {
  DESKS_HREF, TEAM_HREF, TEAM_INVITE_HREF, inviteStatusKey, pairKey, seatTile, sessionBoundVars, staffHref, swcPageState, teamActHref, twoFactorKey,
} from '../../../features/swc/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swc.team.title'), robots: { index: false, follow: false } };
}

export default async function TeamPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(TEAM_HREF);
  const t = getTranslator(); const lang = getLang();
  const n = (x: number) => formatNumber(x, lang);
  const at = (iso: string | null) => (iso ? formatDate(iso, lang, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : t.t('common.dash'));
  const cursor = typeof searchParams.cursor === 'string' && searchParams.cursor.length <= 400 ? searchParams.cursor : undefined;
  let ov: TeamOverview | null = null; let state: string | null = null;
  try { ov = await tenantClient().team.overview({ cursor, limit: 25 }); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = swcPageState(err?.code, err?.status); }

  if (!ov) {
    return (
      <section>
        <h1>{t.t('swc.team.title')}</h1>
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <h2>{t.t(`swc.state.${state ?? 'error'}.title`)}</h2><p>{t.t(`swc.state.${state ?? 'error'}.body`)}</p>
          {state === 'error' && <p><Link href={TEAM_HREF} className="kv-btn--link">{t.t('swc.retryLoad')}</Link> <span className="kv-field__hint">{t.t('swc.refused.retry')}</span></p>}
        </div>
      </section>
    );
  }
  const seats = seatTile(ov.seats);
  const bound = sessionBoundVars(ov.sessionEndBoundSec, ov.accessTokenTtlSec);
  const full = ov.seats.kind === 'limited' && ov.seats.full;

  return (
    <section>
      <nav aria-label={t.t('swc.breadcrumb.label')} className="kv-field__hint">{t.t('dk.breadcrumb.settings')} › {t.t('swc.team.title')}</nav>
      <h1>{t.t('swc.team.title')}</h1>
      <p className="kv-field__hint">{t.t('swc.team.restrictedNote')}</p>
      <dl className="kv-tiles">
        <div className="kv-tile"><dt>{t.t('swc.seats.title')}</dt><dd><strong>{t.t(seats.key, Object.fromEntries(Object.entries(seats.vars).map(([k, v]) => [k, typeof v === 'number' ? n(v) : v])))}</strong></dd>
          <dd className="kv-field__hint">{t.t('swc.seats.hint')}</dd></div>
        <div className="kv-tile"><dt>{t.t('swc.team.sessions')}</dt><dd>{t.t('swc.team.sessionsBound', { sec: n(bound.sec), min: n(bound.ttlMin) })}</dd></div>
      </dl>
      <p>
        {ov.invitesEnabled ? <Link href={TEAM_INVITE_HREF} className={`kv-btn${full ? '' : ' kv-btn--primary'}`}>{t.t('swc.team.invite')}</Link> : <span className="kv-field__hint">{t.t('swc.team.invitesOff')}</span>}{' '}
        <Link href={teamActHref('add_directly')} className="kv-btn">{t.t('swc.team.addDirectly')}</Link>{' '}
        <Link href={DESKS_HREF} className="kv-btn--link">{t.t('swc.team.configureDesks')}</Link>
      </p>
      {full && <p className="kv-card kv-card--notice" role="status">{t.t('swc.seats.fullUpgrade')}</p>}

      <h2>{t.t('swc.team.staff')}</h2>
      {ov.staff.length === 0 ? <p className="kv-field__hint">{t.t('swc.team.empty')}</p> : (
        <table className="kv-table">
          <caption className="kv-sr-only">{t.t('swc.team.staff')}</caption>
          <thead><tr><th scope="col">{t.t('swc.col.name')}</th><th scope="col">{t.t('swc.col.role')}</th><th scope="col">{t.t('swc.col.desks')}</th><th scope="col">{t.t('swc.col.overrides')}</th><th scope="col">{t.t('swc.col.tfa')}</th><th scope="col">{t.t('swc.col.lastActive')}</th></tr></thead>
          <tbody>{ov.staff.map((s) => (
            <tr key={s.userId}>
              <th scope="row"><Link href={staffHref(s.userId)} className="kv-btn--link">{s.name ?? t.t('swc.unnamed')}</Link>{s.suspended && <span className="kv-badge kv-badge--warn"> {t.t('swc.suspended')}</span>}</th>
              <td>{s.roles.join(', ')}</td>
              <td>{s.desks.length ? s.desks.map((d) => d.name).join(', ') : t.t('common.dash')}</td>
              <td>{n(s.overrides)}</td>
              <td><span className={`kv-badge kv-badge--${s.twoFactor === 'confirmed' ? 'ok' : 'muted'}`}>{t.t(twoFactorKey(s.twoFactor))}</span></td>
              <td>{at(s.lastActiveAt)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {ov.nextCursor && <p><Link href={`${TEAM_HREF}?cursor=${encodeURIComponent(ov.nextCursor)}`} className="kv-btn--link">{t.t('swc.team.more')}</Link></p>}

      <h2>{t.t('swc.pairs.title')}</h2>
      <p className="kv-field__hint">{t.t('swc.pairs.lede', { n: n(ov.pairsOver) })}</p>
      <ul className="kv-list">{ov.pairs.map((p) => (
        <li key={p.code}><strong>{t.t(pairKey(p.code))}</strong> — {t.t('swc.pairs.makers')}: {p.makers.length ? p.makers.map((m) => m.name ?? t.t('swc.unnamed')).join(', ') : t.t('swc.pairs.nobody')}
          {' · '}{t.t('swc.pairs.checkers')}: {p.checkers.length ? p.checkers.map((m) => m.name ?? t.t('swc.unnamed')).join(', ') : t.t('swc.pairs.nobody')}
          {!p.live && <span className="kv-badge kv-badge--warn"> {t.t('swc.pairs.notLive')}</span>}
          <span className="kv-field__hint"> · {p.enforcedBy}</span></li>
      ))}</ul>

      <h2>{t.t('swc.invites.title')}</h2>
      {ov.invites.length === 0 ? <p className="kv-field__hint">{t.t('swc.invites.none')}</p> : (
        <table className="kv-table">
          <thead><tr><th scope="col">{t.t('swc.col.phone')}</th><th scope="col">{t.t('swc.col.role')}</th><th scope="col">{t.t('swc.col.status')}</th><th scope="col">{t.t('swc.col.expires')}</th><th scope="col">{t.t('swc.col.act')}</th></tr></thead>
          <tbody>{ov.invites.map((i) => (
            <tr key={i.id}><th scope="row">{i.phoneMasked}</th><td>{i.roleCode}</td>
              <td>{t.t(inviteStatusKey(i.live ? i.status : 'expired'))}{i.sentAt ? <span className="kv-field__hint"> · {t.t('swc.invites.sent')}</span> : i.sendFailure ? <span className="kv-field__hint"> · {t.t('swc.invites.notSent')}</span> : <span className="kv-field__hint"> · {t.t('swc.invites.queued')}</span>}</td>
              <td>{at(i.expiresAt)}</td>
              <td><Link href={teamActHref('revoke_invite', { inviteId: i.id })} className="kv-btn--link">{t.t('swc.invites.revoke')}</Link></td></tr>
          ))}</tbody>
        </table>
      )}

      <h2>{t.t('swc.proposals.title')}</h2>
      {ov.proposals.length === 0 ? <p className="kv-field__hint">{t.t('swc.proposals.none')}</p> : (
        <ul className="kv-list">{ov.proposals.map((p) => (
          <li key={p.id}>{t.t('swc.proposals.line', { who: p.granteeName ?? t.t('swc.unnamed'), perm: p.permissionCode, by: p.proposedByName ?? t.t('swc.unnamed') })}
            {' · '}<Link href={staffHref(p.granteeUserId)} className="kv-btn--link">{t.t('swc.proposals.open')}</Link></li>
        ))}</ul>
      )}
      <p className="kv-field__hint">{t.t('swc.refused.whatsapp')}</p>
    </section>
  );
}
