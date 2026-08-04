// apps/web-tenant/src/app/settings/page.tsx · tenant self-config console: commission rules, delivery zones,
// branding + storefront languages. Server-first, requireSession-gated; every section loads independently and
// degrades on its own (Law 12). All writes go through Server Actions → the audited, RBAC-gated API (which is the
// authority for money + privilege — Law 2/11; platform-default commission rows render read-only). Money via
// formatMoneyMinor (Law 2); all copy via i18n; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { getThemePreference, getSeniorMode } from '../../lib/mechanism';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { formatBps, settingString, settingList, PLATFORM_LANGUAGES, COMMISSION_SOURCES } from '../../features/settings/config';
import {
  createCommissionRuleAction, deactivateCommissionRuleAction, createDeliveryZoneAction,
  setZoneActiveAction, saveBrandingAction, saveLanguagesAction,
} from './actions';
import type { CommissionRule, DeliveryZone, TenantSetting } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('settings.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['commission', 'commission.off', 'zone', 'zone.on', 'zone.off', 'branding', 'languages']);

export default async function SettingsPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/settings');
  const t = getTranslator();
  const lang = getLang();

  let rules: CommissionRule[] = []; let zones: DeliveryZone[] = []; let settings: TenantSetting[] = [];
  let rulesFailed = false; let zonesFailed = false; let settingsFailed = false;
  const [rRes, zRes, sRes] = await Promise.allSettled([
    tenantClient().tenantConfig.commissionRules({ activeOnly: false, includePlatformDefaults: true, limit: 100 }),
    tenantClient().tenantConfig.deliveryZones({ activeOnly: false, limit: 100 }),
    tenantClient().tenantConfig.settings(),
  ]);
  if (rRes.status === 'fulfilled') rules = rRes.value.items; else rulesFailed = true;
  if (zRes.status === 'fulfilled') zones = zRes.value.items; else zonesFailed = true;
  if (sRes.status === 'fulfilled') settings = sRes.value; else settingsFailed = true;

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errorKey = searchParams.error || null;

  const enabledLangs = settingList(settings, 'languages.enabled', ['en']);
  const defaultLang = settingString(settings, 'languages.default', 'en') || 'en';
  const themePref = getThemePreference();
  const seniorOn = getSeniorMode();

  return (
    <section>
      <h1>{t.t('settings.title')}</h1>
      <p className="kv-muted">{t.t('settings.subtitle')} · <Link href="/settings/integrations">{t.t('integrations.title')} →</Link> · <Link href="/settings/webhooks">{t.t('webhooks.title')} →</Link></p>
      {okKey && <p className="kv-success" role="status">{t.t('settings.ok')}</p>}
      {errorKey && <p className="kv-error" role="alert">{t.t('settings.error')}: {errorKey}</p>}

      {/* ---- display preferences (DEV-19: dark mode / senior mode mechanism) ----
          No-JS form, mirrors LocaleSwitcher's own convention: posts to /api/mechanism, which sets the
          kvt_theme/kvt_senior cookies (read server-side by layout.tsx's getThemeHtmlAttrs/getSeniorMode) and
          redirects back here via the Referer header — a real page reload, not a live client-side toggle (see
          apps/web-tenant/src/app/api/mechanism/route.ts's own header comment for why). Canon shows no
          topbar/header theme-toggle affordance for the console realm (grep-verified against web-screens/ —
          0 hits for a theme-toggle control) — placed in the settings surface per this batch's own brief. */}
      <h2 className="kv-section-title">{t.t('settings.display.title')}</h2>
      <p className="kv-muted">{t.t('settings.display.help')}</p>
      <form action="/api/mechanism" method="post" className="kv-form kv-form--grid">
        <fieldset className="kv-fieldset">
          <legend>{t.t('settings.display.theme.label')}</legend>
          <label className="kv-check">
            <input type="radio" name="theme" value="light" defaultChecked={themePref === 'light'} />
            {t.t('settings.display.theme.light')}
          </label>
          <label className="kv-check">
            <input type="radio" name="theme" value="dark" defaultChecked={themePref === 'dark'} />
            {t.t('settings.display.theme.dark')}
          </label>
          <label className="kv-check">
            <input type="radio" name="theme" value="system" defaultChecked={themePref === 'system'} />
            {t.t('settings.display.theme.system')}
          </label>
        </fieldset>
        <fieldset className="kv-fieldset">
          <legend>{t.t('settings.display.senior.label')}</legend>
          <p className="kv-muted">{t.t('settings.display.senior.help')}</p>
          <label className="kv-check">
            <input type="radio" name="senior" value="on" defaultChecked={seniorOn} />
            {t.t('settings.display.senior.on')}
          </label>
          <label className="kv-check">
            <input type="radio" name="senior" value="off" defaultChecked={!seniorOn} />
            {t.t('settings.display.senior.off')}
          </label>
        </fieldset>
        <button type="submit" className="kv-btn">{t.t('settings.display.save')}</button>
      </form>

      {/* ---- commission rules ---- */}
      <h2 className="kv-section-title">{t.t('settings.commission.title')}</h2>
      <p className="kv-muted">{t.t('settings.commission.help')}</p>
      {rulesFailed ? <p className="kv-error" role="alert">{t.t('settings.loadError')}</p> : (
        <DataTable
          rows={rules}
          empty={t.t('settings.commission.empty')}
          columns={[
            { header: t.t('settings.commission.scope'), cell: (r) => <span className="kv-badge">{t.t(`settings.scope.${r.scope}`)}</span> },
            { header: t.t('settings.commission.source'), cell: (r) => r.source ? t.t(`settings.source.${r.source}`) : t.t('settings.commission.anySource') },
            { header: t.t('settings.commission.rate'), cell: (r) => formatBps(r.rateBps) },
            { header: t.t('settings.commission.platformShare'), cell: (r) => formatBps(r.platformShareBps) },
            { header: t.t('settings.commission.fixed'), cell: (r) => formatMoneyMinor(r.fixedMinor, 'INR', lang) },
            { header: t.t('settings.commission.chargedTo'), cell: (r) => t.t(`settings.chargedTo.${r.chargedTo}`) },
            { header: t.t('settings.status'), cell: (r) => r.isActive ? t.t('settings.active') : t.t('settings.inactive') },
            { header: '', cell: (r) => (r.scope === 'tenant' && r.isActive)
              ? <form action={deactivateCommissionRuleAction}><input type="hidden" name="id" value={r.id} /><button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">{t.t('settings.commission.deactivate')}</button></form>
              : <span className="kv-muted">{r.scope === 'platform' ? t.t('settings.commission.inherited') : t.t('common.dash')}</span> },
          ]}
        />
      )}
      <details className="kv-disclosure">
        <summary>{t.t('settings.commission.add')}</summary>
        <form action={createCommissionRuleAction} className="kv-form kv-form--grid">
          <label className="kv-label">{t.t('settings.commission.rate')} ({t.t('settings.bps')})
            <input className="kv-input" name="rateBps" type="number" min={0} max={100000} required inputMode="numeric" />
          </label>
          <label className="kv-label">{t.t('settings.commission.platformShare')} ({t.t('settings.bps')})
            <input className="kv-input" name="platformShareBps" type="number" min={0} max={100000} required inputMode="numeric" />
          </label>
          <label className="kv-label">{t.t('settings.commission.fixed')} ({t.t('settings.minor')})
            <input className="kv-input" name="fixedMinor" type="text" inputMode="numeric" pattern="[0-9]*" defaultValue="0" />
          </label>
          <label className="kv-label">{t.t('settings.commission.source')}
            <select className="kv-input" name="source" defaultValue="">
              <option value="">{t.t('settings.commission.anySource')}</option>
              {COMMISSION_SOURCES.map((s) => <option key={s} value={s}>{t.t(`settings.source.${s}`)}</option>)}
            </select>
          </label>
          <label className="kv-label">{t.t('settings.commission.chargedTo')}
            <select className="kv-input" name="chargedTo" defaultValue="seller">
              <option value="seller">{t.t('settings.chargedTo.seller')}</option>
              <option value="buyer">{t.t('settings.chargedTo.buyer')}</option>
            </select>
          </label>
          <label className="kv-label">{t.t('settings.commission.priority')}
            <input className="kv-input" name="priority" type="number" min={0} max={1000} defaultValue={100} inputMode="numeric" />
          </label>
          <button type="submit" className="kv-btn">{t.t('settings.commission.create')}</button>
        </form>
      </details>

      {/* ---- delivery zones ---- */}
      <h2 className="kv-section-title">{t.t('settings.zone.title')}</h2>
      <p className="kv-muted">{t.t('settings.zone.help')}</p>
      {zonesFailed ? <p className="kv-error" role="alert">{t.t('settings.loadError')}</p> : (
        <DataTable
          rows={zones}
          empty={t.t('settings.zone.empty')}
          columns={[
            { header: t.t('settings.zone.name'), cell: (z) => z.defaultName },
            { header: t.t('settings.zone.pincodes'), cell: (z) => z.pincodes.length ? `${z.pincodes.length}` : t.t('common.dash') },
            { header: t.t('settings.zone.regions'), cell: (z) => z.regionIds.length ? `${z.regionIds.length}` : t.t('common.dash') },
            { header: t.t('settings.status'), cell: (z) => z.isActive ? t.t('settings.active') : t.t('settings.inactive') },
            { header: '', cell: (z) => (
              <form action={setZoneActiveAction}>
                <input type="hidden" name="id" value={z.id} />
                <input type="hidden" name="isActive" value={z.isActive ? 'false' : 'true'} />
                <button type="submit" className="kv-btn kv-btn--muted kv-btn--sm">{z.isActive ? t.t('settings.zone.disable') : t.t('settings.zone.enable')}</button>
              </form>
            ) },
          ]}
        />
      )}
      <details className="kv-disclosure">
        <summary>{t.t('settings.zone.add')}</summary>
        <form action={createDeliveryZoneAction} className="kv-form">
          <label className="kv-label">{t.t('settings.zone.name')}
            <input className="kv-input" name="defaultName" type="text" maxLength={120} required />
          </label>
          <label className="kv-label">{t.t('settings.zone.pincodes')}
            <textarea className="kv-input" name="pincodes" rows={3} placeholder={t.t('settings.zone.pincodesHint')} />
          </label>
          <button type="submit" className="kv-btn">{t.t('settings.zone.create')}</button>
        </form>
      </details>

      {/* ---- branding ---- */}
      <h2 className="kv-section-title">{t.t('settings.branding.title')}</h2>
      {settingsFailed ? <p className="kv-error" role="alert">{t.t('settings.loadError')}</p> : (
        <form action={saveBrandingAction} className="kv-form kv-form--grid">
          <label className="kv-label">{t.t('settings.branding.displayName')}
            <input className="kv-input" name="displayName" type="text" maxLength={120} defaultValue={settingString(settings, 'branding.display_name')} />
          </label>
          <label className="kv-label">{t.t('settings.branding.logoUrl')}
            <input className="kv-input" name="logoUrl" type="url" defaultValue={settingString(settings, 'branding.logo_url')} placeholder="https://…" />
          </label>
          <label className="kv-label">{t.t('settings.branding.primaryColor')}
            <input className="kv-input" name="primaryColor" type="text" defaultValue={settingString(settings, 'branding.primary_color')} placeholder="#1B5E20" />
          </label>
          <label className="kv-label">{t.t('settings.branding.supportEmail')}
            <input className="kv-input" name="supportEmail" type="email" defaultValue={settingString(settings, 'branding.support_email')} />
          </label>
          <button type="submit" className="kv-btn">{t.t('settings.save')}</button>
        </form>
      )}

      {/* ---- languages ---- */}
      <h2 className="kv-section-title">{t.t('settings.languages.title')}</h2>
      <p className="kv-muted">{t.t('settings.languages.help')}</p>
      {settingsFailed ? <p className="kv-error" role="alert">{t.t('settings.loadError')}</p> : (
        <form action={saveLanguagesAction} className="kv-form">
          <fieldset className="kv-fieldset">
            <legend>{t.t('settings.languages.enabled')}</legend>
            {PLATFORM_LANGUAGES.map((code) => (
              <label key={code} className="kv-check">
                <input type="checkbox" name="enabled" value={code} defaultChecked={enabledLangs.includes(code)} />
                {t.t(`settings.lang.${code}`)}
              </label>
            ))}
          </fieldset>
          <label className="kv-label">{t.t('settings.languages.default')}
            <select className="kv-input" name="default" defaultValue={defaultLang}>
              {PLATFORM_LANGUAGES.map((code) => <option key={code} value={code}>{t.t(`settings.lang.${code}`)}</option>)}
            </select>
          </label>
          <button type="submit" className="kv-btn">{t.t('settings.save')}</button>
        </form>
      )}
    </section>
  );
}
