// apps/web-tenant/src/app/channels/whatsapp/broadcast/page.tsx · W429 — a WhatsApp broadcast · PC-56 TENANT-8e.
// A NAMED REFUSAL for the WhatsApp half — *"Marketing-category templates, approved only — sent to the members who opted
// in"*, the opt-in maths (2,412 on file · 1,387 opted in to marketing), the WhatsApp result — because there is no provider,
// no marketing category, no WhatsApp template and no opt-in record (the cooperative's opt-in POLICY can be recorded on
// W430; consent is not collected). THE BROADCAST PLANE ITSELF IS REAL AND LIVES AT `/comms`: an in-app announcement with
// its honest maths (audience, templates en · hi · gu, quiet-hours impact), the form chain (*Save draft*), the mutate chain
// (*Send broadcast*, cancel a scheduled one) and a receipt counted from the delivery log. PARITY-DECOR: the template picker,
// the status filter, the pager.
import type { Metadata } from 'next';
import { requireSession } from '../../../../lib/session';
import { getTranslator } from '../../../../lib/i18n';
import { WhatsAppRefusalScreen } from '../../../../components/WhatsAppRefusalScreen';
import { BROADCAST_FORM_HREF, COMMS_HREF, WA_BROADCAST_HREF, WA_SETTINGS_HREF } from '../../../../features/comms/broadcasts';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('wa.broadcast.title'), robots: { index: false, follow: false } }; }

export default async function WhatsAppBroadcastPage() {
  await requireSession(WA_BROADCAST_HREF);
  return <WhatsAppRefusalScreen screen="broadcast" href={WA_BROADCAST_HREF} gu="વોટ્સએપ બ્રોડકાસ્ટ"
    instead={[{ href: COMMS_HREF, key: 'wa.instead.whatsappBroadcast' }, { href: BROADCAST_FORM_HREF, key: 'wa.instead.newAnnouncement' }, { href: WA_SETTINGS_HREF, key: 'wa.instead.marketingOptin' }]} />;
}
