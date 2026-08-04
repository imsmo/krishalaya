// apps/web-tenant/src/app/inbox/page.tsx · seller message inbox (PC-28b, queued from PC-27). The tenant-staff
// view of buyer↔seller conversations (messaging resource — membership-gated server-side, a non-participant gets
// 404). List with unread counts; thread + reply live at /inbox/[id]. Keyset paging; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import type { Conversation } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('inbox.title'), robots: { index: false, follow: false } };
}

export default async function InboxPage({ searchParams }: { searchParams: { cursor?: string } }) {
  await requireSession('/inbox');
  const t = getTranslator();
  const lang = getLang();

  let items: Conversation[] = []; let nextCursor: string | null = null; let failed = false;
  try {
    const p = await tenantClient().conversations.list({ cursor: searchParams.cursor, limit: 30 });
    items = p.items; nextCursor = p.nextCursor;
  } catch { failed = true; }

  return (
    <section>
      <h1>{t.t('inbox.title')}</h1>
      <p className="kv-field__hint">{t.t('inbox.hint')}</p>
      {failed ? <p className="kv-error" role="alert">{t.t('inbox.loadError')}</p> : (
        <DataTable
          rows={items}
          empty={t.t('inbox.empty')}
          columns={[
            {
              header: t.t('inbox.colConversation'),
              cell: (c) => (
                <Link href={`/inbox/${c.id}`} className="kv-link">
                  {t.t(`inbox.context.${c.contextType}`) || c.contextType}{c.contextId ? ` · ${c.contextId.slice(0, 8)}…` : ''}
                </Link>
              ),
            },
            { header: t.t('inbox.colUnread'), cell: (c) => (c.unreadCount ? <span className="kv-badge">{c.unreadCount}</span> : t.t('common.dash')) },
            { header: t.t('inbox.colStarted'), cell: (c) => (c.createdAt ? formatDate(c.createdAt, lang) : t.t('common.dash')) },
          ]}
        />
      )}
      {nextCursor && <p className="kv-pager"><a href={`/inbox?cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn--link">{t.t('common.nextPage')}</a></p>}
    </section>
  );
}
