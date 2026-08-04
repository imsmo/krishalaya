// apps/web-tenant/src/app/comms/page.tsx · the tenant comms hub (PC-27): member BROADCASTS (WhatsApp/SMS/push
// fan-out handled server-side by the communication module + whatsapp-bot) and per-event NOTIFICATION TEMPLATES
// (event × channel × language, incl. whatsapp providerTemplateRef). Server-first, requireSession-gated, noindex;
// everything re-gated server-side by comm.manage. Sections degrade independently (Law 12).
//
// PERSONA/SCOPE RULINGS recorded (PC-27): buyer↔seller CONVERSATIONS ride the messaging resource (storefront
// /messages built; a seller inbox is queued in PC-28's remainder). "WhatsApp settings" = provider wiring, which
// lives in /settings/integrations (built) — no duplicate settings surface here.
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { NOTIF_CHANNELS } from '../../features/comms/hub';
import { sendBroadcastAction, upsertTemplateAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('comms.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['broadcast', 'template']);
const ERR = new Set(['title', 'body', 'broadcast', 'template', 'tpl_event', 'tpl_channel', 'tpl_lang', 'tpl_body', 'tpl_subject']);

export default async function CommsPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/comms');
  const t = getTranslator();
  const lang = getLang();
  const client = tenantClient();

  let broadcasts: Awaited<ReturnType<typeof client.notifications.listBroadcasts>>['items'] = [];
  let broadcastsFailed = false;
  try { broadcasts = (await client.notifications.listBroadcasts({ limit: 50 })).items; }
  catch { broadcastsFailed = true; }

  let templates: Awaited<ReturnType<typeof client.notifications.listTemplates>>['items'] = [];
  let templatesFailed = false;
  try { templates = (await client.notifications.listTemplates({ limit: 50 })).items; }
  catch { templatesFailed = true; }

  let events: Array<{ code: string; description?: string | null }> = [];
  try { events = await client.notifications.templateEvents(); } catch { events = []; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <h1>{t.t('comms.title')}</h1>
      <p className="kv-field__hint">{t.t('comms.hint')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`comms.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`comms.error.${errKey}`)}</p>}

      <h2>{t.t('comms.broadcasts')}</h2>
      {broadcastsFailed ? <p className="kv-error" role="alert">{t.t('comms.loadError')}</p> : (
        <DataTable
          rows={broadcasts}
          empty={t.t('comms.broadcastsEmpty')}
          columns={[
            { header: t.t('comms.colTitle'), cell: (b) => b.title },
            { header: t.t('comms.colAudience'), cell: (b) => b.audienceRoleCode || t.t('comms.audienceAll') },
            { header: t.t('comms.colWhen'), cell: (b) => (b.createdAt ? formatDate(b.createdAt, lang) : t.t('common.dash')) },
          ]}
        />
      )}

      <details className="kv-card">
        <summary className="kv-card__title">{t.t('comms.send')}</summary>
        <p className="kv-field__hint">{t.t('comms.sendHint')}</p>
        <form action={sendBroadcastAction} className="kv-form">
          <label htmlFor="b-title" className="kv-field__label">{t.t('comms.colTitle')}</label>
          <input id="b-title" name="title" className="kv-input" required maxLength={160} />
          <label htmlFor="b-body" className="kv-field__label">{t.t('comms.body')}</label>
          <textarea id="b-body" name="body" className="kv-textarea" rows={4} required maxLength={2000} />
          <label htmlFor="b-role" className="kv-field__label">{t.t('comms.audience')}</label>
          <input id="b-role" name="audienceRoleCode" className="kv-input" placeholder={t.t('comms.audiencePlaceholder')} maxLength={60} />
          <p className="kv-field__hint">{t.t('comms.audienceHint')}</p>
          <button type="submit" className="kv-btn">{t.t('comms.sendBtn')}</button>
        </form>
      </details>

      <h2>{t.t('comms.templates')}</h2>
      {templatesFailed ? <p className="kv-error" role="alert">{t.t('comms.loadError')}</p> : (
        <DataTable
          rows={templates}
          empty={t.t('comms.templatesEmpty')}
          columns={[
            { header: t.t('comms.colEvent'), cell: (x) => <span className="kv-mono">{x.eventCode}</span> },
            { header: t.t('comms.colChannel'), cell: (x) => <span className="kv-badge">{x.channel}</span> },
            { header: t.t('comms.colLang'), cell: (x) => x.languageCode },
            { header: t.t('comms.colActive'), cell: (x) => (x.isActive ? t.t('comms.activeYes') : t.t('common.dash')) },
          ]}
        />
      )}

      <details className="kv-card">
        <summary className="kv-card__title">{t.t('comms.addTemplate')}</summary>
        <p className="kv-field__hint">{t.t('comms.templateHint')}</p>
        <form action={upsertTemplateAction} className="kv-form">
          <label htmlFor="tp-event" className="kv-field__label">{t.t('comms.colEvent')}</label>
          {events.length > 0 ? (
            <select id="tp-event" name="eventCode" className="kv-input" required defaultValue="">
              <option value="" disabled>{t.t('comms.eventChoose')}</option>
              {events.map((e) => <option key={e.code} value={e.code}>{e.code}</option>)}
            </select>
          ) : (
            <input id="tp-event" name="eventCode" className="kv-input" required maxLength={80} placeholder="order.confirmed" />
          )}
          <label htmlFor="tp-ch" className="kv-field__label">{t.t('comms.colChannel')}</label>
          <select id="tp-ch" name="channel" className="kv-input" defaultValue="whatsapp">
            {NOTIF_CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label htmlFor="tp-lang" className="kv-field__label">{t.t('comms.colLang')}</label>
          <input id="tp-lang" name="languageCode" className="kv-input" required maxLength={8} placeholder="hi" pattern="[a-z]{2}(-[A-Za-z]{2,4})?" />
          <label htmlFor="tp-subject" className="kv-field__label">{t.t('comms.subject')}</label>
          <input id="tp-subject" name="subject" className="kv-input" maxLength={250} />
          <label htmlFor="tp-body" className="kv-field__label">{t.t('comms.body')}</label>
          <textarea id="tp-body" name="body" className="kv-textarea" rows={4} required maxLength={4000} />
          <p className="kv-field__hint">{t.t('comms.bodyVarsHint')}</p>
          <label className="kv-field__label" htmlFor="tp-active">
            <input id="tp-active" type="checkbox" name="isActive" value="1" defaultChecked /> {t.t('comms.activeYes')}
          </label>
          <button type="submit" className="kv-btn">{t.t('comms.saveTemplate')}</button>
        </form>
      </details>
    </section>
  );
}
