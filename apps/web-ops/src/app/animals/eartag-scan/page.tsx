// apps/web-ops/src/app/animals/eartag-scan/page.tsx · PC-56 OPS-4b · W394 (canon `animals/eartag-scan`) — HONEST: THIS PAGE READS NOTHING (founder Q4-A / Q5-A, applied by the
// lead). Kiosk chrome (OPS-1c); zero inputs; no API call. Its "Retry" is DECOR: `?act=` opens the W3310–W3312 chain, which says there is nothing to read again.
import type { Metadata } from 'next';
import { requireSession } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { AnimalHonestView } from '../../../components/ops4/AnimalViews';
import { Ops4Chain } from '../../../components/ops4/Ops4Chain';
import { chain4State } from '../../../features/ops4/refusals';
import { ANIMALS } from '../../../features/ops4/upkeep';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('ops4.animals.eartag.title'), robots: { index: false, follow: false } }; }

export default async function AnimalEartagPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requireSession(ANIMALS.eartag);
  const t = getTranslator();
  const act = chain4State('eartag_act', searchParams);
  if (act) return <Ops4Chain t={t} chain="eartag_act" state={act} page={ANIMALS.eartag} />;
  return <AnimalHonestView t={t} surface="eartag" />;
}
