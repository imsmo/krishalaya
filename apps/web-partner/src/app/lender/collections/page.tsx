// apps/web-partner/src/app/lender/collections/page.tsx · PC-56 PARTNER-5b · W219 (canon `lender/collections`) — AN HONEST PAGE THAT READS
// NOTHING (founder 5b-1 / 5b-2, door Q5; the W217 shape): a lender does not collect on this platform. The page makes NO partner read — so it
// writes NO audit row and has NO error state of its own — and its state is the platform's public, client-safe flag map (`partner_console`
// OFF prints OFF). `?act=confirm|success|failure` is the W2918–W2920 chain (DECOR — "Take next case" is a refused act and nothing is read,
// so nothing is re-read) and is checked FIRST. An insurer is sent to its own dashboard. Certified readless by test/readless.spec.ts.
import type { Metadata } from 'next';
import { requirePartner } from '../../../lib/session';
import { getTranslator } from '../../../lib/i18n';
import { lenderGate, lenderSwitches } from '../../../lib/lender';
import { LenderCollectionsView } from '../../../components/partner5/LenderCollectionsView';
import { LenderChain5 } from '../../../components/partner5/LenderChain5';
import { chain5State } from '../../../features/partner5/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('partner5.collections.title'), robots: { index: false, follow: false } };
}

export default async function LenderCollectionsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePartner();
  const t = getTranslator();
  await lenderGate();
  const act = chain5State('collections_act', searchParams);
  if (act) return <LenderChain5 t={t} chain="collections_act" state={act} />;
  return <LenderCollectionsView t={t} state={await lenderSwitches()} />;
}
