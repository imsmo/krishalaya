// apps/web-storefront/src/app/[tenantSlug]/messages/page.tsx · PC-56 STORE-4b · C1 — canon W297 "Messages", under the ORGANISATION's chrome
// (founder Q13: a buyer's threads are WITH THE ORGANISATION; the platform /messages is a door — lib/store-door.ts). PROTECTED + dynamic.
//   • this store's `communication` flag OFF → the honest sentence and NO API call (the "Flagged off — see store settings" copy is reworded);
//   • `conversations.list({ scope: 'organisation' })` — order and listing threads only (platform support is refused by name);
//   • each row: the organisation's name (never a person), the context chip (the order number / the listing's title), the preview ("You: …";
//     a reported message → "hidden pending review"; none → "No messages yet"), the unread count, the last-message time, the lock with its kind;
//   • keyset Next only; empty: "Threads start from an order, an offer or a listing — context first" (TRUE now: STORE-4b's entry points);
//   • a load error is NOT empty — said, with a Retry that reloads (W3112–W3114 are DECOR); an entry point's failure is said by name;
//   • the refusals by name (RefusalList surface `messages`).
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDate } from '@krishalaya/i18n';
import type { Conversation, StorefrontFlags } from '@krishalaya/sdk-js';
import { serverClient, publicClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import { reloadHref } from '../../../features/home/load-result';
import { contextChip, lockKey, messagesHref, previewOf, readMessagesQuery } from '../../../features/store4b/messages';
import { threadHref } from '../../../features/store4b/thread';
import { RefusalList } from '../../../components/RefusalList';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('messages.title'), robots: { index: false, follow: false } };
}

export default async function TenantMessagesPage({ params, searchParams }: { params: { tenantSlug: string }; searchParams: SP }) {
  const slug = params.tenantSlug;
  const { cursor, openFailure } = readMessagesQuery(searchParams);
  await requireSession(messagesHref(slug, { cursor }));
  const t = getTranslator();
  const lang = getLang();

  let flags: StorefrontFlags | null = null;
  try { flags = await publicClient(slug).storefront.flags(); } catch { flags = null; }
  const head = (
    <>
      <h1>{t.t('messages.title')}</h1>
      <p className="kv-detail__muted" data-kv-lead="context">{t.t('store4b.messages.lead')}</p>
      {openFailure && <p className="kv-form__error" role="alert" data-kv-failure={`open-${openFailure}`}>{t.t(`store4b.open.failure.${openFailure}`)}</p>}
    </>
  );
  if (flags !== null && flags.communication !== true) {
    return (
      <section className="kv-threads" data-kv-screen="messages" data-kv-store={slug}>
        {head}
        <div className="kv-state" role="status" data-kv-state="off"><p>{t.t('store4b.messages.off')}</p></div>
        <RefusalList surface="messages" />
      </section>
    );
  }

  let items: Conversation[] = [];
  let nextCursor: string | null = null;
  let failed = flags === null;   // the store's switches unreadable: never guess ON — said, with a Retry
  if (!failed) {
    try {
      const page = await serverClient(slug).conversations.list({ scope: 'organisation', cursor, limit: 20 });
      items = page.items; nextCursor = page.nextCursor;
    } catch { failed = true; }
  }
  if (failed) {
    return (
      <section className="kv-threads" data-kv-screen="messages" data-kv-store={slug}>
        {head}
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('store4b.messages.loadError')}</p>
          <a href={reloadHref(`/${encodeURIComponent(slug)}/messages`, searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
        <RefusalList surface="messages" />
      </section>
    );
  }

  return (
    <section className="kv-threads" data-kv-screen="messages" data-kv-store={slug}>
      {head}
      {items.length === 0 ? (
        <div className="kv-state" data-kv-state="empty"><p className="kv-empty">{t.t('store4b.messages.empty')}</p></div>
      ) : (
        <ul className="kv-threads__list">
          {items.map((c) => {
            const chip = contextChip(c);
            const pv = previewOf(c);
            const org = c.counterpartyRole === 'organisation' && c.counterpartyName ? c.counterpartyName : t.t('store4.from.organisation');
            const unread = c.unreadCount ?? 0;
            const at = c.lastMessageAt ?? c.createdAt;
            const words = pv.kind === 'text' ? pv.text : pv.kind === 'voice' ? t.t('messages.voiceMessage') : pv.kind === 'attachment' ? t.t('messages.attachment') : '';
            return (
              <li key={c.id} className={`kv-threads__item${unread > 0 ? ' kv-threads__item--unread' : ''}`} data-kv-thread-row={c.contextType}>
                <Link href={threadHref(slug, c.id)} className="kv-threads__link">
                  <span className="kv-threads__org" data-kv-org>{org}</span>
                  <span className="kv-chip" data-kv-chip={chip.kind}>
                    {chip.kind === 'other' ? t.t(`messages.context.${chip.type}`) : chip.kind === 'order' ? t.t('store4.context.order', { no: chip.label }) : t.t('store4b.chip.listing', { title: chip.label })}
                  </span>
                  <span className="kv-threads__preview" data-kv-preview={pv.kind}>
                    {pv.kind === 'hidden' ? t.t('store4b.messages.hiddenPreview')
                      : pv.kind === 'none' ? t.t('store4b.messages.noPreview')
                        : pv.fromYou ? t.t('store4b.messages.youPrefix', { text: words }) : words}
                  </span>
                  {unread > 0 && <span className="kv-header__badge" data-kv-unread={unread}>{t.t('store4b.messages.unread', { n: unread })}</span>}
                  {at && <span className="kv-detail__muted" data-kv-at>{formatDate(at, lang, { dateStyle: 'medium', timeStyle: 'short' })}</span>}
                  {c.isLocked && <span className="kv-cart__warn" data-kv-lock={c.lockKind ?? 'owner'}>{t.t(lockKey(c.lockKind))}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {nextCursor && (
        <p className="kv-loadmore"><Link href={messagesHref(slug, { cursor: nextCursor })} className="kv-btn kv-btn--ghost" rel="next" data-kv-next>{t.t('discover.nextPage')}</Link></p>
      )}
      <RefusalList surface="messages" />
    </section>
  );
}
