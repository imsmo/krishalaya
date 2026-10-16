// apps/web-storefront/src/app/[tenantSlug]/messages/[id]/page.tsx · PC-56 STORE-4b · C2 — canon W298 "Conversation", under the ORGANISATION's
// chrome (founder Q13; the platform /messages/[id] is a door carrying the id). PROTECTED + dynamic; a thread that is not the buyer's → notFound().
//   • this store's `communication` flag OFF → the honest sentence and NO API call;
//   • the header = the ORGANISATION's name (HOTFIX-6's buyer shape — never a person, never "KYC ✓");
//   • the context strip: the order number + "Open order" (→ /<slug>/orders/[id]) or the listing's title + "Open listing" (→ /<slug>/listings/[id]);
//   • messages by `from` with the time; a REPORTED message prints "hidden pending review" (the API served no body — founder D2b); a voice note
//     its label (playback refused by name — D4); an attachment its label; ⋮ "Report" on another party's message → the report chain (W3109);
//   • the composer: the key MINTED AT RENDER (`send:<uuid>`, hidden) → postMessageAction → ?status=sent | senderr&code=…; a locked thread:
//     "Readable forever, writable never" + the kind's sentence, and no composer;
//   • W3110 success (?status=reported) — "Reported — hidden from you pending review"; the refusals by name (surface `thread`: call (HOTFIX-6),
//     block, translation, transcript, voice playback, waveform, mic, AI, KYC, read receipts, offline queue, safety desk, flagged off);
//   • `markRead` best effort; no person's id anywhere in the page (the thread's, the messages', the context's and the keys' ids only).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { randomUUID } from 'crypto';
import { formatDate } from '@krishalaya/i18n';
import type { Conversation, Message, StorefrontFlags } from '@krishalaya/sdk-js';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient, publicClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { reloadHref } from '../../../../features/home/load-result';
import { lockKey, messagesHref } from '../../../../features/store4b/messages';
import { bodyView, canReport, contextLink, readThreadQuery, reportHref, threadHref, whoKey } from '../../../../features/store4b/thread';
import { RefusalList } from '../../../../components/RefusalList';
import { postMessageAction } from './actions';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('messages.threadTitle'), robots: { index: false, follow: false } };
}

export default async function TenantThreadPage({ params, searchParams }: { params: { tenantSlug: string; id: string }; searchParams: SP }) {
  const slug = params.tenantSlug;
  await requireSession(threadHref(slug, params.id));
  const t = getTranslator();
  const lang = getLang();
  const { status, code } = readThreadQuery(searchParams);
  const back = <p><Link href={messagesHref(slug)} className="kv-btn--link" data-kv-back>{t.t('messages.back')}</Link></p>;

  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(slug).storefront.flags(); } catch { flags = null; }
  if (flags !== null && flags.communication !== true) {
    return (
      <section className="kv-thread" data-kv-screen="thread" data-kv-store={slug}>
        <h1>{t.t('messages.threadTitle')}</h1>
        <div className="kv-state" role="status" data-kv-state="off"><p>{t.t('store4b.messages.off')}</p></div>
        <RefusalList surface="thread" />
        {back}
      </section>
    );
  }

  const api = serverClient(slug);
  let convo: Conversation | null = null;
  let messages: Message[] = [];
  if (flags !== null) {
    try {
      convo = await api.conversations.get(params.id);
      messages = (await api.conversations.listMessages(params.id, { limit: 30 })).items.slice().reverse();   // newest-first → oldest→newest
      api.conversations.markRead(params.id).catch(() => undefined);                                           // best effort; never blocks render
    } catch (e) {
      if (e instanceof SdkError && e.isNotFound) notFound();
      convo = null;
    }
  }
  if (!convo) {
    return (
      <section className="kv-thread" data-kv-screen="thread" data-kv-store={slug}>
        <h1>{t.t('messages.threadTitle')}</h1>
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('store4b.thread.loadError')}</p>
          <a href={reloadHref(threadHref(slug, params.id), searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
        <RefusalList surface="thread" />
        {back}
      </section>
    );
  }

  const org = convo.counterpartyRole === 'organisation' && convo.counterpartyName ? convo.counterpartyName : null;
  const link = contextLink(slug, convo);
  const who = (m: Message) => (m.from === 'organisation' && org ? org : t.t(whoKey(m.from)));
  const banner = status === 'sent' ? { cls: 'kv-form__notice', key: 'store4b.thread.sent', role: 'status' as const }
    : status === 'reported' ? { cls: 'kv-form__notice', key: 'store4b.report.success', role: 'status' as const }
      : status === 'senderr' ? { cls: 'kv-form__error', key: code && code.startsWith('lock_') ? `store4b.lock.sentence.${code.slice(5)}` : `store4b.thread.sendFailure.${code ?? 'server'}`, role: 'alert' as const }
        : null;

  return (
    <section className="kv-thread" data-kv-screen="thread" data-kv-thread={convo.id} data-kv-store={slug}>
      <h1>{org ? t.t('store4.threadWith', { org }) : t.t('messages.threadTitle')}</h1>
      {link && (
        <p className="kv-thread__context" data-kv-context={link.kind}>
          <span>{link.kind === 'order'
            ? (convo.contextLabel ? t.t('store4.context.order', { no: convo.contextLabel }) : t.t('messages.context.order'))
            : (convo.contextLabel ? t.t('store4b.chip.listing', { title: convo.contextLabel }) : t.t('messages.context.listing'))}</span>
          {' · '}
          <Link href={link.href} className="kv-link" data-kv-context-link={link.kind}>{t.t(link.kind === 'order' ? 'store4b.thread.openOrder' : 'store4b.thread.openListing')}</Link>
        </p>
      )}
      {banner && <p className={banner.cls} role={banner.role} data-kv-status={status}>{t.t(banner.key)}</p>}

      <ol className="kv-thread__msgs" aria-label={t.t('messages.threadTitle')}>
        {messages.length === 0 && <li className="kv-detail__muted" data-kv-state="no-messages">{t.t('messages.threadEmpty')}</li>}
        {messages.map((m) => {
          const mine = m.from === 'you';
          const v = bodyView(m);
          return (
            <li key={m.id} className={`kv-msg ${mine ? 'kv-msg--mine' : 'kv-msg--them'}`} data-kv-from={m.from ?? 'system'} data-kv-body={v.kind}>
              <span className="kv-msg__who">{who(m)}</span>
              <span className="kv-msg__body">
                {v.kind === 'hidden' ? t.t('store4b.thread.hidden')
                  : v.kind === 'text' ? v.text
                    : v.kind === 'voice' ? t.t('messages.voiceMessage')
                      : v.kind === 'attachment' ? t.t('messages.attachment') : ''}
              </span>
              {m.createdAt && <span className="kv-msg__time">{formatDate(m.createdAt, lang, { dateStyle: 'short', timeStyle: 'short' })}</span>}
              {!convo!.isLocked && canReport(m) && (
                <Link href={reportHref(slug, convo!.id, m.id)} className="kv-btn--link kv-msg__report" data-kv-report={m.id} aria-label={t.t('store4b.thread.reportLabel')}>{t.t('store4b.thread.report')}</Link>
              )}
            </li>
          );
        })}
      </ol>

      {convo.isLocked ? (
        <div className="kv-state" role="status" data-kv-state="locked" data-kv-lock={convo.lockKind ?? 'owner'}>
          <p><strong>{t.t('store4b.thread.lockedTitle')}</strong></p>
          <p>{t.t(`store4b.lock.sentence.${convo.lockKind === 'moderator' || convo.lockKind === 'dispute' ? convo.lockKind : 'owner'}`)}</p>
          <p className="kv-detail__muted">{t.t(lockKey(convo.lockKind))}</p>
        </div>
      ) : (
        <form action={postMessageAction} className="kv-thread__compose" data-kv-form="send">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="conversationId" value={convo.id} />
          <input type="hidden" name="key" value={`send:${randomUUID()}`} />
          <label htmlFor="msg-body" className="kv-visually-hidden">{t.t('messages.composePlaceholder')}</label>
          <input id="msg-body" name="body" type="text" maxLength={4000} className="kv-field__input" placeholder={t.t('messages.composePlaceholder')} required />
          <button type="submit" className="kv-btn">{t.t('messages.send')}</button>
          <p className="kv-detail__muted" data-kv-once>{t.t('store4b.thread.sendOnce')}</p>
        </form>
      )}

      <RefusalList surface="thread" />
      {back}
    </section>
  );
}
