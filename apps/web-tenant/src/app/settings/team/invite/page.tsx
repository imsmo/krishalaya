// apps/web-tenant/src/app/settings/team/invite/page.tsx · THE TEAM MUTATE CHAIN — "Invite staff": W2335 confirm · W2336 success ·
// W2337 failure · PC-56 TENANT-SW-c (founder decision: SMS INVITE TOKEN).
//   • confirm — the form AND the rules, before anything is pressed: the invite goes by SMS (WhatsApp: no provider connected — refused by
//     name), carries a single-use token that expires in 7 days and is NEVER shown in this console (only sha256 of it is kept), accepting
//     needs the token AND a one-time code sent to the invited phone, and the seat is taken only when it is accepted (the seats line is real);
//   • success — the invite as the API answered (phone MASKED, expiry), and its audit entry; failure — every refusal by name, nothing written.
// "Retry" (W2337) is a page load back to confirm — refused by name as a mutation. Server component; the key is minted here.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { DeskBoard, TeamOverview } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../lib/i18n';
import { mutateStep, mutateStepKey } from '../../../../features/mutate/chain';
import { INVITE_LANGUAGES, TEAM_HREF, TEAM_INVITE_HREF, isUuid, parseCodes, seatTile, swcCodeKey, swcPageState } from '../../../../features/swc/console';
import { AuditEntryCard } from '../../../people/ambassadors/AuditEntryCard';
import { inviteAction } from '../team-actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swc.inviteChain.title'), robots: { index: false, follow: false } };
}

export default async function InviteStaffPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(TEAM_INVITE_HREF);
  const t = getTranslator(); const lang = getLang();
  const step = mutateStep(searchParams.step);
  let ov: TeamOverview | null = null; let board: DeskBoard | null = null; let state: string | null = null;
  if (step === 'confirm') {
    try { ov = await tenantClient().team.overview({ limit: 1 }); } catch (e) { const err = e instanceof SdkError ? e : null; state = swcPageState(err?.code, err?.status); }
    try { board = await tenantClient().desks.board(); } catch { board = null; }
  }
  const seats = ov ? seatTile(ov.seats) : null;
  const n = (x: number) => formatNumber(x, lang);

  return (
    <section>
      <nav aria-label={t.t('swc.breadcrumb.label')} className="kv-field__hint">{t.t('dk.breadcrumb.settings')} › <Link href={TEAM_HREF} className="kv-btn--link">{t.t('swc.team.title')}</Link> › {t.t('swc.inviteChain.title')}</nav>
      <h1>{t.t('swc.inviteChain.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('swc.chain.module')}</p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`swc.state.${state}.title`)}</strong><p>{t.t(`swc.state.${state}.body`)}</p></div>}

      {step === 'confirm' && ov && (
        <div className="kv-card">
          <ul className="kv-list">
            <li>{t.t('swc.inviteChain.rule.sms')}</li><li>{t.t('swc.inviteChain.rule.token')}</li><li>{t.t('swc.inviteChain.rule.otp')}</li>
            <li>{t.t('swc.inviteChain.rule.seat')} {seats && <strong>{t.t(seats.key, Object.fromEntries(Object.entries(seats.vars).map(([k, v]) => [k, typeof v === 'number' ? n(v) : v])))}</strong>}</li>
          </ul>
          {!ov.invitesEnabled ? <p className="kv-card kv-card--notice">{t.t('swc.team.invitesOff')}</p> : (
            <form action={inviteAction} className="kv-form">
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <label className="kv-field" htmlFor="inv-phone"><span>{t.t('swc.field.phone')}</span>
                <input id="inv-phone" name="phone" type="tel" inputMode="tel" autoComplete="off" className="kv-input" required minLength={8} maxLength={20} /></label>
              <label className="kv-field" htmlFor="inv-role"><span>{t.t('swc.field.role')}</span>
                <select id="inv-role" name="roleCode" className="kv-select" required defaultValue="">
                  <option value="" disabled>{t.t('swc.field.roleChoose')}</option>
                  {ov.staffRoles.map((r) => <option key={r} value={r}>{r}</option>)}
                </select></label>
              <fieldset className="kv-field"><legend>{t.t('swc.field.desks')}</legend>
                {(board?.desks ?? []).filter((d) => d.status === 'active').map((d) => (
                  <label key={d.id} className="kv-check"><input type="checkbox" name="deskIds" value={d.id} /> {d.name}</label>
                ))}
                {!board && <p className="kv-field__hint">{t.t('swc.field.desksUnreadable')}</p>}
              </fieldset>
              <label className="kv-field" htmlFor="inv-lang"><span>{t.t('swc.field.smsLanguage')}</span>
                <select id="inv-lang" name="languageCode" className="kv-select" defaultValue={['hi', 'gu'].includes(lang.slice(0, 2)) ? lang.slice(0, 2) : 'en'}>
                  {INVITE_LANGUAGES.map((l) => <option key={l} value={l}>{t.t(`swc.lang.${l}`)}</option>)}
                </select></label>
              <p className="kv-field__hint">{t.t('swc.refused.whatsapp')}</p>
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('swc.inviteChain.proceed')}</button>{' '}
              <Link href={TEAM_HREF} className="kv-btn--link">{t.t('swc.chain.cancel')}</Link>
            </form>
          )}
        </div>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-success" role="status">
            <strong>{t.t('swc.inviteChain.sent', { phone: searchParams.phone ?? t.t('common.dash') })}</strong>
            {searchParams.until && <p>{t.t('swc.inviteChain.until', { at: formatDate(searchParams.until, lang, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>}
            <p className="kv-field__hint">{t.t('swc.inviteChain.tokenNever')}</p>
            <p><Link href={TEAM_HREF} className="kv-btn kv-btn--primary">{t.t('swc.chain.back')}</Link></p>
          </div>
          {isUuid(searchParams.id) && <AuditEntryCard t={t} lang={lang} entityType="staff_invite" entityId={searchParams.id} action="team.invite.created" />}
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('swc.chain.failure')}</strong>
          <ul className="kv-list">{(parseCodes(searchParams.error).length ? parseCodes(searchParams.error) : ['unknown']).map((c) => <li key={c}>{t.t(swcCodeKey(c))}</li>)}</ul>
          <p>{t.t('swc.chain.untouched')}</p>
          <p><Link href={`${TEAM_INVITE_HREF}?step=confirm`} className="kv-btn--link">{t.t('swc.chain.retry')}</Link> <span className="kv-field__hint">{t.t('swc.refused.retry')}</span></p>
        </div>
      )}
    </section>
  );
}
