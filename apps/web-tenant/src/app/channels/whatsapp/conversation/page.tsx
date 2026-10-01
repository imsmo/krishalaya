// apps/web-tenant/src/app/channels/whatsapp/conversation/page.tsx · W426 — a WhatsApp conversation · PC-56 TENANT-8e.
// A NAMED REFUSAL. A WhatsApp thread cannot exist here: no inbound sink captures a customer's message (the canon's
// *"Messages remain queued server-side"* is false — nothing captures them), there is no 24-hour window to count, the
// canon's template names (`kv_order_confirmed_v2_gu` …) do not exist (zero WhatsApp templates), and `is_ai_generated` is
// written `false` by every insert — nothing drafts a reply. What DOES exist is the in-app thread (`/inbox/[id]`: post with
// the form's key, flag for moderation) — the page links there. PARITY-DECOR: the mini-list, the bubbles, the composer,
// *Use draft · Discard*, the window chips, *Reveal* (the real code is `member.pii.reveal`, not the canon's
// `support.pii.reveal`, and there is no WhatsApp number to reveal).
import type { Metadata } from 'next';
import { requireSession } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { WhatsAppRefusalScreen } from '../../../../components/WhatsAppRefusalScreen';
import { COMMS_HREF, INAPP_INBOX_HREF, WA_CONVERSATION_HREF } from '../../../../features/comms/broadcasts';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('wa.conversation.title'), robots: { index: false, follow: false } }; }

export default async function WhatsAppConversationPage() {
  await requireSession(WA_CONVERSATION_HREF);
  return <WhatsAppRefusalScreen screen="conversation" href={WA_CONVERSATION_HREF} gu="વોટ્સએપ વાતચીત"
    instead={[{ href: INAPP_INBOX_HREF, key: 'wa.instead.conversation' }, { href: COMMS_HREF, key: 'wa.instead.whatsappBroadcast' }]} />;
}
