// apps/web-tenant/src/app/comms/page.tsx · the tenant comms hub (PC-27): member BROADCASTS (WhatsApp/SMS/push
// fan-out handled server-side by the communication module + whatsapp-bot). Server-first, requireSession-gated, noindex;
// everything re-gated server-side by comm.manage. Sections degrade independently (Law 12).
//
// [PC-56 TENANT-8a] THE TEMPLATE FORM THAT LIVED HERE IS GONE. It upserted a row whose words `resolve()` never read —
// a tenant "override" saved here NEVER SENT (F-1) — listed that row's body as though it were live, defaulted its channel
// to `whatsapp` (the one channel with zero templates and no provider — F-22), and ran on the support agent's broadcast
// key (F-19). Templates are W180 now (`/content/templates`): a draft, a second person's approval, and only then the
// words your members receive. (The broadcast half of this page is TENANT-8e's: F-2 and F-17 are named there.)
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
import Link from 'next/link';
import { sendBroadcastAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('comms.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['broadcast']);
const ERR = new Set(['title', 'body', 'broadcast']);

export default async function CommsPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/comms');
  const t = getTranslator();
  const lang = getLang();
  const client = tenantClient();

  let broadcasts: Awaited<ReturnType<typeof client.notifications.listBroadcasts>>['items'] = [];
  let broadcastsFailed = false;
  try { broadcasts = (await client.notifications.listBroadcasts({ limit: 50 })).items; }
  catch { broadcastsFailed = true; }

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
      <div className="kv-card kv-card--notice" role="status">
        <p>{t.t('comms.templatesMoved')}</p>
        <p><Link href="/content/templates" className="kv-btn--link">{t.t('nav.templates')}</Link></p>
      </div>
    </section>
  );
}
