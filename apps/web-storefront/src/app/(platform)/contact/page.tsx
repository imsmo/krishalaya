// apps/web-storefront/src/app/(platform)/contact/page.tsx · PC-56 STORE-SWEEP-a · C2 (canon W312; founders D3 / D7) — THE PLATFORM'S CONTACT PAGE. One
// read: the platform facts (the five mailboxes, the entity and the office — migration 0223). On a store's own host `/contact` is the STORE's page
// (rewritten to `/<slug>/contact` — brand-theme.ts `hostRewritePath`), never this one. `contact` is a reserved slug since 0204.
import type { Metadata } from 'next';
import type { PlatformFacts } from '@krishalaya/sdk-js';
import { getTranslator } from '../../../lib/i18n';
import { publicClient } from '../../../lib/api-client';
import { loadResult } from '../../../features/home/load-result';
import { ContactScreen } from '../../../components/sweep/ContactScreen';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('sweep.contact.title'), description: t.t('sweep.contact.lead') };
}

export default async function ContactPage() {
  const facts = await loadResult<PlatformFacts>(() => publicClient().storefront.platformFacts());
  return <ContactScreen facts={facts} />;
}
