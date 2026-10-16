// apps/web-storefront/src/app/(platform)/messages/[id]/page.tsx · a chat thread. PROTECTED + dynamic; notFound() on a
// conversation the caller doesn't participate in (membership enforced server-side — no IDOR). Posting a message is a Server Action;
// markRead is best-effort on view. Voice/attachment messages show a localized label (their bytes live in S3, referenced by id).
//
// PC-56 HOTFIX-6 · C2 (survey STORE-4 F-1 / F-2, founder D2; HOTFIX-4 D3 "the organisation only"):
//   • the other side is the ORGANISATION — `conversations.get` answers the buyer's shape (the organisation's name when the other party
//     belongs to it, a party label, the order number as the context label), never a person's name;
//   • each message is labelled by `from` (you · the organisation · platform support · system) — the page reads no sender id and derives none;
//   • the Call button and the hidden farmer-uuid input are GONE: "Call" is refused by name (`features/store4/refusals.ts`, RefusalList
//     surface `thread`) until the cost owner and the consent notice are decided. No person id is ever written into this page.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { formatDate } from '@krishalaya/i18n';
import type { Conversation, Message } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { RefusalList } from '../../../../components/RefusalList';
import { postMessageAction } from './actions';

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
  try {
    convo = await client.conversations.get(params.id);
    messages = (await client.conversations.listMessages(params.id, { limit: 30 })).items.slice().reverse(); // API is newest-first → oldest→newest
    client.conversations.markRead(params.id).catch(() => {}); // best-effort; never blocks render
  } catch (e) {
    if (e instanceof SdkError && e.isNotFound) notFound();
    convo = null;
  }
  if (!convo) {
    return <section className="kv-thread"><h1>{t.t('messages.threadTitle')}</h1>
      <p className="kv-form__error" role="alert">{t.t('messages.loadError')}</p></section>;
  }

  const org = convo.counterpartyRole === 'organisation' && convo.counterpartyName ? convo.counterpartyName : null;
  const notice = searchParams.status === 'senderr' ? t.t('messages.sendError') : null;
  const bodyOf = (m: Message) => m.body ?? (m.voiceMediaId ? t.t('messages.voiceMessage') : m.attachmentMediaId ? t.t('messages.attachment') : '');
  const who = (m: Message) =>
    m.from === 'you' ? t.t('messages.you')
      : m.from === 'organisation' ? (org ?? t.t('store4.from.organisation'))
        : m.from === 'platform' ? t.t('store4.from.platform')
          : t.t('store4.from.system');

  return (
    <section className="kv-thread" data-kv-thread={convo.id}>
      <h1>{org ? t.t('store4.threadWith', { org }) : t.t('messages.threadTitle')}</h1>
      {convo.contextType === 'order' && convo.contextLabel && <p className="kv-detail__muted" data-kv-context="order">{t.t('store4.context.order', { no: convo.contextLabel })}</p>}
      {notice && <p className="kv-form__error" role="status">{notice}</p>}

      <ol className="kv-thread__msgs" aria-label={t.t('messages.threadTitle')}>
        {messages.length === 0 && <li className="kv-detail__muted">{t.t('messages.threadEmpty')}</li>}
        {messages.map((m) => {
          const mine = m.from === 'you';
          return (
            <li key={m.id} className={`kv-msg ${mine ? 'kv-msg--mine' : 'kv-msg--them'}`} data-kv-from={m.from ?? 'system'}>
              <span className="kv-msg__who">{who(m)}</span>
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

      <RefusalList surface="thread" />

      <p><Link href="/messages" className="kv-btn--link">{t.t('messages.back')}</Link></p>
    </section>
  );
}
