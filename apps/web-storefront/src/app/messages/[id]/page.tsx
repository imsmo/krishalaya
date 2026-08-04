// apps/web-storefront/src/app/messages/[id]/page.tsx · a chat thread. PROTECTED + dynamic; notFound() on a
// conversation the caller doesn't participate in (membership enforced server-side — no IDOR). Reads the
// conversation + recent messages + the caller's own id (auth.me) to align bubbles and derive the COUNTERPART
// (the other participant's user id, taken from a message they sent — the read-model lists no participants). The
// masked-call CTA passes only that USER id; no phone number is ever fetched or shown. Posting a message + the
// call are Server Actions. markRead is best-effort on view. Voice/attachment messages show a localized label
// (their bytes live in S3, referenced by id).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatDate } from '@krishalaya/i18n';
import type { Conversation, Message } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import { postMessageAction, initiateCallAction } from './actions';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('messages.threadTitle'), robots: { index: false, follow: false } };
}

export default async function ThreadPage({ params, searchParams }: { params: { id: string }; searchParams: { status?: string } }) {
  await requireSession(`/messages/${encodeURIComponent(params.id)}`);
  const t = getTranslator();
  const lang = getLang();
  const client = serverClient();

  let convo: Conversation | null = null;
  let messages: Message[] = [];
  let myId = '';
  try {
    convo = await client.conversations.get(params.id);
    const [msgPage, me] = await Promise.all([client.conversations.listMessages(params.id, { limit: 30 }), client.auth.me()]);
    messages = msgPage.items.slice().reverse(); // API is newest-first → show oldest→newest
    myId = me.id;
    client.conversations.markRead(params.id).catch(() => {}); // best-effort; never blocks render
  } catch (e) {
    if (e instanceof SdkError && e.isNotFound) notFound();
    convo = null;
  }
  if (!convo) {
    return <section className="kv-thread"><h1>{t.t('messages.threadTitle')}</h1>
      <p className="kv-form__error" role="alert">{t.t('messages.loadError')}</p></section>;
  }

  const counterpartId = messages.find((m) => m.senderUserId && m.senderUserId !== myId)?.senderUserId ?? null;
  const notice =
    searchParams.status === 'calling' ? { kind: 'ok', msg: t.t('messages.callConnecting') } :
    searchParams.status === 'callerr' ? { kind: 'err', msg: t.t('messages.callError') } :
    searchParams.status === 'senderr' ? { kind: 'err', msg: t.t('messages.sendError') } : null;

  const bodyOf = (m: Message) => m.body ?? (m.voiceMediaId ? t.t('messages.voiceMessage') : m.attachmentMediaId ? t.t('messages.attachment') : '');

  return (
    <section className="kv-thread">
      <h1>{t.t('messages.threadTitle')}</h1>
      {notice && <p className={notice.kind === 'ok' ? 'kv-form__notice' : 'kv-form__error'} role="status">{notice.msg}</p>}

      <ol className="kv-thread__msgs" aria-label={t.t('messages.threadTitle')}>
        {messages.length === 0 && <li className="kv-detail__muted">{t.t('messages.threadEmpty')}</li>}
        {messages.map((m) => {
          const mine = m.senderUserId === myId;
          return (
            <li key={m.id} className={`kv-msg ${mine ? 'kv-msg--mine' : 'kv-msg--them'}`}>
              <span className="kv-msg__who">{mine ? t.t('messages.you') : t.t('messages.them')}</span>
              <span className="kv-msg__body">{bodyOf(m)}</span>
              {m.createdAt && <span className="kv-msg__time">{formatDate(m.createdAt, lang, { dateStyle: 'short', timeStyle: 'short' })}</span>}
            </li>
          );
        })}
      </ol>

      {convo.isLocked ? (
        <p className="kv-cart__warn" role="status">{t.t('messages.locked')}</p>
      ) : (
        <form action={postMessageAction} className="kv-thread__compose">
          <input type="hidden" name="conversationId" value={convo.id} />
          <label htmlFor="msg-body" className="kv-visually-hidden">{t.t('messages.composePlaceholder')}</label>
          <input id="msg-body" name="body" type="text" maxLength={4000} className="kv-field__input" placeholder={t.t('messages.composePlaceholder')} required />
          <button type="submit" className="kv-btn">{t.t('messages.send')}</button>
        </form>
      )}

      {counterpartId && (
        <form action={initiateCallAction} className="kv-thread__call">
          <input type="hidden" name="conversationId" value={convo.id} />
          <input type="hidden" name="calleeUserId" value={counterpartId} />
          <input type="hidden" name="contextType" value={convo.contextType} />
          {convo.contextId && <input type="hidden" name="contextId" value={convo.contextId} />}
          <button type="submit" className="kv-btn--ghost kv-btn">{t.t('messages.callCta')}</button>
          <span className="kv-field__hint">{t.t('messages.callPrivacy')}</span>
        </form>
      )}

      <p><Link href="/messages" className="kv-btn--link">{t.t('messages.back')}</Link></p>
    </section>
  );
}
