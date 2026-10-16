// apps/web-storefront/src/components/MessageOrgButton.tsx · PC-56 STORE-4b · C4 (founder D1; re-opening STORE-3a's "Get help on this order" and
// STORE-3b's "Message seller") — "Message the organisation" about an ORDER (the buyer's) or a LISTING (an offer's lot, or the listing page). A
// form, no client JS: the key is MINTED HERE AT RENDER (`openorg:<uuid>`), so a double tap opens one thread; the server validates the context
// in this store and resolves who answers (never a person picked by the page). The caller decides whether to draw it (`showsMessageOrg`:
// signed in AND this store's `communication` flag ON).
import { randomUUID } from 'crypto';
import { getTranslator } from '../lib/i18n';
import { openOrganisationThreadAction } from '../app/[tenantSlug]/messages/actions';

export function MessageOrgButton({ slug, contextType, contextId, labelKey }: { slug: string; contextType: 'order' | 'listing'; contextId: string; labelKey: string }) {
  const t = getTranslator();
  return (
    <form action={openOrganisationThreadAction} className="kv-inline-form" data-kv-form="message-org" data-kv-context={contextType}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="contextType" value={contextType} />
      <input type="hidden" name="contextId" value={contextId} />
      <input type="hidden" name="key" value={`openorg:${randomUUID()}`} />
      <button type="submit" className="kv-btn kv-btn--muted" data-kv-act="message-org">{t.t(labelKey)}</button>
    </form>
  );
}
