// apps/web-ops/src/app/chc/insights/page.tsx · PC-56 OPS-4a · W409 (canon `chc/insights`) — HONEST: THIS PAGE READS NOTHING. No revenue,
// utilisation, subsidy or month-to-date figure for machine hire exists on this platform, so none is shown; it says so. Its "Retry" is DECOR:
// `?act=` opens the W3304–W3306 chain, which says there is nothing to read again.
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { ChcInsightsView } from '../../../components/ops4/ChcViews';
import { Ops4Chain } from '../../../components/ops4/Ops4Chain';
import { chain4State } from '../../../features/ops4/refusals';
import { CHC } from '../../../features/ops4/chc';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops4.insights.title'), robots: { index: false, follow: false } };
}

export default async function ChcInsightsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession(CHC.insights);
  const t = getTranslator();
  const act = chain4State('chc_act', searchParams);
  if (act) return <Ops4Chain t={t} chain="chc_act" state={act} page={CHC.insights} reads={false} />;
  return <ChcInsightsView t={t} />;
}
