// apps/web-tenant/src/app/channels/whatsapp/templates/editor/page.tsx · W428 — the WhatsApp template editor · PC-56 TENANT-8e.
// A NAMED REFUSAL over a real plane. The canon's editor is Meta's template model — category (utility · marketing ·
// authentication), a header, positional `{{1}}…{{4}}` with a sample per variable "required by Meta", a footer with a
// mandatory opt-out line for marketing, up to three buttons, *Submit for review* to Meta and a rejection reason from Meta.
// None of those columns exist (no category, header, footer, buttons or positional variables on `notification_templates`;
// the 0072 lifecycle columns are read and written by nothing), there is no Meta submission and no rejection ingestion
// (ADMIN-11b-Q1 owns the provider). What exists: 8a's override plane — a WhatsApp override is AUTHORED there (draft →
// submit → `submitted_to_provider`, which never serves) — and the canon's *Save draft* (W2841) is 8a's own form chain.
// PARITY-DECOR: the language chips, *Insert variable*, the counters, the phone preview, *Cancel*.
import type { Metadata } from 'next';
import { requireSession } from '../../../../../lib/session';
import { getTranslator } from '../../../../../lib/i18n';
import { WhatsAppRefusalScreen } from '../../../../../components/WhatsAppRefusalScreen';
import { TEMPLATES_HREF, WA_EDITOR_HREF, WA_TEMPLATES_HREF } from '../../../../../features/comms/broadcasts';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('wa.editor.title'), robots: { index: false, follow: false } }; }

export default async function WhatsAppTemplateEditorPage() {
  await requireSession(WA_EDITOR_HREF);
  return <WhatsAppRefusalScreen screen="editor" href={WA_EDITOR_HREF} gu="વોટ્સએપ ટેમ્પલેટ સંપાદક"
    instead={[{ href: WA_TEMPLATES_HREF, key: 'wa.instead.waTemplates' }, { href: `${TEMPLATES_HREF}/new?channel=whatsapp`, key: 'wa.instead.newOverride' }]} />;
}
