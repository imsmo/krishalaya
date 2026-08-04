// apps/web-tenant/src/app/studio/live/page.tsx · live-session hosting (PC-26b). Server-first, requireSession-
// gated, noindex. Channels (register + list; moderation/approval is admin-side — status shown honestly) and
// live sessions (schedule on a channel → start/end/cancel, only the legal actions per features/studio/quiz
// liveActions; the API re-checks education.host + transitions). Times ISO server-side, rendered localized.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { liveActions } from '../../../features/studio/quiz';
import { registerChannelAction, scheduleLiveAction, liveLifecycleAction } from '../actions';
import type { EduChannel, LiveSession } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('live.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['channel', 'live', 'start', 'end', 'cancel']);
const ERR = new Set(['channel', 'chtitle', 'churl', 'live', 'live_channel', 'live_title', 'live_when', 'action', 'illegal']);
const PROVIDERS = ['youtube', 'vimeo', 'website', 'podcast', 'other'] as const;

export default async function LiveStudioPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/studio/live');
  const t = getTranslator();
  const lang = getLang();

  let channels: EduChannel[] = []; let channelsFailed = false;
  try { channels = (await tenantClient().liveStudio.channels({ limit: 50 })).items; }
  catch { channelsFailed = true; }

  let sessions: LiveSession[] = []; let sessionsFailed = false;
  try { sessions = (await tenantClient().liveStudio.list({ box: 'mine', limit: 50 })).items; }
  catch { sessionsFailed = true; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const channelTitle = (id: string) => channels.find((c) => c.id === id)?.title ?? id.slice(0, 8);

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('live.title')}</h1>
        <Link href="/studio" className="kv-btn--link">← {t.t('studio.title')}</Link>
      </div>
      {okKey && <p className="kv-success" role="status">{t.t(`live.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`live.error.${errKey}`)}</p>}

      <h2>{t.t('live.sessions')}</h2>
      {sessionsFailed ? <p className="kv-error" role="alert">{t.t('live.loadError')}</p> : (
        <DataTable
          rows={sessions}
          empty={t.t('live.sessionsEmpty')}
          columns={[
            { header: t.t('live.colTitle'), cell: (s) => s.title },
            { header: t.t('live.colChannel'), cell: (s) => channelTitle(s.channelId) },
            { header: t.t('live.colWhen'), cell: (s) => formatDate(s.scheduledAt, lang) },
            { header: t.t('live.colStatus'), cell: (s) => <span className="kv-badge">{t.t(`live.status.${s.status}`) || s.status}</span> },
            {
              header: t.t('live.colActions'),
              cell: (s) => (
                <span className="kv-actions">
                  {liveActions(s.status).map((kind) => (
                    <form key={kind} action={liveLifecycleAction} className="kv-inline-form">
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="kind" value={kind} />
                      <button type="submit" className={kind === 'start' ? 'kv-btn' : 'kv-btn kv-btn--muted'}>{t.t(`live.act.${kind}`)}</button>
                    </form>
                  ))}
                </span>
              ),
            },
          ]}
        />
      )}

      {channels.length > 0 && (
        <details className="kv-card">
          <summary className="kv-card__title">{t.t('live.schedule')}</summary>
          <form action={scheduleLiveAction} className="kv-form">
            <label htmlFor="lv-ch" className="kv-field__label">{t.t('live.colChannel')}</label>
            <select id="lv-ch" name="channelId" className="kv-input" required defaultValue="">
              <option value="" disabled>{t.t('live.channelChoose')}</option>
              {channels.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <label htmlFor="lv-title" className="kv-field__label">{t.t('live.colTitle')}</label>
            <input id="lv-title" name="title" className="kv-input" required maxLength={250} />
            <label htmlFor="lv-when" className="kv-field__label">{t.t('live.when')}</label>
            <input id="lv-when" name="scheduledAt" type="datetime-local" className="kv-input" required />
            <button type="submit" className="kv-btn">{t.t('live.scheduleBtn')}</button>
          </form>
        </details>
      )}

      <h2>{t.t('live.channels')}</h2>
      {channelsFailed ? <p className="kv-error" role="alert">{t.t('live.loadError')}</p> : (
        <DataTable
          rows={channels}
          empty={t.t('live.channelsEmpty')}
          columns={[
            { header: t.t('live.colTitle'), cell: (c) => c.title },
            { header: t.t('live.colProvider'), cell: (c) => c.provider },
            { header: t.t('live.colStatus'), cell: (c) => <span className="kv-badge">{t.t(`live.chStatus.${c.status}`) || c.status}</span> },
          ]}
        />
      )}

      <details className="kv-card">
        <summary className="kv-card__title">{t.t('live.addChannel')}</summary>
        <p className="kv-field__hint">{t.t('live.channelHint')}</p>
        <form action={registerChannelAction} className="kv-form">
          <label htmlFor="ch-prov" className="kv-field__label">{t.t('live.colProvider')}</label>
          <select id="ch-prov" name="provider" className="kv-input" defaultValue="youtube">
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <label htmlFor="ch-title" className="kv-field__label">{t.t('live.colTitle')}</label>
          <input id="ch-title" name="title" className="kv-input" required maxLength={200} />
          <label htmlFor="ch-url" className="kv-field__label">{t.t('live.url')}</label>
          <input id="ch-url" name="externalUrl" type="url" className="kv-input" required maxLength={500} placeholder="https://…" />
          <button type="submit" className="kv-btn">{t.t('live.addChannelBtn')}</button>
        </form>
      </details>
    </section>
  );
}
