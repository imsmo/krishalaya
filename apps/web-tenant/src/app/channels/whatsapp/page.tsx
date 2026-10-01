// apps/web-tenant/src/app/channels/whatsapp/page.tsx · W425 — THE WHATSAPP HUB, DECLARED HONESTLY · PC-56 TENANT-8e.
//
// The canon draws an agent queue of WhatsApp conversations — SLA, masked numbers, the 24-hour window, assign, mark resolved.
// NONE of it can exist on this platform: there is no WhatsApp provider (no Meta Cloud API, no BSP), no inbound sink (the
// ADMIN-SWEEP-b2 ruling: *"no inbound-message controller exists anywhere"*), no business number, zero WhatsApp templates,
// and `apps/whatsapp-bot` exits 1 (F-15). So this page prints WHAT IS, from the API: the provider registry's answer
// (not connected — and the message providers that DO exist), the serving templates by channel (WhatsApp: 0 — 8a's plane),
// the events that list WhatsApp as a channel (each records a leg it cannot send), the cooperative's in-app announcements
// over 30 days counted from the delivery log, and the opt-in policy record — and refuses every WhatsApp act by name with
// what exists instead (the in-app inbox, the announcements) and who owns the gap. *Export queue* is real: the broadcast
// history on the export plane (W2839/W2840), whose receipt says no WhatsApp dataset exists.
// PARITY-DECOR (named): the canon's tabs *Unassigned 34 · Mine 12 · All 1,284*, the filters, the pager — over a queue that
// does not exist. States: data · restricted · flagged off · couldn't load + Retry (a page load) · loading.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { WhatsAppHub } from '@krishalaya/sdk-js';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { WhatsAppRefusals } from '../../../components/WhatsAppRefusals';
import {
  COMMS_HREF, INAPP_INBOX_HREF, SCREEN_REFUSALS, WA_CONVERSATION_HREF, WA_HUB_HREF, WA_SETTINGS_HREF, WA_TEMPLATES_HREF, channelKey, statusKey, transportState,
} from '../../../features/comms/broadcasts';
import { enqueueBroadcastsExportAction } from '../../comms/actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('wa.hub.title'), robots: { index: false, follow: false } };
}

export default async function WhatsAppHubPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireSession(WA_HUB_HREF);
  const t = getTranslator();
  const lang = getLang();
  let hub: WhatsAppHub | null = null; let state = 'data';
  try { hub = await tenantClient().notifications.whatsappHub(); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = transportState(err?.code, err?.status); }
  const n = (x: number) => formatNumber(x, lang);

  return (
    <section>
      <h1>{t.t('wa.hub.title')} <span lang="gu" className="kv-field__hint">વોટ્સએપ</span></h1>
      <p className="kv-field__hint">{t.t('wa.hub.lead')}</p>
      {searchParams.error && <div className="kv-error" role="alert"><p>{t.t('bc.export.failed')} <code>{searchParams.error}</code></p></div>}
      {!hub && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(`wa.state.${state}`)}</p>
          {state === 'error' && <p><Link href={WA_HUB_HREF} className="kv-btn--link">{t.t('bc.retry')}</Link> <span className="kv-field__hint">{t.t('bc.retryIsReload')}</span></p>}
        </div>
      )}
      {hub && (
        <>
          <div className="kv-card kv-card--notice" role="status">
            <h2>{t.t(hub.provider.connected ? 'wa.provider.connected' : 'wa.provider.none')}</h2>
            <p>{t.t('wa.provider.why')}</p>
            <p className="kv-field__hint">{t.t('wa.provider.existing')} {hub.provider.messageProviders.length ? hub.provider.messageProviders.map((p) => `${p.code} (${p.category})`).join(', ') : t.t('common.dash')}</p>
          </div>

          <div className="kv-cards">
            <div className="kv-card">
              <h2>{t.t('wa.hub.instead.title')}</h2>
              <p><Link href={INAPP_INBOX_HREF} className="kv-btn--link">{t.t('wa.instead.conversation')}</Link> — {t.t('wa.hub.instead.inbox')}</p>
              <p><Link href={COMMS_HREF} className="kv-btn--link">{t.t('wa.instead.whatsappBroadcast')}</Link> — {t.t('wa.hub.instead.comms')}</p>
            </div>
            <div className="kv-card">
              <h2>{t.t('wa.hub.broadcasts.title', { d: n(hub.broadcasts.windowDays) })}</h2>
              <dl className="kv-facts">
                <dt>{t.t('wa.hub.broadcasts.fannedOut')}</dt><dd>{n(hub.broadcasts.fannedOut)}{hub.broadcasts.cut && <span className="kv-field__hint"> · {t.t('wa.hub.broadcasts.cut')}</span>}</dd>
                <dt>{t.t('wa.hub.broadcasts.inapp')}</dt><dd>{n(hub.broadcasts.counts.inapp)}</dd>
                <dt>{t.t('wa.hub.broadcasts.sent')}</dt><dd>{n(hub.broadcasts.counts.sent)}</dd>
                <dt>{t.t('wa.hub.broadcasts.held')}</dt><dd>{n(hub.broadcasts.counts.held)}</dd>
                <dt>{t.t('wa.hub.broadcasts.suppressed')}</dt><dd>{n(hub.broadcasts.counts.suppressed)}</dd>
                <dt>{t.t('wa.hub.broadcasts.failed')}</dt><dd>{n(hub.broadcasts.counts.failed)}</dd>
              </dl>
              <p className="kv-field__hint">{Object.entries(hub.broadcasts.byStatus).map(([s, c]) => `${t.t(statusKey(s))} ${n(c)}`).join(' · ') || t.t('bc.empty')}</p>
              <p className="kv-field__hint">{t.t('bc.countsFromLog')}</p>
            </div>
            <div className="kv-card">
              <h2>{t.t('wa.hub.templates.title')}</h2>
              <table className="kv-table">
                <thead><tr><th scope="col">{t.t('bc.impact.col.channel')}</th><th scope="col">{t.t('wa.hub.templates.platform')}</th><th scope="col">{t.t('wa.hub.templates.own')}</th></tr></thead>
                <tbody>
                  {hub.templates.byChannel.map((r) => <tr key={r.channel}><th scope="row">{t.t(channelKey(r.channel))}</th><td>{n(r.platform)}</td><td>{n(r.own)}</td></tr>)}
                  {!hub.templates.byChannel.some((r) => r.channel === 'whatsapp') && <tr><th scope="row">{t.t('bc.channel.whatsapp')}</th><td>{n(0)}</td><td>{n(0)}</td></tr>}
                </tbody>
              </table>
              <p className="kv-field__hint">{t.t('wa.hub.templates.overrides', { n: n(hub.templates.whatsappOverrides) })} <Link href={WA_TEMPLATES_HREF} className="kv-btn--link">{t.t('nav.waTemplates')}</Link></p>
              <p className="kv-field__hint">{t.t('wa.hub.templates.declaring', { n: n(hub.templates.eventsDeclaringWhatsApp.length) })} {hub.templates.eventsDeclaringWhatsApp.map((c) => <code key={c}>{c} </code>)}</p>
            </div>
            <div className="kv-card">
              <h2>{t.t('wa.hub.optin.title')}</h2>
              <p>{t.t(hub.optin.recorded ? 'wa.hub.optin.recorded' : 'wa.hub.optin.none')}</p>
              <p className="kv-field__hint">{t.t('wa.optin.notCollected')}</p>
              <p><Link href={WA_SETTINGS_HREF} className="kv-btn--link">{t.t('nav.waSettings')}</Link></p>
            </div>
          </div>

          <form action={enqueueBroadcastsExportAction} className="kv-card">
            <input type="hidden" name="idempotencyKey" value={randomUUID()} /><input type="hidden" name="back" value="hub" />
            <button type="submit" className="kv-btn kv-btn--secondary">{t.t('wa.hub.exportQueue')}</button>
            <p className="kv-field__hint">{t.t('wa.hub.exportHint')}</p>
          </form>

          <WhatsAppRefusals all={hub.refused} codes={SCREEN_REFUSALS.hub} />
          <p className="kv-field__hint">{t.t('wa.hub.decor')} <Link href={WA_CONVERSATION_HREF} className="kv-btn--link">{t.t('nav.waConversation')}</Link></p>
        </>
      )}
    </section>
  );
}
