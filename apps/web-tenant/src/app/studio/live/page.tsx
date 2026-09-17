// apps/web-tenant/src/app/studio/live/page.tsx · external content CHANNELS (PC-26b). Server-first, requireSession-
// gated, noindex. Channels: register + list; moderation/approval is admin-side — status shown honestly. The live
// SESSIONS that lived here (PC-26b: schedule on a channel → start/end/cancel, a `datetime-local` parsed in the server's
// own timezone, no reason, no audit row) are GONE since PC-56 TENANT-7c — the live class is `/live` (W414/W415).
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { DataTable } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { registerChannelAction } from '../actions';
import type { EduChannel } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('channels.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['channel']);
const ERR = new Set(['channel', 'chtitle', 'churl']);
const PROVIDERS = ['youtube', 'vimeo', 'website', 'podcast', 'other'] as const;

export default async function LiveStudioPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/studio/live');
  const t = getTranslator();

  let channels: EduChannel[] = []; let channelsFailed = false;
  try { channels = (await tenantClient().liveStudio.channels({ limit: 50 })).items; }
  catch { channelsFailed = true; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('channels.title')}</h1>
        <Link href="/studio" className="kv-btn--link">← {t.t('studio.title')}</Link>
      </div>
      {okKey && <p className="kv-success" role="status">{t.t(`channels.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`channels.error.${errKey}`)}</p>}

      {/* PC-56 TENANT-7c: the live class is its own record and chains at /live (W414/W415); this page keeps PC-26b's channels. */}
      <p className="kv-field__hint"><Link href="/live" className="kv-btn--link">{t.t('channels.toLive')} →</Link></p>

      <h2>{t.t('channels.yours')}</h2>
      {channelsFailed ? <p className="kv-error" role="alert">{t.t('channels.loadError')}</p> : (
        <DataTable
          rows={channels}
          empty={t.t('channels.empty')}
          columns={[
            { header: t.t('channels.colTitle'), cell: (c) => c.title },
            { header: t.t('channels.colProvider'), cell: (c) => c.provider },
            { header: t.t('channels.colStatus'), cell: (c) => <span className="kv-badge">{t.t(`channels.status.${c.status}`) || c.status}</span> },
          ]}
        />
      )}

      <details className="kv-card">
        <summary className="kv-card__title">{t.t('channels.add')}</summary>
        <p className="kv-field__hint">{t.t('channels.hint')}</p>
        <form action={registerChannelAction} className="kv-form">
          <label htmlFor="ch-prov" className="kv-field__label">{t.t('channels.colProvider')}</label>
          <select id="ch-prov" name="provider" className="kv-input" defaultValue="youtube">
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <label htmlFor="ch-title" className="kv-field__label">{t.t('channels.colTitle')}</label>
          <input id="ch-title" name="title" className="kv-input" required maxLength={200} />
          <label htmlFor="ch-url" className="kv-field__label">{t.t('channels.url')}</label>
          <input id="ch-url" name="externalUrl" type="url" className="kv-input" required maxLength={500} placeholder="https://…" />
          <button type="submit" className="kv-btn">{t.t('channels.addBtn')}</button>
        </form>
      </details>
    </section>
  );
}
