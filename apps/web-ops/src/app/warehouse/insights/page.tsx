// apps/web-ops/src/app/warehouse/insights/page.tsx · PC-56 OPS-2c · W379 (canon `warehouse/insights`) — WAREHOUSE INSIGHTS, AN HONEST PAGE THAT
// READS NOTHING. No API call at all: every visit prints the same page. `?export=queued|ready` is the W3360–W3361 chain (DECOR; Back → here).
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { InsightsView } from '../../../components/ops2/InsightsView';
import { Ops2Chain } from '../../../components/ops2/Ops2Chain';
import { chain2State } from '../../../features/ops2/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops2.insights.title'), robots: { index: false, follow: false } };
}

export default async function WarehouseInsightsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession('/warehouse/insights');
  const t = getTranslator();
  const exp = chain2State('wh_export', searchParams);
  if (exp) return <Ops2Chain t={t} chain="wh_export" state={exp} />;
  return <InsightsView t={t} />;
}
