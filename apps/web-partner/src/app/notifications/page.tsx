// apps/web-partner/src/app/notifications/page.tsx · partner notification inbox (PC-2C shared rail). The
// notifications resource is CALLER-scoped (same platform API as tenants; the partner token scopes the rows), so
// this is a thin, honest mirror of the console inbox: list + per-item mark-read + link to preferences.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { markReadAction } from './actions';
import type { NotificationItem } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('notif.title'), robots: { index: false, follow: false } };
}

export default async function NotificationsPage({ searchParams }: { searchParams: { cursor?: string } }) {
  await requirePartner();
  const t = getTranslator();

  let items: NotificationItem[] = []; let nextCursor: string | null = null; let failed = false;
  try {
    const p = await partnerClient().notifications.inbox({ cursor: searchParams.cursor, limit: 50 });
    items = p.items; nextCursor = p.nextCursor;
  } catch { failed = true; }

  const title = (n: NotificationItem) => {
    const payload = n.payload as { title?: unknown; body?: unknown };
    return typeof payload.title === 'string' && payload.title ? payload.title : n.eventCode;
  };

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('notif.title')}</h1>
        <Link href="/notifications/preferences" className="kv-btn--link">{t.t('notif.prefsLink')} →</Link>
      </div>
      {failed ? <p className="kv-error" role="alert">{t.t('notif.loadError')}</p> : (
        <DataTable
          rows={items}
          empty={t.t('notif.empty')}
          columns={[
            { header: t.t('notif.colWhat'), cell: (n) => (n.readAt ? title(n) : <strong>{title(n)}</strong>) },
            { header: t.t('notif.colChannel'), cell: (n) => <span className="kv-badge">{n.channel}</span> },
            {
              header: t.t('notif.colActions'),
              cell: (n) => (n.readAt ? t.t('notif.read') : (
                <form action={markReadAction} className="kv-inline-form">
                  <input type="hidden" name="id" value={n.id} />
                  <button type="submit" className="kv-btn--link">{t.t('notif.markRead')}</button>
                </form>
              )),
            },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={`/notifications?cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}
    </section>
  );
}
