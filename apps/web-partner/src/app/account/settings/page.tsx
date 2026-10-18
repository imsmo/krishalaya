// apps/web-partner/src/app/account/settings/page.tsx · PC-56 PARTNER-1a · founder D5 — ORGANISATION SETTINGS (canon W269, its own path
// `account/settings`). Reads `/v1/partner/me` (identity, the published promise), the dashboard read's latency (the actuals) and — for an
// administrator — `/v1/partner/team`. `?act=revoke_invite|remove_member&id=…` is the act's confirm; `?form=error|review|success|failure` the
// Save-changes chain (W3002–W3005, DECOR). The invite chain (W3006–W3008, REAL) is a client step machine whose Idempotency-Key is minted HERE,
// at render. A 404 while `partner_console` is OFF prints the switched-off sentence. components/partner1/SettingsView.tsx renders.
import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { SdkError, type PartnerDashboard, type PartnerMe } from '@krishalaya/sdk-js';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { partnerConsoleSwitch } from '../../../lib/console-flag';
import { en } from '../../../i18n/en';
import { ChainNotice } from '../../../components/partner1/ChainNotice';
import { ActConfirm, SettingsView, type TeamState } from '../../../components/partner1/SettingsView';
import { InviteChain } from '../../../components/partner1/InviteChain';
import { chainState } from '../../../features/partner1/refusals';
import { settingsAct } from '../../../features/partner1/settings';
import { failureOf } from '../../../features/partner1/dashboard';
import { inviteMemberAction, teamActAction } from './actions';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner1.settings.title'), robots: { index: false, follow: false } };
}

export default async function SettingsPage({ searchParams }: { searchParams?: SP }) {
  const persona = await requirePartner();
  const t = getTranslator(); const lang = getLang();
  const form = chainState('settings_form', searchParams);
  if (form) return <ChainNotice t={t} chain="settings_form" state={form} />;
  const c = partnerClient();
  let me: PartnerMe | null = null;
  try { me = await c.partner.me(); } catch (e) {
    if (failureOf(e instanceof SdkError ? e.status : undefined, e instanceof SdkError && e.status === 404 ? await partnerConsoleSwitch() : 'unknown') === 'off') {
      return <section><h1>{t.t('partner.off.title')}</h1><p className="kv-muted">{t.t('partner.off.body')}</p></section>;
    }
  }
  const isAdmin = (me?.person.permissions ?? persona.perms ?? []).includes('partner.team.manage');
  let team: TeamState = { kind: 'admins_only' };
  if (isAdmin) { try { team = { kind: 'ok', team: await c.partner.team.list() }; } catch { team = { kind: 'error' }; } }

  const act = settingsAct(one(searchParams?.act)); const id = one(searchParams?.id);
  if (act && id) {
    const subject = team.kind !== 'ok' ? null : act === 'revoke_invite'
      ? (() => { const i = team.team.invites.find((x) => x.id === id); return i ? { phone: i.phoneMasked, role: i.roleCode } : null; })()
      : (() => { const m = team.team.members.find((x) => x.membershipId === id && x.active); return m ? { name: m.name ?? undefined, role: m.roleCode } : null; })();
    return <ActConfirm t={t} act={act} id={id} subject={subject} action={teamActAction} />;
  }

  let sla: PartnerDashboard['sla'] | null = null;
  try { sla = (await c.partner.dashboard()).sla; } catch { sla = null; }
  // the client step machine gets ONLY its own words (the active language over en)
  const labels = Object.fromEntries(Object.keys(en).filter((k) => k.startsWith('partner1.invite.') || k.startsWith('partner1.role.')).map((k) => [k, t.t(k)]));
  const done = one(searchParams?.done); const failed = one(searchParams?.failed);
  return (
    <SettingsView t={t} lang={lang} me={me} sla={sla} team={team}
      invite={isAdmin && team.kind === 'ok' ? <InviteChain labels={labels} lang={lang} idempotencyKey={randomUUID()} invite={inviteMemberAction} /> : null}
      notice={{ done: done === 'revoked' || done === 'removed' ? done : null, failed }} />
  );
}
