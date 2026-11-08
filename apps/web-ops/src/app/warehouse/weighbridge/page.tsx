// apps/web-ops/src/app/warehouse/weighbridge/page.tsx · PC-56 OPS-2a · W371 (canon `warehouse/weighbridge`) — WEIGHBRIDGE, AN HONEST PAGE THAT READS
// NOTHING (founder Q6-A, 2026-11-06): this platform records no weighment. No API call at all; zero inputs. `?export=queued|ready` is the W3355–W3356
// chain ("Print slip") and `?act=confirm|success|failure` the W3357–W3359 chain ("Retry"), both DECOR; Back → here.
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { WeighbridgeView } from '../../../components/ops2/IntakeViews';
import { Ops2Chain } from '../../../components/ops2/Ops2Chain';
import { chain2State } from '../../../features/ops2/refusals';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ops2.weighbridge.title'), robots: { index: false, follow: false } };
}

export default async function WeighbridgePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession('/warehouse/weighbridge');
  const t = getTranslator();
  const exp = chain2State('weighbridge_export', searchParams);
  if (exp) return <Ops2Chain t={t} chain="weighbridge_export" state={exp} />;
  const act = chain2State('weighbridge_act', searchParams);
  if (act) return <Ops2Chain t={t} chain="weighbridge_act" state={act} />;
  return <WeighbridgeView t={t} />;
}
