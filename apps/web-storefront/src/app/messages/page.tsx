// apps/web-storefront/src/app/messages/page.tsx · the buyer's conversations. PROTECTED + dynamic. conversations.list
// is keyset-paged; the API + RLS scope to conversations the caller participates in. Each links to its thread.
// Degrades to empty/error (Law 12). No PII — the conversation read-model carries only a context label + id.
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate } from '@krishalaya/i18n';
import type { Conversation } from '@krishalaya/sdk-js';
import { serverClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator, getLang } from '../../lib/i18n';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('messages.title'), robots: { index: false, follow: false } };
}

export default async function MessagesPage({ searchParams }: { searchParams: { cursor?: string } }) {
  await requireSession('/messages');
  const t = getTranslator();
  const lang = getLang();

  let items: Conversation[] = [];
  let nextCursor: string | null = null;
  let failed = false;
  try {
    const page = await serverClient().conversations.list({ cursor: searchParams.cursor, limit: 20 });
    items = page.items; nextCursor = page.nextCursor;
  } catch { failed = true; }

  if (failed) {
    return <section className="kv-threads"><h1>{t.t('messages.title')}</h1>
      <p className="kv-form__error" role="alert">{t.t('messages.loadError')}</p></section>;
  }

  const contextLabel = (c: string) => { const k = `messages.context.${c.toLowerCase()}`; const l = t.t(k); return l === k ? c : l; };

  return (
    <section className="kv-threads">
      <h1>{t.t('messages.title')}</h1>
      {items.length === 0 ? (
        <p className="kv-empty">{t.t('messages.empty')}</p>
      ) : (
        <ul className="kv-threads__list">
          {items.map((c) => (
            <li key={c.id} className="kv-threads__item">
              <Link href={`/messages/${encodeURIComponent(c.id)}`} className="kv-threads__link">
                <span className="kv-threads__ctx">{contextLabel(c.contextType)}</span>
                {c.createdAt && <span className="kv-detail__muted">{formatDate(c.createdAt, lang)}</span>}
                {c.isLocked && <span className="kv-cart__warn">{t.t('messages.locked')}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {nextCursor && (
        <p className="kv-loadmore"><Link href={`/messages?cursor=${encodeURIComponent(nextCursor)}`} className="kv-btn kv-btn--ghost" rel="next">{t.t('discover.nextPage')}</Link></p>
      )}
    </section>
  );
}
