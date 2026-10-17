// apps/web-storefront/src/app/(platform)/quality-promise/page.tsx · PC-56 STORE-SWEEP-a · C2 (canon W309 at `(public)/quality` — DELTA `quality_route`;
// founder D1) — the quality promise under the PLATFORM chrome. The SHARED screen; the dispute rules print under "each organisation decides whether
// its store takes disputes". No flag (0223's named Law 10 exception). `quality-promise` is a reserved slug since 0204.
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';
import { QualityPromiseScreen } from '../../../components/sweep/QualityPromiseScreen';
import { PLATFORM_CHROME } from '../../../features/store4a/account';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('sweep.quality.title'), description: t.t('sweep.quality.lead') };
}

export default function QualityPromisePage() {
  return <QualityPromiseScreen chrome={PLATFORM_CHROME} disputes="unknown" />;
}
