// apps/web-storefront/src/components/sweep/StoreContactScreen.tsx · PC-56 STORE-SWEEP-a · C2 (founder D6) — A STORE'S OWN CONTACT PAGE
// (`/<slug>/contact`, and `/contact` on the store's own host). The organisation publishes no address (none exists in `PublishedBrand`), so the page
// offers what is real: "Message the organisation" about an ORDER or a LOT — the 4b button lives on the order page and the lot page (links: your
// orders, browse lots) — behind THIS store's `communication` flag (ON → the two doors; OFF → "this organisation has not switched on messages";
// unreadable → said so); phone, short code, chat app, callbacks and "one ticket system" refused by name, and a general-enquiry thread queued by
// name (B10). The platform's Grievances link (trust is not re-brandable). Organisation-neutral words — no platform name.
import { getTranslator } from '../../lib/i18n';
import { RefusalList } from '../RefusalList';
import type { AccountChrome } from '../../features/store4a/account';
import { grievancesHref } from '../../features/sweep/paths';
import { helpLinkHref } from './HelpScreen';

export type MessagesState = 'on' | 'off' | 'unknown';
export function messagesState(flags: { communication?: boolean } | null | undefined): MessagesState {
  if (!flags) return 'unknown';
  return flags.communication === true ? 'on' : 'off';
}

export function StoreContactScreen({ chrome, name, messages, platformOrigin }: { chrome: AccountChrome; name: string; messages: MessagesState; platformOrigin: string }) {
  const t = getTranslator();
  const home = chrome.kind === 'tenant' ? `/${encodeURIComponent(chrome.slug)}` : '/';
  return (
    <article className="kv-prose" data-kv-contact="store" data-kv-messages={messages}>
      <h1>{t.t('sweep.storeContact.title', { org: name })}</h1>
      <p className="kv-prose__lead">{t.t('sweep.storeContact.lead')}</p>
      {messages === 'on' && (
        <>
          <ul data-kv-contact-section="doors">
            <li data-kv-door="order">{t.t('sweep.storeContact.order')} <a href={helpLinkHref(chrome, 'orders')} className="kv-btn--link" data-kv-link="orders">{t.t('help.link.orders')}</a></li>
            <li data-kv-door="lot">{t.t('sweep.storeContact.lot')} <a href={home} className="kv-btn--link" data-kv-link="browse">{t.t('sweep.storeContact.browse')}</a></li>
          </ul>
          <p>{t.t('sweep.storeContact.signIn')}</p>
        </>
      )}
      {messages === 'off' && <p className="kv-state" role="status" data-kv-state="messages-off">{t.t('sweep.storeContact.off')}</p>}
      {messages === 'unknown' && <p className="kv-state" role="status" data-kv-state="messages-unknown">{t.t('sweep.storeContact.unknown')}</p>}
      <section data-kv-contact-section="grievances" aria-labelledby="kv-store-contact-griev">
        <h2 id="kv-store-contact-griev">{t.t('sweep.footer.grievances')}</h2>
        <p>{t.t('sweep.storeContact.grievances')} <a href={grievancesHref(chrome, platformOrigin)} className="kv-btn--link" data-kv-link="grievances">{t.t('sweep.footer.grievances')}</a></p>
      </section>
      <RefusalList surface="contact_store" />
    </article>
  );
}
