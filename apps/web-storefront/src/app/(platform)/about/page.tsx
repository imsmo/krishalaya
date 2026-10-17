// apps/web-storefront/src/app/(platform)/about/page.tsx · PC-56 STORE-SWEEP-a · C2 (canon W308; founder D5) — ABOUT, PLATFORM-ONLY. Rebuilt from the
// static page whose `about.p2` named payments, logistics and traceability as live while their flags are OFF (survey F-9). Two reads: the
// precomputed counts (`storefront.stats()`, as the platform home) and the platform facts (the press mailbox, migration 0223). Dynamic: Retry must
// read again. On a store's own host `/about` answers 307 to the platform's origin (middleware.ts); "Powered by" links here.
import type { Metadata } from 'next';
import type { PlatformFacts, StorefrontStats } from '@krishalaya/sdk-js';
import { getTranslator } from '../../../lib/i18n';
import { publicClient } from '../../../lib/api-client';
import { loadResult } from '../../../features/home/load-result';
import { AboutScreen } from '../../../components/sweep/AboutScreen';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('about.title'), description: t.t('about.visionNote') };
}

export default async function AboutPage() {
  const api = publicClient();
  const [stats, facts] = await Promise.all([
    loadResult<StorefrontStats>(() => api.storefront.stats()),
    loadResult<PlatformFacts>(() => api.storefront.platformFacts()),
  ]);
  return <AboutScreen stats={stats} facts={facts} />;
}
