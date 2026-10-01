// apps/web-tenant/src/app/content/templates/page.tsx · W180 — notification templates, the tenant's OVERRIDES of the
// platform defaults · PC-56 TENANT-8a.
//
// W180: *"Platform defaults you can override per event × channel × language (your tenant_id row wins). Security templates
// (OTP, disputes) are platform-locked"* · *"Deleting an override never silences the event — sending falls back to the
// platform default"*.
//
// WHAT THIS PAGE PRINTS, AND FROM WHERE. One row per event × channel × language that has a platform default or your
// override (keyset on the slot). The Status column is the SERVING fact (`slotStatus`): your approved override, the
// platform default, or — honestly — nothing at all, in which case that channel records `no_template` at send time. It
// is never `is_active` alone: before 0175 an override row could be "active" and never send (F-1).
//
// THE CANON'S TILES, MEASURED. *"14 of 1,286 platform defaults"* → your serving overrides of the live platform row count;
// *"Locked templates 31"* → the live count of security-copy events (it IS 31 today, by query, not by the canon's word);
// *"Delivery (30d) 99.4% · 42,180 sends across 6 channels"* → REFUSED BY NAME here: per-override delivery statistics
// do not exist (ADMIN-11b named it) and the tenant delivery log is TENANT-8b's read. Beside them, the two gaps this
// platform must not hide (F-12): the events that serve no template on ANY channel (listed, counted by query) and
// "no event serves WhatsApp".
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { TemplateIndex } from '@krishalaya/sdk-js';
import {
  CHANNEL_VALUES, EXPERIMENTS_HREF, NEW_OVERRIDE_HREF, TEMPLATES_HREF, canStartOverride, channelKey, lifecycleKey, newOverrideHref, pageStateKey, refusedKey,
  slotHref, slotStatus, slotStatusKey, templatesHref, templatesTransportState, type TemplatesPageState,
} from '../../../features/templates/override';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('templates.title'), robots: { index: false, follow: false } };
}

const str = (v: string | string[] | undefined) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);

export default async function TemplatesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(TEMPLATES_HREF);
  const t = getTranslator();
  const lang = getLang();
  const filters = { eventCode: str(searchParams.eventCode), channel: str(searchParams.channel), languageCode: str(searchParams.languageCode), only: str(searchParams.only) === 'overrides' ? 'overrides' : null };
  const cursor = str(searchParams.cursor);

  let idx: TemplateIndex | null = null;
  let state: TemplatesPageState | null = null;
  try {
    idx = await tenantClient().notifications.templateIndex({
      eventCode: filters.eventCode ?? undefined, channel: filters.channel ?? undefined, languageCode: filters.languageCode ?? undefined,
      only: filters.only === 'overrides' ? 'overrides' : 'all', cursor: cursor ?? undefined, limit: 50,
    });
  } catch (e) {
    state = e instanceof SdkError ? templatesTransportState(e.code, e.status) : 'error';
  }
  const filtered = Boolean(filters.eventCode || filters.channel || filters.languageCode || filters.only);
  const s = idx?.summary;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('templates.title')}</h1>
        {idx?.canAuthor && <Link href={NEW_OVERRIDE_HREF} className="kv-btn">{t.t('templates.new')}</Link>}
      </div>
      <p className="kv-field__hint">{t.t('templates.lead')}</p>
      <p className="kv-field__hint">{t.t('templates.fallbackNeverSilence')}</p>

      {state !== null && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(pageStateKey(state))}</p>
          {state === 'error' && (
            <>
              {/* W180 "Retry" (→ W2790): a page load, not a mutation — the 6a ruling; the templates-mutate chain has no route. */}
              <p><Link href={templatesHref(filters, cursor)} className="kv-btn--link">{t.t('templates.retry')}</Link></p>
              <p className="kv-field__hint">{t.t(refusedKey('compiledCache'))}</p>
            </>
          )}
        </div>
      )}

      {idx && s && (
        <>
          <div className="kv-stats">
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('templates.tile.overrides')}</span>
              <strong className="kv-stat__value">{formatNumber(s.overridesServing, lang)}</strong>
              <span className="kv-stat__hint">{t.t('templates.tile.overridesHint', { platform: formatNumber(s.platformServing, lang), rows: formatNumber(s.platformRows, lang), open: formatNumber(s.versionsOpen, lang), provider: formatNumber(s.versionsAtProvider, lang) })}</span>
            </div>
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('templates.tile.locked')}</span>
              <strong className="kv-stat__value">{formatNumber(s.lockedEvents, lang)}</strong>
              <span className="kv-stat__hint">{t.t('templates.tile.lockedHint', { total: formatNumber(s.eventsTotal, lang) })}</span>
            </div>
            <div className="kv-stat">
              <span className="kv-stat__label">{t.t('templates.tile.delivery')}</span>
              <strong className="kv-stat__value">{t.t('common.dash')}</strong>
              <span className="kv-stat__hint">{t.t(refusedKey('deliveryStats'))}</span>
            </div>
          </div>

          {/* ---- THE GAPS (F-12): printed from a live query, never a literal ---- */}
          <div className="kv-card kv-card--notice" role="status">
            <p>{t.t('templates.gap.noTemplate', { n: formatNumber(s.eventsWithoutTemplate.length, lang), total: formatNumber(s.eventsTotal, lang) })}</p>
            {s.eventsWithoutTemplate.length > 0 && (
              <details className="kv-disclosure">
                <summary>{t.t('templates.gap.showEvents')}</summary>
                <p className="kv-field__hint">{s.eventsWithoutTemplate.map((c) => <code key={c}>{c} </code>)}</p>
              </details>
            )}
            <p>{s.whatsappServing === 0
              ? t.t('templates.gap.noWhatsapp', { events: formatNumber(s.whatsappEvents, lang) })
              : t.t('templates.gap.whatsappServing', { n: formatNumber(s.whatsappServing, lang) })}</p>
          </div>

          {/* ---- FILTERS as a GET form: every view is a URL ---- */}
          <form action={TEMPLATES_HREF} method="get" className="kv-form--grid" aria-label={t.t('templates.filter.label')}>
            <label className="kv-field" htmlFor="f-event"><span>{t.t('templates.col.event')}</span>
              <input id="f-event" name="eventCode" defaultValue={filters.eventCode ?? ''} maxLength={80} placeholder={t.t('templates.filter.eventHint')} />
            </label>
            <label className="kv-field" htmlFor="f-channel"><span>{t.t('templates.col.channel')}</span>
              <select id="f-channel" name="channel" defaultValue={filters.channel ?? ''}>
                <option value="">{t.t('templates.filter.any')}</option>
                {CHANNEL_VALUES.map((c) => <option key={c} value={c}>{t.t(channelKey(c))}</option>)}
              </select>
            </label>
            <label className="kv-field" htmlFor="f-lang"><span>{t.t('templates.col.lang')}</span>
              <input id="f-lang" name="languageCode" defaultValue={filters.languageCode ?? ''} maxLength={8} />
            </label>
            <label className="kv-field" htmlFor="f-only">
              <input id="f-only" type="checkbox" name="only" value="overrides" defaultChecked={filters.only === 'overrides'} />
              <span>{t.t('templates.filter.onlyOverrides')}</span>
            </label>
            <button type="submit" className="kv-btn">{t.t('templates.filter.apply')}</button>
            {filtered && <Link href={TEMPLATES_HREF} className="kv-btn--link">{t.t('templates.filter.clear')}</Link>}
          </form>

          {idx.items.length === 0 ? (
            <div className="kv-card kv-card--notice" role="status">
              <p>{t.t(filtered ? 'templates.emptyFiltered' : 'templates.empty')}</p>
              {idx.canAuthor && <p><Link href={NEW_OVERRIDE_HREF} className="kv-btn--link">{t.t('templates.new')}</Link></p>}
            </div>
          ) : (
            <table className="kv-table">
              <thead>
                <tr>
                  <th>{t.t('templates.col.event')}</th>
                  <th>{t.t('templates.col.channel')}</th>
                  <th>{t.t('templates.col.lang')}</th>
                  <th>{t.t('templates.col.serving')}</th>
                  <th>{t.t('templates.col.since')}</th>
                  <th>{t.t('templates.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {idx.items.map((r) => {
                  const href = slotHref(r); const st = slotStatus(r);
                  return (
                    <tr key={`${r.eventCode}|${r.channel}|${r.languageCode}`}>
                      <td>{href ? <Link href={href} className="kv-link"><code>{r.eventCode}</code></Link> : <code>{r.eventCode}</code>}</td>
                      <td>{t.t(channelKey(r.channel))}{!r.channelIsDefault && <div className="kv-field__hint">{t.t('templates.notDefaultChannel')}</div>}</td>
                      <td>{r.languageCode}</td>
                      <td>
                        {r.source === 'override' && t.t('templates.serving.override', { v: String(r.override.servingVersionNo ?? '') })}
                        {r.source === 'platform' && t.t('templates.serving.platform', { v: String(r.platform.servingVersionNo ?? '') })}
                        {r.source === 'none' && <span className="kv-field__hint">{t.t('templates.serving.none')}</span>}
                        {r.override.templateId && r.override.latestLifecycle && r.source !== 'override' && (
                          <div className="kv-field__hint">{t.t('templates.latest', { v: String(r.override.latestVersionNo ?? ''), state: t.t(lifecycleKey(r.override.latestLifecycle)) })}</div>
                        )}
                      </td>
                      <td>{r.override.servingSince ? formatDate(r.override.servingSince, lang) : <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                      <td>
                        <span className="kv-badge">{t.t(slotStatusKey(st))}</span>
                        {idx!.canAuthor && canStartOverride(r) && <div><Link href={newOverrideHref(r)} className="kv-btn--link">{t.t('templates.overrideThis')}</Link></div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="kv-field__hint">{t.t('templates.orderNote')}</p>
          {idx.nextCursor && <p className="kv-pager"><Link href={templatesHref(filters, idx.nextCursor)} className="kv-btn--link">{t.t('common.nextPage')}</Link></p>}
          <p className="kv-field__hint">{t.t('templates.smsNote')}</p>
          <p><Link href={EXPERIMENTS_HREF} className="kv-btn--link">{t.t('templates.toExperiments')}</Link></p>
        </>
      )}
    </section>
  );
}
