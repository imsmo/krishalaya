// apps/web-tenant/src/app/inbox/[id]/page.tsx · one conversation thread + reply (PC-28b). Membership is
// asserted SERVER-SIDE (non-participant → 404 = notFound, no IDOR). Opening marks it read (best-effort).
// Reply posts text via postMessage (Idempotency-Key); locked conversations show the state honestly.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatDate } from '@krishalaya/i18n';
import { replyAction } from './actions';
import type { Conversation, Message } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('inbox.threadTitle'), robots: { index: false, follow: false } };
}

const ERR = new Set(['reply', 'empty', 'locked']);

export default async function InboxThreadPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requireSession(`/inbox/${params.id}`);
  const t = getTranslator();
  const lang = getLang();
  const client = tenantClient();

  let convo: Conversation;
  try { convo = await client.conversations.get(params.id); }
  catch { notFound(); }

  let messages: Message[] = []; let messagesFailed = false;
  try { messages = (await client.conversations.listMessages(params.id, { limit: 50 })).items; }
  catch { messagesFailed = true; }

  try { await client.conversations.markRead(params.id); } catch { /* best-effort */ }

  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('inbox.threadTitle')}</h1>
        <Link href="/inbox" className="kv-btn--link">← {t.t('inbox.title')}</Link>
      </div>
      {searchParams.ok === 'sent' && <p className="kv-success" role="status">{t.t('inbox.ok.sent')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`inbox.error.${errKey}`)}</p>}

      {messagesFailed ? <p className="kv-error" role="alert">{t.t('inbox.loadError')}</p> : messages.length === 0 ? (
        <p className="kv-muted">{t.t('inbox.threadEmpty')}</p>
      ) : (
        <ul className="kv-thread">
          {messages.map((m) => (
            <li key={m.id} className="kv-thread__item">
              <p className="kv-thread__body">{m.body ?? t.t('inbox.mediaMessage')}</p>
              <span className="kv-muted">{m.createdAt ? formatDate(m.createdAt, lang) : ''}</span>
            </li>
          ))}
        </ul>
      )}

      {convo.isLocked ? (
        <p className="kv-field__hint kv-note">{t.t('inbox.locked')}</p>
      ) : (
        <form action={replyAction} className="kv-form kv-card">
          <input type="hidden" name="id" value={convo.id} />
          <label htmlFor="ib-body" className="kv-field__label">{t.t('inbox.reply')}</label>
          <textarea id="ib-body" name="body" className="kv-textarea" rows={3} required maxLength={4000} />
          <button type="submit" className="kv-btn">{t.t('inbox.send')}</button>
        </form>
      )}
    </section>
  );
}
