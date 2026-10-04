// apps/web-tenant/src/app/me/security/page.tsx · `/me/security` — PC-56 TENANT-SW-c (needed for B3 / A3 to be real for staff).
//   • two-factor sign-in (TOTP, an authenticator app): enrol → confirm → recovery codes, all shown once (the client panel); disable
//     with a code. When the organisation requires 2FA for staff, every other console route answers "TWO_FACTOR_REQUIRED" until this is on;
//   • my conflict declarations: declaring one RECUSES me mechanically from that member's KYC decisions and take-next claims; only a
//     tenant administrator (not me) lifts it. Nothing is inferred from names or addresses.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { formatDate } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { ConflictDeclaration, TwoFactorState } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getLang, getTranslator } from '../../../lib/i18n';
import { CONFLICT_RELATIONS, ME_SECURITY_HREF, REASON_MAX, REASON_MIN, SWC_CODES, parseCodes, relationKey, swcCodeKey } from '../../../features/swc/console';
import { TwoFactorPanel } from './TwoFactorPanel';
import { declareMyConflictAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swc.me.title'), robots: { index: false, follow: false } };
}

const PANEL_KEYS = ['swc.tfa.panel.off', 'swc.tfa.panel.disabled', 'swc.tfa.panel.enrol', 'swc.tfa.panel.scan', 'swc.tfa.panel.shownOnce', 'swc.tfa.panel.code',
  'swc.tfa.panel.confirm', 'swc.tfa.panel.on', 'swc.tfa.panel.recoveryOnce', 'swc.tfa.panel.saved', 'swc.tfa.panel.recoveryLeft', 'swc.tfa.panel.disableTitle',
  'swc.tfa.panel.recovery', 'swc.tfa.panel.disable'] as const;

export default async function MySecurityPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(ME_SECURITY_HREF);
  const t = getTranslator(); const lang = getLang();
  let tfa: TwoFactorState | null = null; let conflicts: ConflictDeclaration[] = []; let failed = false;
  try { [tfa, conflicts] = await Promise.all([tenantClient().meSecurity.twoFactor(), tenantClient().meSecurity.conflicts()]); }
  catch (e) { failed = !(e instanceof SdkError && e.status === 404); }
  const q = (searchParams.q ?? '').slice(0, 60);
  let members: Array<{ userId: string; name: string | null; roles: string[] }> = [];
  try { members = (await tenantClient().meSecurity.conflictMembers(q)).slice(0, 20); } catch { members = []; }
  const labels = Object.fromEntries([...PANEL_KEYS.map((k) => [k, t.t(k)]), ...SWC_CODES.map((c) => [`swc.code.${c}`, t.t(swcCodeKey(c))])]);

  return (
    <section>
      <h1>{t.t('swc.me.title')}</h1>
      {failed && <div className="kv-error" role="alert"><p>{t.t('swc.state.error.body')}</p><p><Link href={ME_SECURITY_HREF} className="kv-btn--link">{t.t('swc.retryLoad')}</Link></p></div>}
      <h2>{t.t('swc.me.tfaTitle')}</h2>
      <p className="kv-field__hint">{t.t('swc.me.tfaLede')}</p>
      {tfa && <TwoFactorPanel labels={labels} confirmed={tfa.confirmed} recoveryLeft={tfa.recoveryLeft} />}

      <h2 id="conflicts">{t.t('swc.me.conflictsTitle')}</h2>
      <p className="kv-field__hint">{t.t('swc.desk.recusalRule')}</p>
      {parseCodes(searchParams.error).map((c) => <p key={c} className="kv-error" role="alert">{t.t(swcCodeKey(c))}</p>)}
      {searchParams.declared === '1' && <p className="kv-card kv-success" role="status">{t.t('swc.me.declared')}</p>}
      {conflicts.length === 0 ? <p className="kv-field__hint">{t.t('swc.staff.noConflicts')}</p> : (
        <ul className="kv-list">{conflicts.map((c) => (
          <li key={c.id}>{c.memberName ?? t.t('swc.unnamed')} · {t.t(relationKey(c.relation))} · {formatDate(c.createdAt, lang, { dateStyle: 'medium' })} · {c.active ? t.t('swc.conflict.active') : t.t('swc.conflict.lifted', { reason: c.revokeReason ?? '' })}</li>
        ))}</ul>
      )}
      <div className="kv-card">
        <form action={ME_SECURITY_HREF} method="get" className="kv-form kv-filters">
          <label className="kv-field" htmlFor="me-q"><span>{t.t('swc.field.memberSearch')}</span><input id="me-q" name="q" className="kv-input" defaultValue={q} maxLength={60} /></label>
          <button type="submit" className="kv-btn--link">{t.t('swc.field.search')}</button>
        </form>
        <form action={declareMyConflictAction} className="kv-form">
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />
          <label className="kv-field" htmlFor="me-member"><span>{t.t('swc.field.member')}</span>
            <select id="me-member" name="memberUserId" className="kv-select" required defaultValue="">
              <option value="" disabled>{t.t('swc.field.memberChoose')}</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.name ?? t.t('swc.unnamed')} · {m.roles.join(', ')}</option>)}</select></label>
          <label className="kv-field" htmlFor="me-rel"><span>{t.t('swc.field.relation')}</span>
            <select id="me-rel" name="relation" className="kv-select" required>{CONFLICT_RELATIONS.map((r) => <option key={r} value={r}>{t.t(relationKey(r))}</option>)}</select></label>
          <label className="kv-field" htmlFor="me-note"><span>{t.t('swc.field.relationNote')}</span><input id="me-note" name="relationNote" className="kv-input" maxLength={200} /></label>
          <label className="kv-field" htmlFor="me-reason"><span>{t.t('swc.field.reason')}</span>
            <textarea id="me-reason" name="reason" className="kv-textarea" rows={2} minLength={REASON_MIN} maxLength={REASON_MAX} required /></label>
          <p className="kv-field__hint">{t.t('swc.me.declareRule')}</p>
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('swc.me.declare')}</button>
        </form>
      </div>
      <p className="kv-field__hint">{t.t('swc.refused.nameInference')}</p>
    </section>
  );
}
