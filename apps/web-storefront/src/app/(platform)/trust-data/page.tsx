// apps/web-storefront/src/app/(platform)/trust-data/page.tsx · PC-56 STORE-SWEEP-a · C2 (canon W310 at `(public)/trust` — DELTA `trust_route`; founders
// D2 / D3) — TRUST & YOUR DATA, PLATFORM-ONLY (a store host answers 307 to the platform's origin; every store's footer links `#grievances` here).
// One read: the platform facts (migration 0223). No flag (0223's named Law 10 exception: a grievance address has no kill-switch). `trust-data` is a
// reserved slug since 0204.
import type { Metadata } from 'next';
import type { PlatformFacts } from '@krishalaya/sdk-js';
import { getTranslator } from '../../../lib/i18n';
import { publicClient } from '../../../lib/api-client';
import { loadResult } from '../../../features/home/load-result';
import { TrustScreen } from '../../../components/sweep/TrustScreen';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('sweep.trust.title'), description: t.t('sweep.trust.lead') };
}

export default async function TrustDataPage() {
  const facts = await loadResult<PlatformFacts>(() => publicClient().storefront.platformFacts());
  return <TrustScreen facts={facts} />;
}
