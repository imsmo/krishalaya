// apps/web-tenant/src/app/channels/whatsapp/settings/page.tsx · W430 — WhatsApp settings · PC-56 TENANT-8e.
//
// Every field the canon draws is refused by name EXCEPT ONE. There is no business number to show, connect or disconnect,
// no channel toggle (no channel to switch — and its promise *"turning this off … only moves delivery to SMS"* describes a
// per-channel fallback that does not exist; the only SMS fallback is the routine rule, G0-4), no quality rating or
// messaging tier to ingest, no WhatsApp webhook to report the health of (the generic notifier's callback is a different
// fact). The one thing a cooperative can honestly record today is its OPT-IN POLICY: how it intends to collect consent
// (the `whatsapp_optin_source` vocabulary — the canon's storefront checkbox, QR till-card, assisted kiosk on the member's
// own OTP) and the statement its members will be shown — recorded beside the fact that consent is NOT collected (0179
// constrains it). *Logo → Branding* is a real link (W191). States: data · restricted (reads; the edit needs
// `notification.whatsapp.policy.manage`) · flagged off · couldn't load + Retry · loading · "no opt-in sources yet".
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { WhatsAppHub, WhatsAppOptinView } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { WhatsAppRefusals } from '../../../../components/WhatsAppRefusals';
import { SCREEN_REFUSALS, WA_HUB_HREF, WA_POLICY_FORM_HREF, WA_SETTINGS_HREF, transportState } from '../../../../features/comms/broadcasts';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('wa.settings.title'), robots: { index: false, follow: false } }; }

export default async function WhatsAppSettingsPage() {
  await requireSession(WA_SETTINGS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const c = tenantClient().notifications;
  let view: WhatsAppOptinView | null = null; let hub: WhatsAppHub | null = null; let state = 'data';
  try { [view, hub] = await Promise.all([c.whatsappOptinPolicy(), c.whatsappHub().catch(() => null)]); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = transportState(err?.code, err?.status); }
  const nameOf = (code: string) => view?.sources.find((s) => s.code === code)?.name ?? code;

  return (
    <section>
      <nav aria-label={t.t('wa.breadcrumb')} className="kv-field__hint"><Link href={WA_HUB_HREF}>{t.t('wa.hub.title')}</Link></nav>
      <h1>{t.t('wa.settings.title')} <span lang="gu" className="kv-field__hint">વોટ્સએપ સેટિંગ્સ</span></h1>
      {!view && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(`wa.state.${state}`)}</p>
          {state === 'error' && <p><Link href={WA_SETTINGS_HREF} className="kv-btn--link">{t.t('bc.retry')}</Link></p>}
        </div>
      )}
      {view && (
        <>
          <div className="kv-card kv-card--notice" role="status">
            <h2>{t.t('wa.settings.number')}</h2>
            <p>{t.t(view.providerConnected ? 'wa.provider.connected' : 'wa.settings.noNumber')}</p>
            <p className="kv-field__hint">{t.t('wa.settings.logo')} <Link href="/settings" className="kv-btn--link">{t.t('wa.settings.branding')}</Link></p>
          </div>

          <div className="kv-card">
            <h2>{t.t('wa.optin.title')}</h2>
            <p><span className="kv-badge kv-badge--muted">{t.t('wa.optin.notCollected')}</span></p>
            {view.policy ? (
              <>
                <h3>{t.t('wa.optin.sources')}</h3>
                <ul className="kv-list">{view.policy.sources.map((s) => <li key={s}>{nameOf(s)} <code>{s}</code></li>)}</ul>
                <h3>{t.t('wa.optin.statement')}</h3>
                <blockquote className="kv-note">{view.policy.consentStatement}</blockquote>
                <p className="kv-field__hint">{t.t('wa.optin.version', { v: formatNumber(view.policy.version, lang) })} · {formatDate(view.policy.updatedAt, lang, { dateStyle: 'medium', timeStyle: 'short' })}</p>
              </>
            ) : <p>{t.t('wa.optin.none')}</p>}
            {view.canManage
              ? <p><Link href={WA_POLICY_FORM_HREF} className="kv-btn kv-btn--secondary">{t.t(view.policy ? 'wa.optin.edit' : 'wa.optin.record')}</Link></p>
              : <p className="kv-field__hint">{t.t('wa.optin.restricted')}</p>}
            <p className="kv-field__hint">{t.t('wa.optin.why')}</p>
          </div>

          {hub && <WhatsAppRefusals all={hub.refused} codes={SCREEN_REFUSALS.settings} />}
          <p className="kv-field__hint">{t.t('wa.settings.decor')}</p>
        </>
      )}
    </section>
  );
}
